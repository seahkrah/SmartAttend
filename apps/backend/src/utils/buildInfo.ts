/**
 * Which build this process is: so a check after a deploy, or a test run,
 * can confirm the API and the face worker it is talking to are the code it
 * means. The commit comes from GIT_COMMIT (set when an image is built) or,
 * in a checkout, from git; "unknown" otherwise. A checkout with local
 * changes says so, since its commit then does not describe the code.
 */
import { execFileSync } from 'child_process'

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim()
  } catch {
    return null
  }
}

const fromEnv = (process.env.GIT_COMMIT ?? '').trim()
const commit = /^[0-9a-f]{7,40}$/i.test(fromEnv) ? fromEnv.slice(0, 12) : (git(['rev-parse', '--short=12', 'HEAD']) ?? 'unknown')
const dirty = fromEnv ? false : (() => {
  const s = git(['status', '--porcelain', '--untracked-files=no'])
  return s === null ? null : s !== ''
})()

export const BUILD = Object.freeze({ commit, dirty, startedAt: new Date().toISOString() })

/**
 * The build, for the public readiness answer. Outside production it is
 * always shown; in production only with HEALTH_SHOW_BUILD=true, since the
 * exact commit tells an attacker which code to study (audit F15). The face
 * worker's /health, behind its token, always shows it.
 */
export function publicBuild(): typeof BUILD | undefined {
  return process.env.NODE_ENV !== 'production' || process.env.HEALTH_SHOW_BUILD === 'true' ? BUILD : undefined
}
