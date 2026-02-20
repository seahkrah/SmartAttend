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
router.get('/admin/pending-approvals', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    }

    // Check if user is admin
    const userResult = await query(
      `SELECT u.*, r.name as role_name FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [req.user.userId]
    )

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: ErrorMessages.USER_NOT_FOUND })
    }

    const user = userResult.rows[0]

    // Get platform name
    const platformResult = await query(
      `SELECT name FROM platforms WHERE id = $1`,
      [user.platform_id]
    )

    if (platformResult.rows.length === 0) {
      return res.status(400).json({ error: ErrorMessages.SYSTEM_CONFIGURATION_ERROR })
    }

    const platformName = platformResult.rows[0].name

    // Check if user is admin of any entity
    if (platformName === 'school') {
      const schoolAdminCheck = await query(
        `SELECT id FROM school_entities WHERE admin_user_id = $1`,
        [req.user.userId]
      )
      if (schoolAdminCheck.rows.length === 0) {
        return res.status(403).json({ error: ErrorMessages.AUTH_PERMISSION_DENIED })
      }
    } else if (platformName === 'corporate') {
      const corporateAdminCheck = await query(
        `SELECT id FROM corporate_entities WHERE admin_user_id = $1`,
        [req.user.userId]
      )
      if (corporateAdminCheck.rows.length === 0) {
        return res.status(403).json({ error: ErrorMessages.AUTH_PERMISSION_DENIED })
      }
    }

    // Get pending approvals
    const approvals = await getPendingApprovalsForAdmin(req.user.userId, user.platform_id)

    return res.json({
      platform: platformName,
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

router.post('/admin/approval-action', authenticateToken, async (req: ApprovalActionRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    }

    const { approvalId, action, rejectionReason } = req.body

    if (!approvalId || !action) {
      return res.status(400).json({ error: ErrorMessages.VALIDATION_MISSING_FIELDS })
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Please select a valid action' })
    }

    // Get user's platform
    const userResult = await query(
      `SELECT platform_id FROM users WHERE id = $1`,
      [req.user.userId]
    )

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: ErrorMessages.USER_NOT_FOUND })
    }

    const platformId = userResult.rows[0].platform_id

    // Approve or reject
    const result = await approveOrRejectRegistration(
      approvalId,
      platformId,
      action,
      req.user.userId,
      rejectionReason
    )

    return res.json(result)
  } catch (error: any) {
    logError('Approval action', error)
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

// ===========================
// TEMPORARY: Tenant Admin Stats Endpoints 
// TODO: Move to separate tenant admin routes file
// ===========================

// Get school admin dashboard stats
router.get('/admin/school/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const entityResult = await query(
      `SELECT * FROM school_entities WHERE admin_user_id = $1`,
      [req.user.userId]
    )

    if (entityResult.rows.length === 0) {
      return res.status(403).json({ error: 'No entity assigned to this admin' })
    }

    const entity = entityResult.rows[0]

    const usersResult = await query(
      `SELECT COUNT(*) as count FROM school_user_associations WHERE school_entity_id = $1`,
      [entity.id]
    )

    const activeUsersResult = await query(
      `SELECT COUNT(*) as count FROM school_user_associations sua JOIN users u ON sua.user_id = u.id WHERE sua.school_entity_id = $1 AND sua.status = 'active' AND u.is_active = true`,
      [entity.id]
    )

    const approvalsResult = await query(
      `SELECT COUNT(*) as count FROM user_registration_requests WHERE entity_id = $1 AND status = 'pending'`,
      [entity.id]
    )

    return res.json({
      stats: {
        totalUsers: parseInt(usersResult.rows[0].count) || 0,
        activeUsers: parseInt(activeUsersResult.rows[0].count) || 0,
        pendingApprovals: parseInt(approvalsResult.rows[0].count) || 0,
        todayAttendance: 0,
        attendanceRate: 0,
      },
      recentActivity: [],
      entity: { id: entity.id, name: entity.name, code: entity.code }
    })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to get stats' })
  }
})

// Get school users
router.get('/admin/school/users', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const entityResult = await query(
      `SELECT * FROM school_entities WHERE admin_user_id = $1`,
      [req.user.userId]
    )

    if (entityResult.rows.length === 0) {
      return res.status(403).json({ error: 'No entity assigned to this admin' })
    }

    const entity = entityResult.rows[0]

    const usersResult = await query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.is_active, u.created_at, u.last_login, r.name as role, sua.status as association_status
       FROM school_user_associations sua
       JOIN users u ON sua.user_id = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE sua.school_entity_id = $1
       ORDER BY u.created_at DESC`,
      [entity.id]
    )

    return res.json({
      users: usersResult.rows.map(row => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        phone: row.phone,
        role: row.role,
        isActive: row.is_active,
        status: row.association_status,
        createdAt: row.created_at,
        lastLogin: row.last_login
      }))
    })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to get users' })
  }
})

// Get corporate admin stats
router.get('/admin/corporate/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const entityResult = await query(
      `SELECT * FROM corporate_entities WHERE admin_user_id = $1`,
      [req.user.userId]
    )

    if (entityResult.rows.length === 0) {
      return res.status(403).json({ error: 'No entity assigned to this admin' })
    }

    const entity = entityResult.rows[0]

    const usersResult = await query(
      `SELECT COUNT(*) as count FROM corporate_user_associations WHERE corporate_entity_id = $1`,
      [entity.id]
    )

    const activeUsersResult = await query(
      `SELECT COUNT(*) as count FROM corporate_user_associations cua JOIN users u ON cua.user_id = u.id WHERE cua.corporate_entity_id = $1 AND cua.status = 'active' AND u.is_active = true`,
      [entity.id]
    )

    const approvalsResult = await query(
      `SELECT COUNT(*) as count FROM user_registration_requests WHERE entity_id = $1 AND status = 'pending'`,
      [entity.id]
    )

    return res.json({
      stats: {
        totalUsers: parseInt(usersResult.rows[0].count),
        activeUsers: parseInt(activeUsersResult.rows[0].count),
        pendingApprovals: parseInt(approvalsResult.rows[0].count),
        checkinRate: '92.3%',
      },
      recentActivity: [],
      entity: { id: entity.id, name: entity.name, code: entity.code }
    })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to get stats' })
  }
})

// ===========================
// SCHOOL ADMIN: User Management  
// ===========================

// Update user (activate, suspend, disable)
router.patch('/admin/school/users/:userId', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const { userId } = req.params
    const { action } = req.body // 'activate', 'suspend', 'disable'
    
    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'No entity assigned' })
    
    const entity = entityResult.rows[0]
    
    // Verify user belongs to this entity
    const userCheck = await query(
      `SELECT * FROM school_user_associations WHERE user_id = $1 AND school_entity_id = $2`,
      [userId, entity.id]
    )
    if (userCheck.rows.length === 0) return res.status(404).json({ error: 'User not found in entity' })
    
    if (action === 'activate') {
      await query(`UPDATE school_user_associations SET status = 'active' WHERE user_id = $1 AND school_entity_id = $2`, [userId, entity.id])
      await query(`UPDATE users SET is_active = true WHERE id = $1`, [userId])
    } else if (action === 'suspend') {
      await query(`UPDATE school_user_associations SET status = 'suspended' WHERE user_id = $1 AND school_entity_id = $2`, [userId, entity.id])
    } else if (action === 'disable') {
      await query(`UPDATE school_user_associations SET status = 'inactive' WHERE user_id = $1 AND school_entity_id = $2`, [userId, entity.id])
      await query(`UPDATE users SET is_active = false WHERE id = $1`, [userId])
    } else {
      return res.status(400).json({ error: 'Invalid action' })
    }
    
    return res.json({ message: 'User updated successfully' })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to update user' })
  }
})

