import express, { Request, Response } from 'express'
import { query } from '../db/connection.js'
import {
  registerUser,
  loginUser,
  getUserWithRole,
  getUserByEmail,
  generateAccessToken,
  verifyRefreshToken,
  registerUserWithRole,
  getPendingApprovalsForAdmin,
  approveOrRejectRegistration
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

export default router
