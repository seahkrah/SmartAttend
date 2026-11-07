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
