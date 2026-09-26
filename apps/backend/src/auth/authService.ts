import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { query } from '../db/connection.js'
import type { User } from '../types/database.js'
import crypto from 'crypto'
import { createSession } from './sessions.js'
import { createChallenge, mfaEnabled, mfaSetupPending } from './mfaService.js'

// SECURITY: Never use hardcoded fallback secrets. Fail hard if not configured.
function requireEnvSecret(key: string): string {
  const value = process.env[key]
  if (!value) {
    // In development, auto-generate a random secret and warn
    if (process.env.NODE_ENV !== 'production') {
      const generated = crypto.randomBytes(64).toString('hex')
      console.warn(`[SECURITY] WARNING: ${key} not set. Using auto-generated secret. Set ${key} in .env for persistent sessions.`)
      return generated
    }
    throw new Error(`[SECURITY] FATAL: ${key} environment variable is required in production. Server cannot start without it.`)
  }
  return value
}

const JWT_SECRET = requireEnvSecret('JWT_SECRET')

// Hash password (12 rounds for stronger security)
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(12)
  return bcrypt.hash(password, salt)
}

// Verify password
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// Access tokens last fifteen minutes and name the server-side session they
// belong to; every request checks that session is still live (middleware.ts).
// `mfaSetup` marks a person whose role requires two-factor sign-in and who has
// not set it up: such a token reaches only the setup routes.
export function generateAccessToken(
  userId: string, platformId: string, roleId: string, sessionId: string, mfaSetup = false
): string {
  return jwt.sign(
    { userId, platformId, roleId, sid: sessionId, ...(mfaSetup ? { mfa: 'setup' } : {}) },
    JWT_SECRET,
    { expiresIn: '15m' }
  )
}

// Verify access token
export function verifyAccessToken(token: string): any {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
  } catch (error) {
    throw new Error('Invalid or expired token')
  }
}

/** Starts a session for a user who has proved who they are. */
export async function issueTokens(
  user: { id: string; platform_id: string; role_id: string },
  meta: { ip?: string | null; userAgent?: string | null } = {}
): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
  const { sessionId, refreshToken } = await createSession(user.id, meta)
  const mfaSetup = await mfaSetupPending(user.id, user.role_id)
  return {
    accessToken: generateAccessToken(user.id, user.platform_id, user.role_id, sessionId, mfaSetup),
    refreshToken,
    sessionId,
  }
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

export const LOGIN_MAX_FAILURES = 5
export const LOGIN_LOCK_MINUTES = 15

/**
 * Why a sign-in was refused. `invalid` is deliberately the same whether the
 * address exists or not; the others are only ever reported to someone who
 * has just given the right password.
 */
export class LoginError extends Error {
  constructor(
    readonly code: 'invalid' | 'locked' | 'not_activated' | 'pending_approval' | 'inactive'
      | 'no_tenant' | 'tenant_suspended' | 'platform_mismatch',
    message: string,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message)
  }
}

// Compared against when the address matches no account, so an unknown address
// takes as long to refuse as a known one with the wrong password.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12)

function normEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase().slice(0, 255)
}

async function lockedFor(emailNorm: string): Promise<number> {
  const r = await query(
    `SELECT COUNT(*)::int AS n, MIN(attempted_at) AS first
       FROM (SELECT attempted_at FROM auth_failed_logins
              WHERE email_norm = $1 AND attempted_at > CURRENT_TIMESTAMP - ($2 || ' minutes')::interval
              ORDER BY attempted_at DESC LIMIT $3) recent`,
    [emailNorm, String(LOGIN_LOCK_MINUTES), LOGIN_MAX_FAILURES]
  )
  const { n, first } = r.rows[0]
  if (n < LOGIN_MAX_FAILURES) return 0
  const until = new Date(first).getTime() + LOGIN_LOCK_MINUTES * 60_000
  return Math.max(1, Math.ceil((until - Date.now()) / 1000))
}

