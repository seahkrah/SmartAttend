/**
 * The face worker (brief 5.4): images in, faces out, and nothing else.
 *
 *   GET  /health    the engines' state, and how busy the worker is
 *   POST /analyze   one JPEG or PNG as the request body; answers the faces
 *                   found, each with its 128-number descriptor, head yaw,
 *                   detection score and width, and the image's quality
 *
 * It holds no database credentials and refuses to start if any are in its
 * environment. It holds no template keys and knows no tenant: matching,
 * consent and templates stay in the API. Every request must carry the shared
 * X-Worker-Token.
 *
 * This process only queues. The analysis runs in FACE_ENGINE_PROCESSES child
 * processes (engineChild.ts), one image at a time each. TensorFlow holds a
 * process's event loop while it works, and when it ran here an overloaded
 * worker could not answer its health checks or notice callers that had given
 * up: it took 139 s to recover after the check-in burst test. Now:
 *   - a request is refused at once when FACE_WORKER_MAX_QUEUE are waiting;
 *   - a request whose caller has gone is dropped before it reaches an engine;
 *   - an engine that dies is replaced, and its request answered 503.
 *
 *   FACE_WORKER_PORT (5100), FACE_WORKER_HOST (127.0.0.1), FACE_WORKER_TOKEN
 *   (required, at least 32 characters), FACE_WORKER_MAX_QUEUE (8),
 *   FACE_ENGINE_PROCESSES (2), FACE_WORKER_PID_FILE (optional: where to write
 *   the process id).
 *
 * Run: npx tsx src/faceWorker/server.ts
 */
import { fork, type ChildProcess } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import { fileURLToPath } from 'url'
import { IMAGE_LIMITS, ImageRejected, checkImage } from '../biometrics/engine.js'
import { BUILD } from '../utils/buildInfo.js'

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
// Refused beyond this, at once: work the API would time out on is better
// refused early, so it can fall back to manual.
const MAX_QUEUE = Math.max(1, Number(process.env.FACE_WORKER_MAX_QUEUE ?? 8))
const PROCESSES = Math.max(1, Number(process.env.FACE_ENGINE_PROCESSES ?? 2))

// ---------------------------------------------------------------------------
// The engines
// ---------------------------------------------------------------------------

interface Job {
  id: number
  buf: Buffer
  gone: () => boolean
  resolve: (v: { faces: unknown[]; quality: unknown }) => void
  reject: (e: Error) => void
}

interface Engine {
  child: ChildProcess
  state: 'loading' | 'ready' | 'failed'
  busy: Job | null
  info: Record<string, unknown> | null
  error: string | null
}

const CHILD = fileURLToPath(new URL(`./engineChild.${import.meta.url.endsWith('.ts') ? 'ts' : 'js'}`, import.meta.url))
const engines: Engine[] = []
const queue: Job[] = []
let nextId = 1
let stopping = false

class Busy extends Error {}

function startEngine(): Engine {
  const child = fork(CHILD, [], {
    execArgv: process.execArgv,
    serialization: 'advanced',
    env: { ...process.env, FACE_ENGINE_CONCURRENCY: '1' },
  })
  const e: Engine = { child, state: 'loading', busy: null, info: null, error: null }
  child.on('message', (m: any) => {
    if (m.type === 'ready') {
      e.state = 'ready'
      e.info = m.info
      dispatch()
      return
    }
    if (m.type === 'failed') {
      e.state = 'failed'
      e.error = m.error
      console.error('[FACE_WORKER] an engine could not start:', m.error)
      return
    }
    const job = e.busy
    if (!job || job.id !== m.id) return
    e.busy = null
    if (m.type === 'result') job.resolve({ faces: m.faces, quality: m.quality })
    else if (m.type === 'rejected') job.reject(new ImageRejected(m.code, m.error))
    else job.reject(new Error(m.error))
    dispatch()
  })
  child.on('exit', (code) => {
    const i = engines.indexOf(e)
    if (i >= 0) engines.splice(i, 1)
    if (e.busy) e.busy.reject(new Error(`the engine stopped (exit ${code})`))
    if (!stopping) {
      console.error(`[FACE_WORKER] an engine stopped (exit ${code}); starting another`)
      engines.push(startEngine())
    }
  })
  return e
}

