/**
 * Head pose from facial landmarks, for the liveness challenge.
 *
 * The challenge asks for a random sequence of poses — facing the camera,
 * turned to the left, turned to the right — and each captured frame must show
 * the pose asked for. What this measures is horizontal rotation (yaw), from
 * the 68-point landmark model: where the nose tip sits between the two sides
 * of the jaw, as a fraction of the jaw's width.
 *
 * Why this ratio: a real head turning moves the nose relative to the jaw line
 * because the nose stands out from the face. A flat photograph turned in front
 * of the camera is compressed as a whole, so the ratio barely moves. That is
 * the property the challenge relies on, and also its limit: it tells a head
 * from a flat picture, not a head from a video of that head.
 *
 * Directions are the subject's own. A person turning to their left shows the
 * camera their right cheek, so in the (unmirrored) camera image the nose moves
 * towards the image's right edge and the ratio goes positive.
 */

export type Pose = 'center' | 'left' | 'right'
export const POSES: readonly Pose[] = ['center', 'left', 'right']

export interface Point { x: number; y: number }

/** Thresholds, calibrated on frontal and turned faces (see the tests). */
export const POSE_LIMITS = {
  /** |yaw| at or under this is facing the camera. */
  centerMax: 0.1,
  /** |yaw| at or over this is a deliberate turn. */
  turnMin: 0.16,
}

/**
 * Yaw ratio for one face: roughly -0.35 (turned fully to the subject's
 * right) to +0.35 (turned fully to their left), 0 when facing the camera.
 * Returns null when the landmarks are not a usable 68-point set.
 */
export function yawRatio(points: Point[]): number | null {
  if (!Array.isArray(points) || points.length !== 68) return null
  const jawLeft = points[0]
  const jawRight = points[16]
  const noseTip = points[30]
  const width = jawRight.x - jawLeft.x
  if (!(width > 0)) return null
  const mid = (jawLeft.x + jawRight.x) / 2
  return (noseTip.x - mid) / width
}

/** Which pose a yaw ratio shows, or 'ambiguous' between the thresholds. */
export function classifyPose(yaw: number): Pose | 'ambiguous' {
  const a = Math.abs(yaw)
  if (a <= POSE_LIMITS.centerMax) return 'center'
  if (a >= POSE_LIMITS.turnMin) return yaw > 0 ? 'left' : 'right'
  return 'ambiguous'
}

/**
 * Whether a captured sequence answers the challenge: every frame shows the
 * pose asked for at that step, in order.
 */
export function sequenceMatches(asked: readonly Pose[], yaws: readonly number[]): boolean {
  if (asked.length !== yaws.length || asked.length === 0) return false
  return asked.every((pose, i) => classifyPose(yaws[i]) === pose)
}

/**
 * A fresh random challenge. Each pose appears once, in a random order, so a
 * recording made for one challenge answers another only by chance (1 in 6),
 * and the frames must come from a head that really turned both ways.
 */
export function randomSequence(random: (n: number) => number): Pose[] {
  const steps = [...POSES]
  for (let i = steps.length - 1; i > 0; i--) {
    const j = random(i + 1)
    ;[steps[i], steps[j]] = [steps[j], steps[i]]
  }
  return steps
}
