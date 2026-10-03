/**
 * Layered presentation-attack signals for a face capture (brief 5.4).
 *
 * Each capture answers a server-issued challenge. It is single-use, expires
 * after a few minutes, and is bound to the person who asked, the tenant and
 * the purpose: its id is the nonce, and a capture cannot be submitted twice.
 * On top of that, the frames are judged on:
 *
 *   hard  the head turns as instructed (pose.ts), and every frame is the same
 *         person (service.ts);
 *   hard  no two frames are the same image (a still photo sent as every pose);
 *   hard  frame times the client reports are monotonic, at least 100 ms
 *         apart, and spread over at least 300 ms per turn;
 *   soft  the client reported no frame times;
 *   soft  the capture arrived sooner after the challenge than a person
 *         could turn their head;
 *   soft  frames are soft, flat or glaring (printed photo, screen replay).
 *
 * The soft signals subtract from a score of 1. A capture passes when no hard
 * signal fires and the score is at least the tenant's threshold. That
 * threshold is tunable but clamped to [0.5, 0.9], so a tenant can make the
 * soft signals decisive but cannot turn the check off.
 *
 * What this is not: a trained passive-liveness model, or a defence a
 * presentation-attack lab has measured. It raises the cost of a photo, a
 * replayed file or a looping video. It does not stop a good 3D mask or an
 * injected camera stream. ISO/IEC 30107-3 testing is an owner action (OA-5).
 */
import type { FrameQuality } from './engine.js'

export const PAD_THRESHOLD = { default: 0.7, min: 0.5, max: 0.9 }

export function clampPadThreshold(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return PAD_THRESHOLD.default
  return Math.min(PAD_THRESHOLD.max, Math.max(PAD_THRESHOLD.min, n))
}

export const PENALTY = {
  noFrameTimes: 0.15,
  tooQuick: 0.15,
  soft: 0.2,
  flat: 0.2,
  glare: 0.2,
}

export interface PadInput {
  /** One per frame, as the client reported them: milliseconds since the capture began. */
  frameTimes: number[] | null
  /** Milliseconds between the challenge being issued and the capture arriving. */
  elapsedMs: number
  /** How many head turns the challenge asked for. */
  steps: number
  /** One per frame, from the engine; absent when the engine reports none. */
  quality: Array<FrameQuality | undefined>
  /** Two frames had identical bytes. */
  duplicateFrames: boolean
}

export interface PadResult {
  score: number
  pass: boolean
  /** Why it failed, or the soft signals that lowered the score. */
  reasons: string[]
  hard: string | null
  signals: Record<string, unknown>
}

/** The fewest milliseconds a person needs to answer a challenge of `steps` turns. */
export function minimumCaptureMs(steps: number): number {
  return 300 * Math.max(1, steps - 1)
}

export function assessPad(input: PadInput, threshold: number): PadResult {
  const reasons: string[] = []
  const signals: Record<string, unknown> = { elapsedMs: input.elapsedMs, steps: input.steps }
  let hard: string | null = null

  if (input.duplicateFrames) hard = 'duplicate_frames'

  if (!hard && input.frameTimes) {
    const t = input.frameTimes
    signals.frameTimes = t
    const valid = t.length === input.steps && t.every((x) => Number.isFinite(x) && x >= 0)
    const gaps = t.slice(1).map((x, i) => x - t[i])
    if (!valid || gaps.some((g) => g < 100) || (t.length > 1 && t[t.length - 1] - t[0] < minimumCaptureMs(input.steps))) {
      hard = 'implausible_timing'
    }
  }

  let score = 1
  if (!input.frameTimes) {
    score -= PENALTY.noFrameTimes
    reasons.push('no_frame_times')
  }
  if (input.elapsedMs < minimumCaptureMs(input.steps)) {
    score -= PENALTY.tooQuick
    reasons.push('answered_too_quickly')
  }
  const q = input.quality.filter((x): x is FrameQuality => !!x)
  if (q.length) {
    const min = (k: keyof FrameQuality) => Math.min(...q.map((x) => x[k]))
    const max = (k: keyof FrameQuality) => Math.max(...q.map((x) => x[k]))
    signals.quality = { sharpness: min('sharpness'), contrast: min('contrast'), brightness: [min('brightness'), max('brightness')] }
    if (min('sharpness') < 0.05) {
      score -= PENALTY.soft
      reasons.push('soft_image')
    }
    if (min('contrast') < 0.06) {
      score -= PENALTY.flat
      reasons.push('flat_image')
    }
    if (max('brightness') > 0.92 || min('brightness') < 0.08) {
      score -= PENALTY.glare
      reasons.push('glare_or_dark')
    }
  }
  score = Math.max(0, Math.round(score * 100) / 100)
  const t = clampPadThreshold(threshold)
  signals.threshold = t
  if (hard) return { score: 0, pass: false, reasons: [hard], hard, signals }
  return { score, pass: score >= t, reasons, hard: null, signals }
}
