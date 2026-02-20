import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { query } from '../db/connection.js'
import type { User } from '../types/database.js'
import crypto from 'crypto'

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
const REFRESH_TOKEN_SECRET = requireEnvSecret('REFRESH_TOKEN_SECRET')

// Hash password (12 rounds for stronger security)
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(12)
  return bcrypt.hash(password, salt)
}

// Verify password
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// Generate access token (short-lived: 15 minutes for security)
export function generateAccessToken(userId: string, platformId: string, roleId: string): string {
  return jwt.sign(
    { userId, platformId, roleId },
    JWT_SECRET,
    { expiresIn: '15m' }
  )
}

// Generate refresh token (long-lived)
export function generateRefreshToken(userId: string): string {
  return jwt.sign(
    { userId },
    REFRESH_TOKEN_SECRET,
    { expiresIn: '7d' }
  )
}

// Verify access token
export function verifyAccessToken(token: string): any {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch (error) {
    throw new Error('Invalid or expired token')
  }
}

// Verify refresh token
export function verifyRefreshToken(token: string): any {
  try {
    return jwt.verify(token, REFRESH_TOKEN_SECRET)
  } catch (error) {
    throw new Error('Invalid or expired refresh token')
  }
}

// Register new user (School or Corporate)
export async function registerUser(
  platformId: string,
  email: string,
  fullName: string,
  password: string,
  roleId: string,
  phone?: string
): Promise<User> {
  const passwordHash = await hashPassword(password)
  
  const result = await query(
    `INSERT INTO users (platform_id, email, full_name, phone, role_id, password_hash, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING id, platform_id, email, full_name, phone, role_id, profile_image_url, is_active, created_at, updated_at`,
    [platformId, email, fullName, phone || null, roleId, passwordHash]
  )
  
  if (result.rows.length === 0) {
    throw new Error('Failed to create user')
  }
  
  return result.rows[0]
}

