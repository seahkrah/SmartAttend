import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { query } from '../db/connection.js'
import type { User } from '../types/database.js'

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_this_in_production'
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'your_super_secret_refresh_token_key'

// Hash password
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(password, salt)
}

// Verify password
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// Generate access token (short-lived)
export function generateAccessToken(userId: string, platformId: string, roleId: string): string {
  return jwt.sign(
    { userId, platformId, roleId },
    JWT_SECRET,
    { expiresIn: '24h' }
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
    `SELECT u.*, r.permissions FROM users u
     LEFT JOIN roles r ON u.role_id = r.id
     WHERE u.email = $1 AND u.platform_id = $2 AND u.is_active = true`,
    [email, platformId]
  )
  
  if (result.rows.length === 0) {
    // Check if email exists in other platforms
    const emailCheckResult = await query(
      `SELECT DISTINCT platform_id FROM users WHERE email = $1 LIMIT 1`,
      [email]
    )
    
    if (emailCheckResult.rows.length > 0) {
      // Email exists but in a different platform
      throw new Error('email_registered_different_platform')
    }
    
    throw new Error('Invalid email or platform')
  }
  
  const user = result.rows[0]
  
  // Verify password
  const isValidPassword = await verifyPassword(password, user.password_hash)
  if (!isValidPassword) {
    throw new Error('Invalid password')
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
