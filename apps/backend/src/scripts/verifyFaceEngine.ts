/**
 * Proves the face-matching engine works on this machine, end to end.
 *
 *   npm run verify-face-engine
 *
 * "TensorFlow is installed" is not the claim that matters; the claim is that
 * the engine decides identity correctly here. So this loads the engine the
 * way the API does, runs the real networks over the committed fixtures
 * (src/tests/fixtures/faces), and checks what a deployment depends on:
 *
 *   - the native TensorFlow backend is in use, not a silent fallback to the
 *     pure-JavaScript CPU backend, which is two orders of magnitude slower
 *   - a face is found where there is one, none where there is none, and two
 *     where there are two
 *   - two photos of one person are closer than the match threshold, and two
 *     different people are further apart than it
 *   - head pose reads the right way round (the liveness check depends on it)
 *
 * Exits non-zero on any failure, so it can gate a deployment.
 */
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { analyzeFrame, warmUp, engineInfo } from '../biometrics/engine.js'
import { distance, THRESHOLDS, DESCRIPTOR_LENGTH } from '../biometrics/matching.js'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(here, '..', 'tests', 'fixtures', 'faces')

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

async function main() {
  const pkg = (name: string) => require(`${name}/package.json`).version as string
  console.log(`Node ${process.version} on ${process.platform}-${process.arch}`)
  console.log(`@tensorflow/tfjs-node ${pkg('@tensorflow/tfjs-node')}, @vladmandic/face-api ${pkg('@vladmandic/face-api')}`)

  const t0 = Date.now()
  await warmUp()
  const loadMs = Date.now() - t0
  const info = engineInfo()
  console.log(`Engine loaded in ${loadMs} ms: backend=${info.backend}, tfjs=${info.tfjsVersion}, ` +
    `TensorFlow C library=${info.nativeVersion ?? 'unknown'}\n`)

  console.log('-- runtime --')
  check('the native TensorFlow backend is in use', info.backend === 'tensorflow', `backend=${info.backend}`)
  check('face-api runs on the same TensorFlow instance as the server',
    info.sharedInstance, info.sharedInstance ? '' : 'face-api bundled a second copy of tfjs')

  const img = (n: string) => readFileSync(path.join(FIXTURES, n))
  const timed = async (n: string) => {
    const s = Date.now()
    const r = await analyzeFrame(img(n))
    return { ...r, ms: Date.now() - s }
  }

  console.log('-- detection --')
  const center = await timed('synthetic-center.jpg')
  check('one face in a frontal photo', center.faces.length === 1, `${center.faces.length} found, ${center.ms} ms`)
  check(`a ${DESCRIPTOR_LENGTH}-number descriptor is produced`,
    center.faces[0]?.descriptor.length === DESCRIPTOR_LENGTH)
  check('the descriptor is finite (no NaN from a broken kernel)',
    !!center.faces[0] && Array.from(center.faces[0].descriptor).every(Number.isFinite))
  const none = await timed('no-face.jpg')
  check('no face in an image without one', none.faces.length === 0, `${none.faces.length} found`)
  const two = await timed('two-faces.jpg')
  check('two faces where there are two', two.faces.length === 2, `${two.faces.length} found`)

  console.log('-- identity --')
  const same = await timed('synthetic-center-m.jpg')
  const otherA = await timed('other-a.jpg')
  const otherB = await timed('other-b.jpg')
  const dSame = distance(center.faces[0].descriptor, same.faces[0].descriptor)
  const dOther = distance(otherA.faces[0].descriptor, otherB.faces[0].descriptor)
  const dDiff = distance(center.faces[0].descriptor, otherA.faces[0].descriptor)
  const t = THRESHOLDS.default
  check('two photos of one person match', dSame < t, `distance ${dSame.toFixed(3)} < ${t}`)
  check('two photos of another person match', dOther < t, `distance ${dOther.toFixed(3)} < ${t}`)
  check('two different people do not match', dDiff > t, `distance ${dDiff.toFixed(3)} > ${t}`)
  check('with a clear margin either side of the threshold',
    dDiff - t > 0.1 && t - Math.max(dSame, dOther) > 0.05,
    `same ≤ ${Math.max(dSame, dOther).toFixed(3)}, different ${dDiff.toFixed(3)}`)

  console.log('-- pose (liveness) --')
  const left = await timed('synthetic-left.jpg')
  const right = await timed('synthetic-right.jpg')
  const yc = center.faces[0].yaw, yl = left.faces[0]?.yaw, yr = right.faces[0]?.yaw
  check('turning left and right read as opposite directions',
    yl !== undefined && yr !== undefined && Math.sign(yl - yc) === -Math.sign(yr - yc),
    `left ${yl?.toFixed(2)}, centre ${yc.toFixed(2)}, right ${yr?.toFixed(2)}`)

  console.log('-- speed --')
  const runs: number[] = []
  for (let i = 0; i < 5; i++) runs.push((await timed('synthetic-center.jpg')).ms)
  const median = runs.sort((a, b) => a - b)[2]
  check('a frame is analysed in under 2 seconds once warm', median < 2000, `median ${median} ms over 5 runs`)

  console.log(failures ? `\n${failures} check(s) failed` : '\nThe face engine works on this machine.')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error('\nThe face engine could not run:', e?.message ?? e)
  process.exit(1)
})