/** A wrong second-factor code counts towards the same lockout as a wrong password. */
export async function noteFailedSignIn(email: string, ip?: string | null) {
  await recordFailure(normEmail(email), ip)
}

async function recordFailure(emailNorm: string, ip?: string | null) {
  await query(
    `INSERT INTO auth_failed_logins (email_norm, ip) VALUES ($1, $2)`,
    [emailNorm, ip?.slice(0, 64) ?? null]
  )
  // Keep the table small: nothing older than a day is ever consulted.
  if (Math.random() < 0.02) {
    await query(`DELETE FROM auth_failed_logins WHERE attempted_at < CURRENT_TIMESTAMP - INTERVAL '1 day'`)
  }
}

/**
 * Signs a user in. `platformId` is the platform they chose on the sign-in
 * page; a platform superadmin may sign in from either.
 *
 * Order matters. Nothing about an account, not even whether it exists, is
 * revealed until the password has been checked, and five wrong passwords for
 * an address in fifteen minutes pause sign-in for that address whether or not
 * it has an account.
 */
export async function loginUser(
  email: string,
  password: string,
  platformId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {}
): Promise<SignInResult> {
  const emailNorm = normEmail(email)
  const wait = await lockedFor(emailNorm)
  if (wait > 0) {
    throw new LoginError('locked', 'Too many failed sign-in attempts. Try again later.', { retryAfter: wait })
  }

  const candidates = await query(
    `SELECT u.*, r.permissions, r.name AS role_name, p.name AS platform_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       LEFT JOIN platforms p ON u.platform_id = p.id
      WHERE LOWER(u.email) = $1`,
    [emailNorm]
  )
  const rows = candidates.rows
  const user =
    rows.find((u: any) => u.platform_id === platformId) ??
    rows.find((u: any) => u.role_name === 'superadmin' && u.platform_name === 'system') ??
    rows[0]

  const ok = await bcrypt.compare(String(password ?? ''), user?.password_hash ?? DUMMY_HASH)
  if (!user || !ok) {
    await recordFailure(emailNorm, meta.ip)
    throw new LoginError('invalid', 'Invalid email or password')
  }

  const isPlatformSuperadmin = user.role_name === 'superadmin' && user.platform_name === 'system'
  if (user.platform_id !== platformId && !isPlatformSuperadmin) {
    const correctPlatform = user.platform_name === 'school' ? 'School' : 'Corporate'
    throw new LoginError('platform_mismatch', `PLATFORM_MISMATCH:${correctPlatform}`, { correctPlatform })
  }

  if (!user.activated_at) {
    throw new LoginError('not_activated',
      'This account has not been set up yet. Use the link in your invitation email to choose a password.')
  }

  if (!user.is_active) {
    const pending = await query(
      `SELECT 1 FROM school_user_approvals WHERE user_id = $1 AND status = 'pending'
       UNION ALL
       SELECT 1 FROM corporate_user_approvals WHERE user_id = $1 AND status = 'pending'
       LIMIT 1`,
      [user.id]
    )
    if (pending.rows.length > 0) {
      throw new LoginError('pending_approval', 'Your registration is waiting for an administrator to approve it.')
    }
    throw new LoginError('inactive', 'Your account has been suspended. Please contact your administrator.')
  }

  if (!isPlatformSuperadmin && (user.platform_name === 'school' || user.platform_name === 'corporate')) {
    const t = await query(
      `SELECT m.tenant_name, t.is_active
         FROM user_tenant_memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1 AND m.platform_kind = $2 AND m.status = 'active'`,
      [user.id, user.platform_name]
    )
    if (t.rows.length === 0) {
      const what = user.platform_name === 'school' ? 'school' : 'company'
      throw new LoginError('no_tenant', `You are not assigned to any ${what}. Please contact your administrator.`)
    }
    if (!t.rows.some((row: any) => row.is_active)) {
      throw new LoginError('tenant_suspended',
        `Your ${user.platform_name === 'school' ? 'school' : 'company'} (${t.rows[0].tenant_name}) has been suspended. Please contact support.`)
    }
  }

  const { password_hash, ...safeUser } = user

  // The password was right. With two-factor on, the session waits for the
  // code (POST /api/auth/mfa/verify); the lockout counter is cleared only
  // once the code is right, so wrong codes accumulate against it.
  if (await mfaEnabled(user.id)) {
    return { user: safeUser, mfaRequired: true, mfaToken: await createChallenge(user.id, meta.ip) }
  }

  await query(`DELETE FROM auth_failed_logins WHERE email_norm = $1`, [emailNorm])
  const { accessToken, refreshToken } = await issueTokens(user, meta)
  await query(`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`, [user.id])

  return { user: safeUser, mfaRequired: false, accessToken, refreshToken }
}

