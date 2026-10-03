/**
 * Where faces are analysed (brief 5.4): the isolated face worker, or, in
 * local development only, the engine in this process.
 *
 * With FACE_WORKER_URL set, images go to the worker
 * (src/faceWorker/server.ts). The worker holds no database credentials or
 * template keys, knows no tenant, and answers only "these faces, these
 * descriptors". The API never loads TensorFlow, so an engine that crashes or
 * runs out of memory takes the worker down, not the API. When the worker is
 * down, slow or full, face routes answer 503 (EngineUnavailable) and
 * attendance is taken by hand with a reason (brief 5.2).
 *
 * Without FACE_WORKER_URL the engine runs in this process, as before. That
 * is for development. deployment.md says production sets the worker.
 */
import { checkImage, EngineUnavailable, ImageRejected, IMAGE_LIMITS, type EngineInfo, type FrameAnalysis } from './engine.js'

export { EngineUnavailable, ImageRejected, IMAGE_LIMITS }
export type { EngineInfo, FrameAnalysis }

const WORKER = (process.env.FACE_WORKER_URL ?? '').replace(/\/$/, '')
const TOKEN = process.env.FACE_WORKER_TOKEN ?? ''
const TIMEOUT_MS = Math.max(1000, Number(process.env.FACE_WORKER_TIMEOUT_MS ?? 15000))

export function usesWorker(): boolean {
  return WORKER !== ''
}

let local: typeof import('./engine.js') | null = null
async function localEngine() {
  local ??= await import('./engine.js')
  return local
}

// What the worker last said about itself, for the readiness check.
let lastWorker: EngineInfo & { reachable: boolean; checkedAt: string | null } = {
  state: 'not_loaded', backend: null, tfjsVersion: null, nativeVersion: null, sharedInstance: false, error: null,
  reachable: false, checkedAt: null,
}

async function workerFetch(pathname: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), init.timeoutMs ?? TIMEOUT_MS)
  try {
    return await fetch(WORKER + pathname, {
      ...init,
      signal: ac.signal,
      headers: { ...(init.headers ?? {}), 'X-Worker-Token': TOKEN },
    })
  } finally {
    clearTimeout(timer)
  }
}

/** Asks the worker how it is; never throws. */
export async function pollWorker(): Promise<typeof lastWorker> {
  try {
    const r = await workerFetch('/health', { timeoutMs: 3000 })
    const body: any = await r.json().catch(() => ({}))
    lastWorker = {
      state: r.ok ? (body.state ?? 'ready') : 'failed', backend: body.backend ?? null, tfjsVersion: body.tfjsVersion ?? null,
      nativeVersion: body.nativeVersion ?? null, sharedInstance: !!body.sharedInstance,
      error: r.ok ? (body.error ?? null) : `worker answered ${r.status}`, reachable: true, checkedAt: new Date().toISOString(),
    }
  } catch (e) {
    lastWorker = { ...lastWorker, state: 'failed', reachable: false, error: `worker unreachable: ${(e as Error)?.message ?? e}`,
      checkedAt: new Date().toISOString() }
  }
  return lastWorker
}

export async function analyzeFrame(buf: Buffer): Promise<FrameAnalysis> {
  if (!usesWorker()) return (await localEngine()).analyzeFrame(buf)
  // Refused here, before it travels: the worker checks again.
  checkImage(buf)
  let r: Response
  try {
    r = await workerFetch('/analyze', {
      method: 'POST', body: new Uint8Array(buf), headers: { 'Content-Type': 'application/octet-stream' },
    })
  } catch (e) {
    lastWorker = { ...lastWorker, state: 'failed', reachable: false, error: `worker unreachable: ${(e as Error)?.message ?? e}` }
    throw new EngineUnavailable(e)
  }
  const body: any = await r.json().catch(() => null)
  if (r.status === 422 && body?.code) throw new ImageRejected(body.code, body.error ?? 'The image was refused')
  if (!r.ok || !Array.isArray(body?.faces)) {
    throw new EngineUnavailable(new Error(`the face worker answered ${r.status}${body?.error ? `: ${body.error}` : ''}`))
  }
  return {
    faces: body.faces.map((f: any) => ({
      descriptor: Float32Array.from(f.descriptor ?? []),
      yaw: Number(f.yaw), score: Number(f.score), width: Number(f.width),
    })),
  }
}

export async function warmUp(): Promise<void> {
  if (!usesWorker()) return (await localEngine()).warmUp()
  const w = await pollWorker()
  if (!w.reachable || w.state === 'failed') throw new EngineUnavailable(new Error(w.error ?? 'face worker not ready'))
}

/** The engine's state for the readiness check: the worker's, or this process's. */
export function engineInfo(): EngineInfo & { worker?: { url: string; reachable: boolean; checkedAt: string | null } } {
  if (!usesWorker()) {
    return local ? local.engineInfo() : {
      state: 'not_loaded', backend: null, tfjsVersion: null, nativeVersion: null, sharedInstance: false, error: null,
    }
  }
  const { reachable, checkedAt, ...info } = lastWorker
  return { ...info, worker: { url: WORKER, reachable, checkedAt } }
}

/** Keeps the readiness check current while the worker comes and goes. */
export function watchWorker(everyMs = 10_000): void {
  if (!usesWorker()) return
  void pollWorker()
  setInterval(() => void pollWorker(), everyMs).unref()
}
