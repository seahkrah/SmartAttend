import { query } from '../../db/connection.js'

/**
 * Teardown for the database-backed unit tests.
 *
 * All three of these suites built their fixture in beforeEach by inserting a
 * platform with a hardcoded name and never removing it. The first test in a
 * file passed; every test after it failed on the unique index, and so did
 * every test in every later run, because the row from the first run was
 * still there. That is the whole of why 104 unit tests were failing.
 *
 * The fix is a unique name per test plus a teardown that removes what the
 * name identifies. Deleting by prefix rather than by captured id means a test
 * that dies halfway through still cleans up after itself on the next run.
 */

/** A platform name unique to one test, within the length the column allows. */
export function uniquePlatformName(prefix = 'ut'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Removes everything hanging off the named platforms.
 *
 * Ordered by dependency: the leaves first, then what they reference. Tables
 * that may not exist in a given database are guarded with to_regclass so a
 * partial schema does not turn teardown into a second failure.
 */
export async function dropPlatforms(names: string[]): Promise<void> {
  if (names.length === 0) return

  const ids = await query(
    `SELECT id FROM platforms WHERE name = ANY($1::text[])`, [names]
  )
  if (ids.rowCount === 0) return
  const platformIds = ids.rows.map((r: any) => r.id)

  // Entities belonging to those platforms, found through the users on them,
  // since school_entities carries no platform column.
  const entities = await query(
    `SELECT DISTINCT a.school_entity_id AS id
       FROM school_user_associations a
       JOIN users u ON u.id = a.user_id
      WHERE u.platform_id = ANY($1::uuid[])`,
    [platformIds]
  )
  const entityIds = entities.rows.map((r: any) => r.id).filter(Boolean)

  const byTenant = [
    'school_attendance', 'enrollments', 'student_courses', 'class_schedules',
    'rooms', 'students', 'courses', 'semesters', 'school_departments',
  ]
  for (const table of byTenant) {
    if (entityIds.length === 0) break
    await query(
      `DO $cleanup$
       BEGIN
         IF to_regclass('public.${table}') IS NOT NULL THEN
           EXECUTE format('DELETE FROM %I WHERE tenant_id = ANY($1)', '${table}')
             USING $1::uuid[];
         END IF;
       END
       $cleanup$;`,
      [entityIds]
    ).catch(() => undefined)
  }

  await query(
    `DELETE FROM school_user_associations
      WHERE user_id IN (SELECT id FROM users WHERE platform_id = ANY($1::uuid[]))`,
    [platformIds]
  ).catch(() => undefined)

  // The audit tables refuse deletion, which is correct everywhere except a
  // teardown. Suspended for exactly these rows and restored immediately.
  for (const [table, trigger] of [
    ['superadmin_audit_log', 'prevent_superadmin_audit_log_delete'],
    ['audit_logs', 'USER'],
    ['audit_access_log', 'USER'],
  ] as const) {
    await query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`).catch(() => undefined)
  }
  try {
    await query(
      `DELETE FROM superadmin_audit_log
        WHERE actor_id IN (SELECT id FROM users WHERE platform_id = ANY($1::uuid[]))`,
      [platformIds]
    ).catch(() => undefined)
    await query(
      `DELETE FROM audit_logs
        WHERE user_id IN (SELECT id FROM users WHERE platform_id = ANY($1::uuid[]))
           OR actor_id IN (SELECT id FROM users WHERE platform_id = ANY($1::uuid[]))`,
      [platformIds]
    ).catch(() => undefined)
    await query(
      `DELETE FROM audit_access_log
        WHERE actor_id IN (SELECT id FROM users WHERE platform_id = ANY($1::uuid[]))`,
      [platformIds]
    ).catch(() => undefined)
  } finally {
    for (const [table, trigger] of [
      ['superadmin_audit_log', 'prevent_superadmin_audit_log_delete'],
      ['audit_logs', 'USER'],
      ['audit_access_log', 'USER'],
    ] as const) {
      await query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`).catch(() => undefined)
    }
  }

  if (entityIds.length > 0) {
    await query(`DELETE FROM tenant_lifecycle_audit WHERE tenant_id = ANY($1::uuid[])`,
      [entityIds]).catch(() => undefined)
    await query(`DELETE FROM session_invalidation_log WHERE tenant_id = ANY($1::uuid[])`,
      [entityIds]).catch(() => undefined)
  }

  await query(`DELETE FROM users WHERE platform_id = ANY($1::uuid[])`, [platformIds])
    .catch(() => undefined)

  if (entityIds.length > 0) {
    // The AFTER DELETE trigger removes the matching tenants row.
    await query(`DELETE FROM school_entities WHERE id = ANY($1::uuid[])`, [entityIds])
      .catch(() => undefined)
  }

  await query(`DELETE FROM roles WHERE platform_id = ANY($1::uuid[])`, [platformIds])
    .catch(() => undefined)
  await query(`DELETE FROM platforms WHERE id = ANY($1::uuid[])`, [platformIds])
    .catch(() => undefined)
}

/**
 * Removes anything a previous run left behind under a prefix.
 *
 * Called once before a suite starts, so a run that was interrupted does not
 * poison the next one.
 */
export async function dropPlatformsByPrefix(prefix: string): Promise<void> {
  const r = await query(`SELECT name FROM platforms WHERE name LIKE $1`, [`${prefix}-%`])
  await dropPlatforms(r.rows.map((x: any) => x.name))
}
