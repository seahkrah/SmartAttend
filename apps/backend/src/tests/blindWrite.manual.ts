/**
 * Row-level security, write side: as tenant A, try to change tenant B.
 *
 *   - UPDATE / DELETE aimed at B's row by id affect nothing;
 *   - INSERT carrying B's tenant_id is refused (WITH CHECK);
 *   - moving A's own row into B is refused;
 *   - an UPDATE with no WHERE at all touches only A's rows;
 *   - a reference from A's row to B's (where foreign-key checks, which
 *     PostgreSQL runs without RLS, would let it through) is refused.
 *
 * Everything runs in one transaction that is rolled back; the owner verifies
 * B's rows are untouched. Needs APP_DATABASE_URL and the e2e seed fixtures.
 * Run by scripts/run-all-e2e.sh as suite "blindWrite".
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import pool, { getConnection } from '../db/connection.js'
import { withTenant } from '../db/dbContext.js'

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
const studentA: string = seed.A.students[0]
const studentB: string = seed.B.students[0]

async function owner(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    return await c.query(sql, params)
  } finally {
    await c.end()
  }
}

async function main() {
  if (!process.env.APP_DATABASE_URL || process.env.APP_DATABASE_URL === process.env.DATABASE_URL) {
    check('APP_DATABASE_URL names a runtime role distinct from DATABASE_URL', false, '(not set: nothing here would be filtered)')
    return
  }
  const before = (await owner(`SELECT first_name, tenant_id FROM students WHERE id = $1`, [studentB])).rows[0]

  await withTenant({ tenantId: A }, async () => {
    const c = await getConnection()
    // An expected refusal must not abort the rest of the transaction.
    const refused = async (sql: string, params: unknown[]): Promise<string | null> => {
      await c.query('SAVEPOINT attempt')
      try {
        await c.query(sql, params)
        await c.query('RELEASE SAVEPOINT attempt')
        return null
      } catch (e: any) {
        await c.query('ROLLBACK TO SAVEPOINT attempt')
        return e.message as string
      }
    }
    try {
      await c.query('BEGIN')

      const upd = await c.query(`UPDATE students SET first_name = 'Hijacked' WHERE id = $1`, [studentB])
      check("UPDATE of B's row by id affects nothing", upd.rowCount === 0, `(${upd.rowCount})`)

      const del = await c.query(`DELETE FROM students WHERE id = $1`, [studentB])
      check("DELETE of B's row by id affects nothing", del.rowCount === 0, `(${del.rowCount})`)

      const ins = await refused(
        `INSERT INTO guardians (tenant_id, first_name, last_name, email) VALUES ($1, 'Blind', 'Write', 'blind@example.org')`,
        [B],
      )
      check("INSERT carrying B's tenant_id is refused", !!ins && /row-level security/i.test(ins), `(${ins})`)

      const move = await refused(`UPDATE students SET tenant_id = $1 WHERE id = $2`, [B, studentA])
      check("moving A's own row into B is refused", !!move, `(${move})`)

      const ownCount = Number((await c.query(`SELECT count(*) AS n FROM students`)).rows[0].n)
      const everything = await c.query(`UPDATE students SET status = status`)
      check('an UPDATE with no WHERE touches only A’s rows', everything.rowCount === ownCount, `(${everything.rowCount} vs ${ownCount})`)

      // Foreign-key checks are made without RLS, so the database's own
      // reference check would accept B's student id; the same-tenant
      // triggers must not.
      const g = await c.query(
        `INSERT INTO guardians (tenant_id, first_name, last_name, email) VALUES ($1, 'Blind', 'Ref', 'ref@example.org') RETURNING id`,
        [A],
      )
      const link = await refused(
        `INSERT INTO guardian_students (tenant_id, guardian_id, student_id, relationship) VALUES ($1, $2, $3, 'guardian')`,
        [A, g.rows[0].id, studentB],
      )
      check("A's row cannot reference B's student", !!link, `(${link})`)
    } finally {
      await c.query('ROLLBACK').catch(() => {})
      c.release()
    }
  })

  const afterRow = (await owner(`SELECT first_name, tenant_id FROM students WHERE id = $1`, [studentB])).rows[0]
  check("B's student is exactly as it was", JSON.stringify(afterRow) === JSON.stringify(before), `(${JSON.stringify(afterRow)})`)
}

main()
  .catch((e) => {
    fail++
    console.error(e)
  })
  .finally(async () => {
    await pool.end().catch(() => {})
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail === 0 && pass > 0 ? 0 : 1)
  })
