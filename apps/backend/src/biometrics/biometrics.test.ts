/**
 * Face matching, tested against real images and the real networks.
 *
 * The fixtures (src/tests/fixtures/faces) are one synthetic identity in three
 * head poses, mirrored copies of it, and two photographs of a different
 * person. Mirroring changes every pixel and flips the pose, so matching the
 * mirrored set against a template built from the originals is a genuine
 * same-person test, not the same bytes compared with themselves.
 */
import fs from 'fs'
import path from 'path'
import { describe, it, expect, beforeAll } from 'vitest'
import { classifyPose, randomSequence, sequenceMatches, yawRatio, POSES } from './pose.js'
import { THRESHOLDS, clampThreshold, distance, identify, mean, spread } from './matching.js'
import { openTemplate, sealTemplate, templateContext, templateKeyConfigured } from './templateCrypto.js'
import { analyzeFrame, checkImage, imageHeader, ImageRejected, type FaceObservation } from './engine.js'

const FIX = path.join(__dirname, '..', 'tests', 'fixtures', 'faces')
const img = (name: string) => fs.readFileSync(path.join(FIX, name))

describe('pose', () => {
  it('reads yaw from the nose position between the jaw edges', () => {
    const pts = Array.from({ length: 68 }, () => ({ x: 0, y: 0 }))
    pts[0] = { x: 100, y: 0 }
    pts[16] = { x: 200, y: 0 }
    pts[30] = { x: 150, y: 0 }
    expect(yawRatio(pts)).toBeCloseTo(0)
    pts[30] = { x: 180, y: 0 }
    expect(yawRatio(pts)).toBeCloseTo(0.3)
  })

  it('refuses landmark sets that are not the 68-point model', () => {
    expect(yawRatio([])).toBeNull()
    expect(yawRatio(Array.from({ length: 5 }, () => ({ x: 1, y: 1 })))).toBeNull()
  })

  it('classifies centre, turns, and the band between them', () => {
    expect(classifyPose(0.02)).toBe('center')
    expect(classifyPose(0.3)).toBe('left')
    expect(classifyPose(-0.3)).toBe('right')
    expect(classifyPose(0.13)).toBe('ambiguous')
  })

  it('accepts a sequence only in the order asked', () => {
    expect(sequenceMatches(['center', 'left', 'right'], [0, 0.3, -0.3])).toBe(true)
    expect(sequenceMatches(['center', 'right', 'left'], [0, 0.3, -0.3])).toBe(false)
    expect(sequenceMatches(['center', 'left'], [0, 0.3, -0.3])).toBe(false)
    expect(sequenceMatches([], [])).toBe(false)
  })

  it('draws every pose exactly once', () => {
    let seed = 7
    for (let n = 0; n < 50; n++) {
      const seq = randomSequence((k) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % k)
      expect([...seq].sort()).toEqual([...POSES].sort())
    }
  })
})

describe('matching', () => {
  const a = new Float32Array(128).fill(0)
  const b = new Float32Array(128).fill(0.004)
  const c = new Float32Array(128).fill(0.2)

  it('measures Euclidean distance and refuses mismatched lengths', () => {
    expect(distance(a, a)).toBe(0)
    expect(distance(a, c)).toBeCloseTo(Math.sqrt(128 * 0.04), 5)
    expect(() => distance(a, new Float32Array(3))).toThrow()
  })

  it('keeps tenant thresholds inside the safe band', () => {
    expect(clampThreshold(0.9)).toBe(THRESHOLDS.max)
    expect(clampThreshold(0.1)).toBe(THRESHOLDS.min)
    expect(clampThreshold('nonsense')).toBe(THRESHOLDS.default)
  })

  it('averages and measures spread', () => {
    expect(mean([a, c])[0]).toBeCloseTo(0.1)
    expect(spread([a, b, c])).toBeCloseTo(distance(a, c), 5)
  })

  it('identifies only with a clear winner under the threshold', () => {
    expect(identify(a, [], 0.5).outcome).toBe('no_match')
    expect(identify(a, [{ id: 'far', template: c }], 0.5).outcome).toBe('no_match')
    const near = identify(a, [{ id: 'a', template: a }, { id: 'c', template: c }], 0.5)
    expect(near).toMatchObject({ outcome: 'match', id: 'a' })
    // Two candidates both close: refuse rather than guess.
    const twin = identify(a, [{ id: 'a', template: a }, { id: 'b', template: b }], 0.5)
    expect(twin.outcome).toBe('ambiguous')
  })
})