export type SignInResult =
  | { user: User; mfaRequired: false; accessToken: string; refreshToken: string }
  | { user: User; mfaRequired: true; mfaToken: string }

// Verify user exists and get their details with role
export async function getUserWithRole(userId: string): Promise<any> {
  const result = await query(
    `SELECT u.*, r.name as role_name, r.permissions FROM users u
     LEFT JOIN roles r ON u.role_id = r.id
     WHERE u.id = $1`,
    [userId]
  )
  
  if (result.rows.length === 0) {
    throw new Error('User not found')
  }
  
  const user = result.rows[0]
  const { password_hash, ...safeUser } = user
  
  return safeUser
}

// Get user by email
export async function getUserByEmail(email: string, platformId: string): Promise<any> {
  const result = await query(
    `SELECT * FROM users WHERE email = $1 AND platform_id = $2`,
    [email, platformId]
  )
  
  return result.rows.length > 0 ? result.rows[0] : null
}

// ===========================
// ROLE-BASED REGISTRATION WITH APPROVAL WORKFLOW
// ===========================

// Every self-service registration waits for an administrator of the chosen
// tenant. Students and employees used to be let straight in, so anyone could
// make themselves a member of any school or company by picking it from a
// list, and see whatever its members see.
const REQUIRES_APPROVAL_SCHOOL = ['student', 'faculty', 'it']
const REQUIRES_APPROVAL_CORPORATE = ['employee', 'it', 'hr']

