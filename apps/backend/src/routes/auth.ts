import express, { Request, Response } from 'express'
import { query, getConnection } from '../db/connection.js'
import {
  registerUser,
  loginUser,
  getUserWithRole,
  getUserByEmail,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  verifyPassword,
  registerUserWithRole,
  getPendingApprovalsForAdmin,
  approveOrRejectRegistration,
  isSuperadmin,
  getSuperadminDashboardStats,
  getSuperadminAllEntities,
  getSuperadminAllPendingApprovals,
  getSuperadminActionLogs,
  logSuperadminAction,
  getSuperadminUserStatistics,
  getSuperadminEntityUsers,
  hashPassword
} from '../auth/authService.js'
import { authenticateToken } from '../auth/middleware.js'
import {
  resolveTenantContext,
  requireTenant,
  requirePlatform,
  requireRoles,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import { ErrorMessages, getUserFriendlyError, logError } from '../utils/errorMessages.js'
import { getClientIp } from '../utils/getClientIp.js'

const router = express.Router()

// ===========================
// ROLE-BASED REGISTRATION WITH APPROVAL WORKFLOW
// ===========================

interface RoleBasedRegisterRequest extends Request {
  body: {
    platform: 'school' | 'corporate'
    email: string
    fullName: string
    password: string
    confirmPassword: string
    phone?: string
    role: 'student' | 'faculty' | 'it' | 'employee' | 'hr'
    entityId: string // school_entities.id or corporate_entities.id
  }
}

router.post('/register-with-role', async (req: RoleBasedRegisterRequest, res: Response) => {
  try {
    const { platform, email, fullName, password, confirmPassword, phone, role, entityId } = req.body

    // Validation
    if (!platform || !email || !fullName || !password || !confirmPassword || !role || !entityId) {
      return res.status(400).json({ error: ErrorMessages.VALIDATION_MISSING_FIELDS })
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: ErrorMessages.VALIDATION_PASSWORD_MISMATCH })
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    // Validate role for platform
    const validSchoolRoles = ['student', 'faculty', 'it']
    const validCorporateRoles = ['employee', 'it', 'hr']
    
    if (platform === 'school' && !validSchoolRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role selected for school' })
    }

    if (platform === 'corporate' && !validCorporateRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role selected for corporate' })
    }

    // Get platform ID
    const platformResult = await query(
      `SELECT id FROM platforms WHERE name = $1`,
      [platform]
    )

    if (platformResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid platform' })
    }

    const platformId = platformResult.rows[0].id

    // Validate entity exists
    if (platform === 'school') {
      const schoolResult = await query(
        `SELECT id FROM school_entities WHERE id = $1 AND is_active = true`,
        [entityId]
      )
      if (schoolResult.rows.length === 0) {
        return res.status(400).json({ error: 'School not found or inactive' })
      }
    } else {
      const corporateResult = await query(
        `SELECT id FROM corporate_entities WHERE id = $1 AND is_active = true`,
        [entityId]
      )
      if (corporateResult.rows.length === 0) {
        return res.status(400).json({ error: 'Organization not found or inactive' })
      }
    }

    // Register user with role
    const { user, requiresApproval, status, message } = await registerUserWithRole(
      platformId,
      email,
      fullName,
      password,
      role,
      entityId,
      phone
    )

    return res.status(201).json({
      message,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        platform,
        role,
        status
      },
      requiresApproval,
      nextSteps: requiresApproval
        ? 'Your registration is pending approval from the administrator'
        : 'You can now log in with your credentials'
    })
  } catch (error: any) {
    logError('Role-based registration', error)
    const friendlyError = getUserFriendlyError(error, ErrorMessages.USER_CREATE_FAILED)
    return res.status(400).json({ error: friendlyError.error })
  }
})

// ===========================
// ADMIN APPROVAL ENDPOINTS
// ===========================

// Get pending approvals for logged-in admin
/**
 * Registration requests awaiting a decision in the caller's own tenant.
 *
 * Authority used to be "are you named as an entity's admin_user_id", a column
 * that is NULL for every entity, so this answered 403 or an empty list to
 * everyone and the approvals dashboard never showed anything. It now uses the
 * resolved tenant and the administrator role, as elsewhere.
 */
