/**
 * One face-engine process, started by the face worker (server.ts). It loads
 * the networks, then analyses one image at a time on request over IPC.
 *
 * TensorFlow's work holds a process's event loop while it runs. In its own
 * process it holds only this one: the worker's HTTP process stays free to
 * answer health checks, refuse when full, and drop work whose caller has gone.
 */
import { analyzeFrame, engineInfo, ImageRejected, warmUp } from '../biometrics/engine.js'

type Job = { id: number; buf: Buffer | Uint8Array }

function reply(msg: unknown) {
  process.send?.(msg)
}

warmUp()
  .then(() => reply({ type: 'ready', info: engineInfo() }))
  .catch((e) => reply({ type: 'failed', error: (e as Error)?.message ?? String(e) }))

process.on('message', async (job: Job) => {
  try {
    const { faces, quality } = await analyzeFrame(Buffer.from(job.buf))
    reply({
      type: 'result', id: job.id,
      faces: faces.map((f) => ({ descriptor: Array.from(f.descriptor), yaw: f.yaw, score: f.score, width: f.width })),
      quality: quality ?? null,
    })
  } catch (e) {
    if (e instanceof ImageRejected) reply({ type: 'rejected', id: job.id, code: e.code, error: e.message })
    else reply({ type: 'error', id: job.id, error: (e as Error)?.message ?? String(e) })
  }
})

// The worker going away takes its engines with it.
process.on('disconnect', () => process.exit(0))