// Register user with role selection (School or Corporate)
export async function registerUserWithRole(
  platformId: string,
  email: string,
  fullName: string,
  password: string,
  roleName: string,
  entityId: string,
  phone?: string
): Promise<{
  user: User
  requiresApproval: boolean
  status: 'active' | 'pending_approval'
  message: string
}> {
  // Validate role exists
  const roleResult = await query(
    `SELECT id, name FROM roles WHERE platform_id = $1 AND name = $2`,
    [platformId, roleName]
  )
  
  if (roleResult.rows.length === 0) {
    throw new Error(`Role '${roleName}' not found for this platform`)
  }
  
  const roleId = roleResult.rows[0].id
  
  // Check if email already exists in this platform
  const existingUser = await getUserByEmail(email, platformId)
  if (existingUser) {
    throw new Error('Email already registered in this platform')
  }
  
  // Get platform name
  const platformResult = await query(
    `SELECT name FROM platforms WHERE id = $1`,
    [platformId]
  )
  
  if (platformResult.rows.length === 0) {
    throw new Error('Platform not found')
  }
  
  const platformName = platformResult.rows[0].name
  
  // Determine if this role requires approval
  let requiresApproval = false
  if (platformName === 'school' && REQUIRES_APPROVAL_SCHOOL.includes(roleName)) {
    requiresApproval = true
  } else if (platformName === 'corporate' && REQUIRES_APPROVAL_CORPORATE.includes(roleName)) {
    requiresApproval = true
  }
  
  const passwordHash = await hashPassword(password)
  
  // Create user (inactive if requires approval)
  const result = await query(
    `INSERT INTO users (platform_id, email, full_name, phone, role_id, password_hash, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, platform_id, email, full_name, phone, role_id, profile_image_url, is_active, created_at, updated_at`,
    [platformId, email, fullName, phone || null, roleId, passwordHash, !requiresApproval]
  )
  
  if (result.rows.length === 0) {
    throw new Error('Failed to create user')
  }
  
  const user = result.rows[0]
  
  if (requiresApproval) {
    // Create approval request
    if (platformName === 'school') {
      await query(
        `INSERT INTO school_user_approvals (user_id, school_entity_id, requested_role, status, requested_at)
         VALUES ($1, $2, $3, 'pending', CURRENT_TIMESTAMP)`,
        [user.id, entityId, roleName]
      )
    } else if (platformName === 'corporate') {
      await query(
        `INSERT INTO corporate_user_approvals (user_id, corporate_entity_id, requested_role, status, requested_at)
         VALUES ($1, $2, $3, 'pending', CURRENT_TIMESTAMP)`,
        [user.id, entityId, roleName]
      )
    }
  } else {
    // Auto-create association for non-approval roles (student, employee)
    if (platformName === 'school') {
      await query(
        `INSERT INTO school_user_associations (user_id, school_entity_id, status, assigned_at)
         VALUES ($1, $2, 'active', CURRENT_TIMESTAMP)`,
        [user.id, entityId]
      )
    } else if (platformName === 'corporate') {
      await query(
        `INSERT INTO corporate_user_associations (user_id, corporate_entity_id, status, assigned_at)
         VALUES ($1, $2, 'active', CURRENT_TIMESTAMP)`,
        [user.id, entityId]
      )
    }
  }
  
  return {
    user,
    requiresApproval,
    status: requiresApproval ? 'pending_approval' : 'active',
    message: requiresApproval
      ? `Registration successful! Your ${roleName} account is pending approval from the admin.`
      : `Registration successful! You can now log in.`
  }
}

// Get pending approvals for admin
/**
 * Registration requests awaiting this administrator's decision.
 *
 * Authority used to come from school_entities.admin_user_id (and the corporate
 * equivalent), a column that is NULL for every entity in the schema — so the
 * query matched nothing and the approvals dashboard was permanently empty for
 * everyone. It now comes from the caller's resolved tenant, which is how
 * authority is established everywhere else, and the tenant predicate is what
 * keeps one institution's requests out of another's queue.
 */
export async function getPendingApprovalsForAdmin(
  adminUserId: string,
  platformId: string,
  tenantId: string
): Promise<{
  school?: Array<any>
  corporate?: Array<any>
}> {
  // Get platform name
  const platformResult = await query(
    `SELECT name FROM platforms WHERE id = $1`,
    [platformId]
  )
  
  if (platformResult.rows.length === 0) {
    throw new Error('Platform not found')
  }
  
  const platformName = platformResult.rows[0].name
  const result: any = {}
  
  if (platformName === 'school') {
    // Get all school approvals for schools where this user is admin
    const approvalsResult = await query(
      `SELECT 
        sua.id,
        sua.user_id,
        sua.school_entity_id,
        sua.requested_role,
        sua.requested_at,
        u.email,
        u.full_name,
        se.name as school_name
      FROM school_user_approvals sua
      JOIN users u ON sua.user_id = u.id
      JOIN school_entities se ON sua.school_entity_id = se.id
      WHERE sua.status = 'pending'
        AND sua.school_entity_id = $1
        AND u.platform_id = $2
      ORDER BY sua.requested_at DESC`,
      [tenantId, platformId]
    )
    
    result.school = approvalsResult.rows.map((row: any) => ({
      id: row.id,
      user: {
        id: row.user_id,
        email: row.email,
        full_name: row.full_name
      },
      requested_role: row.requested_role,
      school_entity: {
        id: row.school_entity_id,
        name: row.school_name
      },
      requested_at: row.requested_at
    }))
  } else if (platformName === 'corporate') {
    // Get all corporate approvals for entities where this user is admin
    const approvalsResult = await query(
      `SELECT 
        cua.id,
        cua.user_id,
        cua.corporate_entity_id,
        cua.requested_role,
        cua.requested_at,
        u.email,
        u.full_name,
        ce.name as corporate_name
      FROM corporate_user_approvals cua
      JOIN users u ON cua.user_id = u.id
      JOIN corporate_entities ce ON cua.corporate_entity_id = ce.id
      WHERE cua.status = 'pending'
        AND cua.corporate_entity_id = $1
        AND u.platform_id = $2
      ORDER BY cua.requested_at DESC`,
      [tenantId, platformId]
    )
    
    result.corporate = approvalsResult.rows.map((row: any) => ({
      id: row.id,
      user: {
        id: row.user_id,
        email: row.email,
        full_name: row.full_name
      },
      requested_role: row.requested_role,
      corporate_entity: {
        id: row.corporate_entity_id,
        name: row.corporate_name
      },
      requested_at: row.requested_at
    }))
  }
  
  return result
}