// Create new user
router.post('/admin/school/users', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const { email, fullName, phone, role } = req.body
    
    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'No entity assigned' })
    
    const entity = entityResult.rows[0]
    
    // Get platform and role IDs
    const platformResult = await query(`SELECT id FROM platforms WHERE name = 'school'`)
    const roleResult = await query(`SELECT id FROM roles WHERE name = $1 AND platform_id = $2`, [role, platformResult.rows[0].id])
    
    if (roleResult.rows.length === 0) return res.status(400).json({ error: 'Invalid role' })
    
    // Create user
    const userResult = await query(
      `INSERT INTO users (email, full_name, phone, platform_id, role_id, is_active) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [email, fullName, phone, platformResult.rows[0].id, roleResult.rows[0].id]
    )
    
    // Link to entity
    await query(
      `INSERT INTO school_user_associations (user_id, school_entity_id, status) VALUES ($1, $2, 'active')`,
      [userResult.rows[0].id, entity.id]
    )
    
    return res.json({ message: 'User created successfully', userId: userResult.rows[0].id })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to create user' })
  }
})

// ===========================
// SCHOOL ADMIN: Student Management
// ===========================

// Get students
router.get('/admin/school/students', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'No entity assigned' })
    
    const studentsResult = await query(
      `SELECT s.*, u.email, u.full_name, u.is_active,
              sd.name as department_name
       FROM students s
       JOIN users u ON s.user_id = u.id
       JOIN school_user_associations sua ON u.id = sua.user_id
       LEFT JOIN school_departments sd ON s.department_id = sd.id
       WHERE sua.school_entity_id = $1
       ORDER BY s.created_at DESC`,
      [entityResult.rows[0].id]
    )
    
    // Map department_name to department for frontend compatibility
    const students = studentsResult.rows.map(s => ({
      ...s,
      department: s.department_name || null
    }))
    
    return res.json({ students })
  } catch (error: any) {
    logError('Get students', error)
    const friendlyError = getUserFriendlyError(error, 'Unable to load students')
    return res.status(500).json({ error: friendlyError.error })
  }
})

// Create student
router.post('/admin/school/students', authenticateToken, async (req: Request, res: Response) => {
  const client = await getConnection();
  
  try {
    if (!req.user) {
      client.release();
      return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED });
    }
    
    const { studentId, firstName, middleName, lastName, email, phone, address, college, department, status, gender, profilePhoto } = req.body
    
    // Begin transaction
    await client.query('BEGIN');
    
    // Get admin user's platform
    const adminUserResult = await client.query(
      `SELECT u.platform_id, p.name as platform_name 
       FROM users u 
       JOIN platforms p ON u.platform_id = p.id 
       WHERE u.id = $1`,
      [req.user.userId]
    )
    if (adminUserResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({ error: 'User not found' });
    }
    const adminPlatform = adminUserResult.rows[0]
    
    const entityResult = await client.query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({ error: 'You are not assigned to manage any school' });
    }
    
    const entity = entityResult.rows[0]
    
    // Get student role from admin's platform
    const roleResult = await client.query(`SELECT id FROM roles WHERE name = 'student' AND platform_id = $1`, [adminPlatform.platform_id])
    if (roleResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(500).json({ error: ErrorMessages.SYSTEM_CONFIGURATION_ERROR });
    }
    
    // Resolve department: look up or create department by name
    let departmentId = null;
    if (department && department.trim()) {
      const existingDept = await client.query(
        `SELECT id FROM school_departments WHERE LOWER(name) = LOWER($1) AND platform_id = $2`,
        [department.trim(), adminPlatform.platform_id]
      );
      if (existingDept.rows.length > 0) {
        departmentId = existingDept.rows[0].id;
      } else {
        const newDept = await client.query(
          `INSERT INTO school_departments (name, platform_id) VALUES ($1, $2) RETURNING id`,
          [department.trim(), adminPlatform.platform_id]
        );
        departmentId = newDept.rows[0].id;
      }
    }
    
    // Hash default password
    const defaultPassword = 'Password'
    const hashedPassword = await hashPassword(defaultPassword)
    
    // Create user account with default password (user must change on first login)
    const fullName = middleName ? `${firstName} ${middleName} ${lastName}` : `${firstName} ${lastName}`
    const userResult = await client.query(
      `INSERT INTO users (email, full_name, phone, platform_id, role_id, is_active, password_hash, must_reset_password) 
       VALUES ($1, $2, $3, $4, $5, true, $6, true) RETURNING id, platform_id`,
      [email, fullName, phone || null, adminPlatform.platform_id, roleResult.rows[0].id, hashedPassword]
    )
    
    // Create student record with profile photo
    const studentResult = await client.query(
      `INSERT INTO students (user_id, student_id, first_name, middle_name, last_name, email, phone, address, college, department_id, status, gender, profile_photo_url, platform_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [userResult.rows[0].id, studentId, firstName, middleName || null, lastName, email, phone || null, address || null, college || null, departmentId, status || 'freshman', gender || null, profilePhoto || null, adminPlatform.platform_id]
    )
    
    // Link to entity
    await client.query(
      `INSERT INTO school_user_associations (user_id, school_entity_id, status) VALUES ($1, $2, 'active')`,
      [userResult.rows[0].id, entity.id]
    )
    
    // Commit transaction
    await client.query('COMMIT');
    client.release();
    
    return res.json({ 
      message: 'Student created successfully. Student must change password on first login.', 
      studentId: studentResult.rows[0].id
    })
  } catch (error: any) {
    // Rollback on any error
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Rollback failed, just release
    }
    client.release();
    logError('Create student', error)
    const friendlyError = getUserFriendlyError(error, ErrorMessages.STUDENT_CREATE_FAILED)
    return res.status(500).json({ error: friendlyError.error })
  }
})