router.get(
  '/admin/pending-approvals',
  authenticateToken,
  resolveTenantContext,
  requireTenant,
  requireRoles('admin'),
  async (req: TenantRequest, res: Response) => {
  try {
    const ctx = req.ctx!

    const approvals = await getPendingApprovalsForAdmin(
      ctx.userId,
      ctx.platformId,
      ctx.tenantId!
    )

    return res.json({
      platform: ctx.platformKind,
      approvals
    })
  } catch (error: any) {
    logError('Get approvals', error)
    const friendlyError = getUserFriendlyError(error, 'Unable to load pending approvals')
    return res.status(500).json({ error: friendlyError.error })
  }
})

// Approve or reject registration
interface ApprovalActionRequest extends Request {
  body: {
    approvalId: string
    action: 'approve' | 'reject'
    rejectionReason?: string
  }
}

router.post(
  '/admin/approval-action',
  authenticateToken,
  resolveTenantContext,
  requireTenant,
  requireRoles('admin'),
  async (req: ApprovalActionRequest & TenantRequest, res: Response) => {
  try {
    const ctx = req.ctx!

    const { approvalId, action, rejectionReason } = req.body

    if (!approvalId || !action) {
      return res.status(400).json({ error: ErrorMessages.VALIDATION_MISSING_FIELDS })
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Please select a valid action' })
    }

    // Approving a request creates an account inside a tenant, so the request
    // must belong to the caller's own.
    const result = await approveOrRejectRegistration(
      approvalId,
      ctx.platformId,
      action,
      ctx.userId,
      ctx.tenantId!,
      rejectionReason
    )

    return res.json(result)
  } catch (error: any) {
    logError('Approval action', error)
    // A request that is not this tenant's reads as missing, which is both the
    // honest answer and the one that does not confirm the id exists
    // elsewhere. The generic message hid a refusal behind an apparent fault.
    if (String(error?.message ?? '').includes('not found')) {
      return res.status(404).json({ error: 'Approval request not found' })
    }
    const friendlyError = getUserFriendlyError(error, 'Unable to process approval action')
    return res.status(400).json({ error: friendlyError.error })
  }
})

// ===========================
// REGISTRATION ENDPOINT (LEGACY - BACKWARD COMPATIBLE)
// ===========================

interface RegisterRequest extends Request {
  body: {
    platform: 'school' | 'corporate'
    email: string
    fullName: string
    password: string
    confirmPassword: string
    phone?: string
    role?: string
  }
}

router.post('/register', async (req: RegisterRequest, res: Response) => {
  try {
    const { platform, email, fullName, password, confirmPassword, phone, role } = req.body

    // Validation
    if (!platform || !email || !fullName || !password || !confirmPassword) {
      return res.status(400).json({ error: ErrorMessages.VALIDATION_MISSING_FIELDS })
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: ErrorMessages.VALIDATION_PASSWORD_MISMATCH })
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    // Get platform ID
    const platformResult = await query(
      `SELECT id FROM platforms WHERE name = $1`,
      [platform]
    )

    if (platformResult.rows.length === 0) {
      return res.status(400).json({ error: ErrorMessages.SYSTEM_CONFIGURATION_ERROR })
    }

    const platformId = platformResult.rows[0].id

    // Get default role if not specified
    let roleId = role
    if (!roleId) {
      // Default roles: 'student' for school, 'employee' for corporate
      const defaultRole = platform === 'school' ? 'student' : 'employee'
      const roleResult = await query(
        `SELECT id FROM roles WHERE platform_id = $1 AND name = $2`,
        [platformId, defaultRole]
      )

      if (roleResult.rows.length === 0) {
        return res.status(500).json({ error: ErrorMessages.SYSTEM_CONFIGURATION_ERROR })
      }

      roleId = roleResult.rows[0].id
    }

    // Check if email already exists
    const existingUser = await getUserByEmail(email, platformId)
    if (existingUser) {
      return res.status(409).json({ error: ErrorMessages.USER_ALREADY_EXISTS })
    }

    // Create user
    const user = await registerUser(platformId, email, fullName, password, roleId || '', phone)

    return res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        platform,
        createdAt: user.created_at
      }
    })
  } catch (error: any) {
    logError('Registration', error)
    const friendlyError = getUserFriendlyError(error, ErrorMessages.USER_CREATE_FAILED)
    return res.status(500).json({ error: friendlyError.error })
  }
})

