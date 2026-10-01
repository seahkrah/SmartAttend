/**
 * The migrations directory and the `migrations` ledger table, kept in step.
 *
 * Five numeric prefixes were used more than once (006, 007, 008, 012, 017),
 * and the order within each was decided by the rest of the filename — so
 * renaming a file, or adding "008_audit_fix.sql", silently reordered the
 * schema history. The duplicates now carry a letter (006a, 006b, ...)
 * chosen to keep exactly the order they always ran in, and
 * scripts/checks/migration-lint.mjs refuses a repeated prefix.
 *
 * A database that applied the old names must not run them again under the
 * new ones. reconcileLedger() renames the ledger rows first, in one
 * transaction, before anything is compared. It is idempotent: a fresh
 * database has no old rows, an upgraded one has no old rows left.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { PoolClient } from 'pg'

export const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

/** Old ledger name -> current filename. Never remove an entry. */
export const RENAMED: Readonly<Record<string, string>> = {
  '006_add_platform_id_to_school_departments.sql': '006a_add_platform_id_to_school_departments.sql',
  '006_infrastructure_control_plane.sql': '006b_infrastructure_control_plane.sql',
  '006_superadmin_security_tables.sql': '006c_superadmin_security_tables.sql',
  '007_add_platform_id_to_students.sql': '007a_add_platform_id_to_students.sql',
  '007_role_escalation_detection.sql': '007b_role_escalation_detection.sql',
  '007_safety_controls.sql': '007c_safety_controls.sql',
  '008_5_immutability_triggers.sql': '008a_immutability_triggers.sql',
  '008_add_platform_id_to_corporate_departments.sql': '008b_add_platform_id_to_corporate_departments.sql',
  '008_immutable_audit_logging.sql': '008c_immutable_audit_logging.sql',
  '008_incident_management_system.sql': '008d_incident_management_system.sql',
  '012_add_password_reset_flag.sql': '012a_add_password_reset_flag.sql',
  '012_platform_metrics_7_1.sql': '012b_platform_metrics_7_1.sql',
  '017_face_recognition_and_sessions.sql': '017a_face_recognition_and_sessions.sql',
  '017_time_authority_clock_drift_tracking.sql': '017b_time_authority_clock_drift_tracking.sql',
}

/**
 * Migration files in the order they run. A superseded `*_OLD.sql` never
 * runs: it would sort after its replacement and re-apply an older schema
 * over the current one. They are deleted now, and the lint refuses them;
 * this filter is the last line.
 */
export function migrationFiles(dir = migrationsDir): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('_OLD.sql'))
    .sort()
}

/** The ledger name a database may hold for a file, mapped to the current name. */
export function currentName(ledgerName: string): string {
  return RENAMED[ledgerName] ?? ledgerName
}

/**
 * Rewrites old names in the ledger to the current ones. Runs in its own
 * transaction so a failure leaves the ledger exactly as it was.
 */
export async function reconcileLedger(client: PoolClient): Promise<number> {
  await client.query('BEGIN')
  try {
    let renamed = 0
    for (const [oldName, newName] of Object.entries(RENAMED)) {
      const r = await client.query(
        `UPDATE migrations SET name = $2
          WHERE name = $1
            AND NOT EXISTS (SELECT 1 FROM migrations WHERE name = $2)`,
        [oldName, newName],
      )
      renamed += r.rowCount ?? 0
      // Both present would mean the file ran twice under two names; keep the
      // new row and drop the stale one rather than fail every future deploy.
      await client.query(`DELETE FROM migrations WHERE name = $1`, [oldName])
    }
    await client.query('COMMIT')
    return renamed
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}
