/** Seeds two corporate tenants with HR directors, employees and check-ins. */
import { query } from '../db/connection.js'
import { generateAccessToken } from '../auth/authService.js'
import bcrypt from 'bcryptjs'

async function main() {
  const cp = (await query(`SELECT id FROM platforms WHERE name='corporate'`)).rows[0]
  const hrRole = (await query(`SELECT id FROM roles WHERE platform_id=$1 AND name='hr'`, [cp.id])).rows[0]
  const empRole = (await query(`SELECT id FROM roles WHERE platform_id=$1 AND name='employee'`, [cp.id])).rows[0]

  await query(`DELETE FROM notifications WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM notification_campaigns WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  // Leave rows reference employees and types, so they clear first.
  await query(`DELETE FROM leave_request_days WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM leave_requests WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM leave_balances WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM leave_types WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM corporate_checkins WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM employees WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM corporate_departments WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM corporate_user_associations WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@c2e.test')`)
  await query(`DELETE FROM users WHERE email LIKE '%@c2e.test'`)
  await query(`DELETE FROM corporate_entities WHERE code LIKE 'C2E-%'`)
  await query(`DELETE FROM tenants WHERE code LIKE 'C2E-%'`)

  const hash = await bcrypt.hash('Passw0rd!x', 10)
  const out: any = {}
  for (const tag of ['A', 'B']) {
    const ent = (await query(
      `INSERT INTO corporate_entities (name, code, email, is_active) VALUES ($1,$2,$3,true) RETURNING id`,
      [`C2E Corp ${tag}`, `C2E-${tag}`, `${tag.toLowerCase()}@c2e.test`])).rows[0]

    const hr = (await query(
      `INSERT INTO users (platform_id,email,full_name,role_id,password_hash,is_active)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
      [cp.id, `hr.${tag.toLowerCase()}@c2e.test`, `HR ${tag}`, hrRole.id, hash])).rows[0]
    await query(`INSERT INTO corporate_user_associations (user_id, corporate_entity_id, status) VALUES ($1,$2,'active')`,
      [hr.id, ent.id])

    const dept = (await query(
      `INSERT INTO corporate_departments (name, code, platform_id, tenant_id) VALUES ($1,$2,$3,$4) RETURNING id`,
      [`Operations ${tag}`, `OPS${tag}`, cp.id, ent.id])).rows[0]

    // The HR user is an employee of the company too. Without this they cannot
    // take leave, and the rule that nobody approves their own request has no
    // way to be exercised for the people it matters most for.
    const hrEmp = (await query(
      `INSERT INTO employees (user_id, employee_id, first_name, last_name, email, phone,
                              department_id, date_of_joining, is_currently_employed, tenant_id)
       VALUES ($1,$2,$3,$4,$5,'000',$6,'2024-01-01',true,$7) RETURNING id`,
      [hr.id, `E-${tag}HR`, 'HR', tag, `hr.${tag.toLowerCase()}@c2e.test`, dept.id, ent.id])).rows[0]

    const empIds: string[] = []
    let firstEmpUserId: string | null = null
    for (let i = 1; i <= 3; i++) {
      const eu = (await query(
        `INSERT INTO users (platform_id,email,full_name,role_id,password_hash,is_active)
         VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
        [cp.id, `emp${i}.${tag.toLowerCase()}@c2e.test`, `Emp${i} ${tag}`, empRole.id, hash])).rows[0]
      await query(`INSERT INTO corporate_user_associations (user_id, corporate_entity_id, status) VALUES ($1,$2,'active')`,
        [eu.id, ent.id])
      const emp = (await query(
        `INSERT INTO employees (user_id, employee_id, first_name, last_name, email, phone, department_id, date_of_joining, is_currently_employed, tenant_id)
         VALUES ($1,$2,$3,$4,$5,'000',$6,'2025-01-01',true,$7) RETURNING id`,
        [eu.id, `E-${tag}${i}`, `Emp${i}`, tag, `emp${i}.${tag.toLowerCase()}@c2e.test`, dept.id, ent.id])).rows[0]
      empIds.push(emp.id)
      if (i === 1) firstEmpUserId = eu.id
      // employee 1 attends a lot, 2 some, 3 none -> distinct bands and patterns
      const n = i === 1 ? 28 : i === 2 ? 12 : 0
      for (let d = 0; d < n; d++) {
        await query(
          `INSERT INTO corporate_checkins (employee_id, check_in_type, check_in_time, face_verified, tenant_id)
           VALUES ($1,'office', NOW() - ($2 || ' days')::interval, $3, $4)`,
          [emp.id, d, d % 2 === 0, ent.id])
      }
    }

    out[tag] = {
      tenantId: ent.id, deptId: dept.id, employees: empIds,
      hrEmpId: hrEmp.id,
      token: generateAccessToken(hr.id, cp.id, hrRole.id),
      empToken: generateAccessToken(firstEmpUserId!, cp.id, empRole.id),
      empId: empIds[0],
    }
  }
  console.log(JSON.stringify(out))
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})