describe('template encryption', () => {
  const KEY = 'a'.repeat(64)

  it('round-trips under the right context and fails under any other', () => {
    const before = process.env.BIOMETRIC_TEMPLATE_KEY
    process.env.BIOMETRIC_TEMPLATE_KEY = KEY
    try {
      expect(templateKeyConfigured()).toBe(true)
      const d = Float32Array.from({ length: 128 }, (_, i) => i / 128)
      const ctx = templateContext('t1', 'student', 's1', 'm')
      const sealed = sealTemplate(d, ctx)
      expect(Buffer.from(sealed.ciphertext).equals(Buffer.from(d.buffer))).toBe(false)
      expect(Array.from(openTemplate(sealed, ctx))).toEqual(Array.from(d))
      // Moved to another person's row, or tampered with: refuses to open.
      expect(() => openTemplate(sealed, templateContext('t1', 'student', 's2', 'm'))).toThrow()
      const tampered = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext) }
      tampered.ciphertext[0] ^= 1
      expect(() => openTemplate(tampered, ctx)).toThrow()
    } finally {
      if (before === undefined) delete process.env.BIOMETRIC_TEMPLATE_KEY
      else process.env.BIOMETRIC_TEMPLATE_KEY = before
    }
  })

  it('is off without a key rather than using a default one', () => {
    const before = process.env.BIOMETRIC_TEMPLATE_KEY
    delete process.env.BIOMETRIC_TEMPLATE_KEY
    try {
      expect(templateKeyConfigured()).toBe(false)
      expect(() => sealTemplate(new Float32Array(128), 'x')).toThrow()
    } finally {
      if (before !== undefined) process.env.BIOMETRIC_TEMPLATE_KEY = before
    }
  })
})

describe('image checks before decoding', () => {
  it('reads JPEG and PNG sizes from the header', () => {
    expect(imageHeader(img('synthetic-center.jpg'))).toMatchObject({ type: 'jpeg', width: 256, height: 256 })
    const png = Buffer.alloc(24)
    png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(0x0d0a1a0a, 4)
    png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20)
    expect(imageHeader(png)).toMatchObject({ type: 'png', width: 640, height: 480 })
  })

  it('refuses other types, oversized files and absurd dimensions without decoding', () => {
    expect(() => checkImage(Buffer.from('GIF89a..........'))).toThrow(ImageRejected)
    expect(() => checkImage(Buffer.alloc(3 * 1024 * 1024, 0xff))).toThrow(/at most/)
    const huge = Buffer.alloc(24)
    huge.writeUInt32BE(0x89504e47, 0); huge.writeUInt32BE(0x0d0a1a0a, 4)
    huge.writeUInt32BE(30000, 16); huge.writeUInt32BE(30000, 20)
    expect(() => checkImage(huge)).toThrow(/between/)
  })
})

describe('the engine on real images', () => {
  const faces: Record<string, FaceObservation[]> = {}
  const names = [
    'synthetic-center', 'synthetic-left', 'synthetic-right',
    'synthetic-center-m', 'synthetic-left-m', 'synthetic-right-m',
    'other-a', 'other-b', 'no-face', 'two-faces',
  ]

  beforeAll(async () => {
    for (const n of names) faces[n] = (await analyzeFrame(img(`${n}.jpg`))).faces
  }, 120_000)

  it('finds exactly one face where there is one, none or two where there are', () => {
    for (const n of names.filter((x) => x.startsWith('synthetic') || x.startsWith('other'))) {
      expect(faces[n], n).toHaveLength(1)
    }
    expect(faces['no-face']).toHaveLength(0)
    expect(faces['two-faces']).toHaveLength(2)
  })

  it('reads head pose, and mirroring flips it', () => {
    expect(classifyPose(faces['synthetic-center'][0].yaw)).toBe('center')
    expect(classifyPose(faces['synthetic-left'][0].yaw)).toBe('left')
    expect(classifyPose(faces['synthetic-right'][0].yaw)).toBe('right')
    expect(classifyPose(faces['synthetic-center-m'][0].yaw)).toBe('center')
    expect(classifyPose(faces['synthetic-left-m'][0].yaw)).toBe('left')
    expect(classifyPose(faces['synthetic-right-m'][0].yaw)).toBe('right')
  })

  it('places one person close together and a different person far away', () => {
    const d = (n: string) => faces[n][0].descriptor
    const template = mean(['synthetic-center', 'synthetic-left', 'synthetic-right'].map(d))
    const probe = mean(['synthetic-center-m', 'synthetic-left-m', 'synthetic-right-m'].map(d))
    const other = mean(['other-a', 'other-b'].map(d))
    expect(distance(template, probe)).toBeLessThan(THRESHOLDS.default)
    expect(distance(template, other)).toBeGreaterThan(THRESHOLDS.max)
    expect(spread(['synthetic-center', 'synthetic-left', 'synthetic-right'].map(d)))
      .toBeLessThan(THRESHOLDS.withinCapture)
    expect(distance(d('synthetic-center'), d('other-a'))).toBeGreaterThan(THRESHOLDS.withinCapture)
  })
})