// ===========================
// LOGIN ENDPOINT
// ===========================

interface LoginRequest extends Request {
  body: {
    platform: 'school' | 'corporate'
    email: string
    password: string
  }
}

router.post('/login', async (req: LoginRequest, res: Response) => {
  try {
    const { platform, email, password } = req.body

    // Validation
    if (!platform || !email || !password) {
      return res.status(400).json({ error: ErrorMessages.VALIDATION_MISSING_FIELDS })
    }

    // Get platform ID
    const platformResult = await query(
      `SELECT id FROM platforms WHERE name = $1`,
      [platform]
    )

    if (platformResult.rows.length === 0) {
      return res.status(400).json({ error: ErrorMessages.SYSTEM_CONFIGURATION_ERROR })
    }

    const platformId = platformResult.rows[0].id

    // Login user
    const { user, accessToken, refreshToken } = await loginUser(email, password, platformId)

    // Get role name and permissions
    const roleResult = await query(
      `SELECT name, permissions FROM roles WHERE id = $1`,
      [user.role_id]
    )

    const roleInfo = roleResult.rows[0]

    return res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        phone: user.phone,
        platform,
        role: roleInfo.name,
        permissions: roleInfo.permissions || [],
        profileImage: user.profile_image_url,
        mustResetPassword: (user as any).must_reset_password || false
      },
      accessToken,
      refreshToken
    })
  } catch (error: any) {
    logError('Login', error)
    
    // Handle platform mismatch - tell the user which platform to use
    if (error.code === 'PLATFORM_MISMATCH' || (error.message && error.message.startsWith('PLATFORM_MISMATCH:'))) {
      const correctPlatform = error.correctPlatform || error.message.split(':')[1] || 'other'
      return res.status(401).json({
        error: `Your account is registered under the ${correctPlatform} platform. Please select "${correctPlatform}" and try again.`,
        code: 'PLATFORM_MISMATCH',
        correctPlatform: correctPlatform.toLowerCase()
      })
    }
    
    // Don't expose whether email exists or password is wrong
    return res.status(401).json({ error: ErrorMessages.AUTH_INVALID_CREDENTIALS })
  }
})

// ===========================
// CHANGE PASSWORD ENDPOINT
// ===========================

