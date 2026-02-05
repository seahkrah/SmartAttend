/**
 * Superadmin Bootstrap & Management Routes
 * 
 * Endpoints for:
 * 1. Bootstrap mode (development only) - initialize superadmin system
 * 2. Operational endpoints (authenticated) - manage superadmin accounts and operations
 * 
 * All operational endpoints require:
 * - Authentication (valid JWT)
 * - Superadmin role verification
 * - Audit logging
 * - Environment-based controls
 */

import express, { Request, Response } from 'express'
import { authenticateToken } from '../auth/middleware.js'
import { auditContextMiddleware } from '../auth/auditContextMiddleware.js'
import { extractAuditContext, logAuditEntry, updateAuditEntry } from '../services/auditService.js'
import {
  bootstrapSuperadmin,
  createSuperadminAccount,
  deleteSuperadminAccount,
  resetSuperadminPassword,
  isBootstrapModeAvailable,
  SuperadminBootstrapResult,
  SuperadminOperationResult
} from '../services/superadminService.js'
import { config } from '../config/environment.js'
import { query } from '../db/connection.js'
import crypto from 'crypto'

const router = express.Router()

// Apply audit context middleware to all routes
router.use(auditContextMiddleware)

/**
 * Middleware: Verify superadmin access
 * Applied to all operational endpoints
 */
async function verifySuperadmin(req: Request, res: Response, next: Function) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    // Check if user has superadmin role
    const roleCheck = await query(
      `SELECT r.name FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1 AND r.name = 'superadmin'`,
      [req.user.userId]
    )

    if (roleCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Superadmin access required' })
    }

    next()
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Authorization error' })
  }
}

/**
 * Middleware: Verify bootstrap is available
 * Checks environment and enables bootstrap only in development
 */
function verifyBootstrapAvailable(req: Request, res: Response, next: Function) {
  if (!isBootstrapModeAvailable()) {
    return res.status(403).json({
      error: 'Bootstrap mode not available',
      details: `Bootstrap is only available in development environment. Current: ${config.nodeEnv}`,
      environment: config.nodeEnv
    })
  }
  next()
}

// ===========================
// BOOTSTRAP ENDPOINTS
// Development only - Initialize superadmin system
// ===========================

/**
 * POST /api/superadmin/bootstrap
 * 
 * Bootstrap the superadmin system (development only)
 * 
 * Creates:
 * - System platform
 * - Superadmin role
 * - Initial superadmin user account
 * - Required database tables and indexes
 * - Database views
 * 
 * Security:
 * - Only available in development environment
 * - Returns default credentials that MUST be changed before production
 */
router.post('/bootstrap', verifyBootstrapAvailable, async (req: Request, res: Response) => {
  try {
    console.log('[API] Bootstrap request received')
    console.log(`[ENVIRONMENT] NODE_ENV: ${config.nodeEnv}`)

    const result: SuperadminBootstrapResult = await bootstrapSuperadmin()

    return res.status(201).json({
      success: true,
      message: 'Superadmin system bootstrapped successfully',
      data: {
        systemPlatformId: result.systemPlatformId,
        superadminRoleId: result.superadminRoleId,
        superadminUserId: result.superadminUserId,
        email: result.email,
        password: result.password,
        passwordExpires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      },
      warning: 'IMPORTANT: This is a default account for development only. Change the password immediately before production use.'
    })
  } catch (error: any) {
    console.error('[API] Bootstrap failed:', error.message)
    return res.status(500).json({
      error: 'Bootstrap failed',
      details: error.message,
      environment: config.nodeEnv
    })
  }
})

/**
 * GET /api/superadmin/bootstrap/status
 * Check if bootstrap mode is available
 */
router.get('/bootstrap/status', async (req: Request, res: Response) => {
  return res.json({
    bootstrapAvailable: isBootstrapModeAvailable(),
    environment: config.nodeEnv,
    message: isBootstrapModeAvailable()
      ? 'Bootstrap mode is available in development'
      : `Bootstrap is not available in ${config.nodeEnv} environment`
  })
})

// ===========================
// OPERATIONAL ENDPOINTS
// Authenticated - Manage superadmin accounts and operations
// ===========================

/**
 * POST /api/superadmin/accounts
 * 
 * Create a new superadmin account (authenticated + superadmin role required)
 * 
 * Features:
 * - Generates secure random password
 * - Fully audited operation
 * - Returns temporary password (must be changed on first login)
 */
interface CreateAccountRequest extends Request {
  body: {
    email: string
    fullName: string
  }
}