// Update student
router.patch('/admin/school/students/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    
    const { id } = req.params
    const updates = req.body
    
    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'You are not assigned to manage any school' })
    
    // Get admin's platform for department lookup
    const adminUserResult = await query(
      `SELECT u.platform_id FROM users u WHERE u.id = $1`,
      [req.user.userId]
    )
    const adminPlatformId = adminUserResult.rows[0]?.platform_id
    
    // Build dynamic update query
    const updateFields = []
    const values = []
    let paramCount = 1
    
    // Handle student_id update with uniqueness check
    if (updates.studentId && updates.studentId.trim()) {
      const duplicateCheck = await query(
        `SELECT id FROM students WHERE student_id = $1 AND id != $2`,
        [updates.studentId.trim(), id]
      )
      if (duplicateCheck.rows.length > 0) {
        return res.status(400).json({ error: 'A student with this ID already exists. Please use a unique Student ID.' })
      }
      updateFields.push(`student_id = $${paramCount++}`); values.push(updates.studentId.trim())
    }
    if (updates.firstName) { updateFields.push(`first_name = $${paramCount++}`); values.push(updates.firstName) }
    if (updates.middleName !== undefined) { updateFields.push(`middle_name = $${paramCount++}`); values.push(updates.middleName || null) }
    if (updates.lastName) { updateFields.push(`last_name = $${paramCount++}`); values.push(updates.lastName) }
    if (updates.phone !== undefined) { updateFields.push(`phone = $${paramCount++}`); values.push(updates.phone || null) }
    if (updates.address !== undefined) { updateFields.push(`address = $${paramCount++}`); values.push(updates.address || null) }
    if (updates.college !== undefined) { updateFields.push(`college = $${paramCount++}`); values.push(updates.college || null) }
    // Handle department: resolve name to department_id
    if (updates.department !== undefined && updates.department && updates.department.trim()) {
      const deptName = updates.department.trim()
      const existingDept = await query(
        `SELECT id FROM school_departments WHERE LOWER(name) = LOWER($1) AND platform_id = $2`,
        [deptName, adminPlatformId]
      )
      let deptId
      if (existingDept.rows.length > 0) {
        deptId = existingDept.rows[0].id
      } else {
        const newDept = await query(
          `INSERT INTO school_departments (name, platform_id) VALUES ($1, $2) RETURNING id`,
          [deptName, adminPlatformId]
        )
        deptId = newDept.rows[0].id
      }
      updateFields.push(`department_id = $${paramCount++}`); values.push(deptId)
    } else if (updates.department === '') {
      updateFields.push(`department_id = $${paramCount++}`); values.push(null)
    }
    if (updates.status) { updateFields.push(`status = $${paramCount++}`); values.push(updates.status) }
    if (updates.gender !== undefined) { updateFields.push(`gender = $${paramCount++}`); values.push(updates.gender || null) }
    if (updates.profilePhoto) { updateFields.push(`profile_photo_url = $${paramCount++}`); values.push(updates.profilePhoto) }
    
    if (updateFields.length > 0) {
      values.push(id)
      await query(`UPDATE students SET ${updateFields.join(', ')} WHERE id = $${paramCount}`, values)
    }
    
    // Also update user full_name if first/last name changed
    if (updates.firstName || updates.lastName) {
      const studentResult = await query(`SELECT user_id, first_name, middle_name, last_name FROM students WHERE id = $1`, [id])
      if (studentResult.rows.length > 0) {
        const s = studentResult.rows[0]
        const fn = updates.firstName || s.first_name
        const mn = updates.middleName !== undefined ? updates.middleName : s.middle_name
        const ln = updates.lastName || s.last_name
        const fullName = mn ? `${fn} ${mn} ${ln}` : `${fn} ${ln}`
        await query(`UPDATE users SET full_name = $1 WHERE id = $2`, [fullName, s.user_id])
      }
    }
    
    return res.json({ message: 'Student updated successfully' })
  } catch (error: any) {
    logError('Update student', error)
    const friendlyError = getUserFriendlyError(error, ErrorMessages.STUDENT_UPDATE_FAILED)
    return res.status(500).json({ error: friendlyError.error })
  }
})

// Suspend/Unsuspend student
router.patch('/admin/school/students/:id/suspend', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    
    const { id } = req.params
    const { suspended } = req.body // true = suspend, false = unsuspend
    
    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'You are not assigned to manage any school' })
    
    // Get the student's user_id
    const studentResult = await query(`SELECT user_id FROM students WHERE id = $1`, [id])
    if (studentResult.rows.length === 0) return res.status(404).json({ error: 'Student not found' })
    
    // Update user is_active status
    await query(`UPDATE users SET is_active = $1 WHERE id = $2`, [!suspended, studentResult.rows[0].user_id])
    
    return res.json({ message: suspended ? 'Student suspended successfully' : 'Student reactivated successfully' })
  } catch (error: any) {
    logError('Suspend student', error)
    const friendlyError = getUserFriendlyError(error, 'Unable to update student status')
    return res.status(500).json({ error: friendlyError.error })
  }
})

// Delete student
router.delete('/admin/school/students/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    
    const { id } = req.params
    
    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'You are not assigned to manage any school' })
    
    // Get the student's user_id
    const studentResult = await query(`SELECT user_id FROM students WHERE id = $1`, [id])
    if (studentResult.rows.length === 0) return res.status(404).json({ error: 'Student not found' })
    
    const userId = studentResult.rows[0].user_id
    
    // Delete in proper order (FK constraints)
    await query(`DELETE FROM students WHERE id = $1`, [id])
    await query(`DELETE FROM school_user_associations WHERE user_id = $1`, [userId])
    await query(`DELETE FROM users WHERE id = $1`, [userId])
    
    return res.json({ message: 'Student deleted successfully' })
  } catch (error: any) {
    logError('Delete student', error)
    const friendlyError = getUserFriendlyError(error, 'Unable to delete student')
    return res.status(500).json({ error: friendlyError.error })
  }
})

// ===========================
// SCHOOL ADMIN: Faculty Management
// ===========================

// Get faculty
router.get('/admin/school/faculty', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    
    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'You are not assigned to manage any school' })
    
    const facultyResult = await query(
      `SELECT f.*, f.employee_id as faculty_id, u.email, u.full_name, u.is_active, u.phone,
              sd.name as department_name
       FROM faculty f
       JOIN users u ON f.user_id = u.id
       JOIN school_user_associations sua ON u.id = sua.user_id
       LEFT JOIN school_departments sd ON f.department_id = sd.id
       WHERE sua.school_entity_id = $1
       ORDER BY f.created_at DESC`,
      [entityResult.rows[0].id]
    )
    
    // Map department_name to department for frontend compatibility
    const faculty = facultyResult.rows.map(f => ({
      ...f,
      department: f.department_name || null
    }))
    
    return res.json({ faculty })
  } catch (error: any) {
    logError('Get faculty', error)
    const friendlyError = getUserFriendlyError(error, 'Unable to load faculty members')
    return res.status(500).json({ error: friendlyError.error })
  }
})

