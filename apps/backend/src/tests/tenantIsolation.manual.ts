/**
 * Tenant isolation proof.
 *
 * Seeds two school tenants plus one corporate tenant with real rows, then
 * exercises the scoped data layer as a member of each to confirm no operation
 * crosses a boundary. Run with:
 *   DATABASE_URL=... npx tsx src/tests/tenantIsolation.manual.ts
 */
import { query } from '../db/connection.js'
import {
  listScoped, findScoped, insertScoped, updateScoped, deleteScoped,
  countScoped, assertAllInTenant, TenantScopeError,
} from '../db/tenantScoped.js'
import type { ResolvedTenantContext } from '../auth/tenantContextMiddleware.js'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ok    ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`) }
}
async function expectThrow(name: string, fn: () => Promise<unknown>, status?: number) {
  try { await fn(); check(name, false, '(expected a rejection)') }
  catch (e: any) {
    const ok = e instanceof TenantScopeError && (status === undefined || e.status === status)
    check(name, ok, ok ? '' : `(got ${e.name}: ${e.message})`)
  }
}

async function main() {
  const schoolPlatform = (await query(`SELECT id FROM platforms WHERE name='school'`)).rows[0]
  const corpPlatform = (await query(`SELECT id FROM platforms WHERE name='corporate'`)).rows[0]
  if (!schoolPlatform || !corpPlatform) throw new Error('platforms not seeded')

  // Two school tenants and one corporate tenant.
  await query(`DELETE FROM students WHERE student_id LIKE 'ISO-%'`)
  await query(`DELETE FROM tenants WHERE code IN ('ISO-A','ISO-B','ISO-C')`)
  const a = (await query(
    `INSERT INTO tenants (id, platform_id, kind, name, code) VALUES (gen_random_uuid(),$1,'school','Tenant A','ISO-A') RETURNING id`,
    [schoolPlatform.id])).rows[0]
  const b = (await query(
    `INSERT INTO tenants (id, platform_id, kind, name, code) VALUES (gen_random_uuid(),$1,'school','Tenant B','ISO-B') RETURNING id`,
    [schoolPlatform.id])).rows[0]
  const c = (await query(
    `INSERT INTO tenants (id, platform_id, kind, name, code) VALUES (gen_random_uuid(),$1,'corporate','Tenant C','ISO-C') RETURNING id`,
    [corpPlatform.id])).rows[0]

  const ctx = (tenantId: string, kind: 'school'|'corporate'): ResolvedTenantContext => ({
    userId: '00000000-0000-0000-0000-000000000001', roleId: 'r', roleName: 'admin',
    platformId: kind === 'school' ? schoolPlatform.id : corpPlatform.id,
    platformKind: kind, tenantId, tenantName: 'x', memberships: [], isSuperadmin: false,
  })
  const ctxA = ctx(a.id, 'school'), ctxB = ctx(b.id, 'school'), ctxC = ctx(c.id, 'corporate')

  // students.user_id is NOT NULL, so each student needs a backing identity.
  const role = (await query(`SELECT id FROM roles WHERE platform_id=$1 LIMIT 1`, [schoolPlatform.id])).rows[0]
  if (!role) throw new Error('no school role seeded')
  await query(`DELETE FROM users WHERE email LIKE '%@iso.test'`)
  const mkUser = async (email: string) => (await query(
    `INSERT INTO users (platform_id, email, full_name, role_id, password_hash, is_active)
     VALUES ($1,$2,$3,$4,'x',true) RETURNING id`,
    [schoolPlatform.id, email, email, role.id])).rows[0].id
  const uA = await mkUser('a1@iso.test')
  const uB = await mkUser('b1@iso.test')

  console.log('\n-- create is owned by the server --')
  const sA = await insertScoped<any>('students', ctxA, {
    user_id: uA,
    student_id: 'ISO-A1', first_name: 'Ada', last_name: 'Alpha', email: 'a1@iso.test', college: 'Computing', status: 'active', enrollment_year: 2026, platform_id: schoolPlatform.id,
    tenant_id: b.id,   // hostile: try to plant the row in Tenant B
  })
  check('insert ignores client tenant_id', sA.tenant_id === a.id, `(got ${sA.tenant_id})`)

  const sB = await insertScoped<any>('students', ctxB, {
    user_id: uB,
    student_id: 'ISO-B1', first_name: 'Bob', last_name: 'Beta', email: 'b1@iso.test', college: 'Computing', status: 'active', enrollment_year: 2026, platform_id: schoolPlatform.id,
  })
  check('second tenant insert lands in its own tenant', sB.tenant_id === b.id)

  console.log('\n-- read is scoped --')
  const listA = await listScoped<any>('students', ctxA, { where: "student_id LIKE 'ISO-%'" })
  check('A sees only its own rows', listA.every(r => r.tenant_id === a.id) && listA.length === 1)
  const nA = await countScoped('students', ctxA, "student_id LIKE 'ISO-%'")
  check('count is scoped', nA === 1, `(got ${nA})`)

  console.log('\n-- cross-tenant access by id --')
  check('A cannot read B row by id', (await findScoped('students', ctxA, sB.id)) === null)
  check('B cannot read A row by id', (await findScoped('students', ctxB, sA.id)) === null)
  check('A cannot update B row', (await updateScoped('students', ctxA, sB.id, { first_name: 'Hacked' })) === null)
  const bStill = await findScoped<any>('students', ctxB, sB.id)
  check('B row unchanged after A attempt', bStill?.first_name === 'Bob')
  check('A cannot delete B row', (await deleteScoped('students', ctxA, sB.id)) === null)
  check('B row survives A delete attempt', (await findScoped('students', ctxB, sB.id)) !== null)

  console.log('\n-- ownership cannot be reassigned by update --')
  const moved = await updateScoped<any>('students', ctxA, sA.id, { first_name: 'Ada2', tenant_id: b.id })
  check('update refuses to change tenant_id', moved?.tenant_id === a.id, `(got ${moved?.tenant_id})`)
  check('update still applies other fields', moved?.first_name === 'Ada2')

  console.log('\n-- related-id checks --')
  await expectThrow('assertAllInTenant rejects a foreign id', () => assertAllInTenant('students', ctxA, [sB.id]), 404)
  await assertAllInTenant('students', ctxA, [sA.id]); check('assertAllInTenant accepts own id', true)

  console.log('\n-- platform isolation --')
  await expectThrow('corporate identity cannot read school table', () => listScoped('students', ctxC), 403)
  await expectThrow('corporate identity cannot write school table',
    () => insertScoped('students', ctxC, { user_id: uA, student_id: 'ISO-C1', first_name: 'X', last_name: 'Y', email: 'c@iso.test', college: 'Ops', status: 'active', enrollment_year: 2026, platform_id: schoolPlatform.id, }), 403)

  console.log('\n-- misuse is refused --')
  await expectThrow('unknown table rejected', () => listScoped('pg_user', ctxA), 500)
  await expectThrow('missing tenant rejected',
    () => listScoped('students', { ...ctxA, tenantId: null }), 403)
  await expectThrow('unsafe orderBy rejected',
    () => listScoped('students', ctxA, { orderBy: 'id; DROP TABLE students' }), 500)

  // Clean up.
  await query(`DELETE FROM students WHERE student_id LIKE 'ISO-%'`)
  await query(`DELETE FROM users WHERE email LIKE '%@iso.test'`)
  await query(`DELETE FROM tenants WHERE code IN ('ISO-A','ISO-B','ISO-C')`)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