router.post('/change-password', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    
    const { currentPassword, newPassword, confirmPassword } = req.body
    
    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'All fields are required' })
    }
    
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New passwords do not match' })
    }
    
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }
    
    // Get user
    const userResult = await query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [req.user.userId]
    )
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    const user = userResult.rows[0]
    
    // Verify current password
    const isValidPassword = await verifyPassword(currentPassword, user.password_hash)
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' })
    }
    
    // Hash new password
    const newPasswordHash = await hashPassword(newPassword)
    
    // Update password and clear must_reset_password flag
    await query(
      `UPDATE users SET password_hash = $1, must_reset_password = false, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [newPasswordHash, req.user.userId]
    )
    
    return res.json({ message: 'Password changed successfully' })
  } catch (error: any) {
    logError('Change password', error)
    return res.status(500).json({ error: 'Failed to change password' })
  }
})

// ===========================
// SUPERADMIN REGISTRATION ENDPOINT
// ===========================

interface SuperadminRegisterRequest extends Request {
  body: {
    email: string
    fullName: string
    password: string
    confirmPassword: string
  }
}

// REMOVED: Test endpoint (L6 - no test endpoints in production code)

// SECURITY: Superadmin registration is gated â€” only works if:
// 1. No superadmin exists yet (bootstrap mode), OR
// 2. Request includes a valid SUPERADMIN_BOOTSTRAP_TOKEN from env
router.post('/register-superadmin', async (req: SuperadminRegisterRequest, res: Response) => {
  try {
    const { email, fullName, password, confirmPassword } = req.body

    // Validation
    if (!email || !fullName || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' })
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    // SECURITY GATE: Check if any superadmin already exists
    const anySuperadminResult = await query(
      `SELECT COUNT(*) as cnt FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name = 'superadmin'`
    )
    const superadminCount = parseInt(anySuperadminResult.rows[0].cnt, 10)

    if (superadminCount > 0) {
      // A superadmin already exists â€” require bootstrap token
      const bootstrapToken = process.env.SUPERADMIN_BOOTSTRAP_TOKEN
      const providedToken = req.headers['x-bootstrap-token'] as string

      if (!bootstrapToken || !providedToken || providedToken !== bootstrapToken) {
        return res.status(403).json({ error: 'Superadmin registration is disabled. Contact the existing superadmin.' })
      }
    }

    // Check if superadmin with this email already exists
    const existingResult = await query(
      `SELECT id FROM users WHERE email = $1 AND role_id IN (
        SELECT id FROM roles WHERE name = 'superadmin'
      )`,
      [email]
    )

    if (existingResult.rows.length > 0) {
      return res.status(409).json({ error: 'Superadmin account already exists' })
    }

    // Check if email exists as regular user
    const emailCheckResult = await query(
      `SELECT id FROM users WHERE email = $1`,
      [email]
    )

    if (emailCheckResult.rows.length > 0) {
      return res.status(409).json({ error: 'This email is already registered' })
    }

    // Get system platform
    const platformResult = await query(
      `SELECT id FROM platforms WHERE name = 'system'`
    )

    if (platformResult.rows.length === 0) {
      return res.status(500).json({ error: 'System platform not configured' })
    }

    const systemPlatformId = platformResult.rows[0].id

    // Get superadmin role
    const roleResult = await query(
      `SELECT id FROM roles WHERE name = 'superadmin' AND platform_id = $1`,
      [systemPlatformId]
    )

    if (roleResult.rows.length === 0) {
      return res.status(500).json({ error: 'Superadmin role not configured' })
    }

    const superadminRoleId = roleResult.rows[0].id

    // Hash password
    const hashedPassword = await hashPassword(password)

    // Create superadmin user
    const userResult = await query(
      `INSERT INTO users (platform_id, email, full_name, role_id, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, email, full_name`,
      [systemPlatformId, email, fullName, superadminRoleId, hashedPassword]
    )

    const newSuperadmin = userResult.rows[0]

    return res.status(201).json({
      message: 'Superadmin account created successfully',
      user: {
        id: newSuperadmin.id,
        email: newSuperadmin.email,
        fullName: newSuperadmin.full_name,
        role: 'superadmin'
      }
    })
  } catch (error: any) {
    return res.status(500).json({ error: 'Registration failed' })
  }
})

// ===========================
// SUPERADMIN LOGIN ENDPOINT
// ===========================

interface SuperadminLoginRequest extends Request {
  body: {
    email: string
    password: string
  }
}

router.post('/login-superadmin', async (req: SuperadminLoginRequest, res: Response) => {
  try {
    const { email, password } = req.body

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Get system platform
    const platformResult = await query(
      `SELECT id FROM platforms WHERE name = 'system'`
    )

    if (platformResult.rows.length === 0) {
      return res.status(500).json({ error: 'System platform not configured' })
    }

    const systemPlatformId = platformResult.rows[0].id

    // Find superadmin user
    const userResult = await query(
      `SELECT u.*, r.name as role_name, r.permissions FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.email = $1 AND u.platform_id = $2 AND r.name = 'superadmin' AND u.is_active = true`,
      [email, systemPlatformId]
    )

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const user = userResult.rows[0]

    // Verify password
    const isValidPassword = await verifyPassword(password, user.password_hash)
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id, user.platform_id, user.role_id)
    const refreshToken = generateRefreshToken(user.id)

    // Update last_login
    await query(
      `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`,
      [user.id]
    )

    return res.json({
      message: 'Superadmin login successful',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role_name,
        permissions: user.permissions || []
      },
      accessToken,
      refreshToken
    })
  } catch (error: any) {
    return res.status(500).json({ error: 'Login failed' })
  }
})

// ===========================
// REFRESH TOKEN ENDPOINT
// ===========================

interface RefreshRequest extends Request {
  body: {
    refreshToken: string
  }
}

router.post('/refresh', async (req: RefreshRequest, res: Response) => {
  try {
    const { refreshToken } = req.body

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' })
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken)
    const userId = decoded.userId

    // Get user and their role info
    const userResult = await query(
      `SELECT u.*, r.id as role_id FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [userId]
    )

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' })
    }

    const user = userResult.rows[0]

    // Generate new access token
    const accessToken = generateAccessToken(user.id, user.platform_id, user.role_id)

    return res.json({
      message: 'Token refreshed successfully',
      accessToken
    })
  } catch (error: any) {
    return res.status(403).json({ error: 'Invalid refresh token' })
  }
})

