/**
 * The face-analysis engine: images in, faces out.
 *
 * Runs on the server with TensorFlow (tfjs-node) and three published networks
 * shipped in @vladmandic/face-api: an SSD MobileNet face detector, the
 * 68-point landmark model and dlib's ResNet-34 face-recognition network. The
 * client sends images; everything that decides identity happens here.
 *
 * Images are checked before they are decoded. A few kilobytes of JPEG can
 * declare a 30000x30000 canvas, so the header is read first and anything
 * outside the limits is refused without allocating it.
 */
import { createRequire } from 'module'
import path from 'path'
import { yawRatio, type Point } from './pose.js'
import { DESCRIPTOR_LENGTH } from './matching.js'

const require = createRequire(import.meta.url)

export const IMAGE_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxSide: 4096,
  minSide: 160,
  /** Frames are scaled down to this before analysis; larger adds cost, not accuracy. */
  analysisSide: 960,
  /** A face narrower than this is too small to describe reliably. */
  minFaceWidth: 64,
  minDetectionScore: 0.6,
}

export class ImageRejected extends Error {
  constructor(readonly code: 'unsupported_type' | 'too_large' | 'bad_dimensions' | 'unreadable', message: string) {
    super(message)
  }
}

/** Reads the pixel size from a JPEG or PNG header without decoding it. */
export function imageHeader(buf: Buffer): { type: 'jpeg' | 'png'; width: number; height: number } {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      const len = buf.readUInt16BE(i + 2)
      if (len < 2) break
      i += 2 + len
    }
    throw new ImageRejected('unreadable', 'The JPEG has no readable frame header')
  }
  throw new ImageRejected('unsupported_type', 'Send a JPEG or PNG image')
}

export function checkImage(buf: Buffer): void {
  if (buf.length > IMAGE_LIMITS.maxBytes) {
    throw new ImageRejected('too_large', `Each image must be at most ${IMAGE_LIMITS.maxBytes / 1024 / 1024} MB`)
  }
  const { width, height } = imageHeader(buf)
  if (width > IMAGE_LIMITS.maxSide || height > IMAGE_LIMITS.maxSide ||
      width < IMAGE_LIMITS.minSide || height < IMAGE_LIMITS.minSide) {
    throw new ImageRejected('bad_dimensions',
      `Images must be between ${IMAGE_LIMITS.minSide} and ${IMAGE_LIMITS.maxSide} pixels on each side`)
  }
}

export interface FaceObservation {
  descriptor: Float32Array
  yaw: number
  score: number
  width: number
}

export interface FrameAnalysis {
  faces: FaceObservation[]
}

// ---------------------------------------------------------------------------
// Model loading, once, on first use.
// ---------------------------------------------------------------------------

let loading: Promise<{ tf: any; faceapi: any }> | null = null

function load(): Promise<{ tf: any; faceapi: any }> {
  if (!loading) {
    loading = (async () => {
      const tf = require('@tensorflow/tfjs-node')
      const faceapi = require('@vladmandic/face-api/dist/face-api.node.js')
      const modelDir = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model')
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir)
      await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir)
      await faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir)
      return { tf, faceapi }
    })().catch((e) => {
      loading = null
      throw e
    })
  }
  return loading
}

/** Loads the networks ahead of the first request, so it is not slow. */
export async function warmUp(): Promise<void> {
  await load()
}

// ---------------------------------------------------------------------------
// Bounded concurrency: each analysis holds a few hundred MB of tensors.
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = Math.max(1, Number(process.env.FACE_ENGINE_CONCURRENCY ?? 2))
let active = 0
const waiting: Array<() => void> = []

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve))
  active++
  try {
    return await fn()
  } finally {
    active--
    waiting.shift()?.()
  }
}

export async function analyzeFrame(buf: Buffer): Promise<FrameAnalysis> {
  checkImage(buf)
  const { tf, faceapi } = await load()
  return withSlot(async () => {
    let tensor: any
    try {
      tensor = tf.node.decodeImage(buf, 3)
    } catch {
      throw new ImageRejected('unreadable', 'The image could not be decoded')
    }
    try {
      const [h, w] = tensor.shape
      const scale = Math.min(1, IMAGE_LIMITS.analysisSide / Math.max(h, w))
      if (scale < 1) {
        const resized = tf.image.resizeBilinear(tensor, [Math.round(h * scale), Math.round(w * scale)])
        tf.dispose(tensor)
        tensor = resized
      }
      const detections = await faceapi
        .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: IMAGE_LIMITS.minDetectionScore }))
        .withFaceLandmarks()
        .withFaceDescriptors()
      const faces: FaceObservation[] = []
      for (const d of detections) {
        const descriptor: Float32Array = d.descriptor
        const yaw = yawRatio(d.landmarks.positions as Point[])
        if (descriptor?.length !== DESCRIPTOR_LENGTH || yaw === null) continue
        faces.push({
          descriptor,
          yaw,
          score: d.detection.score,
          width: d.detection.box.width / scale,
        })
      }
      return { faces }
    } finally {
      tf.dispose(tensor)
    }
  })
}