// Login user (School or Corporate)
export async function loginUser(
  email: string,
  password: string,
  platformId: string
): Promise<{ user: User; accessToken: string; refreshToken: string }> {
  // Find user by email and platform
  const result = await query(
    `SELECT u.*, r.permissions, r.name as role_name, p.name as platform_name 
     FROM users u
     LEFT JOIN roles r ON u.role_id = r.id
     LEFT JOIN platforms p ON u.platform_id = p.id
     WHERE u.email = $1 AND u.platform_id = $2`,
    [email, platformId]
  )
  
  if (result.rows.length === 0) {
    // Check if email exists in other platforms
    const emailCheckResult = await query(
      `SELECT u.id, u.email, u.full_name, u.platform_id, u.role_id, u.password_hash, u.is_active, u.phone, u.profile_image_url, u.last_login, u.created_at, u.updated_at, r.name as role_name, r.permissions, p.name as platform_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       LEFT JOIN platforms p ON u.platform_id = p.id
       WHERE u.email = $1`,
      [email]
    )
    
    if (emailCheckResult.rows.length > 0) {
      const userInOtherPlatform = emailCheckResult.rows[0]
      
      // Check if password is correct
      const isValidPassword = await verifyPassword(password, userInOtherPlatform.password_hash)
      
      if (isValidPassword) {
        // Nested if: Check if this user is a superadmin
        if (userInOtherPlatform.role_name === 'superadmin' && userInOtherPlatform.platform_name === 'system') {
          // Allow superadmin to login regardless of platform selection
          const superadminUser = userInOtherPlatform
          
          // Verify user is active
          if (!superadminUser.is_active) {
            throw new Error('Your account has been suspended. Please contact support.')
          }
          
          // Generate tokens
          const accessToken = generateAccessToken(superadminUser.id, superadminUser.platform_id, superadminUser.role_id)
          const refreshToken = generateRefreshToken(superadminUser.id)
          
          // Update last_login
          await query(
            `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`,
            [superadminUser.id]
          )
          
          // Remove sensitive data and return
          const { password_hash, ...safeUser } = superadminUser
          
          return {
            user: safeUser,
            accessToken,
            refreshToken
          }
        } else {
          // Not a superadmin, show platform mismatch error
          throw new Error('email_registered_different_platform')
        }
      } else {
        // Password is incorrect
        throw new Error('Invalid email or password')
      }
    }
    
    throw new Error('Invalid email or platform')
  }
  
  const user = result.rows[0]
  
  // Check if user is active
  if (!user.is_active) {
    throw new Error('Your account has been suspended. Please contact your administrator.')
  }
  
  // Check tenant status based on role and platform
  if (user.platform_name === 'school' && user.role_name !== 'superadmin') {
    // Check if user belongs to a school entity and if that entity is active
    const schoolEntityCheck = await query(
      `SELECT se.is_active, se.name as school_name
       FROM school_user_associations sua
       JOIN school_entities se ON sua.school_entity_id = se.id
       WHERE sua.user_id = $1 AND sua.status = 'active'
       LIMIT 1`,
      [user.id]
    )
    
    if (schoolEntityCheck.rows.length === 0) {
      throw new Error('You are not assigned to any school. Please contact your administrator.')
    }
    
    const schoolEntity = schoolEntityCheck.rows[0]
    if (!schoolEntity.is_active) {
      throw new Error(`Your school (${schoolEntity.school_name}) has been suspended. Please contact support.`)
    }
  } else if (user.platform_name === 'corporate' && user.role_name !== 'superadmin') {
    // Check if user belongs to a corporate entity and if that entity is active
    const corpEntityCheck = await query(
      `SELECT ce.is_active, ce.name as company_name
       FROM corporate_user_associations cua
       JOIN corporate_entities ce ON cua.corporate_entity_id = ce.id
       WHERE cua.user_id = $1
       LIMIT 1`,
      [user.id]
    )
    
    if (corpEntityCheck.rows.length === 0) {
      throw new Error('You are not assigned to any company. Please contact your administrator.')
    }
    
    const corpEntity = corpEntityCheck.rows[0]
    if (!corpEntity.is_active) {
      throw new Error(`Your company (${corpEntity.company_name}) has been suspended. Please contact support.`)
    }
  }
  
  // Verify password
  const isValidPassword = await verifyPassword(password, user.password_hash)
  if (!isValidPassword) {
    throw new Error('Invalid email or password')
  }
  
  // Generate tokens
  const accessToken = generateAccessToken(user.id, user.platform_id, user.role_id)
  const refreshToken = generateRefreshToken(user.id)
  
  // Update last_login
  await query(
    `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`,
    [user.id]
  )
  
  // Remove sensitive data
  const { password_hash, ...safeUser } = user
  
  return {
    user: safeUser,
    accessToken,
    refreshToken
  }
}

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

// Roles that require admin approval
const REQUIRES_APPROVAL_SCHOOL = ['faculty', 'it']
const REQUIRES_APPROVAL_CORPORATE = ['it', 'hr']

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
export async function getPendingApprovalsForAdmin(
  adminUserId: string,
  platformId: string
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
        AND se.admin_user_id = $1
        AND u.platform_id = $2
      ORDER BY sua.requested_at DESC`,
      [adminUserId, platformId]
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
        AND ce.admin_user_id = $1
        AND u.platform_id = $2
      ORDER BY cua.requested_at DESC`,
      [adminUserId, platformId]
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
export async function approveOrRejectRegistration(
  approvalId: string,
  platformId: string,
  action: 'approve' | 'reject',
  adminUserId: string,
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
      `SELECT sua.*, se.admin_user_id FROM school_user_approvals sua
       JOIN school_entities se ON sua.school_entity_id = se.id
       WHERE sua.id = $1`,
      [approvalId]
    )
    
    if (result.rows.length === 0) {
      throw new Error('Approval request not found')
    }
    
    if (result.rows[0].admin_user_id !== adminUserId) {
      throw new Error('Not authorized to approve this request')
    }
    
    approvalRow = result.rows[0]
    approvalTable = 'school_user_approvals'
  } else if (platformName === 'corporate') {
    const result = await query(
      `SELECT cua.*, ce.admin_user_id FROM corporate_user_approvals cua
       JOIN corporate_entities ce ON cua.corporate_entity_id = ce.id
       WHERE cua.id = $1`,
      [approvalId]
    )
    
    if (result.rows.length === 0) {
      throw new Error('Approval request not found')
    }
    
    if (result.rows[0].admin_user_id !== adminUserId) {
      throw new Error('Not authorized to approve this request')
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