router.post('/accounts', authenticateToken, verifySuperadmin, async (req: CreateAccountRequest, res: Response) => {
  const { email, fullName } = req.body
  let auditId: string | undefined

  try {
    if (!email || !fullName) {
      return res.status(400).json({ error: 'Email and fullName are required' })
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' })
    }

    // Create audit context
    const auditContext = extractAuditContext(req, 'CREATE_SUPERADMIN_ACCOUNT', 'SYSTEM')
    auditContext.targetEntityType = 'SUPERADMIN_USER'
    auditContext.justification = `Create superadmin account for ${email}`

    // Log audit entry first (before operation)
    try {
      auditId = await logAuditEntry(auditContext)
    } catch (auditError) {
      console.warn('[AUDIT] Non-critical audit logging failed:', auditError)
      auditId = undefined
    }

    try {
      const result: SuperadminOperationResult = await createSuperadminAccount(
        req.user!.userId,
        email,
        fullName,
        req.ip || 'unknown',
        auditId || 'unknown'
      )

      // Update audit entry with success
      if (auditId) {
        await updateAuditEntry(auditId, 'SUCCESS', undefined, {
          createdUserId: result.details.userId,
          email: result.details.email
        })
      }

      return res.status(201).json({
        success: true,
        message: 'Superadmin account created',
        data: {
          userId: result.details.userId,
          email: result.details.email,
          fullName: result.details.fullName,
          temporaryPassword: result.details.password,
          passwordExpires: result.details.passwordExpires,
          mustChangePasswordOnFirstLogin: true
        },
        warning: 'Share the temporary password securely. User must change it on first login.'
      })
    } catch (opError: any) {
      // Update audit entry with failure
      if (auditId) {
        await updateAuditEntry(auditId, 'FAILURE', undefined, undefined, opError.message)
      }
      throw opError
    }
  } catch (error: any) {
    console.error('[API] Failed to create superadmin account:', error.message)
    return res.status(500).json({
      error: 'Failed to create superadmin account',
      details: error.message
    })
  }
})

/**
 * DELETE /api/superadmin/accounts/:userId
 * 
 * Delete a superadmin account (authenticated + superadmin role required)
 * 
 * Features:
 * - Prevents self-deletion
 * - Fully audited with reason tracking
 * - Cascades deletion to related records
 */
interface DeleteAccountRequest extends Request {
  body: {
    reason: string
  }
  params: {
    userId: string
  }
}

router.delete('/accounts/:userId', authenticateToken, verifySuperadmin, async (req: DeleteAccountRequest, res: Response) => {
  const { userId } = req.params
  const { reason } = req.body
  let auditId: string | undefined

  try {
    if (!reason) {
      return res.status(400).json({ error: 'Reason for deletion is required' })
    }

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' })
    }

    // Prevent self-deletion at API level
    if (req.user!.userId === userId) {
      return res.status(400).json({ error: 'Cannot delete your own superadmin account' })
    }

    // Create audit context
    const auditContext = extractAuditContext(req, 'DELETE_SUPERADMIN_ACCOUNT', 'SYSTEM')
    auditContext.targetEntityType = 'SUPERADMIN_USER'
    auditContext.targetEntityId = userId
    auditContext.justification = reason

    // Log audit entry first (before operation)
    try {
      auditId = await logAuditEntry(auditContext)
    } catch (auditError) {
      console.warn('[AUDIT] Non-critical audit logging failed:', auditError)
      auditId = undefined
    }

    try {
      const result: SuperadminOperationResult = await deleteSuperadminAccount(
        req.user!.userId,
        userId,
        reason,
        req.ip || 'unknown',
        auditId || 'unknown'
      )

      // Update audit entry with success
      if (auditId) {
        await updateAuditEntry(auditId, 'SUCCESS', undefined, {
          deletedUserId: result.details.deletedUserId,
          deletedEmail: result.details.deletedEmail
        })
      }

      return res.status(200).json({
        success: true,
        message: 'Superadmin account deleted',
        data: {
          deletedUserId: result.details.deletedUserId,
          deletedEmail: result.details.deletedEmail,
          reason: result.details.reason
        }
      })
    } catch (opError: any) {
      // Update audit entry with failure
      if (auditId) {
        await updateAuditEntry(auditId, 'FAILURE', undefined, undefined, opError.message)
      }
      throw opError
    }
  } catch (error: any) {
    console.error('[API] Failed to delete superadmin account:', error.message)
    return res.status(500).json({
      error: 'Failed to delete superadmin account',
      details: error.message
    })
  }
})

/**
 * POST /api/superadmin/accounts/:userId/reset-password
 * 
 * Reset a superadmin password (authenticated + superadmin role required)
 * 
 * Features:
 * - Generates new secure password
 * - Fully audited operation
 * - Returns temporary password (must be changed on next login)
 */
