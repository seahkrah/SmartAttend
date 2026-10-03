/**
 * Accounts and credentials under row-level security, as the API's runtime
 * role (migration 074, findings #17).
 *
 * The Phase 1 audit showed that from tenant A's context the runtime role
 * read every account on the platform, password hashes included, and could
 * update B's accounts. Here, for the runtime role:
 *
 *   - in A's context only A's people (members, applicants, accounts created
 *     in A, and the caller) are visible, and only A's membership rows;
 *   - nobody can read a password hash, in any context;
 *   - credentials (sessions, links, two-factor) follow their account;
 *   - B's accounts cannot be updated from A;
 *   - every table without tenant_id that names an account is either under a
 *     policy or listed below as platform-level, with the reason.
 *
 * Needs APP_DATABASE_URL and the e2e seed fixtures. Suite "identityIsolation"
 * in scripts/run-all-e2e.sh.
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import pool, { query } from '../db/connection.js'
import { withNoTenant, withTenant } from '../db/dbContext.js'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++
    console.log(`  ok    ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name} ${detail}`)
  }
}

const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
const seed = JSON.parse(fs.readFileSync(path.join(dir, 'seed.json'), 'utf8'))
const A: string = seed.A.tenantId
const B: string = seed.B.tenantId

async function owner(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    return await c.query(sql, params)
  } finally {
    await c.end()
  }
}

async function refused(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (e: any) {
    return e.code ?? 'error'
  }
}

/**
 * Tables without tenant_id that hold an account reference and are not under
 * a policy, with why. Anything else in that set fails the coverage check, so
 * a new table has to be decided rather than forgotten.
 */
const PLATFORM_LEVEL: Record<string, string> = {}

const MEMBERS = `
  SELECT user_id FROM school_user_associations WHERE school_entity_id = $1
  UNION SELECT user_id FROM corporate_user_associations WHERE corporate_entity_id = $1
  UNION SELECT admin_user_id FROM school_entities WHERE id = $1 AND admin_user_id IS NOT NULL
  UNION SELECT admin_user_id FROM corporate_entities WHERE id = $1 AND admin_user_id IS NOT NULL
  UNION SELECT user_id FROM school_user_approvals WHERE school_entity_id = $1
  UNION SELECT user_id FROM corporate_user_approvals WHERE corporate_entity_id = $1
  UNION SELECT id FROM users WHERE created_tenant_id = $1`

