/**
 * A superadmin for the control-plane suite.
 *
 * Created rather than borrowed. CI starts from an empty database, so a suite
 * that assumed an existing superadmin would pass locally and fail there — and
 * a suite that used whatever superadmin happened to be in a developer's
 * database would be acting as a real person with real history.
 */
import { query } from '../db/connection.js'
import { generateAccessToken } from '../auth/authService.js'
import { hashPassword } from '../auth/authService.js'

async function cleanup() {
  // The audit log refuses deletion by design, which is the whole point of it.
  // A fixture teardown is the one legitimate exception, so the guard is
  // suspended for exactly the rows this fixture created and restored
  // immediately — the same pattern the attendance-correction fixtures use.
  await query(`ALTER TABLE superadmin_audit_log DISABLE TRIGGER prevent_superadmin_audit_log_delete`)
  try {
    await query(
      `DELETE FROM superadmin_action_logs
        WHERE superadmin_user_id IN (SELECT id FROM users WHERE email LIKE '%@sa2e.test')`
    )
    await query(
      `DELETE FROM superadmin_audit_log
        WHERE actor_id IN (SELECT id FROM users WHERE email LIKE '%@sa2e.test')`
    )
  } finally {
    await query(`ALTER TABLE superadmin_audit_log ENABLE TRIGGER prevent_superadmin_audit_log_delete`)
  }
  await query(
    `DELETE FROM tenant_lifecycle_audit
      WHERE actor_id IN (SELECT id FROM users WHERE email LIKE '%@sa2e.test')`
  )
  await query(
    `DELETE FROM session_invalidation_log
      WHERE invalidated_by_superadmin_id IN (SELECT id FROM users WHERE email LIKE '%@sa2e.test')`
  )
  await query(
    `DELETE FROM incidents
      WHERE detected_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@sa2e.test')
         OR resolved_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@sa2e.test')`
  )
  await query(`DELETE FROM users WHERE email LIKE '%@sa2e.test'`)

  // Tenants the suite provisions, and the entities behind them.
  await query(`DELETE FROM school_user_associations
                WHERE school_entity_id IN (SELECT id FROM school_entities WHERE code LIKE 'SA2E-%')`)
  await query(`DELETE FROM corporate_user_associations
                WHERE corporate_entity_id IN (SELECT id FROM corporate_entities WHERE code LIKE 'SA2E-%')`)
  await query(`DELETE FROM tenant_lifecycle_audit
                WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'SA2E-%')`)
  await query(`DELETE FROM session_invalidation_log
                WHERE tenant_id IN (SELECT id FROM tenants WHERE code LIKE 'SA2E-%')`)
  await query(`DELETE FROM school_entities WHERE code LIKE 'SA2E-%'`)
  await query(`DELETE FROM corporate_entities WHERE code LIKE 'SA2E-%'`)
  await query(`DELETE FROM tenants WHERE code LIKE 'SA2E-%'`)

  // Platforms left behind by a unit test that inserted them in beforeEach and
  // never removed them. Harmless, but they show up in every platform listing.
  await query(`DELETE FROM roles WHERE platform_id IN
                 (SELECT id FROM platforms WHERE name IN ('test-school', 'test-corp'))
               AND NOT EXISTS (SELECT 1 FROM users u WHERE u.role_id = roles.id)`)
  await query(`DELETE FROM platforms WHERE name IN ('test-school', 'test-corp')
                AND NOT EXISTS (SELECT 1 FROM users u WHERE u.platform_id = platforms.id)
                AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.platform_id = platforms.id)`)
}

async function main() {
  await cleanup()

  const platform = await query(`SELECT id FROM platforms WHERE name = 'system' LIMIT 1`)
  if (platform.rows.length === 0) throw new Error('no system platform')
  const platformId = platform.rows[0].id

  const role = await query(
    `SELECT id FROM roles WHERE name = 'superadmin' AND platform_id = $1 LIMIT 1`,
    [platformId]
  )
  if (role.rows.length === 0) throw new Error('no superadmin role on the system platform')
  const roleId = role.rows[0].id

  const hashed = await hashPassword('E2e-Superadmin-1!')
  const user = await query(
    `INSERT INTO users (platform_id, email, full_name, role_id, password_hash, is_active)
     VALUES ($1, 'root@sa2e.test', 'E2E Superadmin', $2, $3, TRUE)
     RETURNING id`,
    [platformId, roleId, hashed]
  )

  // A second superadmin, deactivated, so the suite has a reactivation target
  // it did not have to deactivate first.
  const locked = await query(
    `INSERT INTO users (platform_id, email, full_name, role_id, password_hash, is_active)
     VALUES ($1, 'locked@sa2e.test', 'E2E Locked Account', $2, $3, FALSE)
     RETURNING id`,
    [platformId, roleId, hashed]
  )

  console.log(JSON.stringify({
    superadminId: user.rows[0].id,
    token: generateAccessToken(user.rows[0].id, platformId, roleId),
    lockedUserId: locked.rows[0].id,
    platformId,
  }))
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