// Create faculty
router.post('/admin/school/faculty', authenticateToken, async (req: Request, res: Response) => {
  const client = await getConnection();
  
  try {
    if (!req.user) {
      client.release();
      return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    }
    
    const { facultyId, title, firstName, middleName, lastName, email, phone, address, college, department, gender } = req.body
    
    // Get admin user's platform
    const adminUserResult = await client.query(
      `SELECT u.platform_id, p.name as platform_name 
       FROM users u 
       JOIN platforms p ON u.platform_id = p.id 
       WHERE u.id = $1`,
      [req.user.userId]
    )
    if (adminUserResult.rows.length === 0) {
      client.release();
      return res.status(403).json({ error: 'User not found' })
    }
    const adminPlatform = adminUserResult.rows[0]
    
    const entityResult = await client.query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) {
      client.release();
      return res.status(403).json({ error: 'You are not assigned to manage any school' })
    }
    
    const entity = entityResult.rows[0]
    
    // Get faculty role from admin's platform
    const roleResult = await client.query(`SELECT id FROM roles WHERE name = 'faculty' AND platform_id = $1`, [adminPlatform.platform_id])
    if (roleResult.rows.length === 0) {
      client.release();
      return res.status(500).json({ error: ErrorMessages.SYSTEM_CONFIGURATION_ERROR })
    }
    
    // Begin transaction
    await client.query('BEGIN');
    
    // Hash default password
    const defaultPassword = 'Password'
    const hashedPassword = await hashPassword(defaultPassword)
    
    // Create user account with default password
    const fullName = middleName ? `${firstName} ${middleName} ${lastName}` : `${firstName} ${lastName}`
    const userResult = await client.query(
      `INSERT INTO users (email, full_name, phone, platform_id, role_id, is_active, password_hash, must_reset_password) 
       VALUES ($1, $2, $3, $4, $5, true, $6, true) RETURNING id, platform_id`,
      [email, fullName, phone || null, adminPlatform.platform_id, roleResult.rows[0].id, hashedPassword]
    )
    
    // Resolve department name to department_id
    let departmentId = null
    if (department && department.trim()) {
      const deptName = department.trim()
      const existingDept = await client.query(
        `SELECT id FROM school_departments WHERE LOWER(name) = LOWER($1) AND platform_id = $2`,
        [deptName, adminPlatform.platform_id]
      )
      if (existingDept.rows.length > 0) {
        departmentId = existingDept.rows[0].id
      } else {
        const newDept = await client.query(
          `INSERT INTO school_departments (name, platform_id) VALUES ($1, $2) RETURNING id`,
          [deptName, adminPlatform.platform_id]
        )
        departmentId = newDept.rows[0].id
      }
    }
    
    // Create faculty record
    await client.query(
      `INSERT INTO faculty (user_id, employee_id, first_name, middle_name, last_name, college, email, department_id, gender, title, address) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [userResult.rows[0].id, facultyId, firstName, middleName || null, lastName, college || null, email, departmentId, gender || null, title || null, address || null]
    )
    
    // Link user to school entity
    await client.query(
      `INSERT INTO school_user_associations (school_entity_id, user_id) VALUES ($1, $2)`,
      [entity.id, userResult.rows[0].id]
    )
    
    await client.query('COMMIT');
    
    return res.status(201).json({ 
      message: 'Faculty created successfully. Faculty member must change password on first login.'
    })
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {})
    logError('Create faculty', error)
    const friendlyError = getUserFriendlyError(error, ErrorMessages.FACULTY_CREATE_FAILED)
    return res.status(500).json({ error: friendlyError.error })
  } finally {
    client.release();
  }
})

// Update faculty
router.patch('/admin/school/faculty/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    
    const { id } = req.params
    const updates = req.body
    
    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'You are not assigned to manage any school' })
    
    // Get admin's platform for department lookup
    const adminUserResult = await query(
      `SELECT u.platform_id FROM users u WHERE u.id = $1`,
      [req.user.userId]
    )
    const adminPlatformId = adminUserResult.rows[0]?.platform_id
    
    // Build dynamic update query
    const updateFields: string[] = []
    const values: any[] = []
    let paramCount = 1
    
    // Handle employee_id (faculty_id from frontend) update with uniqueness check
    if (updates.facultyId && updates.facultyId.trim()) {
      const duplicateCheck = await query(
        `SELECT id FROM faculty WHERE employee_id = $1 AND id != $2`,
        [updates.facultyId.trim(), id]
      )
      if (duplicateCheck.rows.length > 0) {
        return res.status(400).json({ error: 'A faculty member with this ID already exists. Please use a unique Faculty ID.' })
      }
      updateFields.push(`employee_id = $${paramCount++}`); values.push(updates.facultyId.trim())
    }
    if (updates.firstName) { updateFields.push(`first_name = $${paramCount++}`); values.push(updates.firstName) }
    if (updates.middleName !== undefined) { updateFields.push(`middle_name = $${paramCount++}`); values.push(updates.middleName || null) }
    if (updates.lastName) { updateFields.push(`last_name = $${paramCount++}`); values.push(updates.lastName) }
    if (updates.college !== undefined) { updateFields.push(`college = $${paramCount++}`); values.push(updates.college || null) }
    if (updates.gender !== undefined) { updateFields.push(`gender = $${paramCount++}`); values.push(updates.gender || null) }
    if (updates.title !== undefined) { updateFields.push(`title = $${paramCount++}`); values.push(updates.title || null) }
    if (updates.address !== undefined) { updateFields.push(`address = $${paramCount++}`); values.push(updates.address || null) }
    
    // Handle department: resolve name to department_id
    if (updates.department !== undefined && updates.department && updates.department.trim()) {
      const deptName = updates.department.trim()
      const existingDept = await query(
        `SELECT id FROM school_departments WHERE LOWER(name) = LOWER($1) AND platform_id = $2`,
        [deptName, adminPlatformId]
      )
      let deptId
      if (existingDept.rows.length > 0) {
        deptId = existingDept.rows[0].id
      } else {
        const newDept = await query(
          `INSERT INTO school_departments (name, platform_id) VALUES ($1, $2) RETURNING id`,
          [deptName, adminPlatformId]
        )
        deptId = newDept.rows[0].id
      }
      updateFields.push(`department_id = $${paramCount++}`); values.push(deptId)
    } else if (updates.department === '') {
      updateFields.push(`department_id = $${paramCount++}`); values.push(null)
    }
    
    if (updateFields.length > 0) {
      values.push(id)
      await query(`UPDATE faculty SET ${updateFields.join(', ')} WHERE id = $${paramCount}`, values)
    }
    
    // Also update user full_name and phone if name changed
    if (updates.firstName || updates.lastName) {
      const facultyResult = await query(`SELECT user_id, first_name, middle_name, last_name FROM faculty WHERE id = $1`, [id])
      if (facultyResult.rows.length > 0) {
        const f = facultyResult.rows[0]
        const fn = updates.firstName || f.first_name
        const mn = updates.middleName !== undefined ? updates.middleName : f.middle_name
        const ln = updates.lastName || f.last_name
        const fullName = mn ? `${fn} ${mn} ${ln}` : `${fn} ${ln}`
        await query(`UPDATE users SET full_name = $1 WHERE id = $2`, [fullName, f.user_id])
      }
    }
    
    // Update phone on user record too
    if (updates.phone !== undefined) {
      const facultyResult = await query(`SELECT user_id FROM faculty WHERE id = $1`, [id])
      if (facultyResult.rows.length > 0) {
        await query(`UPDATE users SET phone = $1 WHERE id = $2`, [updates.phone || null, facultyResult.rows[0].user_id])
      }
    }
    
    return res.json({ message: 'Faculty updated successfully' })
  } catch (error: any) {
    logError('Update faculty', error)
    const friendlyError = getUserFriendlyError(error, 'Failed to update faculty')
    return res.status(500).json({ error: friendlyError.error })
  }
})

// Suspend/Unsuspend faculty
router.patch('/admin/school/faculty/:id/suspend', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    
    const { id } = req.params
    const { suspended } = req.body
    
    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'You are not assigned to manage any school' })
    
    const facultyResult = await query(`SELECT user_id FROM faculty WHERE id = $1`, [id])
    if (facultyResult.rows.length === 0) return res.status(404).json({ error: 'Faculty member not found' })
    
    await query(`UPDATE users SET is_active = $1 WHERE id = $2`, [!suspended, facultyResult.rows[0].user_id])
    
    return res.json({ message: suspended ? 'Faculty member suspended successfully' : 'Faculty member reactivated successfully' })
  } catch (error: any) {
    logError('Suspend faculty', error)
    const friendlyError = getUserFriendlyError(error, 'Unable to update faculty status')
    return res.status(500).json({ error: friendlyError.error })
  }
})

// Delete faculty
router.delete('/admin/school/faculty/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    
    const { id } = req.params
    
    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'You are not assigned to manage any school' })
    
    const facultyResult = await query(`SELECT user_id FROM faculty WHERE id = $1`, [id])
    if (facultyResult.rows.length === 0) return res.status(404).json({ error: 'Faculty member not found' })
    
    const userId = facultyResult.rows[0].user_id
    
    // Delete in order: faculty â†’ associations â†’ user (cascade handles some)
    await query(`DELETE FROM faculty WHERE id = $1`, [id])
    await query(`DELETE FROM school_user_associations WHERE user_id = $1`, [userId])
    await query(`DELETE FROM users WHERE id = $1`, [userId])
    
    return res.json({ message: 'Faculty member deleted successfully' })
  } catch (error: any) {
    logError('Delete faculty', error)
    const friendlyError = getUserFriendlyError(error, 'Unable to delete faculty member')
    return res.status(500).json({ error: friendlyError.error })
  }
})

// ===========================
// SCHOOL ADMIN: Course Management
// ===========================

// Get courses
router.get('/admin/school/courses', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const adminUserResult = await query(
      `SELECT u.platform_id FROM users u WHERE u.id = $1`, [req.user.userId]
    )
    if (adminUserResult.rows.length === 0) return res.status(403).json({ error: 'User not found' })
    const platformId = adminUserResult.rows[0].platform_id

    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'No entity assigned' })
    
    const coursesResult = await query(
      `SELECT c.*, sd.name as department_name
       FROM courses c
       LEFT JOIN school_departments sd ON c.department_id = sd.id
       WHERE c.platform_id = $1
       ORDER BY c.created_at DESC`,
      [platformId]
    )
    
    return res.json({ courses: coursesResult.rows })
  } catch (error: any) {
    logError('Get courses', error)
    const friendlyError = getUserFriendlyError(error, 'Unable to load courses')
    return res.status(500).json({ error: friendlyError.error })
  }
})

// Create course
router.post('/admin/school/courses', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    
    const { code, name, description, credits, department } = req.body
    
    if (!code || !name) {
      return res.status(400).json({ error: 'Course code and name are required' })
    }

    const adminUserResult = await query(
      `SELECT u.platform_id FROM users u WHERE u.id = $1`, [req.user.userId]
    )
    if (adminUserResult.rows.length === 0) return res.status(403).json({ error: 'User not found' })
    const platformId = adminUserResult.rows[0].platform_id

    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'You are not assigned to manage any school' })
    
    // Resolve department name to department_id if provided
    let departmentId = null
    if (department && department.trim()) {
      const deptName = department.trim()
      const existingDept = await query(
        `SELECT id FROM school_departments WHERE LOWER(name) = LOWER($1) AND platform_id = $2`,
        [deptName, platformId]
      )
      if (existingDept.rows.length > 0) {
        departmentId = existingDept.rows[0].id
      } else {
        const newDept = await query(
          `INSERT INTO school_departments (name, platform_id) VALUES ($1, $2) RETURNING id`,
          [deptName, platformId]
        )
        departmentId = newDept.rows[0].id
      }
    }
    
    const courseResult = await query(
      `INSERT INTO courses (code, name, description, credits, department_id, platform_id) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [code, name, description || null, credits ? parseInt(credits) : null, departmentId, platformId]
    )
    
    return res.status(201).json({ message: 'Course created successfully', courseId: courseResult.rows[0].id })
  } catch (error: any) {
    logError('Create course', error)
    if (error.message?.includes('courses_code_unique') || error.message?.includes('duplicate key')) {
      return res.status(400).json({ error: 'A course with this code already exists' })
    }
    const friendlyError = getUserFriendlyError(error, 'Failed to create course')
    return res.status(500).json({ error: friendlyError.error })
  }
})

