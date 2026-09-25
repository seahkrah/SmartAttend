/**
 * Descriptor arithmetic and the decisions built on it.
 *
 * Descriptors come from dlib's face-recognition ResNet (128 dimensions). Two
 * images of one person are close in Euclidean distance; the network's
 * published operating point is 0.6. This platform defaults to 0.5, which is
 * stricter: for attendance, refusing a genuine person and falling back to
 * manual marking is a better failure than accepting the wrong one.
 */

export const DESCRIPTOR_LENGTH = 128
export const MODEL_ID = 'dlib-resnet34-128'

export const THRESHOLDS = {
  /** Default decision threshold; tenants may tighten or relax within bounds. */
  default: 0.5,
  min: 0.35,
  max: 0.6,
  /**
   * The frames of one capture must all be of one person. This is looser than
   * the match threshold because turned faces drift further from each other
   * than from the frontal template.
   */
  withinCapture: 0.55,
  /**
   * In identification, the best candidate must beat the second best by this
   * much, or the answer is "not sure" rather than a guess between two people.
   */
  identifyMargin: 0.06,
}

export function distance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error('Descriptors differ in length')
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum)
}

export function mean(descriptors: ArrayLike<number>[]): Float32Array {
  if (descriptors.length === 0) throw new Error('No descriptors to average')
  const out = new Float32Array(descriptors[0].length)
  for (const d of descriptors) for (let i = 0; i < out.length; i++) out[i] += d[i]
  for (let i = 0; i < out.length; i++) out[i] /= descriptors.length
  return out
}

/** Largest distance between any two descriptors: how much a capture varies. */
export function spread(descriptors: ArrayLike<number>[]): number {
  let max = 0
  for (let i = 0; i < descriptors.length; i++)
    for (let j = i + 1; j < descriptors.length; j++)
      max = Math.max(max, distance(descriptors[i], descriptors[j]))
  return max
}

export function clampThreshold(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return THRESHOLDS.default
  return Math.min(THRESHOLDS.max, Math.max(THRESHOLDS.min, n))
}

export interface Candidate {
  id: string
  template: ArrayLike<number>
}

export type IdentifyResult =
  | { outcome: 'match'; id: string; distance: number; runnerUp: number | null }
  | { outcome: 'no_match'; best: number | null }
  | { outcome: 'ambiguous'; best: number; runnerUp: number }

/**
 * One-to-many: who, of these candidates, is in the probe? The probe is the
 * average of the capture's frames. A match needs the best distance under the
 * threshold and a clear lead over the next candidate.
 */
export function identify(
  probe: ArrayLike<number>,
  candidates: Candidate[],
  threshold: number
): IdentifyResult {
  if (candidates.length === 0) return { outcome: 'no_match', best: null }
  const scored = candidates
    .map((c) => ({ id: c.id, d: distance(probe, c.template) }))
    .sort((a, b) => a.d - b.d)
  const [best, second] = scored
  if (best.d > threshold) return { outcome: 'no_match', best: best.d }
  if (second && second.d - best.d < THRESHOLDS.identifyMargin) {
    return { outcome: 'ambiguous', best: best.d, runnerUp: second.d }
  }
  return { outcome: 'match', id: best.id, distance: best.d, runnerUp: second ? second.d : null }
}