// ===========================
// GET CURRENT USER ENDPOINT
// ===========================

router.get('/me', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const user = await getUserWithRole(req.user.userId)

    // Get platform name
    const platformResult = await query(
      `SELECT name FROM platforms WHERE id = $1`,
      [user.platform_id]
    )

    if (platformResult.rows.length === 0) {
      return res.status(500).json({ error: 'Platform not found' });
    }

    const platformName = platformResult.rows[0].name

    const responseData = {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        phone: user.phone,
        platform: platformName,
        role: user.role_name,
        permissions: user.permissions || [],
        profileImage: user.profile_image_url,
        isActive: user.is_active,
        lastLogin: user.last_login,
        mustResetPassword: user.must_reset_password || false
      }
    };
    
    return res.json(responseData);
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to get user' })
  }
})

// ===========================
// UPDATE PROFILE ENDPOINT
// ===========================

router.put('/me', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })

    const { fullName, phone } = req.body

    if (!fullName && !phone) {
      return res.status(400).json({ error: 'At least one field (fullName, phone) is required' })
    }

    // Validate fullName length
    if (fullName && (fullName.length < 2 || fullName.length > 100)) {
      return res.status(400).json({ error: 'Full name must be between 2 and 100 characters' })
    }

    const updates: string[] = []
    const values: any[] = []
    let idx = 1

    if (fullName) {
      updates.push(`full_name = $${idx++}`)
      values.push(fullName)
    }
    if (phone !== undefined) {
      updates.push(`phone = $${idx++}`)
      values.push(phone || null)
    }
    updates.push(`updated_at = CURRENT_TIMESTAMP`)
    values.push(req.user.userId)

    await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    )

    return res.json({ success: true, message: 'Profile updated successfully' })
  } catch (error: any) {
    console.error('[Profile Update]', error.message)
    return res.status(500).json({ error: 'Failed to update profile' })
  }
})

// ===========================
// LOGOUT ENDPOINT (optional - for client-side cleanup)
// ===========================

router.post('/logout', authenticateToken, (req: Request, res: Response) => {
  // JWT is stateless, so logout is mainly client-side (delete tokens)
  // However, you could implement token blacklisting if needed
  return res.json({ message: 'Logout successful' })
})

// ===========================
// SUPERADMIN ENDPOINTS
// ===========================

// Middleware to verify superadmin access
const verifySuperadmin = async (req: Request, res: Response, next: Function) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const superAdminCheck = await isSuperadmin(req.user.userId)
    if (!superAdminCheck) {
      return res.status(403).json({ error: 'Superadmin access required' })
    }

    next()
  } catch (error: any) {
    return res.status(500).json({ error: 'Authorization error' })
  }
}

