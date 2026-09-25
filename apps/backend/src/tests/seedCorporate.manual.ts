/** Seeds two corporate tenants with HR directors, employees and check-ins. */
import { query } from '../db/connection.js'
import { generateAccessToken } from '../auth/authService.js'
import bcrypt from 'bcryptjs'

async function main() {
  const cp = (await query(`SELECT id FROM platforms WHERE name='corporate'`)).rows[0]
  const hrRole = (await query(`SELECT id FROM roles WHERE platform_id=$1 AND name='hr'`, [cp.id])).rows[0]
  const empRole = (await query(`SELECT id FROM roles WHERE platform_id=$1 AND name='employee'`, [cp.id])).rows[0]
  // Payroll needs two distinct people: one who calculates and one who signs
  // off. A single role that can do both makes the approval step decorative.
  const dirRole = (await query(`SELECT id FROM roles WHERE platform_id=$1 AND name='hr_director'`, [cp.id])).rows[0]
  // The tenant administrator and a line manager. The corporate admin routes
  // resolve their company from corporate_entities.admin_user_id, which nothing
  // here used to set, so those pages refused every account in this fixture.
  // Managers have their own permissions — rosters, timesheets, leave — and
  // until now had no account to exercise them with.
  const adminRole = (await query(`SELECT id FROM roles WHERE platform_id=$1 AND name='admin'`, [cp.id])).rows[0]
  const mgrRole = (await query(`SELECT id FROM roles WHERE platform_id=$1 AND name='manager'`, [cp.id])).rows[0]

  await query(`DELETE FROM notifications WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM notification_campaigns WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM stored_files WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM tenant_storage_quota WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  // The outbox, after the inbox rows that point at it.
  await query(`DELETE FROM notification_messages WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM notification_templates WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM notification_channels WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM notification_preferences WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM notification_suppressions WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  // Workforce clears before payroll: a timesheet points at a payroll input.
  // Timesheets cascade to their days; the day guard refuses a direct delete
  // once a sheet is approved, but deleting the sheet carries them with it.
  await query(`DELETE FROM timesheets WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM roster_shifts WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM shift_patterns WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM employment_contracts WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  // Payroll clears before employees: payslips hold employees under RESTRICT.
  //
  // The run is the unit of deletion, not the payslip. An approved run's
  // payslips refuse to be deleted on their own — that is the immutability
  // rule doing its job — but deleting the run cascades through them, which is
  // the only way a tenant's payroll can ever be removed. Trying the slips
  // first fails outright and takes the whole fixture with it.
  await query(`DELETE FROM payroll_runs WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM payroll_inputs WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM payroll_periods WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM employee_salary_components WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM employee_compensation WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM salary_components WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM tax_brackets WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  // Leave rows reference employees and types, so they clear first.
  await query(`DELETE FROM leave_request_days WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM leave_requests WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM leave_balances WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM leave_types WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM corporate_checkins WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  // Face matching records. The event log is append-only and attendance cites
  // it, so it goes after attendance and with its guard suspended for exactly
  // these rows, the same exception the audit-log teardown makes.
  await query(`DELETE FROM face_templates WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM biometric_consents WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`ALTER TABLE biometric_events DISABLE TRIGGER trg_biometric_events_append_only`)
  try {
    await query(`DELETE FROM biometric_events WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  } finally {
    await query(`ALTER TABLE biometric_events ENABLE TRIGGER trg_biometric_events_append_only`)
  }
  await query(`DELETE FROM biometric_challenges WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM employees WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM corporate_departments WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
  await query(`DELETE FROM corporate_user_associations WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@c2e.test')`)
  // Reading the audit trail is itself recorded, and actor_id is RESTRICT
  // (037), so a corporate identity that ever read it would otherwise block
  // its own teardown. Same exception, same pattern as the school fixture.
  await query(`ALTER TABLE audit_access_log DISABLE TRIGGER USER`)
  await query(`DELETE FROM audit_access_log WHERE actor_id IN (SELECT id FROM users WHERE email LIKE '%@c2e.test')`)
  await query(`ALTER TABLE audit_access_log ENABLE TRIGGER USER`)
  await query(`DELETE FROM users WHERE email LIKE '%@c2e.test'`)
  await query(`DELETE FROM corporate_entities WHERE code LIKE 'C2E-%'`)
  await query(`DELETE FROM tenant_settings WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'C2E-%')`)
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

    const dir = (await query(
      `INSERT INTO users (platform_id,email,full_name,role_id,password_hash,is_active)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
      [cp.id, `dir.${tag.toLowerCase()}@c2e.test`, `Director ${tag}`, dirRole.id, hash])).rows[0]
    await query(`INSERT INTO corporate_user_associations (user_id, corporate_entity_id, status) VALUES ($1,$2,'active')`,
      [dir.id, ent.id])

    const admin = (await query(
      `INSERT INTO users (platform_id,email,full_name,role_id,password_hash,is_active)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
      [cp.id, `admin.${tag.toLowerCase()}@c2e.test`, `Admin ${tag}`, adminRole.id, hash])).rows[0]
    await query(`INSERT INTO corporate_user_associations (user_id, corporate_entity_id, status) VALUES ($1,$2,'active')`,
      [admin.id, ent.id])
    await query(`UPDATE corporate_entities SET admin_user_id = $1 WHERE id = $2`, [admin.id, ent.id])

    const mgr = (await query(
      `INSERT INTO users (platform_id,email,full_name,role_id,password_hash,is_active)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
      [cp.id, `mgr.${tag.toLowerCase()}@c2e.test`, `Manager ${tag}`, mgrRole.id, hash])).rows[0]
    await query(`INSERT INTO corporate_user_associations (user_id, corporate_entity_id, status) VALUES ($1,$2,'active')`,
      [mgr.id, ent.id])

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

    const mgrEmp = (await query(
      `INSERT INTO employees (user_id, employee_id, first_name, last_name, email, phone,
                              department_id, date_of_joining, is_currently_employed, tenant_id)
       VALUES ($1,$2,$3,$4,$5,'000',$6,'2024-01-01',true,$7) RETURNING id`,
      [mgr.id, `E-${tag}MG`, 'Manager', tag, `mgr.${tag.toLowerCase()}@c2e.test`, dept.id, ent.id])).rows[0]

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
          // Never face-verified: a fixture has no match to cite, and the
          // database refuses the flag without one (migration 056).
          [emp.id, d, false, ent.id])
      }
    }

    // ---------------------------------------------------------------------
    // A deterministic week for the timesheet suite.
    //
    // Timesheets are computed from closed check-ins, so a suite that asserts
    // real arithmetic needs real evidence at known times. The check-ins the
    // loop above creates are open — no check-out — which is correct for the
    // attendance suites and contributes nothing to hours, so this adds a
    // separate, closed set in a week far enough out that no other suite's
    // RUN-derived dates reach it.
    //
    //   Mon-Thu  08:00-16:30 verified   4 x 8.5 = 34.00 h
    //   Fri      08:00-18:00 verified             10.00 h  -> 44.00 h worked
    //   Sat      09:00-13:00 FLAGGED               4.00 h  -> reported, not counted
    //   Sun      09:00-12:00 REVOKED               3.00 h  -> not counted at all
    //
    // Against a 40-hour contract that is four hours of overtime, and the two
    // excluded days are there so the suite can prove they are excluded for
    // different reasons.
    const tsEmp = empIds[1]
    await query(
      `INSERT INTO employment_contracts
         (tenant_id, employee_id, reference, contract_type, job_title, department_id,
          start_date, weekly_hours, working_days, status, signed_at)
       VALUES ($1,$2,$3,'permanent','Operations Analyst',$4,'2029-01-01',40,5,'active',CURRENT_TIMESTAMP)`,
      [ent.id, tsEmp, `C2E-${tag}-BASE`, dept.id])

    // 2080 a month over a 40-hour week is exactly 12.00 an hour, so an export
    // to payroll has a figure that can be checked by hand.
    await query(
      `INSERT INTO employee_compensation
         (tenant_id, employee_id, effective_from, currency, basic_salary, pay_frequency)
       VALUES ($1,$2,'2029-01-01','USD',2080.00,'monthly')`,
      [ent.id, tsEmp])

    // Six of these weeks, a fortnight apart. The suite transitions a sheet to
    // exported, which by design cannot be undone, so a single week would make
    // the suite runnable once per seed. Six weeks, picked by the suite's run
    // id, give it six; the fortnight gap leaves the week after each one free
    // of check-ins, which is what the leave assertions measure against.
    const SHAPE: Array<[number, string, string, string]> = [
      [0, '08:00', '16:30', 'VERIFIED'],
      [1, '08:00', '16:30', 'VERIFIED'],
      [2, '08:00', '16:30', 'VERIFIED'],
      [3, '08:00', '16:30', 'VERIFIED'],
      [4, '08:00', '18:00', 'VERIFIED'],
      [5, '09:00', '13:00', 'FLAGGED'],
      [6, '09:00', '12:00', 'REVOKED'],
    ]
    const ANCHOR = Date.UTC(2029, 2, 5)   // a Monday
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

    const weeks: Array<Record<string, string>> = []
    for (let k = 0; k < 6; k += 1) {
      const start = ANCHOR + k * 14 * 86400000
      for (const [offset, inAt, outAt, state] of SHAPE) {
        await query(
          `INSERT INTO corporate_checkins
             (employee_id, check_in_type, check_in_time, check_out_time,
              face_verified, checkin_state, tenant_id)
           VALUES ($1,'office',($2 || ' ' || $3)::timestamp,($2 || ' ' || $4)::timestamp,
                   false,$5,$6)`,
          [tsEmp, day(start + offset * 86400000), inAt, outAt, state, ent.id])
      }
      weeks.push({
        start: day(start),
        end: day(start + 6 * 86400000),
        // The week after, deliberately empty of check-ins.
        nextStart: day(start + 7 * 86400000),
        nextEnd: day(start + 13 * 86400000),
        leaveDay: day(start + 9 * 86400000),
      })
    }

    // The payroll period an exported timesheet lands in. Created here rather
    // than by the suite because payroll periods of one frequency cannot
    // overlap, so a suite creating its own would clash with its own last run.
    // 2029 is left clear by every other suite.
    await query(
      `INSERT INTO payroll_periods
         (tenant_id, code, name, start_date, end_date, pay_date, frequency, status)
       VALUES ($1,$2,'Workforce test quarter 2029','2029-03-01','2029-06-30',
               '2029-06-30','monthly','open')`,
      [ent.id, `C2E-${tag}-WF`])

    out[tag] = {
      tenantId: ent.id, deptId: dept.id, employees: empIds,
      timesheetEmpId: tsEmp,
      timesheetWeeks: weeks,
      hrEmpId: hrEmp.id,
      token: generateAccessToken(hr.id, cp.id, hrRole.id),
      dirToken: generateAccessToken(dir.id, cp.id, dirRole.id),
      adminToken: generateAccessToken(admin.id, cp.id, adminRole.id),
      managerToken: generateAccessToken(mgr.id, cp.id, mgrRole.id),
      managerEmpId: mgrEmp.id,
      empToken: generateAccessToken(firstEmpUserId!, cp.id, empRole.id),
      empId: empIds[0],
    }
  }
  console.log(JSON.stringify(out))
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})