// Approve or reject user registration
/**
 * Approves or rejects a registration request.
 *
 * Approving one creates an account inside a tenant, so the request must be
 * that tenant's. The ownership test was `se.admin_user_id === adminUserId`,
 * which is correct in shape but keyed on a column that is NULL everywhere, so
 * every call threw 'Not authorized'. It is now the caller's resolved tenant,
 * checked in the WHERE clause rather than after the fetch: a request
 * belonging to another institution reads as absent, so an id cannot be probed.
 */
export async function approveOrRejectRegistration(
  approvalId: string,
  platformId: string,
  action: 'approve' | 'reject',
  adminUserId: string,
  tenantId: string,
  rejectionReason?: string
): Promise<{
  success: boolean
  message: string
  user?: any
}> {
  // Get platform name
  const platformResult = await query(
    `SELECT name FROM platforms WHERE id = $1`,
    [platformId]
  )
  
  if (platformResult.rows.length === 0) {
    throw new Error('Platform not found')
  }
  
  const platformName = platformResult.rows[0].name
  let approvalRow: any = null
  let approvalTable = ''
  
  if (platformName === 'school') {
    const result = await query(
      `SELECT sua.* FROM school_user_approvals sua
       WHERE sua.id = $1 AND sua.school_entity_id = $2`,
      [approvalId, tenantId]
    )
    
    if (result.rows.length === 0) {
      throw new Error('Approval request not found')
    }
    
    approvalRow = result.rows[0]
    approvalTable = 'school_user_approvals'
  } else if (platformName === 'corporate') {
    const result = await query(
      `SELECT cua.* FROM corporate_user_approvals cua
       WHERE cua.id = $1 AND cua.corporate_entity_id = $2`,
      [approvalId, tenantId]
    )
    
    if (result.rows.length === 0) {
      throw new Error('Approval request not found')
    }
    
    approvalRow = result.rows[0]
    approvalTable = 'corporate_user_approvals'
  }
  
  if (action === 'approve') {
    // Whitelist check for table name (defense-in-depth against SQL injection)
    const allowedTables = ['school_user_approvals', 'corporate_user_approvals']
    if (!allowedTables.includes(approvalTable)) {
      throw new Error('Invalid approval table')
    }
    // Update approval status
    await query(
      `UPDATE ${approvalTable} 
       SET status = 'approved', approved_by_user_id = $1, approved_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [adminUserId, approvalId]
    )
    
    // Activate user
    await query(
      `UPDATE users SET is_active = true WHERE id = $1`,
      [approvalRow.user_id]
    )
    
    // Create association
    if (platformName === 'school') {
      await query(
        `INSERT INTO school_user_associations (user_id, school_entity_id, status, assigned_at)
         VALUES ($1, $2, 'active', CURRENT_TIMESTAMP)
         ON CONFLICT DO NOTHING`,
        [approvalRow.user_id, approvalRow.school_entity_id]
      )
    } else if (platformName === 'corporate') {
      await query(
        `INSERT INTO corporate_user_associations (user_id, corporate_entity_id, status, assigned_at)
         VALUES ($1, $2, 'active', CURRENT_TIMESTAMP)
         ON CONFLICT DO NOTHING`,
        [approvalRow.user_id, approvalRow.corporate_entity_id]
      )
    }
    
    // Get updated user
    const userResult = await query(
      `SELECT id, email, full_name, role_id, is_active FROM users WHERE id = $1`,
      [approvalRow.user_id]
    )
    
    return {
      success: true,
      message: `${approvalRow.requested_role} registration approved successfully`,
      user: userResult.rows[0]
    }
  } else {
    // Update approval status to rejected
    await query(
      `UPDATE ${approvalTable}
       SET status = 'rejected', approved_by_user_id = $1, approved_at = CURRENT_TIMESTAMP, rejection_reason = $2
       WHERE id = $3`,
      [adminUserId, rejectionReason || null, approvalId]
    )
    
    // Delete the user (since they were only created for approval process)
    await query(
      `DELETE FROM users WHERE id = $1`,
      [approvalRow.user_id]
    )
    
    return {
      success: true,
      message: `Registration rejected successfully`
    }
  }
}

// ===========================
// SUPERADMIN FUNCTIONS
// ===========================

// Check if user is superadmin
export async function isSuperadmin(userId: string): Promise<boolean> {
  const result = await query(
    `SELECT EXISTS(
      SELECT 1 FROM users u
      JOIN roles r ON u.role_id = r.id
      JOIN platforms p ON r.platform_id = p.id
      WHERE u.id = $1 AND r.name = 'superadmin' AND p.name = 'system'
    ) as is_superadmin`,
    [userId]
  )
  return result.rows[0]?.is_superadmin || false
}

// Get superadmin dashboard stats
export async function getSuperadminDashboardStats(superadminUserId: string) {
  // Verify user is superadmin
  const isSuperAdminUser = await isSuperadmin(superadminUserId)
  if (!isSuperAdminUser) {
    throw new Error('Unauthorized: User is not a superadmin')
  }

  const stats = await query(
    `SELECT 
      (SELECT CAST(COUNT(*) AS INTEGER) FROM school_entities) as total_schools,
      (SELECT CAST(COUNT(*) AS INTEGER) FROM school_entities WHERE is_active = true) as active_schools,
      (SELECT CAST(COUNT(*) AS INTEGER) FROM corporate_entities) as total_corporates,
      (SELECT CAST(COUNT(*) AS INTEGER) FROM corporate_entities WHERE is_active = true) as active_corporates,
      (SELECT CAST(COUNT(*) AS INTEGER) FROM users WHERE platform_id != (SELECT id FROM platforms WHERE name = 'system')) as total_users,
      (SELECT CAST(COUNT(*) AS INTEGER) FROM users WHERE platform_id != (SELECT id FROM platforms WHERE name = 'system') AND is_active = true) as active_users,
      (SELECT CAST(COUNT(*) AS INTEGER) FROM school_user_approvals WHERE status = 'pending') as pending_school_approvals,
      (SELECT CAST(COUNT(*) AS INTEGER) FROM corporate_user_approvals WHERE status = 'pending') as pending_corporate_approvals`
  )

  return stats.rows[0]
}

// Get all entities (schools and corporate)
export async function getSuperadminAllEntities(superadminUserId: string) {
  const isSuperAdminUser = await isSuperadmin(superadminUserId)
  if (!isSuperAdminUser) {
    throw new Error('Unauthorized: User is not a superadmin')
  }

  const schools = await query(
    `SELECT id, name, code, email, is_active, 
            (SELECT COUNT(*) FROM school_user_associations WHERE school_entity_id = school_entities.id) as user_count,
            (SELECT COUNT(*) FROM school_user_approvals WHERE school_entity_id = school_entities.id AND status = 'pending') as pending_approvals
     FROM school_entities
     ORDER BY created_at DESC`
  )

  const corporates = await query(
    `SELECT id, name, code, email, is_active,
            (SELECT COUNT(*) FROM corporate_user_associations WHERE corporate_entity_id = corporate_entities.id) as user_count,
            (SELECT COUNT(*) FROM corporate_user_approvals WHERE corporate_entity_id = corporate_entities.id AND status = 'pending') as pending_approvals
     FROM corporate_entities
     ORDER BY created_at DESC`
  )

  return {
    schools: schools.rows,
    corporates: corporates.rows
  }
}

// Get all pending approvals across all entities
export async function getSuperadminAllPendingApprovals(superadminUserId: string) {
  const isSuperAdminUser = await isSuperadmin(superadminUserId)
  if (!isSuperAdminUser) {
    throw new Error('Unauthorized: User is not a superadmin')
  }

  const approvals = await query(
    `SELECT * FROM superadmin_all_pending_approvals ORDER BY requested_at DESC`
  )

  return approvals.rows
}

// Get superadmin action logs
export async function getSuperadminActionLogs(superadminUserId: string, limit: number = 100, offset: number = 0) {
  const isSuperAdminUser = await isSuperadmin(superadminUserId)
  if (!isSuperAdminUser) {
    throw new Error('Unauthorized: User is not a superadmin')
  }

  const logs = await query(
    `SELECT id, superadmin_user_id, action, entity_type, entity_id, details, created_at
     FROM superadmin_action_logs
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  )

  const countResult = await query(`SELECT COUNT(*) as total FROM superadmin_action_logs`)
  const total = countResult.rows[0].total

  return {
    logs: logs.rows,
    total,
    limit,
    offset
  }
}

// Log superadmin action
export async function logSuperadminAction(
  superadminUserId: string,
  action: string,
  entityType?: string,
  entityId?: string,
  details?: any,
  ipAddress?: string
) {
  await query(
    `INSERT INTO superadmin_action_logs (superadmin_user_id, action, entity_type, entity_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [superadminUserId, action, entityType || null, entityId || null, details ? JSON.stringify(details) : null, ipAddress || null]
  )
}

// Get user statistics by platform
export async function getSuperadminUserStatistics(superadminUserId: string) {
  const isSuperAdminUser = await isSuperadmin(superadminUserId)
  if (!isSuperAdminUser) {
    throw new Error('Unauthorized: User is not a superadmin')
  }

  const stats = await query(
    `SELECT * FROM superadmin_user_statistics ORDER BY platform_name`
  )

  return stats.rows
}

// Get entity-specific users (superadmin view)
export async function getSuperadminEntityUsers(superadminUserId: string, entityType: 'school' | 'corporate', entityId: string) {
  const isSuperAdminUser = await isSuperadmin(superadminUserId)
  if (!isSuperAdminUser) {
    throw new Error('Unauthorized: User is not a superadmin')
  }

  if (entityType === 'school') {
    const users = await query(
      `SELECT u.id, u.email, u.full_name, r.name as role, sua.status, sua.assigned_at
       FROM users u
       JOIN roles r ON u.role_id = r.id
       JOIN school_user_associations sua ON u.id = sua.user_id
       WHERE sua.school_entity_id = $1
       ORDER BY u.created_at DESC`,
      [entityId]
    )
    return users.rows
  } else if (entityType === 'corporate') {
    const users = await query(
      `SELECT u.id, u.email, u.full_name, r.name as role, cua.status, cua.assigned_at
       FROM users u
       JOIN roles r ON u.role_id = r.id
       JOIN corporate_user_associations cua ON u.id = cua.user_id
       WHERE cua.corporate_entity_id = $1
       ORDER BY u.created_at DESC`,
      [entityId]
    )
    return users.rows
  }

  throw new Error('Invalid entity type')
}