async function main() {
  if (!process.env.APP_DATABASE_URL || process.env.APP_DATABASE_URL === process.env.DATABASE_URL) {
    check('APP_DATABASE_URL names a runtime role distinct from DATABASE_URL', false, '(not set: nothing here would be filtered)')
    return
  }

  const ofA = new Set((await owner(MEMBERS, [A])).rows.map((r) => r.user_id as string))
  const ofB = new Set((await owner(MEMBERS, [B])).rows.map((r) => r.user_id as string))
  const onlyB = [...ofB].filter((u) => !ofA.has(u))
  const total = Number((await owner(`SELECT count(*) AS n FROM users`)).rows[0].n)
  check(`the seed has people only in B (${onlyB.length}) and more accounts than A's (${ofA.size} of ${total})`,
    onlyB.length > 0 && total > ofA.size)

  console.log('-- accounts --')
  const asA = await withTenant({ tenantId: A }, () => query(`SELECT id FROM users`))
  check("in A's context, only A's people are visible", asA.rows.every((r: any) => ofA.has(r.id)),
    `(${asA.rows.filter((r: any) => !ofA.has(r.id)).length} others)`)
  check('and all of them', asA.rowCount === ofA.size, `(${asA.rowCount} vs ${ofA.size})`)
  const named = await withTenant({ tenantId: A }, () => query(`SELECT id FROM users WHERE id = ANY($1)`, [onlyB]))
  check("B's people, asked for by id from A: none", named.rowCount === 0, `(${named.rowCount})`)
  const none = await withNoTenant(() => query(`SELECT count(*) AS n FROM users`))
  check('no tenant and nobody signed in: no accounts', Number(none.rows[0].n) === 0, `(${none.rows[0].n})`)
  const me = onlyB[0]
  const self = await withNoTenant(() => query(`SELECT id FROM users`), me)
  check('no tenant, signed in: only your own account', self.rowCount === 1 && self.rows[0].id === me, `(${self.rowCount})`)

  console.log('-- password hashes --')
  for (const [label, run] of [
    ['in a tenant', () => withTenant({ tenantId: A }, () => query(`SELECT password_hash FROM users LIMIT 1`))],
    ['your own', () => withNoTenant(() => query(`SELECT password_hash FROM users WHERE id = $1`, [me]), me)],
    ['through SELECT *', () => withTenant({ tenantId: A }, () => query(`SELECT * FROM users LIMIT 1`))],
    ['through RETURNING', () => withTenant({ tenantId: A }, () =>
      query(`UPDATE users SET updated_at = updated_at WHERE id = $1 RETURNING password_hash`, [[...ofA][0]]))],
  ] as Array<[string, () => Promise<unknown>]>) {
    const code = await refused(run)
    check(`a password hash cannot be read: ${label}`, code === '42501', `(${code ?? 'it was read'})`)
  }

  console.log('-- writes --')
  const upd = await withTenant({ tenantId: A }, () =>
    query(`UPDATE users SET full_name = full_name || '' WHERE id = ANY($1)`, [onlyB]))
  check("B's accounts cannot be updated from A", upd.rowCount === 0, `(${upd.rowCount} updated)`)
  // Nothing of B's is visible to delete (or a foreign key refuses): either
  // way, every one of B's accounts must still be there afterwards.
  await refused(() => withTenant({ tenantId: A }, () => query(`DELETE FROM users WHERE id = ANY($1)`, [onlyB])))
  const left = Number((await owner(`SELECT count(*) AS n FROM users WHERE id = ANY($1)`, [onlyB])).rows[0].n)
  check("nor deleted: B's accounts are all still there", left === onlyB.length, `(${left} of ${onlyB.length})`)

  // An account created in A is A's to see before its membership exists, and
  // not B's.
  const platform = (await owner(`SELECT platform_id, role_id FROM users WHERE id = $1`, [[...ofA][0]])).rows[0]
  const email = `rls-${Date.now()}@identity.test`
  const created = await withTenant({ tenantId: A }, () =>
    query(`INSERT INTO users (platform_id, email, full_name, role_id, password_hash, is_active)
           VALUES ($1, $2, 'RLS probe', $3, 'x', FALSE) RETURNING id`, [platform.platform_id, email, platform.role_id]))
  const newId = created.rows[0]?.id
  check('A can create an account and read it back', !!newId)
  const fromB = await withTenant({ tenantId: B }, () => query(`SELECT 1 FROM users WHERE id = $1`, [newId]))
  check('B cannot see it', fromB.rowCount === 0)
  await owner(`DELETE FROM users WHERE id = $1`, [newId])

  console.log('-- memberships --')
  for (const [t, col] of [['school_user_associations', 'school_entity_id'], ['school_user_approvals', 'school_entity_id'],
                          ['school_entities', 'id']] as const) {
    const r = await withTenant({ tenantId: A }, () => query(`SELECT ${col} AS t FROM ${t}`))
    check(`${t}: A sees only A's rows`, r.rows.every((x: any) => x.t === A), `(${r.rows.filter((x: any) => x.t !== A).length} others)`)
  }

  // Audit phase 2, F1: visibility follows memberships, so B must not be able
  // to make one of A's people its member, applicant or administrator and so
  // see them (migration 081). B's school is the target; A's person is not
  // visible to B to begin with.
  const onlyA = [...ofA].find((u) => !ofB.has(u))!
  const bIsSchool = (await owner(`SELECT 1 FROM school_entities WHERE id = $1`, [B])).rowCount === 1
  check("B is a school with someone of A's who is not B's", bIsSchool && !!onlyA)
  for (const [label, run] of [
    ['as a member', () => withTenant({ tenantId: B }, () =>
      query(`INSERT INTO school_user_associations (user_id, school_entity_id, status) VALUES ($1, $2, 'active')`, [onlyA, B]))],
    ['as an applicant', () => withTenant({ tenantId: B }, () =>
      query(`INSERT INTO school_user_approvals (user_id, school_entity_id, requested_role, status, requested_at)
             VALUES ($1, $2, 'student', 'pending', CURRENT_TIMESTAMP)`, [onlyA, B]))],
    ['as administrator', () => withTenant({ tenantId: B }, () =>
      query(`UPDATE school_entities SET admin_user_id = $1 WHERE id = $2`, [onlyA, B]))],
    ["by moving one of B's memberships onto them", () => withTenant({ tenantId: B }, () =>
      query(`UPDATE school_user_associations SET user_id = $1
              WHERE id = (SELECT id FROM school_user_associations WHERE school_entity_id = $2 LIMIT 1)`, [onlyA, B]))],
  ] as Array<[string, () => Promise<unknown>]>) {
    const code = await refused(run)
    check(`B cannot take on one of A's people ${label}`, code === '42501', `(${code ?? 'it ran'})`)
  }
  const stillHidden = await withTenant({ tenantId: B }, () => query(`SELECT 1 FROM users WHERE id = $1`, [onlyA]))
  check("and A's person is still invisible to B", stillHidden.rowCount === 0)
  const adminAfter = (await owner(`SELECT admin_user_id FROM school_entities WHERE id = $1`, [B])).rows[0]?.admin_user_id
  check("and B's administrator is unchanged", adminAfter !== onlyA)

  // Audit phase 3, F1: an account another tenant shares keeps its role,
  // status and details whatever one tenant does (migrations 083, 084).
  // An earlier suite may have left a removed membership in B: make it live,
  // and put back whatever was there.
  const priorB = (await owner(`SELECT status FROM school_user_associations WHERE user_id = $1 AND school_entity_id = $2`,
    [onlyA, B])).rows[0]?.status ?? null
  await owner(`INSERT INTO school_user_associations (user_id, school_entity_id, status) VALUES ($1, $2, 'active')
               ON CONFLICT (user_id, school_entity_id) DO UPDATE SET status = 'active'`, [onlyA, B])
  try {
    for (const [label, sql] of [
      ['switched off', `UPDATE users SET is_active = FALSE WHERE id = $1`],
      ['renamed', `UPDATE users SET full_name = full_name || ' (edited)' WHERE id = $1`],
    ] as const) {
      const code = await refused(() => withTenant({ tenantId: A }, () => query(sql, [onlyA])))
      check(`an account school B shares cannot be ${label} from A`, code === '42501', `(${code ?? 'it ran'})`)
    }
    const roleCode = await refused(() => withTenant({ tenantId: A }, () =>
      query(`UPDATE users SET role_id = (SELECT id FROM roles WHERE platform_id = users.platform_id AND id <> users.role_id LIMIT 1) WHERE id = $1`, [onlyA])))
    check('nor given another role', roleCode === '42501', `(${roleCode ?? 'it ran'})`)
    // Visible to A (created there) but live only in B: still B's (migration 085).
    const elsewhere = (await owner(
      `INSERT INTO users (platform_id, email, full_name, role_id, password_hash, is_active, created_tenant_id)
       SELECT platform_id, $1, 'Moved to B', role_id, 'x', TRUE, $2 FROM users WHERE id = $3 RETURNING id`,
      [`moved-${Date.now()}@identity.test`, A, onlyB[0]])).rows[0].id
    await owner(`INSERT INTO school_user_associations (user_id, school_entity_id, status) VALUES ($1, $2, 'active')`, [elsewhere, B])
    try {
      const moved = await refused(() => withTenant({ tenantId: A }, () =>
        query(`UPDATE users SET full_name = 'Renamed by A' WHERE id = $1`, [elsewhere])))
      check('an account A can see but which is live only in B cannot be changed from A', moved === '42501', `(${moved ?? 'it ran'})`)
    } finally {
      await owner(`DELETE FROM school_user_associations WHERE user_id = $1`, [elsewhere])
      await owner(`DELETE FROM users WHERE id = $1`, [elsewhere])
    }
    const solo = [...ofA].find((u) => u !== onlyA && !ofB.has(u))
    if (solo) {
      const mine = await refused(() => withTenant({ tenantId: A }, () =>
        query(`UPDATE users SET full_name = full_name || ' ' WHERE id = $1`, [solo])))
      check("while an account only A has is A's to edit", mine === null, `(${mine})`)
      await owner(`UPDATE users SET full_name = rtrim(full_name) WHERE id = $1`, [solo])
    }
    const forged = await refused(() => withTenant({ tenantId: A }, () =>
      query(`UPDATE users SET membership_count = membership_count + 5 WHERE id = $1`, [onlyA])))
    check('and the membership count that marks it shared cannot be rewritten', forged === '42501', `(${forged ?? 'it ran'})`)
  } finally {
    if (priorB === null) {
      await owner(`DELETE FROM school_user_associations WHERE user_id = $1 AND school_entity_id = $2`, [onlyA, B])
    } else {
      await owner(`UPDATE school_user_associations SET status = $3 WHERE user_id = $1 AND school_entity_id = $2`, [onlyA, B, priorB])
    }
  }

  // The guard must not stop a tenant adding someone it can already see: an
  // account created in B can apply to B.
  const probe = (await owner(
    `INSERT INTO users (platform_id, email, full_name, role_id, password_hash, is_active, created_tenant_id)
     SELECT platform_id, $1, 'Guard probe', role_id, 'x', FALSE, $2 FROM users WHERE id = $3 RETURNING id`,
    [`guard-${Date.now()}@identity.test`, B, onlyB[0]])).rows[0].id
  try {
    const ok = await refused(() => withTenant({ tenantId: B }, () =>
      query(`INSERT INTO school_user_approvals (user_id, school_entity_id, requested_role, status, requested_at)
             VALUES ($1, $2, 'student', 'pending', CURRENT_TIMESTAMP)`, [probe, B])))
    check('B can still add an account it can see', ok === null, `(${ok})`)
  } finally {
    await owner(`DELETE FROM school_user_approvals WHERE user_id = $1`, [probe])
    await owner(`DELETE FROM users WHERE id = $1`, [probe])
  }

  console.log('-- credentials follow the account --')
  for (const t of ['auth_sessions', 'auth_tokens', 'user_mfa', 'user_mfa_recovery_codes', 'mfa_login_challenges']) {
    const r = await withTenant({ tenantId: A }, () => query(`SELECT user_id FROM ${t}`))
    check(`${t}: A sees only its people's rows`, r.rows.every((x: any) => ofA.has(x.user_id)),
      `(${r.rows.filter((x: any) => !ofA.has(x.user_id)).length} others)`)
    const n = await withNoTenant(() => query(`SELECT count(*) AS n FROM ${t}`))
    check(`${t}: nothing with no tenant and nobody signed in`, Number(n.rows[0].n) === 0, `(${n.rows[0].n})`)
  }
  // Sessions are written only by src/auth/sessions.ts on the system pool
  // (migration 081, audit phase 2 F2): the runtime role cannot write one in
  // any context, its own tenant's included.
  const sessionsOfB = Number((await owner(`SELECT count(*) AS n FROM auth_sessions WHERE user_id = ANY($1)`, [onlyB])).rows[0].n)
  const someOfA = [...ofA]
  for (const [label, run] of [
    [`B's sessions (${sessionsOfB}) ended from A`, () => withTenant({ tenantId: A }, () =>
      query(`UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ANY($1)`, [onlyB]))],
    ["A's own sessions ended from A", () => withTenant({ tenantId: A }, () =>
      query(`UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ANY($1)`, [someOfA]))],
    ['a session deleted', () => withTenant({ tenantId: A }, () =>
      query(`DELETE FROM auth_sessions WHERE user_id = ANY($1)`, [someOfA]))],
    ['a session created', () => withTenant({ tenantId: A }, () =>
      query(`INSERT INTO auth_sessions (user_id) VALUES ($1)`, [someOfA[0]]))],
  ] as Array<[string, () => Promise<unknown>]>) {
    const code = await refused(run)
    check(`the runtime role cannot write sessions: ${label}`, code === '42501', `(${code ?? 'it ran'})`)
  }
  const failed = await refused(() => withTenant({ tenantId: A }, () => query(`SELECT 1 FROM auth_failed_logins LIMIT 1`)))
  check('failed sign-ins are not readable by the runtime role at all', failed === '42501', `(${failed ?? 'read'})`)

  console.log('-- coverage --')
  const uncovered = (await owner(`
    SELECT c.relname AS t
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
       AND EXISTS (SELECT 1 FROM pg_constraint k
                    WHERE k.conrelid = c.oid AND k.contype = 'f' AND k.confrelid = 'users'::regclass)
       AND NOT (c.relrowsecurity AND c.relforcerowsecurity
                AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))
     ORDER BY 1`)).rows.map((r) => r.t as string)
  const undecided = uncovered.filter((t) => !(t in PLATFORM_LEVEL))
  check('every table naming an account is under a policy or listed as platform-level', undecided.length === 0,
    `(undecided: ${undecided.join(', ')})`)
  const stale = Object.keys(PLATFORM_LEVEL).filter((t) => !uncovered.includes(t))
  check('and the platform-level list names no table that is covered or gone', stale.length === 0, `(${stale.join(', ')})`)
}

main()
  .catch((e) => {
    fail++
    console.error(e)
  })
  .finally(async () => {
    await pool.end().catch(() => undefined)
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  })