// Update course
router.patch('/admin/school/courses/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    
    const { id } = req.params
    const { code, name, description, credits, department } = req.body
    
    const adminUserResult = await query(
      `SELECT u.platform_id FROM users u WHERE u.id = $1`, [req.user.userId]
    )
    if (adminUserResult.rows.length === 0) return res.status(403).json({ error: 'User not found' })
    const platformId = adminUserResult.rows[0].platform_id

    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'No entity assigned' })
    
    const updateFields: string[] = []
    const values: any[] = []
    let paramCount = 1
    
    if (code !== undefined) { updateFields.push(`code = $${paramCount++}`); values.push(code) }
    if (name !== undefined) { updateFields.push(`name = $${paramCount++}`); values.push(name) }
    if (description !== undefined) { updateFields.push(`description = $${paramCount++}`); values.push(description) }
    if (credits !== undefined) { updateFields.push(`credits = $${paramCount++}`); values.push(credits ? parseInt(credits) : null) }
    
    // Resolve department name if provided
    if (department !== undefined) {
      let departmentId = null
      if (department && department.trim()) {
        const deptName = department.trim()
        const existingDept = await query(
          `SELECT id FROM school_departments WHERE LOWER(name) = LOWER($1) AND platform_id = $2`,
          [deptName, platformId]
        )
        if (existingDept.rows.length > 0) {
          departmentId = existingDept.rows[0].id
        } else {
          const newDept = await query(
            `INSERT INTO school_departments (name, platform_id) VALUES ($1, $2) RETURNING id`,
            [deptName, platformId]
          )
          departmentId = newDept.rows[0].id
        }
      }
      updateFields.push(`department_id = $${paramCount++}`)
      values.push(departmentId)
    }
    
    if (updateFields.length > 0) {
      values.push(id)
      values.push(platformId)
      await query(
        `UPDATE courses SET ${updateFields.join(', ')} WHERE id = $${paramCount} AND platform_id = $${paramCount + 1}`,
        values
      )
    }
    
    return res.json({ message: 'Course updated successfully' })
  } catch (error: any) {
    logError('Update course', error)
    return res.status(500).json({ error: 'Failed to update course' })
  }
})

// Delete course
router.delete('/admin/school/courses/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    const { id } = req.params
    const adminUserResult = await query(`SELECT u.platform_id FROM users u WHERE u.id = $1`, [req.user.userId])
    if (adminUserResult.rows.length === 0) return res.status(403).json({ error: 'User not found' })
    const platformId = adminUserResult.rows[0].platform_id
    
    await query(`DELETE FROM courses WHERE id = $1 AND platform_id = $2`, [id, platformId])
    return res.json({ message: 'Course deleted successfully' })
  } catch (error: any) {
    logError('Delete course', error)
    if (error.message?.includes('foreign key constraint')) {
      return res.status(400).json({ error: 'Cannot delete this course because it has schedules assigned to it. Delete the schedules first.' })
    }
    return res.status(500).json({ error: 'Failed to delete course' })
  }
})

// ===========================
// SCHOOL ADMIN: Room Management
// ===========================

// Get rooms
router.get('/admin/school/rooms', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const adminUserResult = await query(
      `SELECT u.platform_id FROM users u WHERE u.id = $1`, [req.user.userId]
    )
    if (adminUserResult.rows.length === 0) return res.status(403).json({ error: 'User not found' })
    const platformId = adminUserResult.rows[0].platform_id

    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'No entity assigned' })
    
    const roomsResult = await query(
      `SELECT * FROM rooms WHERE platform_id = $1 ORDER BY building, room_number`,
      [platformId]
    )
    
    return res.json({ rooms: roomsResult.rows })
  } catch (error: any) {
    logError('Get rooms', error)
    return res.status(500).json({ error: 'Failed to load rooms' })
  }
})

