/** Seeds two school tenants with an admin each, and prints their JWTs. */
import { query } from '../db/connection.js'
import { generateAccessToken } from '../auth/authService.js'
import bcrypt from 'bcryptjs'

async function main() {
  const sp = (await query(`SELECT id FROM platforms WHERE name='school'`)).rows[0]
  const adminRole = (await query(`SELECT id FROM roles WHERE platform_id=$1 AND name='admin'`, [sp.id])).rows[0]
  const facRole = (await query(`SELECT id FROM roles WHERE platform_id=$1 AND name='faculty'`, [sp.id])).rows[0]

  // Order matters: children before parents.
  // The attendance audit trigger writes audit_logs rows referencing these
  // users, and that foreign key is RESTRICT by design — an audit trail should
  // outlive the record it describes. audit_logs is also immutable (008_5), so
  // deletion is refused outright.
  //
  // Both behaviours are correct and worth keeping. A fixture reset therefore
  // suspends the immutability trigger for the length of its own cleanup rather
  // than weakening either guarantee. This runs only against a throwaway
  // verification database.
  await query(`ALTER TABLE audit_logs DISABLE TRIGGER USER`)
  await query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@e2e.test')`)
  await query(`DELETE FROM audit_logs WHERE actor_id IN (SELECT id FROM users WHERE email LIKE '%@e2e.test')`)
  await query(`ALTER TABLE audit_logs ENABLE TRIGGER USER`)
  // audit_access_log records who read the trail and is immutable for the same
  // reason, with actor_id now RESTRICT rather than SET NULL (037). The fixture
  // clears its own rows the same way.
  await query(`ALTER TABLE audit_access_log DISABLE TRIGGER USER`)
  await query(`DELETE FROM audit_access_log WHERE actor_id IN (SELECT id FROM users WHERE email LIKE '%@e2e.test')`)
  await query(`ALTER TABLE audit_access_log ENABLE TRIGGER USER`)
  // Academic records reference courses, students and terms, so they clear
  // first: results before scores, scores before assessments, curriculum
  // before programmes.
  await query(`DELETE FROM course_results WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM assessment_scores WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM assessments WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM grade_bands WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM grading_schemes WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM student_programmes WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM programme_courses WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM programmes WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)

  // Corrections reference the attendance rows they amend and the person who
  // made them, so they go before both. They are immutable for the same reason
  // audit_logs is — a correction trail that can be deleted proves nothing — so
  // the fixture suspends that guard for its own cleanup rather than weakening
  // it, exactly as it does above.
  await query(`ALTER TABLE correction_audit_log DISABLE TRIGGER USER`)
  await query(`DELETE FROM correction_audit_log WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`ALTER TABLE correction_audit_log ENABLE TRIGGER USER`)
  await query(`ALTER TABLE attendance_corrections DISABLE TRIGGER USER`)
  await query(`DELETE FROM attendance_corrections WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`ALTER TABLE attendance_corrections ENABLE TRIGGER USER`)
  await query(`DELETE FROM attendance_submissions WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM school_attendance WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  // Face templates and their verification attempts hang off students and
  // sessions; course_sessions.lecturer_id is RESTRICT, so sessions have to go
  // before the faculty rows they name.
  await query(`DELETE FROM face_recognition_verifications WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM face_recognition_enrollments WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM student_face_embeddings WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM course_sessions WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM tenant_settings WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM student_courses WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM students WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM class_schedules WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM rooms WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM faculty_courses WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM faculty WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM school_user_associations WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@e2e.test')`)
  await query(`DELETE FROM courses WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM semesters WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM academic_years WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM school_departments WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'E2E-%')`)
  await query(`DELETE FROM users WHERE email LIKE '%@e2e.test'`)
  await query(`DELETE FROM school_entities WHERE code LIKE 'E2E-%'`)
  await query(`DELETE FROM tenants WHERE code LIKE 'E2E-%'`)

  const hash = await bcrypt.hash('Passw0rd!x', 10)
  const out: any = {}
  for (const tag of ['A', 'B']) {
    const ent = (await query(
      `INSERT INTO school_entities (name, code, email, is_active) VALUES ($1,$2,$3,true) RETURNING id`,
      [`E2E School ${tag}`, `E2E-${tag}`, `${tag.toLowerCase()}@e2e.test`])).rows[0]
    // trigger syncs tenants
    const admin = (await query(
      `INSERT INTO users (platform_id,email,full_name,role_id,password_hash,is_active)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
      [sp.id, `admin.${tag.toLowerCase()}@e2e.test`, `Admin ${tag}`, adminRole.id, hash])).rows[0]
    await query(`INSERT INTO school_user_associations (user_id, school_entity_id, status) VALUES ($1,$2,'active')`,
      [admin.id, ent.id])

    const dept = (await query(
      `INSERT INTO school_departments (name, code, platform_id, tenant_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [`Computing ${tag}`, `CMP${tag}`, sp.id, ent.id])).rows[0]
    const sem = (await query(
      `INSERT INTO semesters (department_id, name, start_date, end_date, is_active, tenant_id)
       VALUES ($1,$2,'2026-01-01','2026-06-30',true,$3) RETURNING id`,
      [dept.id, `Semester I ${tag}`, ent.id])).rows[0]
    const course = (await query(
      `INSERT INTO courses (department_id, semester_id, code, name, tenant_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [dept.id, sem.id, `CSC-${tag}`, `Course ${tag}`, ent.id])).rows[0]

    // a faculty member for assign-faculty
    const fuser = (await query(
      `INSERT INTO users (platform_id,email,full_name,role_id,password_hash,is_active)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
      [sp.id, `fac.${tag.toLowerCase()}@e2e.test`, `Faculty ${tag}`, facRole.id, hash])).rows[0]
    await query(`INSERT INTO school_user_associations (user_id, school_entity_id, status) VALUES ($1,$2,'active')`,
      [fuser.id, ent.id])
    const fac = (await query(
      `INSERT INTO faculty (user_id, employee_id, first_name, last_name, college, email, department_id, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [fuser.id, `EMP-${tag}`, 'Fac', tag, 'Computing', `fac.${tag.toLowerCase()}@e2e.test`, dept.id, ent.id])).rows[0]

    // a room, schedule and two enrolled students, so a register exists
    const room = (await query(
      `INSERT INTO rooms (building, room_number, capacity, tenant_id) VALUES ($1,$2,30,$3) RETURNING id`,
      [`Block ${tag}`, `R-${tag}`, ent.id])).rows[0]
    const sched = (await query(
      `INSERT INTO class_schedules (course_id, room_id, faculty_id, day_of_week, start_time, end_time, tenant_id)
       VALUES ($1,$2,$3,1,'10:00','11:30',$4) RETURNING id`,
      [course.id, room.id, fac.id, ent.id])).rows[0]
    await query(`INSERT INTO faculty_courses (faculty_id, course_id, tenant_id) VALUES ($1,$2,$3)`,
      [fac.id, course.id, ent.id])

    const studentIds: string[] = []
    for (let i = 1; i <= 2; i++) {
      const su = (await query(
        `INSERT INTO users (platform_id,email,full_name,role_id,password_hash,is_active)
         VALUES ($1,$2,$3,(SELECT id FROM roles WHERE platform_id=$1 AND name='student'),$4,true) RETURNING id`,
        [sp.id, `stu${i}.${tag.toLowerCase()}@e2e.test`, `Stu${i} ${tag}`, hash])).rows[0]
      await query(`INSERT INTO school_user_associations (user_id, school_entity_id, status) VALUES ($1,$2,'active')`,
        [su.id, ent.id])
      const st = (await query(
        `INSERT INTO students (user_id, student_id, first_name, last_name, college, email, status, enrollment_year, platform_id, department_id, tenant_id)
         VALUES ($1,$2,$3,$4,'Computing',$5,'active',2026,$6,$7,$8) RETURNING id`,
        [su.id, `S-${tag}${i}`, `Stu${i}`, tag, `stu${i}.${tag.toLowerCase()}@e2e.test`, sp.id, dept.id, ent.id])).rows[0]
      studentIds.push(st.id)
      await query(`INSERT INTO student_courses (schedule_id, student_id, is_active, tenant_id) VALUES ($1,$2,true,$3)`,
        [sched.id, st.id, ent.id])
    }

    out[tag] = {
      tenantId: ent.id, deptId: dept.id, semId: sem.id, courseId: course.id, facultyId: fac.id,
      scheduleId: sched.id, students: studentIds,
      token: generateAccessToken(admin.id, sp.id, adminRole.id),
      facToken: generateAccessToken(fuser.id, sp.id, facRole.id),
    }
  }
  console.log(JSON.stringify(out))
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})
