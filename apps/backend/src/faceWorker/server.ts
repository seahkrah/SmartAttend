/**
 * The face worker (brief 5.4): images in, faces out, and nothing else.
 *
 *   GET  /health    the engine's state, and how busy the worker is
 *   POST /analyze   one JPEG or PNG as the request body; answers the faces
 *                   found, each with its 128-number descriptor, head yaw,
 *                   detection score and width
 *
 * It holds no database credentials and refuses to start if any are in its
 * environment. It holds no template keys and knows no tenant: matching,
 * consent and templates stay in the API. Every request must carry the shared
 * X-Worker-Token. Analysis is concurrency-limited by the engine
 * (FACE_ENGINE_CONCURRENCY). Requests beyond FACE_WORKER_MAX_QUEUE waiting
 * are refused with 503 at once rather than queued without bound. Scale out
 * by running more workers behind one address.
 *
 *   FACE_WORKER_PORT (5100), FACE_WORKER_HOST (127.0.0.1), FACE_WORKER_TOKEN
 *   (required, at least 32 characters), FACE_WORKER_MAX_QUEUE (16),
 *   FACE_WORKER_PID_FILE (optional: where to write the process id).
 *
 * Run: npx tsx src/faceWorker/server.ts
 */
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import { analyzeFrame, engineInfo, IMAGE_LIMITS, ImageRejected, warmUp } from '../biometrics/engine.js'

const CREDENTIALS = ['DATABASE_URL', 'APP_DATABASE_URL', 'SYSTEM_DATABASE_URL', 'PGPASSWORD', 'BIOMETRIC_TEMPLATE_KEY',
  'KMS_LOCAL_KEK', 'JWT_SECRET']
const present = CREDENTIALS.filter((k) => process.env[k])
if (present.length) {
  console.error(`[FACE_WORKER] refusing to start: ${present.join(', ')} must not be in the face worker's environment`)
  process.exit(2)
}
const TOKEN = process.env.FACE_WORKER_TOKEN ?? ''
if (TOKEN.length < 32) {
  console.error('[FACE_WORKER] refusing to start: FACE_WORKER_TOKEN must be set, at least 32 characters')
  process.exit(2)
}

const PORT = Number(process.env.FACE_WORKER_PORT ?? 5100)
const HOST = process.env.FACE_WORKER_HOST ?? '127.0.0.1'
const MAX_QUEUE = Math.max(1, Number(process.env.FACE_WORKER_MAX_QUEUE ?? 16))
let inFlight = 0

function tokenOk(req: http.IncomingMessage): boolean {
  const given = Buffer.from(String(req.headers['x-worker-token'] ?? ''))
  const want = Buffer.from(TOKEN)
  return given.length === want.length && crypto.timingSafeEqual(given, want)
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) })
  res.end(json)
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new ImageRejected('too_large', `Each image must be at most ${limit / 1024 / 1024} MB`))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  if (!tokenOk(req)) return send(res, 401, { error: 'Unauthorised' })
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ...engineInfo(), inFlight, maxQueue: MAX_QUEUE, database: false })
  }
  if (req.method === 'POST' && req.url === '/analyze') {
    if (inFlight >= MAX_QUEUE) return send(res, 503, { error: 'The face worker is busy; try again shortly' })
    inFlight++
    try {
      const buf = await readBody(req, IMAGE_LIMITS.maxBytes)
      const { faces } = await analyzeFrame(buf)
      return send(res, 200, {
        faces: faces.map((f) => ({ descriptor: Array.from(f.descriptor), yaw: f.yaw, score: f.score, width: f.width })),
      })
    } catch (e) {
      if (e instanceof ImageRejected) return send(res, 422, { error: e.message, code: e.code })
      console.error('[FACE_WORKER] analysis failed:', (e as Error)?.message ?? e)
      return send(res, 503, { error: 'The face engine could not analyse the image' })
    } finally {
      inFlight--
    }
  }
  return send(res, 404, { error: 'Not found' })
})

server.listen(PORT, HOST, () => {
  if (process.env.FACE_WORKER_PID_FILE) fs.writeFileSync(process.env.FACE_WORKER_PID_FILE, String(process.pid))
  console.log(`[FACE_WORKER] listening on ${HOST}:${PORT}`)
  warmUp()
    .then(() => console.log(`[FACE_WORKER] engine ready: backend=${engineInfo().backend}`))
    .catch((e) => console.error('[FACE_WORKER] engine unavailable:', e.message))
})