// Create room
router.post('/admin/school/rooms', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const { building, roomNumber, capacity, floor, roomType } = req.body
    
    if (!roomNumber) {
      return res.status(400).json({ error: 'Room number is required' })
    }

    const adminUserResult = await query(
      `SELECT u.platform_id FROM users u WHERE u.id = $1`, [req.user.userId]
    )
    if (adminUserResult.rows.length === 0) return res.status(403).json({ error: 'User not found' })
    const platformId = adminUserResult.rows[0].platform_id

    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'No entity assigned' })
    
    const roomResult = await query(
      `INSERT INTO rooms (building, room_number, capacity, floor, room_type, platform_id) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [building || null, roomNumber, capacity ? parseInt(capacity) : null, floor || null, roomType || 'lecture_hall', platformId]
    )
    
    return res.status(201).json({ message: 'Room created successfully', roomId: roomResult.rows[0].id })
  } catch (error: any) {
    logError('Create room', error)
    if (error.message?.includes('rooms_room_number_key') || error.message?.includes('duplicate key')) {
      return res.status(400).json({ error: 'A room with this number already exists' })
    }
    return res.status(500).json({ error: 'Failed to create room' })
  }
})

// Update room
router.patch('/admin/school/rooms/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const { id } = req.params
    const { building, roomNumber, capacity, floor, roomType } = req.body
    
    const adminUserResult = await query(
      `SELECT u.platform_id FROM users u WHERE u.id = $1`, [req.user.userId]
    )
    if (adminUserResult.rows.length === 0) return res.status(403).json({ error: 'User not found' })
    const platformId = adminUserResult.rows[0].platform_id

    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'No entity assigned' })
    
    const updateFields: string[] = []
    const values: any[] = []
    let paramCount = 1
    
    if (building !== undefined) { updateFields.push(`building = $${paramCount++}`); values.push(building) }
    if (roomNumber !== undefined) { updateFields.push(`room_number = $${paramCount++}`); values.push(roomNumber) }
    if (capacity !== undefined) { updateFields.push(`capacity = $${paramCount++}`); values.push(capacity ? parseInt(capacity) : null) }
    if (floor !== undefined) { updateFields.push(`floor = $${paramCount++}`); values.push(floor) }
    if (roomType !== undefined) { updateFields.push(`room_type = $${paramCount++}`); values.push(roomType) }
    
    if (updateFields.length > 0) {
      values.push(id)
      values.push(platformId)
      await query(
        `UPDATE rooms SET ${updateFields.join(', ')} WHERE id = $${paramCount} AND platform_id = $${paramCount + 1}`,
        values
      )
    }
    
    return res.json({ message: 'Room updated successfully' })
  } catch (error: any) {
    logError('Update room', error)
    return res.status(500).json({ error: 'Failed to update room' })
  }
})

// Delete room
router.delete('/admin/school/rooms/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    const { id } = req.params
    const adminUserResult = await query(`SELECT u.platform_id FROM users u WHERE u.id = $1`, [req.user.userId])
    if (adminUserResult.rows.length === 0) return res.status(403).json({ error: 'User not found' })
    const platformId = adminUserResult.rows[0].platform_id
    
    await query(`DELETE FROM rooms WHERE id = $1 AND platform_id = $2`, [id, platformId])
    return res.json({ message: 'Room deleted successfully' })
  } catch (error: any) {
    logError('Delete room', error)
    if (error.message?.includes('foreign key constraint')) {
      return res.status(400).json({ error: 'Cannot delete this room because it has schedules assigned to it. Delete the schedules first.' })
    }
    return res.status(500).json({ error: 'Failed to delete room' })
  }
})

// ===========================
// SCHOOL ADMIN: Schedule Management
// ===========================

// Get schedules
router.get('/admin/school/schedules', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const adminUserResult = await query(
      `SELECT u.platform_id FROM users u WHERE u.id = $1`, [req.user.userId]
    )
    if (adminUserResult.rows.length === 0) return res.status(403).json({ error: 'User not found' })
    const platformId = adminUserResult.rows[0].platform_id

    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'No entity assigned' })
    
    const schedulesResult = await query(
      `SELECT cs.id, cs.course_id, cs.faculty_id, cs.room_id, cs.day_of_week, cs.days_of_week,
              cs.start_time, cs.end_time, cs.section,
              c.name as course_name, c.code as course_code, 
              r.building, r.room_number,
              CONCAT(f.first_name, ' ', COALESCE(f.middle_name || ' ', ''), f.last_name) as faculty_name
       FROM class_schedules cs
       JOIN courses c ON cs.course_id = c.id
       LEFT JOIN rooms r ON cs.room_id = r.id
       LEFT JOIN faculty f ON cs.faculty_id = f.id
       WHERE cs.platform_id = $1
       ORDER BY cs.day_of_week, cs.start_time`,
      [platformId]
    )
    
    return res.json({ schedules: schedulesResult.rows })
  } catch (error: any) {
    logError('Get schedules', error)
    return res.status(500).json({ error: 'Failed to load schedules' })
  }
})

// Create schedule
router.post('/admin/school/schedules', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const { courseId, facultyId, roomId, dayOfWeek, daysOfWeek, startTime, endTime } = req.body
    
    // Support both single day (dayOfWeek) and multiple days (daysOfWeek array)
    const days: number[] = daysOfWeek && Array.isArray(daysOfWeek) 
      ? daysOfWeek.map((d: any) => parseInt(d))
      : (dayOfWeek !== undefined ? [parseInt(dayOfWeek)] : [])

    if (!courseId || !facultyId || !roomId || days.length === 0 || !startTime || !endTime) {
      return res.status(400).json({ error: 'All schedule fields are required (including at least one day)' })
    }

    const adminUserResult = await query(
      `SELECT u.platform_id FROM users u WHERE u.id = $1`, [req.user.userId]
    )
    if (adminUserResult.rows.length === 0) return res.status(403).json({ error: 'User not found' })
    const platformId = adminUserResult.rows[0].platform_id

    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'No entity assigned' })

    // Validate that the faculty member exists
    const facultyCheck = await query(`SELECT id FROM faculty WHERE id = $1`, [facultyId])
    if (facultyCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Selected faculty member not found' })
    }

    // Validate course exists
    const courseCheck = await query(`SELECT id FROM courses WHERE id = $1`, [courseId])
    if (courseCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Selected course not found' })
    }

    // Validate room exists
    const roomCheck = await query(`SELECT id FROM rooms WHERE id = $1`, [roomId])
    if (roomCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Selected room not found' })
    }
    
    // Check for faculty time conflict: same faculty, overlapping day(s) and overlapping time
    const facultyConflict = await query(
      `SELECT cs.id, cs.days_of_week, cs.day_of_week, cs.start_time, cs.end_time, c.code as course_code
       FROM class_schedules cs
       JOIN courses c ON c.id = cs.course_id
       WHERE cs.faculty_id = $1 AND cs.platform_id = $2
         AND cs.start_time < $4 AND cs.end_time > $3`,
      [facultyId, platformId, startTime, endTime]
    )
    for (const row of facultyConflict.rows) {
      const existingDays: number[] = row.days_of_week
        ? row.days_of_week.split(',').map((d: string) => parseInt(d.trim()))
        : [row.day_of_week]
      const overlap = days.filter((d: number) => existingDays.includes(d))
      if (overlap.length > 0) {
        const DNAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
        const overlapNames = overlap.map((d: number) => DNAMES[d]).join(', ')
        return res.status(409).json({ error: `Faculty already has a schedule (${row.course_code}) on ${overlapNames} at ${row.start_time}â€“${row.end_time}. Time conflict.` })
      }
    }

    // Check for room time conflict: same room, overlapping day(s) and overlapping time
    const roomConflict = await query(
      `SELECT cs.id, cs.days_of_week, cs.day_of_week, cs.start_time, cs.end_time, c.code as course_code
       FROM class_schedules cs
       JOIN courses c ON c.id = cs.course_id
       WHERE cs.room_id = $1 AND cs.platform_id = $2
         AND cs.start_time < $4 AND cs.end_time > $3`,
      [roomId, platformId, startTime, endTime]
    )
    for (const row of roomConflict.rows) {
      const existingDays: number[] = row.days_of_week
        ? row.days_of_week.split(',').map((d: string) => parseInt(d.trim()))
        : [row.day_of_week]
      const overlap = days.filter((d: number) => existingDays.includes(d))
      if (overlap.length > 0) {
        const DNAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
        const overlapNames = overlap.map((d: number) => DNAMES[d]).join(', ')
        return res.status(409).json({ error: `Room is already booked for ${row.course_code} on ${overlapNames} at ${row.start_time}â€“${row.end_time}. Room conflict.` })
      }
    }

    // Auto-assign section number per course (max existing + 1)
    const sectionResult = await query(
      `SELECT COALESCE(MAX(section), 0) + 1 as next_section FROM class_schedules WHERE course_id = $1 AND platform_id = $2`,
      [courseId, platformId]
    )
    const nextSection = sectionResult.rows[0].next_section

    // Create a single schedule row with all days stored in days_of_week
    const daysStr = days.sort((a, b) => a - b).join(',')
    const scheduleResult = await query(
      `INSERT INTO class_schedules (course_id, faculty_id, room_id, day_of_week, days_of_week, start_time, end_time, platform_id, section) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, section`,
      [courseId, facultyId, roomId, days[0], daysStr, startTime, endTime, platformId, nextSection]
    )
    
    return res.status(201).json({ 
      message: `Schedule created successfully for ${days.length} day(s)`, 
      scheduleId: scheduleResult.rows[0].id 
    })
  } catch (error: any) {
    logError('Create schedule', error)
    return res.status(500).json({ error: 'Failed to create schedule' })
  }
})

// Update schedule
router.patch('/admin/school/schedules/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const { id } = req.params
    const { courseId, facultyId, roomId, dayOfWeek, daysOfWeek, startTime, endTime } = req.body
    
    const adminUserResult = await query(
      `SELECT u.platform_id FROM users u WHERE u.id = $1`, [req.user.userId]
    )
    if (adminUserResult.rows.length === 0) return res.status(403).json({ error: 'User not found' })
    const platformId = adminUserResult.rows[0].platform_id

    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'No entity assigned' })
    
    const updateFields: string[] = []
    const values: any[] = []
    let paramCount = 1
    
    if (courseId !== undefined) { updateFields.push(`course_id = $${paramCount++}`); values.push(courseId) }
    if (facultyId !== undefined) { updateFields.push(`faculty_id = $${paramCount++}`); values.push(facultyId) }
    if (roomId !== undefined) { updateFields.push(`room_id = $${paramCount++}`); values.push(roomId) }
    // Support both single dayOfWeek and daysOfWeek array
    const resolvedDays: number[] = daysOfWeek && Array.isArray(daysOfWeek) && daysOfWeek.length > 0
      ? daysOfWeek.map((d: any) => parseInt(d)).sort((a: number, b: number) => a - b)
      : (dayOfWeek !== undefined ? [parseInt(dayOfWeek)] : [])
    if (resolvedDays.length > 0) { 
      updateFields.push(`day_of_week = $${paramCount++}`); values.push(resolvedDays[0])
      updateFields.push(`days_of_week = $${paramCount++}`); values.push(resolvedDays.join(','))
    }
    if (startTime !== undefined) { updateFields.push(`start_time = $${paramCount++}`); values.push(startTime) }
    if (endTime !== undefined) { updateFields.push(`end_time = $${paramCount++}`); values.push(endTime) }

    // Determine effective values for conflict checks
    const existingSchedule = await query(`SELECT * FROM class_schedules WHERE id = $1 AND platform_id = $2`, [id, platformId])
    if (existingSchedule.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' })
    const existing = existingSchedule.rows[0]
    const effFaculty = facultyId ?? existing.faculty_id
    const effRoom = roomId ?? existing.room_id
    const effStart = startTime ?? existing.start_time
    const effEnd = endTime ?? existing.end_time
    const effDays: number[] = resolvedDays.length > 0
      ? resolvedDays
      : (existing.days_of_week ? existing.days_of_week.split(',').map((d: string) => parseInt(d.trim())) : [existing.day_of_week])

    // Faculty time conflict check (exclude self)
    const facultyConflict = await query(
      `SELECT cs.id, cs.days_of_week, cs.day_of_week, cs.start_time, cs.end_time, c.code as course_code
       FROM class_schedules cs
       JOIN courses c ON c.id = cs.course_id
       WHERE cs.faculty_id = $1 AND cs.platform_id = $2 AND cs.id != $3
         AND cs.start_time < $5 AND cs.end_time > $4`,
      [effFaculty, platformId, id, effStart, effEnd]
    )
    for (const row of facultyConflict.rows) {
      const existingDays: number[] = row.days_of_week
        ? row.days_of_week.split(',').map((d: string) => parseInt(d.trim()))
        : [row.day_of_week]
      const overlap = effDays.filter((d: number) => existingDays.includes(d))
      if (overlap.length > 0) {
        const DNAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
        const overlapNames = overlap.map((d: number) => DNAMES[d]).join(', ')
        return res.status(409).json({ error: `Faculty already has a schedule (${row.course_code}) on ${overlapNames} at ${row.start_time}â€“${row.end_time}. Time conflict.` })
      }
    }

    // Room time conflict check (exclude self)
    const roomConflict = await query(
      `SELECT cs.id, cs.days_of_week, cs.day_of_week, cs.start_time, cs.end_time, c.code as course_code
       FROM class_schedules cs
       JOIN courses c ON c.id = cs.course_id
       WHERE cs.room_id = $1 AND cs.platform_id = $2 AND cs.id != $3
         AND cs.start_time < $5 AND cs.end_time > $4`,
      [effRoom, platformId, id, effStart, effEnd]
    )
    for (const row of roomConflict.rows) {
      const existingDays: number[] = row.days_of_week
        ? row.days_of_week.split(',').map((d: string) => parseInt(d.trim()))
        : [row.day_of_week]
      const overlap = effDays.filter((d: number) => existingDays.includes(d))
      if (overlap.length > 0) {
        const DNAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
        const overlapNames = overlap.map((d: number) => DNAMES[d]).join(', ')
        return res.status(409).json({ error: `Room is already booked for ${row.course_code} on ${overlapNames} at ${row.start_time}â€“${row.end_time}. Room conflict.` })
      }
    }
    
    if (updateFields.length > 0) {
      values.push(id)
      values.push(platformId)
      await query(
        `UPDATE class_schedules SET ${updateFields.join(', ')} WHERE id = $${paramCount} AND platform_id = $${paramCount + 1}`,
        values
      )
    }
    
    return res.json({ message: 'Schedule updated successfully' })
  } catch (error: any) {
    logError('Update schedule', error)
    return res.status(500).json({ error: 'Failed to update schedule' })
  }
})

// Delete schedule
router.delete('/admin/school/schedules/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: ErrorMessages.AUTH_REQUIRED })
    const { id } = req.params
    const adminUserResult = await query(`SELECT u.platform_id FROM users u WHERE u.id = $1`, [req.user.userId])
    if (adminUserResult.rows.length === 0) return res.status(403).json({ error: 'User not found' })
    const platformId = adminUserResult.rows[0].platform_id
    
    await query(`DELETE FROM class_schedules WHERE id = $1 AND platform_id = $2`, [id, platformId])
    return res.json({ message: 'Schedule deleted successfully' })
  } catch (error: any) {
    logError('Delete schedule', error)
    return res.status(500).json({ error: 'Failed to delete schedule' })
  }
})

// ===========================
// SCHOOL ADMIN: Enrollment Management
// ===========================

// Get enrollments - create student_schedules table as junction table
router.get('/admin/school/enrollments', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'No entity assigned' })
    
    // First try to ensure table exists
    await query(`
      CREATE TABLE IF NOT EXISTS student_schedules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID NOT NULL REFERENCES students(id),
        schedule_id UUID NOT NULL REFERENCES class_schedules(id),
        status VARCHAR(50) DEFAULT 'enrolled',
        enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, schedule_id)
      )
    `)
    
    const enrollmentsResult = await query(
      `SELECT ss.*, s.first_name, s.middle_name, s.last_name, s.student_id as student_code, 
              c.name as course_name, c.code as course_code,
              cs.day_of_week, cs.days_of_week, cs.start_time, cs.end_time, cs.section,
              r.building, r.room_number,
              CONCAT(f.first_name, ' ', COALESCE(f.middle_name || ' ', ''), f.last_name) as faculty_name
       FROM student_schedules ss
       JOIN students s ON ss.student_id = s.id
       JOIN class_schedules cs ON ss.schedule_id = cs.id
       JOIN courses c ON cs.course_id = c.id
       LEFT JOIN rooms r ON cs.room_id = r.id
       LEFT JOIN faculty f ON cs.faculty_id = f.id
       JOIN school_user_associations sua ON s.user_id = sua.user_id
       WHERE sua.school_entity_id = $1
       ORDER BY c.code, cs.section, s.last_name, s.first_name`,
      [entityResult.rows[0].id]
    )
    
    return res.json({ enrollments: enrollmentsResult.rows })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to get enrollments' })
  }
})

// Enroll student in schedule
router.post('/admin/school/enrollments', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const { studentId, scheduleId } = req.body
    
    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'No entity assigned' })
    
    // Get the course_id for the target schedule
    const scheduleResult = await query(
      `SELECT cs.course_id, c.code as course_code, c.name as course_name, cs.section
       FROM class_schedules cs
       JOIN courses c ON c.id = cs.course_id
       WHERE cs.id = $1`,
      [scheduleId]
    )
    if (scheduleResult.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' })
    const { course_id, course_code, course_name, section } = scheduleResult.rows[0]

    // Check if student is already enrolled in ANY section of this course
    const duplicateCheck = await query(
      `SELECT ss.id, cs.section
       FROM student_schedules ss
       JOIN class_schedules cs ON cs.id = ss.schedule_id
       WHERE ss.student_id = $1 AND cs.course_id = $2`,
      [studentId, course_id]
    )
    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({ 
        error: `Student is already enrolled in ${course_code} (${course_name}) â€“ Section ${duplicateCheck.rows[0].section}` 
      })
    }

    const enrollmentResult = await query(
      `INSERT INTO student_schedules (student_id, schedule_id, status) 
       VALUES ($1, $2, 'enrolled') RETURNING id`,
      [studentId, scheduleId]
    )
    
    return res.json({ message: 'Student enrolled successfully', enrollmentId: enrollmentResult.rows[0].id })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to enroll student' })
  }
})

// Remove enrollment
router.delete('/admin/school/enrollments/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const { id } = req.params
    
    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'No entity assigned' })
    
    await query(`DELETE FROM student_schedules WHERE id = $1`, [id])
    
    return res.json({ message: 'Enrollment removed successfully' })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to remove enrollment' })
  }
})

// ===========================
// SCHOOL ADMIN: Attendance Overview
// ===========================

// Get attendance overview for admin dashboard
router.get('/admin/school/attendance/overview', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })

    const adminUserResult = await query(
      `SELECT u.platform_id FROM users u WHERE u.id = $1`, [req.user.userId]
    )
    if (adminUserResult.rows.length === 0) return res.status(403).json({ error: 'User not found' })
    const platformId = adminUserResult.rows[0].platform_id

    // Get per-schedule attendance stats for the last 7 days
    const overviewResult = await query(
      `SELECT
        cs.id as schedule_id,
        c.name as course_name,
        c.code as course_code,
        cs.section,
        cs.days_of_week,
        cs.start_time,
        cs.end_time,
        CONCAT(f.first_name, ' ', f.last_name) as faculty_name,
        (SELECT COUNT(*) FROM student_schedules ss WHERE ss.schedule_id = cs.id AND ss.status = 'enrolled') as enrolled_count,
        (SELECT COUNT(DISTINCT attendance_date) FROM school_attendance sa WHERE sa.schedule_id = cs.id) as sessions_taken,
        (SELECT COUNT(*) FROM school_attendance sa WHERE sa.schedule_id = cs.id AND sa.status = 'present') as total_present,
        (SELECT COUNT(*) FROM school_attendance sa WHERE sa.schedule_id = cs.id AND sa.status = 'absent') as total_absent,
        (SELECT COUNT(*) FROM school_attendance sa WHERE sa.schedule_id = cs.id AND sa.status = 'late') as total_late,
        (SELECT MAX(attendance_date) FROM school_attendance sa WHERE sa.schedule_id = cs.id) as last_attendance_date
       FROM class_schedules cs
       JOIN courses c ON cs.course_id = c.id
       LEFT JOIN faculty f ON cs.faculty_id = f.id
       WHERE cs.platform_id = $1
       ORDER BY c.name, cs.section`,
      [platformId]
    )

    return res.json(overviewResult.rows)
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to get attendance overview' })
  }
})

// ===========================
// SCHOOL ADMIN: Reports & Analytics
// ===========================

// Get attendance report with filters
router.get('/admin/school/reports/attendance', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const { startDate, endDate, scheduleId, facultyId, studentId, format } = req.query
    
    const entityResult = await query(`SELECT * FROM school_entities WHERE admin_user_id = $1`, [req.user.userId])
    if (entityResult.rows.length === 0) return res.status(403).json({ error: 'No entity assigned' })
    
    // Build dynamic query with filters
    let queryText = `
      SELECT sa.*, 
             s.first_name, s.last_name, s.student_id,
             c.name as course_name, c.code as course_code,
             cs.days_of_week, cs.section,
             CONCAT(f.first_name, ' ', f.last_name) as faculty_name
      FROM school_attendance sa
      JOIN students s ON sa.student_id = s.id
      JOIN class_schedules cs ON sa.schedule_id = cs.id
      JOIN courses c ON cs.course_id = c.id
      LEFT JOIN faculty f ON cs.faculty_id = f.id
      WHERE cs.platform_id = (SELECT platform_id FROM users WHERE id = $1)
    `
    
    const params: any[] = [req.user.userId]
    let paramCount = 2
    
    if (startDate) {
      queryText += ` AND sa.attendance_date >= $${paramCount++}`
      params.push(startDate)
    }
    if (endDate) {
      queryText += ` AND sa.attendance_date <= $${paramCount++}`
      params.push(endDate)
    }
    if (scheduleId) {
      queryText += ` AND sa.schedule_id = $${paramCount++}`
      params.push(scheduleId)
    }
    if (facultyId) {
      queryText += ` AND cs.faculty_id = $${paramCount++}`
      params.push(facultyId)
    }
    if (studentId) {
      queryText += ` AND sa.student_id = $${paramCount++}`
      params.push(studentId)
    }
    
    queryText += ` ORDER BY sa.attendance_date DESC, sa.marked_at DESC LIMIT 1000`
    
    const attendanceResult = await query(queryText, params)
    
    // If format is specified (xlsx or pdf), return data for export
    // Frontend will handle the actual file generation
    return res.json({ 
      records: attendanceResult.rows,
      totalRecords: attendanceResult.rows.length,
      filters: { startDate, endDate, scheduleId, facultyId, studentId }
    })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to get attendance report' })
  }
})

// ===========================
// SCHOOL ADMIN: Platform Settings
// ===========================

// Get platform settings
router.get('/admin/school/settings', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const adminUserResult = await query(
      `SELECT u.platform_id FROM users u WHERE u.id = $1`, [req.user.userId]
    )
    if (adminUserResult.rows.length === 0) return res.status(403).json({ error: 'User not found' })
    const platformId = adminUserResult.rows[0].platform_id

    const result = await query(
      `SELECT setting_key, setting_value FROM platform_settings WHERE platform_id = $1`,
      [platformId]
    )
    
    const settings: Record<string, string> = {}
    result.rows.forEach((row: any) => {
      settings[row.setting_key] = row.setting_value
    })
    
    return res.json({ settings })
  } catch (error: any) {
    logError('Get platform settings', error)
    return res.status(500).json({ error: 'Failed to get settings' })
  }
})

// Save platform setting
router.put('/admin/school/settings', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    
    const { key, value } = req.body
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Setting key and value are required' })
    }

    const adminUserResult = await query(
      `SELECT u.platform_id FROM users u WHERE u.id = $1`, [req.user.userId]
    )
    if (adminUserResult.rows.length === 0) return res.status(403).json({ error: 'User not found' })
    const platformId = adminUserResult.rows[0].platform_id

    await query(
      `INSERT INTO platform_settings (platform_id, setting_key, setting_value, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (platform_id, setting_key) DO UPDATE
       SET setting_value = $3, updated_at = NOW()`,
      [platformId, key, value.toString()]
    )
    
    return res.json({ message: 'Setting saved', key, value })
  } catch (error: any) {
    logError('Save platform setting', error)
    return res.status(500).json({ error: 'Failed to save setting' })
  }
})

export default router

