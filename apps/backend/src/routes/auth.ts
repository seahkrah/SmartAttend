import express, { Request, Response } from 'express'
import { query, getConnection } from '../db/connection.js'
import {
  loginUser,
  getUserWithRole,
  getUserByEmail,
  generateAccessToken,
  issueTokens,
  LoginError,
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
import { mfaSetupPending } from '../auth/mfaService.js'
import {
  resolveTenantContext,
  requireTenant,
  requirePlatform,
  requireRoles,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import { ErrorMessages, getUserFriendlyError, logError } from '../utils/errorMessages.js'
import { getClientIp } from '../utils/getClientIp.js'
import { rotateSession, revokeSession, revokeUserSessions, SessionError } from '../auth/sessions.js'
import { checkPassword } from '../auth/passwordPolicy.js'
import { requestPasswordReset, redeemToken, AccountTokenError } from '../auth/accountTokens.js'
import { loginLimiter, refreshLimiter, accountLimiter } from '../security/httpSecurity.js'
import crypto from 'crypto'

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

router.post('/register-with-role', accountLimiter, async (req: RoleBasedRegisterRequest, res: Response) => {
  try {
    const { platform, email, fullName, password, confirmPassword, phone, role, entityId } = req.body

    // Validation
    if (!platform || !email || !fullName || !password || !confirmPassword || !role || !entityId) {
      return res.status(400).json({ error: ErrorMessages.VALIDATION_MISSING_FIELDS })
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: ErrorMessages.VALIDATION_PASSWORD_MISMATCH })
    }

    const problems = checkPassword(password, { email, name: fullName })
    if (problems.length > 0) {
      return res.status(400).json({ error: 'Choose a stronger password', problems })
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

// The legacy POST /register created an active account with whatever role id
// the client sent and no tenant. Nothing called it; it is gone. Self-service
// sign-up is /register-with-role, which always waits for an administrator.

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

function sessionMeta(req: Request) {
  return { ip: getClientIp(req), userAgent: String(req.headers['user-agent'] ?? '') }
}

/** The answer to a refused sign-in. Only `invalid` and `locked` precede a correct password. */
function loginRefusal(res: Response, error: unknown) {
  if (error instanceof LoginError) {
    switch (error.code) {
      case 'locked':
        res.setHeader('Retry-After', String(error.extra.retryAfter ?? 900))
        return res.status(429).json({ error: error.message, code: 'LOGIN_LOCKED', retryAfter: error.extra.retryAfter })
      case 'platform_mismatch': {
        const correctPlatform = String(error.extra.correctPlatform ?? 'other')
        return res.status(401).json({
          error: `Your account is registered under the ${correctPlatform} platform. Please select "${correctPlatform}" and try again.`,
          code: 'PLATFORM_MISMATCH',
          correctPlatform: correctPlatform.toLowerCase(),
        })
      }
      case 'invalid':
        return res.status(401).json({ error: ErrorMessages.AUTH_INVALID_CREDENTIALS })
      default:
        return res.status(403).json({ error: error.message, code: error.code.toUpperCase() })
    }
  }
  logError('Login', error)
  return res.status(500).json({ error: 'Sign-in failed. Please try again.' })
}

router.post('/login', loginLimiter, async (req: LoginRequest, res: Response) => {
  try {
    const { platform, email, password } = req.body

    // Validation
    if (!platform || !email || !password || typeof email !== 'string' || typeof password !== 'string') {
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

    const signIn = await loginUser(email, password, platformId, sessionMeta(req))
    if ('mfaToken' in signIn) {
      return res.json({ mfaRequired: true, mfaToken: signIn.mfaToken })
    }
    const { user, accessToken, refreshToken } = signIn

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
        platform: (user as any).platform_name ?? platform,
        role: roleInfo.name,
        permissions: roleInfo.permissions || [],
        profileImage: user.profile_image_url,
        mustResetPassword: (user as any).must_reset_password || false
      },
      accessToken,
      refreshToken
    })
  } catch (error: any) {
    return loginRefusal(res, error)
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
    
    const userResult = await query(
      `SELECT password_hash, email, full_name FROM users WHERE id = $1`,
      [req.user.userId]
    )
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    const user = userResult.rows[0]

    const problems = checkPassword(newPassword, { email: user.email, name: user.full_name })
    if (problems.length > 0) {
      return res.status(400).json({ error: 'Choose a stronger password', problems })
    }
    
    // Verify current password
    const isValidPassword = await verifyPassword(currentPassword, user.password_hash)
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' })
    }
    if (await verifyPassword(newPassword, user.password_hash)) {
      return res.status(400).json({ error: 'The new password must differ from the current one' })
    }
    
    const newPasswordHash = await hashPassword(newPassword)
    await query(
      `UPDATE users SET password_hash = $1, must_reset_password = false,
              password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2`,
      [newPasswordHash, req.user.userId]
    )
    // Whoever knew the old password may be signed in elsewhere. This device
    // stays signed in; every other session ends.
    const ended = await revokeUserSessions(req.user.userId, 'password_changed', req.user.sessionId)
    
    return res.json({ message: 'Password changed successfully', otherSessionsEnded: ended })
  } catch (error: any) {
    logError('Change password', error)
    return res.status(500).json({ error: 'Failed to change password' })
  }
})

// ===========================
// PASSWORD RESET AND ACCOUNT ACTIVATION
// ===========================

/**
 * Starts a password reset. Always answers 202 with the same words, whether
 * or not the address has an account, so this cannot be used to discover who
 * has one.
 */
router.post('/password/forgot', accountLimiter, async (req: Request, res: Response) => {
  const { email, platform } = req.body ?? {}
  if (typeof email !== 'string' || !email.includes('@') || email.length > 255 ||
      !['school', 'corporate'].includes(platform)) {
    return res.status(400).json({ error: 'Enter your email address and choose your platform' })
  }
  // The work happens after the answer is sent, so neither the answer nor how
  // long it takes depends on whether the account exists. Errors are logged,
  // not reported, for the same reason.
  query(`SELECT id FROM platforms WHERE name = $1`, [platform])
    .then((p) => (p.rows.length > 0 ? requestPasswordReset(email, p.rows[0].id) : undefined))
    .catch((error) => logError('Password reset request', error))
  return res.status(202).json({
    message: 'If an account uses that address, we have sent it a link to reset the password. The link works for 30 minutes.',
  })
})

function tokenRefusal(res: Response, error: unknown) {
  if (error instanceof AccountTokenError) {
    return res.status(error.status).json({ error: error.message, problems: error.problems })
  }
  logError('Account token', error)
  return res.status(500).json({ error: 'Something went wrong. Please try again.' })
}

router.post('/password/reset', accountLimiter, async (req: Request, res: Response) => {
  const { token, password, confirmPassword } = req.body ?? {}
  if (typeof password !== 'string' || password !== confirmPassword) {
    return res.status(400).json({ error: 'The passwords do not match' })
  }
  try {
    await redeemToken('password_reset', token, password)
    return res.json({ message: 'Your password has been changed. Sign in with the new one.' })
  } catch (error) {
    return tokenRefusal(res, error)
  }
})

router.post('/activate', accountLimiter, async (req: Request, res: Response) => {
  const { token, password, confirmPassword } = req.body ?? {}
  if (typeof password !== 'string' || password !== confirmPassword) {
    return res.status(400).json({ error: 'The passwords do not match' })
  }
  try {
    await redeemToken('account_activation', token, password)
    return res.json({ message: 'Your account is ready. Sign in with the password you chose.' })
  } catch (error) {
    return tokenRefusal(res, error)
  }
})

// ===========================
// SESSIONS
// ===========================

/** The caller's own signed-in devices. */
router.get('/sessions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT id, created_at, last_used_at, expires_at, created_ip, user_agent
         FROM auth_sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
        ORDER BY last_used_at DESC`,
      [req.user!.userId]
    )
    return res.json({
      sessions: r.rows.map((s: any) => ({
        id: s.id,
        createdAt: s.created_at,
        lastUsedAt: s.last_used_at,
        expiresAt: s.expires_at,
        ip: s.created_ip,
        userAgent: s.user_agent,
        current: s.id === req.user!.sessionId,
      })),
    })
  } catch (error) {
    logError('List sessions', error)
    return res.status(500).json({ error: 'Failed to load sessions' })
  }
})

/** Signs out one of the caller's own devices. Another user's session reads as missing. */
router.delete('/sessions/:sessionId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const r = await query(
      `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'signed_out_by_user'
        WHERE id::text = $1 AND user_id = $2 AND revoked_at IS NULL
        RETURNING id`,
      [req.params.sessionId, req.user!.userId]
    )
    if (r.rows.length === 0) return res.status(404).json({ error: 'Session not found' })
    return res.json({ message: 'Signed out of that device' })
  } catch (error) {
    logError('Revoke session', error)
    return res.status(500).json({ error: 'Failed to sign out that device' })
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
router.post('/register-superadmin', accountLimiter, async (req: SuperadminRegisterRequest, res: Response) => {
  try {
    const { email, fullName, password, confirmPassword } = req.body

    // Validation
    if (!email || !fullName || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' })
    }

    const problems = checkPassword(password, { email, name: fullName })
    if (problems.length > 0) {
      return res.status(400).json({ error: 'Choose a stronger password', problems })
    }

    // SECURITY GATE: Check if any superadmin already exists
    const anySuperadminResult = await query(
      `SELECT COUNT(*) as cnt FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name = 'superadmin'`
    )
    const superadminCount = parseInt(anySuperadminResult.rows[0].cnt, 10)

    // In production the bootstrap token is always required: otherwise whoever
    // reaches a fresh deployment first becomes its superadmin. Elsewhere the
    // first superadmin may be created without it.
    if (superadminCount > 0 || process.env.NODE_ENV === 'production') {
      const bootstrapToken = process.env.SUPERADMIN_BOOTSTRAP_TOKEN
      const providedToken = req.headers['x-bootstrap-token']

      const matches = typeof bootstrapToken === 'string' && bootstrapToken.length >= 32 &&
        typeof providedToken === 'string' &&
        crypto.timingSafeEqual(
          crypto.createHash('sha256').update(providedToken).digest(),
          crypto.createHash('sha256').update(bootstrapToken).digest()
        )
      if (!matches) {
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

router.post('/login-superadmin', loginLimiter, async (req: SuperadminLoginRequest, res: Response) => {
  try {
    const { email, password } = req.body

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const platformResult = await query(`SELECT id FROM platforms WHERE name = 'system'`)
    if (platformResult.rows.length === 0) {
      return res.status(500).json({ error: 'System platform not configured' })
    }

    // Same checks, throttling and lockout as every other sign-in. Only a
    // platform superadmin gets through: anyone else's correct password on
    // this page reads as a wrong one.
    const signIn =
      await loginUser(email, password, platformResult.rows[0].id, sessionMeta(req)).catch((e) => {
        if (e instanceof LoginError && e.code === 'platform_mismatch') {
          throw new LoginError('invalid', 'Invalid email or password')
        }
        throw e
      })
    const u: any = signIn.user
    if (u.role_name !== 'superadmin' || u.platform_name !== 'system') {
      return res.status(401).json({ error: ErrorMessages.AUTH_INVALID_CREDENTIALS })
    }
    if ('mfaToken' in signIn) {
      return res.json({ mfaRequired: true, mfaToken: signIn.mfaToken })
    }
    const { accessToken, refreshToken } = signIn

    return res.json({
      message: 'Superadmin login successful',
      user: {
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        role: u.role_name,
        permissions: u.permissions || []
      },
      accessToken,
      refreshToken
    })
  } catch (error: any) {
    return loginRefusal(res, error)
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

/**
 * Exchanges a refresh token for a new access token and a new refresh token.
 * The old refresh token stops working. A browser with two tabs refreshing at
 * once gets 409 on the slower one and should retry with the token the faster
 * one stored.
 */
router.post('/refresh', refreshLimiter, async (req: RefreshRequest, res: Response) => {
  try {
    const { refreshToken } = req.body ?? {}

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' })
    }

    const rotated = await rotateSession(refreshToken)
    const userResult = await query(
      `SELECT id, platform_id, role_id FROM users WHERE id = $1 AND is_active = TRUE`,
      [rotated.userId]
    )
    if (userResult.rows.length === 0) {
      await revokeSession(rotated.sessionId, 'account_inactive')
      return res.status(401).json({ error: 'Your session has ended. Please sign in again.', code: 'SESSION_ENDED' })
    }
    const user = userResult.rows[0]

    return res.json({
      message: 'Token refreshed successfully',
      accessToken: generateAccessToken(user.id, user.platform_id, user.role_id, rotated.sessionId,
        await mfaSetupPending(user.id, user.role_id)),
      refreshToken: rotated.refreshToken,
    })
  } catch (error: any) {
    if (error instanceof SessionError && error.code === 'race') {
      return res.status(409).json({ error: error.message, code: 'REFRESH_RACE' })
    }
    if (error instanceof SessionError) {
      return res.status(401).json({ error: 'Your session has ended. Please sign in again.', code: 'SESSION_ENDED' })
    }
    logError('Refresh', error)
    return res.status(500).json({ error: 'Failed to refresh the session' })
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
// LOGOUT
// ===========================

/** Ends this session on the server; its access and refresh tokens stop working at once. */
router.post('/logout', authenticateToken, async (req: Request, res: Response) => {
  try {
    await revokeSession(req.user!.sessionId!, 'logout')
    return res.json({ message: 'Logout successful' })
  } catch (error) {
    logError('Logout', error)
    return res.status(500).json({ error: 'Logout failed' })
  }
})

/** Ends every session of the caller's, this one included. */
router.post('/logout-all', authenticateToken, async (req: Request, res: Response) => {
  try {
    const ended = await revokeUserSessions(req.user!.userId, 'logout_all')
    return res.json({ message: 'Signed out everywhere', sessionsEnded: ended })
  } catch (error) {
    logError('Logout all', error)
    return res.status(500).json({ error: 'Logout failed' })
  }
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