interface ResetPasswordRequest extends Request {
  body: {}
  params: {
    userId: string
  }
}

router.post('/accounts/:userId/reset-password', authenticateToken, verifySuperadmin, async (req: ResetPasswordRequest, res: Response) => {
  const { userId } = req.params
  let auditId: string | undefined

  try {
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' })
    }

    // Prevent self-password-reset (users should use change password endpoint)
    if (req.user!.userId === userId) {
      return res.status(400).json({
        error: 'Use the change password endpoint to reset your own password',
        hint: 'POST /api/auth/change-password'
      })
    }

    // Create audit context
    const auditContext = extractAuditContext(req, 'RESET_SUPERADMIN_PASSWORD', 'SYSTEM')
    auditContext.targetEntityType = 'SUPERADMIN_USER'
    auditContext.targetEntityId = userId
    auditContext.justification = 'Password reset by superadmin'

    // Log audit entry first (before operation)
    try {
      auditId = await logAuditEntry(auditContext)
    } catch (auditError) {
      console.warn('[AUDIT] Non-critical audit logging failed:', auditError)
      auditId = undefined
    }

    try {
      const result: SuperadminOperationResult = await resetSuperadminPassword(
        req.user!.userId,
        userId,
        req.ip || 'unknown',
        auditId || 'unknown'
      )

      // Update audit entry with success
      if (auditId) {
        await updateAuditEntry(auditId, 'SUCCESS', undefined, {
          userId: result.details.userId,
          email: result.details.email
        })
      }

      return res.status(200).json({
        success: true,
        message: 'Superadmin password reset',
        data: {
          userId: result.details.userId,
          email: result.details.email,
          temporaryPassword: result.details.newPassword,
          passwordExpires: result.details.passwordExpires,
          mustChangePasswordOnNextLogin: true
        },
        warning: 'Share the temporary password securely. User must change it on next login.'
      })
    } catch (opError: any) {
      // Update audit entry with failure
      if (auditId) {
        await updateAuditEntry(auditId, 'FAILURE', undefined, undefined, opError.message)
      }
      throw opError
    }
  } catch (error: any) {
    console.error('[API] Failed to reset superadmin password:', error.message)
    return res.status(500).json({
      error: 'Failed to reset superadmin password',
      details: error.message
    })
  }
})

/**
 * GET /api/superadmin/accounts
 * 
 * List all superadmin accounts (authenticated + superadmin role required)
 * 
 * Features:
 * - Returns all superadmin users
 * - Shows creation date and last active
 * - Fully audited
 */
router.get('/accounts', authenticateToken, verifySuperadmin, async (req: Request, res: Response) => {
  try {
    // Create audit context
    const auditContext = extractAuditContext(req, 'LIST_SUPERADMIN_ACCOUNTS', 'SYSTEM')

    // Log audit entry
    try {
      await logAuditEntry(auditContext)
    } catch (auditError) {
      console.warn('[AUDIT] Non-critical audit logging failed:', auditError)
    }

    // Query all superadmin users
    const result = await query(
      `SELECT 
        u.id,
        u.email,
        u.full_name,
        u.is_active,
        u.created_at,
        u.updated_at,
        u.last_login_at
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE r.name = 'superadmin'
      ORDER BY u.created_at DESC`
    )

    return res.json({
      success: true,
      data: result.rows
    })
  } catch (error: any) {
    console.error('[API] Failed to list superadmin accounts:', error.message)
    return res.status(500).json({
      error: 'Failed to list superadmin accounts',
      details: error.message
    })
  }
})

/**
 * GET /api/superadmin/accounts/:userId
 * 
 * Get details for a specific superadmin account (authenticated + superadmin role required)
 */
router.get('/accounts/:userId', authenticateToken, verifySuperadmin, async (req: Request, res: Response) => {
  const { userId } = req.params

  try {
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' })
    }

    // Query superadmin user
    const result = await query(
      `SELECT 
        u.id,
        u.email,
        u.full_name,
        u.is_active,
        u.created_at,
        u.updated_at,
        u.last_login_at,
        r.name AS role_name,
        COUNT(DISTINCT sal.id) AS action_log_count
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN superadmin_action_logs sal ON u.id = sal.superadmin_user_id
      WHERE u.id = $1 AND r.name = 'superadmin'
      GROUP BY u.id, u.email, u.full_name, u.is_active, u.created_at, u.updated_at, u.last_login_at, r.name`,
      [userId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Superadmin account not found' })
    }

    return res.json({
      success: true,
      data: result.rows[0]
    })
  } catch (error: any) {
    console.error('[API] Failed to get superadmin account:', error.message)
    return res.status(500).json({
      error: 'Failed to get superadmin account',
      details: error.message
    })
  }
})

export default router
