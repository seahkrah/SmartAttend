import express, { Request, Response } from 'express'
import { query } from '../db/connection.js'
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
      return res.status(400).json({ error: 'Missing required fields' })
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' })
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' })
    }

    // Validate role for platform
    const validSchoolRoles = ['student', 'faculty', 'it']
    const validCorporateRoles = ['employee', 'it', 'hr']
    
    if (platform === 'school' && !validSchoolRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role for school platform' })
    }

    if (platform === 'corporate' && !validCorporateRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role for corporate platform' })
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
        return res.status(400).json({ error: 'School entity not found' })
      }
    } else {
      const corporateResult = await query(
        `SELECT id FROM corporate_entities WHERE id = $1 AND is_active = true`,
        [entityId]
      )
      if (corporateResult.rows.length === 0) {
        return res.status(400).json({ error: 'Corporate entity not found' })
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
    console.error('Role-based registration error:', error)
    return res.status(400).json({ error: error.message || 'Registration failed' })
  }
})

// ===========================
// ADMIN APPROVAL ENDPOINTS
// ===========================

// Get pending approvals for logged-in admin
router.get('/admin/pending-approvals', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    // Check if user is admin
    const userResult = await query(
      `SELECT u.*, r.name as role_name FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [req.user.userId]
    )

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' })
    }

    const user = userResult.rows[0]

    // Get platform name
    const platformResult = await query(
      `SELECT name FROM platforms WHERE id = $1`,
      [user.platform_id]
    )

    if (platformResult.rows.length === 0) {
      return res.status(400).json({ error: 'Platform not found' })
    }

    const platformName = platformResult.rows[0].name

    // Check if user is admin of any entity
    if (platformName === 'school') {
      const schoolAdminCheck = await query(
        `SELECT id FROM school_entities WHERE admin_user_id = $1`,
        [req.user.userId]
      )
      if (schoolAdminCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Not authorized to approve registrations' })
      }
    } else if (platformName === 'corporate') {
      const corporateAdminCheck = await query(
        `SELECT id FROM corporate_entities WHERE admin_user_id = $1`,
        [req.user.userId]
      )
      if (corporateAdminCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Not authorized to approve registrations' })
      }
    }

    // Get pending approvals
    const approvals = await getPendingApprovalsForAdmin(req.user.userId, user.platform_id)

    return res.json({
      platform: platformName,
      approvals
    })
  } catch (error: any) {
    console.error('Get approvals error:', error)
    return res.status(500).json({ error: error.message || 'Failed to get approvals' })
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
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const { approvalId, action, rejectionReason } = req.body

    if (!approvalId || !action) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' })
    }

    // Get user's platform
    const userResult = await query(
      `SELECT platform_id FROM users WHERE id = $1`,
      [req.user.userId]
    )

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' })
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
    console.error('Approval action error:', error)
    return res.status(400).json({ error: error.message || 'Action failed' })
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
      return res.status(400).json({ error: 'Missing required fields' })
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' })
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' })
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
        return res.status(500).json({ error: 'Default role not configured' })
      }

      roleId = roleResult.rows[0].id
    }

    // Check if email already exists
    const existingUser = await getUserByEmail(email, platformId)
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' })
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
    console.error('Registration error:', error)
    return res.status(500).json({ error: error.message || 'Registration failed' })
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
      return res.status(400).json({ error: 'Missing required fields' })
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
        profileImage: user.profile_image_url
      },
      accessToken,
      refreshToken
    })
  } catch (error: any) {
    console.error('Login error:', error)
    return res.status(401).json({ error: error.message || 'Login failed' })
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

// Test endpoint to verify route works
router.post('/register-superadmin-test', (req: Request, res: Response) => {
  console.log('[TEST] This is a test endpoint');
  return res.status(200).json({ message: 'Test endpoint works' });
});

router.post('/register-superadmin', async (req: SuperadminRegisterRequest, res: Response) => {
  try {
    console.log('[SUPERADMIN] Request body:', req.body);
    
    const { email, fullName, password, confirmPassword } = req.body

    console.log('[SUPERADMIN REGISTER] Request received:', { email, fullName });

    // Validation
    if (!email || !fullName || !password || !confirmPassword) {
      console.log('[SUPERADMIN REGISTER] Missing required fields');
      return res.status(400).json({ error: 'Missing required fields' })
    }

    if (password !== confirmPassword) {
      console.log('[SUPERADMIN REGISTER] Passwords do not match');
      return res.status(400).json({ error: 'Passwords do not match' })
    }

    if (password.length < 6) {
      console.log('[SUPERADMIN REGISTER] Password too short');
      return res.status(400).json({ error: 'Password must be at least 6 characters' })
    }

    console.log('[SUPERADMIN REGISTER] Validation passed, checking existing superadmin...');

    // Check if superadmin already exists
    const existingResult = await query(
      `SELECT id FROM users WHERE email = $1 AND role_id IN (
        SELECT id FROM roles WHERE name = 'superadmin'
      )`,
      [email]
    )

    if (existingResult.rows.length > 0) {
      console.log('[SUPERADMIN REGISTER] Superadmin already exists');
      return res.status(409).json({ error: 'Superadmin account already exists' })
    }

    // Check if email exists as regular user
    const emailCheckResult = await query(
      `SELECT id FROM users WHERE email = $1`,
      [email]
    )

    if (emailCheckResult.rows.length > 0) {
      console.log('[SUPERADMIN REGISTER] Email already registered');
      return res.status(409).json({ error: 'This email is already registered' })
    }

    console.log('[SUPERADMIN REGISTER] Getting system platform...');

    // Get system platform
    const platformResult = await query(
      `SELECT id FROM platforms WHERE name = 'system'`
    )

    if (platformResult.rows.length === 0) {
      console.log('[SUPERADMIN REGISTER] System platform not found');
      return res.status(500).json({ error: 'System platform not configured' })
    }

    const systemPlatformId = platformResult.rows[0].id
    console.log('[SUPERADMIN REGISTER] System platform ID:', systemPlatformId);

    // Get superadmin role
    const roleResult = await query(
      `SELECT id FROM roles WHERE name = 'superadmin' AND platform_id = $1`,
      [systemPlatformId]
    )

    if (roleResult.rows.length === 0) {
      console.log('[SUPERADMIN REGISTER] Superadmin role not found');
      return res.status(500).json({ error: 'Superadmin role not configured' })
    }

    const superadminRoleId = roleResult.rows[0].id
    console.log('[SUPERADMIN REGISTER] Superadmin role ID:', superadminRoleId);

    console.log('[SUPERADMIN REGISTER] Hashing password...');
    // Hash password
    const hashedPassword = await hashPassword(password)
    console.log('[SUPERADMIN REGISTER] Password hashed, creating user...');

    // Create superadmin user
    const userResult = await query(
      `INSERT INTO users (platform_id, email, full_name, role_id, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, email, full_name`,
      [systemPlatformId, email, fullName, superadminRoleId, hashedPassword]
    )

    console.log('[SUPERADMIN REGISTER] User created:', userResult.rows[0]);

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
    console.error('[SUPERADMIN REGISTER] Error:', error)
    return res.status(500).json({ error: error.message || 'Registration failed' })
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

    console.log('[SUPERADMIN LOGIN] Request received:', { email })

    // Validation
    if (!email || !password) {
      console.log('[SUPERADMIN LOGIN] Missing required fields')
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Get system platform
    const platformResult = await query(
      `SELECT id FROM platforms WHERE name = 'system'`
    )

    if (platformResult.rows.length === 0) {
      console.log('[SUPERADMIN LOGIN] System platform not found')
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
      console.log('[SUPERADMIN LOGIN] Superadmin not found or inactive')
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const user = userResult.rows[0]

    // Verify password
    const isValidPassword = await verifyPassword(password, user.password_hash)
    if (!isValidPassword) {
      console.log('[SUPERADMIN LOGIN] Invalid password')
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    console.log('[SUPERADMIN LOGIN] Password verified, generating tokens...')

    // Generate tokens
    const accessToken = generateAccessToken(user.id, user.platform_id, user.role_id)
    const refreshToken = generateRefreshToken(user.id)

    // Update last_login
    await query(
      `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`,
      [user.id]
    )

    console.log('[SUPERADMIN LOGIN] Tokens generated, login successful')

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
    console.error('[SUPERADMIN LOGIN] Error:', error)
    return res.status(500).json({ error: error.message || 'Login failed' })
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
    console.error('Refresh error:', error)
    return res.status(403).json({ error: error.message || 'Invalid refresh token' })
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

    const platformName = platformResult.rows[0].name

    return res.json({
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
        lastLogin: user.last_login
      }
    })
  } catch (error: any) {
    console.error('Get user error:', error)
    return res.status(500).json({ error: error.message || 'Failed to get user' })
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
    return res.status(500).json({ error: error.message || 'Authorization error' })
  }
}

// GET comprehensive superadmin dashboard (all data in one call)
router.get('/superadmin/dashboard', authenticateToken, verifySuperadmin, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId

    console.log('[SUPERADMIN DASHBOARD] Fetching comprehensive dashboard data for user:', userId)

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
      req.ip
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
    console.error('[SUPERADMIN DASHBOARD] Error:', error)
    return res.status(500).json({ error: error.message || 'Failed to fetch dashboard data' })
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
      req.ip
    )

    return res.json({ stats })
  } catch (error: any) {
    console.error('Get dashboard stats error:', error)
    return res.status(500).json({ error: error.message || 'Failed to get dashboard stats' })
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
      req.ip
    )

    return res.json(entities)
  } catch (error: any) {
    console.error('Get entities error:', error)
    return res.status(500).json({ error: error.message || 'Failed to get entities' })
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
      req.ip
    )

    return res.json({ approvals, count: approvals.length })
  } catch (error: any) {
    console.error('Get pending approvals error:', error)
    return res.status(500).json({ error: error.message || 'Failed to get pending approvals' })
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
    console.error('Get action logs error:', error)
    return res.status(500).json({ error: error.message || 'Failed to get action logs' })
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
      req.ip
    )

    return res.json({ stats })
  } catch (error: any) {
    console.error('Get user statistics error:', error)
    return res.status(500).json({ error: error.message || 'Failed to get user statistics' })
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
      req.ip
    )

    return res.json({ users })
  } catch (error: any) {
    console.error('Get entity users error:', error)
    return res.status(500).json({ error: error.message || 'Failed to get entity users' })
  }
})

export default router