// GET comprehensive superadmin dashboard (all data in one call)
router.get('/superadmin/dashboard', authenticateToken, verifySuperadmin, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId

    // Get user info
    const userInfo = await query(
      `SELECT id, email, full_name, profile_image_url FROM users WHERE id = $1`,
      [userId]
    )

    // Get tenant stats
    const schoolStatsResult = await query(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active
      FROM school_entities`
    )

    const corporateStatsResult = await query(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active
      FROM corporate_entities`
    )

    const userStatsResult = await query(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active
      FROM users`
    )

    // Get incidents summary
    const incidentsResult = await query(
      `SELECT 
        severity,
        status,
        COUNT(*) as count
      FROM incidents
      GROUP BY severity, status`
    )

    // Get recent actions
    const recentActionsResult = await query(
      `SELECT 
        id,
        action,
        entity_type,
        created_at
      FROM superadmin_action_logs
      ORDER BY created_at DESC
      LIMIT 10`
    )

    // Get system health
    const healthResult = await query(
      `SELECT 
        service_name,
        status,
        last_checked_at
      FROM system_health
      ORDER BY last_checked_at DESC`
    )

    // Log the action
    await logSuperadminAction(
      userId,
      'view_dashboard',
      undefined,
      undefined,
      undefined,
      getClientIp(req)
    )

    return res.json({
      success: true,
      message: 'Dashboard data fetched successfully',
      data: {
        stats: {
          total_schools: parseInt(schoolStatsResult.rows[0]?.total || '0'),
          active_schools: parseInt(schoolStatsResult.rows[0]?.active || '0'),
          total_corporates: parseInt(corporateStatsResult.rows[0]?.total || '0'),
          active_corporates: parseInt(corporateStatsResult.rows[0]?.active || '0'),
          total_users: parseInt(userStatsResult.rows[0]?.total || '0'),
          active_users: parseInt(userStatsResult.rows[0]?.active || '0')
        },
        entities: {
          schools: [],
          corporates: []
        },
        pendingApprovals: {
          list: incidentsResult.rows,
          count: incidentsResult.rows.length
        },
        userStatistics: [],
        recentActions: recentActionsResult.rows,
        systemHealth: healthResult.rows,
        currentUser: {
          id: userInfo.rows[0]?.id,
          email: userInfo.rows[0]?.email,
          fullName: userInfo.rows[0]?.full_name,
          profileImage: userInfo.rows[0]?.profile_image_url
        }
      }
    })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch dashboard data' })
  }
})

// GET superadmin dashboard stats
router.get('/superadmin/dashboard-stats', authenticateToken, verifySuperadmin, async (req: Request, res: Response) => {
  try {
    const stats = await getSuperadminDashboardStats(req.user!.userId)
    
    // Log the action
    await logSuperadminAction(
      req.user!.userId,
      'view_dashboard_stats',
      undefined,
      undefined,
      undefined,
      getClientIp(req)
    )

    return res.json({ stats })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to get dashboard stats' })
  }
})

// GET all entities (schools and corporate)
router.get('/superadmin/entities', authenticateToken, verifySuperadmin, async (req: Request, res: Response) => {
  try {
    const entities = await getSuperadminAllEntities(req.user!.userId)
    
    // Log the action
    await logSuperadminAction(
      req.user!.userId,
      'view_all_entities',
      undefined,
      undefined,
      undefined,
      getClientIp(req)
    )

    return res.json(entities)
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to get entities' })
  }
})

// GET all pending approvals across all entities
router.get('/superadmin/pending-approvals', authenticateToken, verifySuperadmin, async (req: Request, res: Response) => {
  try {
    const approvals = await getSuperadminAllPendingApprovals(req.user!.userId)
    
    // Log the action
    await logSuperadminAction(
      req.user!.userId,
      'view_all_pending_approvals',
      undefined,
      undefined,
      { count: approvals.length },
      getClientIp(req)
    )

    return res.json({ approvals, count: approvals.length })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to get pending approvals' })
  }
})

// GET superadmin action logs
router.get('/superadmin/action-logs', authenticateToken, verifySuperadmin, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100
    const offset = parseInt(req.query.offset as string) || 0

    const logs = await getSuperadminActionLogs(req.user!.userId, limit, offset)

    return res.json(logs)
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to get action logs' })
  }
})

// GET user statistics by platform
router.get('/superadmin/user-statistics', authenticateToken, verifySuperadmin, async (req: Request, res: Response) => {
  try {
    const stats = await getSuperadminUserStatistics(req.user!.userId)
    
    // Log the action
    await logSuperadminAction(
      req.user!.userId,
      'view_user_statistics',
      undefined,
      undefined,
      undefined,
      getClientIp(req)
    )

    return res.json({ stats })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to get user statistics' })
  }
})

// GET entity-specific users
router.get('/superadmin/entity-users', authenticateToken, verifySuperadmin, async (req: Request, res: Response) => {
  try {
    const { entityType, entityId } = req.query

    if (!entityType || !entityId) {
      return res.status(400).json({ error: 'Missing entityType or entityId' })
    }

    const users = await getSuperadminEntityUsers(
      req.user!.userId,
      entityType as 'school' | 'corporate',
      entityId as string
    )

    // Log the action
    await logSuperadminAction(
      req.user!.userId,
      'view_entity_users',
      entityType as string,
      entityId as string,
      undefined,
      getClientIp(req)
    )

    return res.json({ users })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to get entity users' })
  }
})

// Get corporate admin stats
/**
 * Dashboard figures for a company administrator.
 *
 * Authority came from corporate_entities.admin_user_id, NULL for every entity,
 * so this answered 403 to everyone. The check-in rate it would have returned
 * was the string '92.3%', written into the handler — a number that never came
 * from the data and could not change. It is computed now, over the tenant's
 * own check-ins for the last thirty days, and reported as null when there is
 * nothing to compute it from rather than as a plausible-looking figure.
 */
router.get(
  '/admin/corporate/stats',
  authenticateToken,
  resolveTenantContext,
  requireTenant,
  requirePlatform('corporate'),
  requireRoles('admin', 'hr', 'hr_director', 'manager'),
  async (req: TenantRequest, res: Response) => {
  try {
    const ctx = req.ctx!

    const [users, active, approvals, checkins] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS n FROM corporate_user_associations
          WHERE corporate_entity_id = $1`,
        [ctx.tenantId]
      ),
      query(
        `SELECT COUNT(*)::int AS n
           FROM corporate_user_associations cua
           JOIN users u ON u.id = cua.user_id
          WHERE cua.corporate_entity_id = $1 AND cua.status = 'active' AND u.is_active = TRUE`,
        [ctx.tenantId]
      ),
      query(
        `SELECT COUNT(*)::int AS n FROM user_registration_requests
          WHERE entity_id = $1 AND status = 'pending'`,
        [ctx.tenantId]
      ),
      // Expected check-ins are one per active employee per working day over
      // the window; actual are the distinct employee-days recorded.
      query(
        `SELECT
           COUNT(DISTINCT (c.employee_id, c.check_in_time::date))::int AS recorded,
           (SELECT COUNT(*)::int FROM employees e
             WHERE e.tenant_id = $1 AND e.is_currently_employed = TRUE) AS active_employees,
           COUNT(DISTINCT c.check_in_time::date)::int AS days_with_activity
         FROM corporate_checkins c
        WHERE c.tenant_id = $1
          AND c.check_in_time >= CURRENT_DATE - INTERVAL '30 days'`,
        [ctx.tenantId]
      ),
    ])

    const c = checkins.rows[0]
    const expected = c.active_employees * c.days_with_activity
    const checkinRate =
      expected > 0 ? Math.round((c.recorded / expected) * 1000) / 10 : null

    return res.json({
      stats: {
        totalUsers: users.rows[0].n,
        activeUsers: active.rows[0].n,
        pendingApprovals: approvals.rows[0].n,
        checkinRate,
      },
      recentActivity: [],
      entity: { id: ctx.tenantId, name: ctx.tenantName },
    })
  } catch (error: any) {
    logError('Get corporate stats', error)
    return res.status(500).json({ error: 'Failed to get stats' })
  }
})

export default router