function dispatch() {
  for (const e of engines) {
    if (e.state !== 'ready' || e.busy) continue
    let job: Job | undefined
    // Work whose caller has gone is dropped here, before it costs anything.
    while ((job = queue.shift()) && job.gone()) job.reject(new Busy('caller gone'))
    if (!job) return
    e.busy = job
    e.child.send({ id: job.id, buf: job.buf })
  }
}

function analyse(buf: Buffer, gone: () => boolean): Promise<{ faces: unknown[]; quality: unknown }> {
  return new Promise((resolve, reject) => {
    queue.push({ id: nextId++, buf, gone, resolve, reject })
    dispatch()
  })
}

function waiting(): number {
  return queue.length + engines.filter((e) => e.busy).length
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function tokenOk(req: http.IncomingMessage): boolean {
  const given = Buffer.from(String(req.headers['x-worker-token'] ?? ''))
  const want = Buffer.from(TOKEN)
  return given.length === want.length && crypto.timingSafeEqual(given, want)
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  if (res.writableEnded || res.destroyed) return
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) })
  res.end(json)
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let complete = false
    // An upload the caller abandons never ends: without this the request held
    // its place in the queue for good (found by the check-in burst test).
    req.on('close', () => {
      if (!complete) reject(new Error('the caller closed the connection'))
    })
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new ImageRejected('too_large', `Each image must be at most ${limit / 1024 / 1024} MB`))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      complete = true
      resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

function health() {
  const ready = engines.filter((e) => e.state === 'ready')
  const info = (ready[0]?.info ?? {}) as Record<string, unknown>
  return {
    ...info,
    build: BUILD,
    state: ready.length ? 'ready' : engines.some((e) => e.state === 'loading') ? 'not_loaded' : 'failed',
    error: ready.length ? null : (engines.find((e) => e.error)?.error ?? null),
    engines: { ready: ready.length, loading: engines.filter((e) => e.state === 'loading').length, total: engines.length },
    inFlight: waiting(),
    maxQueue: MAX_QUEUE,
    database: false,
  }
}

const server = http.createServer(async (req, res) => {
  if (!tokenOk(req)) return send(res, 401, { error: 'Unauthorised' })
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, health())
  if (req.method === 'POST' && req.url === '/analyze') {
    if (waiting() >= MAX_QUEUE) return send(res, 503, { error: 'The face worker is busy; try again shortly' })
    // A caller that has given up (the API timed out) is not worth analysing for.
    let gone = false
    res.on('close', () => {
      if (!res.writableEnded) gone = true
    })
    try {
      const buf = await readBody(req, IMAGE_LIMITS.maxBytes)
      checkImage(buf)
      const out = await analyse(buf, () => gone)
      return send(res, 200, out)
    } catch (e) {
      if (gone || e instanceof Busy) return
      if (e instanceof ImageRejected) return send(res, 422, { error: e.message, code: e.code })
      console.error('[FACE_WORKER] analysis failed:', (e as Error)?.message ?? e)
      return send(res, 503, { error: 'The face engine could not analyse the image' })
    }
  }
  return send(res, 404, { error: 'Not found' })
})

for (let i = 0; i < PROCESSES; i++) engines.push(startEngine())

server.listen(PORT, HOST, () => {
  if (process.env.FACE_WORKER_PID_FILE) fs.writeFileSync(process.env.FACE_WORKER_PID_FILE, String(process.pid))
  console.log(`[FACE_WORKER] listening on ${HOST}:${PORT}, ${PROCESSES} engine processes`)
})

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    stopping = true
    for (const e of engines) e.child.kill()
    process.exit(0)
  })
}
