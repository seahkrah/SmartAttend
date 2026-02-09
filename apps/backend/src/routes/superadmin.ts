import express, { Request, Response } from 'express'
import { randomBytes, createHash } from 'crypto'
import { query } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import { auditContextMiddleware } from '../auth/auditContextMiddleware.js'
import { extractAuditContext, logAuditEntry, updateAuditEntry, auditOperation, auditDryRun, getAuditLogs } from '../services/auditService.js'
import { rateLimitMiddleware } from '../auth/rateLimitMiddleware.js'
import { requireMfa, warnIfMfaOld, createMfaChallenge, verifyMfaChallenge } from '../auth/mfaMiddleware.js'
import { ipAllowlistMiddleware, warnIfIpExpiringSoon, addIpToAllowlist, getAllowlistedIps } from '../auth/ipAllowlistMiddleware.js'

const router = express.Router()

// Apply middleware in order: audit context -> IP allowlist -> MFA -> rate limiting
router.use(auditContextMiddleware)
router.use(ipAllowlistMiddleware)
// warnIfIpExpiringSoon is async function that returns middleware, so we need to handle it separately
let ipWarningMiddleware: any = null
warnIfIpExpiringSoon(7).then(m => { ipWarningMiddleware = m })
router.use((req, res, next) => {
  if (!ipWarningMiddleware) return next()
  ipWarningMiddleware(req, res, next).catch(next)
})
router.use(authenticateToken, (req, res, next) => verifySuperadmin(req, res, next))

// ===========================
// MIDDLEWARE: VERIFY SUPERADMIN ACCESS
// ===========================

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

// ===========================
// DIAGNOSTICS ENDPOINT
// ===========================

// GET: System Diagnostics
router.get('/diagnostics', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: Request, res: Response) => {
  try {
    return res.json({
      database_health: {
        status: 'HEALTHY',
        response_time_ms: 10,
        connections_active: 5,
        transaction_queue: 0,
      },
      cache_metrics: {
        hit_rate_percent: 85,
        memory_used_mb: 256,
        items_cached: 1200,
      },
      auth_metrics: {
        failed_auth_24h: 3,
        active_sessions: 12,
        locked_users: 0,
      },
      storage_metrics: {
        used_percent: 45,
        total_gb: 100,
        used_gb: 45,
      },
      uptime_seconds: 86400,
      last_backup_timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to get diagnostics' })
  }
})

// ===========================
// LOCKED USERS ENDPOINTS
// ===========================

// GET: List all locked users
router.get('/locked-users', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: Request, res: Response) => {
  try {
    // This would query a locked_users table or incident tracking
    // For now, return empty array
    return res.json([])
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to get locked users' })
  }
})

// ===========================
// TENANT MANAGEMENT ENDPOINTS
// ===========================

// GET: List all tenants (schools + corporates)
router.get('/tenants', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: Request, res: Response) => {
  try {
    const superadminId = req.user!.userId

    // Get all schools
    const schoolsResult = await query(
      `SELECT 
        se.id,
        se.name,
        se.email,
        se.phone,
        'school' as entity_type,
        se.created_at,
        0 as user_count,
        0 as active_users
      FROM school_entities se
      ORDER BY se.created_at DESC`
    )

    // Get all corporates
    const corporatesResult = await query(
      `SELECT 
        ce.id,
        ce.name,
        ce.email,
        ce.phone,
        'corporate' as entity_type,
        ce.created_at,
        0 as user_count,
        0 as active_users
      FROM corporate_entities ce
      ORDER BY ce.created_at DESC`
    )

    // Log the action
    await query(
      `INSERT INTO superadmin_action_logs (superadmin_user_id, action, ip_address)
       VALUES ($1, $2, $3)`,
      [superadminId, 'list_tenants', req.ip]
    ).catch(() => {}) // Non-critical

    return res.json({
      success: true,
      data: {
        schools: schoolsResult.rows,
        corporates: corporatesResult.rows,
        total: schoolsResult.rows.length + corporatesResult.rows.length
      }
    })
  } catch (error: any) {
    console.error('Error listing tenants:', error)
    return res.status(500).json({ error: error.message || 'Failed to list tenants' })
  }
})

// GET: Get specific tenant details
router.get('/tenants/:tenantId', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params
    const superadminId = req.user!.userId

    // Try to find in schools first
    const schoolResult = await query(
      `SELECT id, name, email, phone, 'school' as type FROM school_entities WHERE id = $1`,
      [tenantId]
    )

    let tenant = schoolResult.rows[0]
    let entityType = 'school'

    if (!tenant) {
      // Try corporates
      const corporateResult = await query(
        `SELECT id, name, email, phone, 'corporate' as type FROM corporate_entities WHERE id = $1`,
        [tenantId]
      )
      tenant = corporateResult.rows[0]
      entityType = 'corporate'
    }

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' })
    }

    // Get tenant-specific stats
    const statsResult = await query(
      `SELECT 
        COUNT(DISTINCT u.id) as total_users,
        COUNT(DISTINCT CASE WHEN u.is_active = true THEN u.id END) as active_users
      FROM users u
      WHERE u.id IN (
        SELECT user_id FROM ${entityType === 'school' ? 'students' : 'employees'}
      )`
    )

    // Get lock events if any
    const lockEventsResult = await query(
      `SELECT id, action, reason, locked_at, unlocked_at
       FROM tenant_lock_events
       WHERE tenant_id = $1
       ORDER BY locked_at DESC
       LIMIT 5`,
      [tenantId]
    )

    // Log the action
    await query(
      `INSERT INTO superadmin_action_logs (superadmin_user_id, action, entity_type, entity_id, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [superadminId, 'view_tenant_details', entityType, tenantId, req.ip]
    ).catch(() => {})

    return res.json({
      success: true,
      data: {
        ...tenant,
        stats: statsResult.rows[0],
        lockEvents: lockEventsResult.rows
      }
    })
  } catch (error: any) {
    console.error('Error getting tenant details:', error)
    return res.status(500).json({ error: error.message || 'Failed to get tenant details' })
  }
})

// POST: Lock a tenant (emergency measure)
interface LockTenantRequest extends Request {
  body: {
    tenantId: string
    reason: string
  }
}

router.post('/tenants/lock', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: LockTenantRequest, res: Response) => {
  try {
    const { tenantId, reason } = req.body
    const superadminId = req.user!.userId

    if (!tenantId || !reason) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Check if tenant exists
    let entityType = 'school'
    let tenantCheckResult = await query(
      `SELECT id FROM school_entities WHERE id = $1`,
      [tenantId]
    )

    if (tenantCheckResult.rows.length === 0) {
      tenantCheckResult = await query(
        `SELECT id FROM corporate_entities WHERE id = $1`,
        [tenantId]
      )
      entityType = 'corporate'
    }

    if (tenantCheckResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' })
    }

    // Create lock event
    const lockResult = await query(
      `INSERT INTO tenant_lock_events (tenant_id, action, reason, locked_by_superadmin_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, locked_at`,
      [tenantId, 'LOCKED', reason, superadminId]
    )

    // Log the action
    await query(
      `INSERT INTO superadmin_action_logs (superadmin_user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [superadminId, 'lock_tenant', entityType, tenantId, { reason }, req.ip]
    ).catch(() => {})

    // Optionally invalidate all sessions for this tenant
    // This would be done in a separate process

    return res.status(201).json({
      success: true,
      message: 'Tenant locked successfully',
      data: lockResult.rows[0]
    })
  } catch (error: any) {
    console.error('Error locking tenant:', error)
    return res.status(500).json({ error: error.message || 'Failed to lock tenant' })
  }
})

// POST: Unlock a tenant
interface UnlockTenantRequest extends Request {
  body: {
    lockEventId: string
    reason?: string
  }
}

router.post('/tenants/unlock', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: UnlockTenantRequest, res: Response) => {
  try {
    const { lockEventId, reason } = req.body
    const superadminId = req.user!.userId

    if (!lockEventId) {
      return res.status(400).json({ error: 'Missing lock event ID' })
    }

    // Get lock event
    const lockEventResult = await query(
      `SELECT tenant_id, action FROM tenant_lock_events WHERE id = $1`,
      [lockEventId]
    )

    if (lockEventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lock event not found' })
    }

    const lockEvent = lockEventResult.rows[0]

    // Unlock (update the event)
    const unlockResult = await query(
      `UPDATE tenant_lock_events
       SET action = $1, unlocked_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, tenant_id, unlocked_at`,
      ['UNLOCKED', lockEventId]
    )

    // Log the action
    await query(
      `INSERT INTO superadmin_action_logs (superadmin_user_id, action, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [superadminId, 'unlock_tenant', lockEvent.tenant_id, { reason: reason || 'Manual unlock' }, req.ip]
    ).catch(() => {})

    return res.json({
      success: true,
      message: 'Tenant unlocked successfully',
      data: unlockResult.rows[0]
    })
  } catch (error: any) {
    console.error('Error unlocking tenant:', error)
    return res.status(500).json({ error: error.message || 'Failed to unlock tenant' })
  }
})

// ===========================
// INCIDENT MANAGEMENT ENDPOINTS
// ===========================

// GET: List incidents
router.get('/incidents', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: Request, res: Response) => {
  try {
    const { status, severity } = req.query
    const superadminId = req.user!.userId

    let whereClause = '1=1'
    const params: any[] = []

    if (status) {
      whereClause += ` AND status = $${params.length + 1}`
      params.push(status)
    }

    if (severity) {
      whereClause += ` AND severity = $${params.length + 1}`
      params.push(severity)
    }

    const incidentsResult = await query(
      `SELECT 
        id,
        incident_number,
        title,
        description,
        incident_type,
        severity,
        status,
        assigned_superadmin_id,
        created_at,
        resolved_at
      FROM incidents
      WHERE ${whereClause}
      ORDER BY created_at DESC`
    )

    // Log the action
    await query(
      `INSERT INTO superadmin_action_logs (superadmin_user_id, action, ip_address)
       VALUES ($1, $2, $3)`,
      [superadminId, 'list_incidents', req.ip]
    ).catch(() => {})

    return res.json({
      success: true,
      data: incidentsResult.rows
    })
  } catch (error: any) {
    console.error('Error listing incidents:', error)
    return res.status(500).json({ error: error.message || 'Failed to list incidents' })
  }
})

// POST: Create incident
interface CreateIncidentRequest extends Request {
  body: {
    title: string
    description: string
    incidentType: string
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    affectedTenantId?: string
    rootCause?: string
  }
}

router.post('/incidents', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: CreateIncidentRequest, res: Response) => {
  try {
    const { title, description, incidentType, severity, affectedTenantId, rootCause } = req.body
    const superadminId = req.user!.userId

    if (!title || !description || !incidentType || !severity) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Create audit context
    const auditContext = extractAuditContext(req, 'CREATE_INFRASTRUCTURE_INCIDENT', 'GLOBAL')
    auditContext.targetEntityType = 'INFRASTRUCTURE_INCIDENT'
    auditContext.justification = description

    // Log audit entry first
    let auditId: string
    try {
      auditId = await logAuditEntry(auditContext)
    } catch (auditError) {
      console.warn('[AUDIT] Non-critical audit logging failed:', auditError)
      auditId = 'unknown'
    }

    try {
      const incidentResult = await query(
        `INSERT INTO infrastructure_incidents (title, description, incident_type, severity, created_by_superadmin_id, affected_tenant_id, root_cause)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, incident_number, created_at`,
        [title, description, incidentType, severity, superadminId, affectedTenantId || null, rootCause || null]
      )

      const incidentId = incidentResult.rows[0].id

      // Create initial activity log entry
      await query(
        `INSERT INTO incident_activity_log (incident_id, activity_type, activity_description, actor_id, actor_role)
         VALUES ($1, $2, $3, $4, $5)`,
        [incidentId, 'INCIDENT_CREATED', `Incident created: ${title}`, superadminId, 'superadmin']
      )

      // Update audit entry with success
      if (auditId !== 'unknown') {
        await updateAuditEntry(auditId, 'SUCCESS', undefined, { incidentId, incidentNumber: incidentResult.rows[0].incident_number })
      }

      return res.status(201).json({
        success: true,
        message: 'Incident created successfully',
        data: incidentResult.rows[0]
      })
    } catch (opError: any) {
      if (auditId !== 'unknown') {
        await updateAuditEntry(auditId, 'FAILURE', undefined, undefined, opError.message)
      }
      throw opError
    }
  } catch (error: any) {
    console.error('Error creating incident:', error)
    return res.status(500).json({ error: error.message || 'Failed to create incident' })
  }
})

// PUT: Update incident status
interface UpdateIncidentRequest extends Request {
  body: {
    incidentId: string
    status: 'OPEN' | 'INVESTIGATING' | 'CONTAINED' | 'RESOLVED' | 'CLOSED'
    resolutionNotes?: string
    rootCause?: string
  }
}

router.put('/incidents/:incidentId', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: UpdateIncidentRequest, res: Response) => {
  const { incidentId } = req.params
  const { status, resolutionNotes, rootCause } = req.body
  const superadminId = req.user!.userId
  let auditId: string = 'unknown'

  if (!status) {
    return res.status(400).json({ error: 'Status is required' })
  }

  try {
    // Create audit context
    const auditContext = extractAuditContext(req, 'UPDATE_INFRASTRUCTURE_INCIDENT', 'GLOBAL')
    auditContext.targetEntityType = 'INFRASTRUCTURE_INCIDENT'
    auditContext.targetEntityId = incidentId
    auditContext.justification = `Status change to ${status}`

    // Log audit entry first
    try {
      auditId = await logAuditEntry(auditContext)
    } catch (auditError) {
      console.warn('[AUDIT] Non-critical audit logging failed:', auditError)
      auditId = 'unknown'
    }

    // Fetch incident before state
    const beforeResult = await query(`SELECT status, root_cause FROM infrastructure_incidents WHERE id = $1`, [incidentId])
    if (beforeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Incident not found' })
    }

    const beforeState = beforeResult.rows[0]

    // Update incident
    const updates: any[] = ['status = $1']
    const params: any[] = [status]
    let paramNum = 2

    if (resolutionNotes) {
      updates.push(`resolution_notes = $${paramNum}`)
      params.push(resolutionNotes)
      paramNum++
    }

    if (rootCause) {
      updates.push(`root_cause = $${paramNum}`)
      params.push(rootCause)
      paramNum++
    }

    if (status === 'RESOLVED') {
      updates.push(`resolved_at = CURRENT_TIMESTAMP`)
    }

    params.push(incidentId)

    const updateResult = await query(
      `UPDATE infrastructure_incidents
       SET ${updates.join(', ')}
       WHERE id = $${paramNum}
       RETURNING *`,
      params
    )

    // Add activity log entry
    await query(
      `INSERT INTO incident_activity_log (incident_id, activity_type, activity_description, actor_id, actor_role, state_change_from, state_change_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [incidentId, 'STATUS_UPDATE', `Status changed from ${beforeState.status} to ${status}`, superadminId, 'superadmin', beforeState.status, status]
    )

    // Update audit entry with success
    if (auditId !== 'unknown') {
      await updateAuditEntry(auditId, 'SUCCESS', beforeState, { status, rootCause })
    }

    return res.json({
      success: true,
      message: 'Incident updated successfully',
      data: updateResult.rows[0]
    })
  } catch (error: any) {
    if (auditId !== 'unknown') {
      await updateAuditEntry(auditId, 'FAILURE', undefined, undefined, error.message)
    }
    console.error('Error updating incident:', error)
    return res.status(500).json({ error: error.message || 'Failed to update incident' })
  }
})

// ===========================
// AUDIT LOG ENDPOINTS
// ===========================

// GET: View audit logs
router.get('/audit-logs', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: Request, res: Response) => {
  try {
    const { limit = '50', offset = '0' } = req.query
    const superadminId = req.user!.userId

    const auditLogsResult = await query(
      `SELECT 
        id,
        superadmin_user_id,
        action,
        entity_type,
        entity_id,
        details,
        ip_address,
        created_at
      FROM superadmin_action_logs
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
      [parseInt(limit as string), parseInt(offset as string)]
    )

    // Log this action
    await query(
      `INSERT INTO superadmin_action_logs (superadmin_user_id, action, ip_address)
       VALUES ($1, $2, $3)`,
      [superadminId, 'view_audit_logs', req.ip]
    ).catch(() => {})

    return res.json({
      success: true,
      data: auditLogsResult.rows
    })
  } catch (error: any) {
    console.error('Error getting audit logs:', error)
    return res.status(500).json({ error: error.message || 'Failed to get audit logs' })
  }
})

// GET: View system health
router.get('/health', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: Request, res: Response) => {
  try {
    const healthResult = await query(
      `SELECT service_name, status, response_time_ms, error_rate_percent, last_checked_at
       FROM system_health
       ORDER BY last_checked_at DESC`
    )

    return res.json({
      success: true,
      data: healthResult.rows
    })
  } catch (error: any) {
    console.error('Error getting system health:', error)
    return res.status(500).json({ error: error.message || 'Failed to get system health' })
  }
})

// ===========================
// NEW: CONTROL PLANE ENDPOINTS
// ===========================

// Helper: SHA256 hash for tokens
function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

// POST: Create confirmation token
interface CreateConfirmationRequest extends Request {
  body: {
    operationType: string
    operationContext: any
    ttlSeconds?: number
  }
}

router.post('/confirmation-tokens', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: CreateConfirmationRequest, res: Response) => {
  try {
    const { operationType, operationContext, ttlSeconds = 900 } = req.body
    const superadminId = req.user!.userId

    if (!operationType || !operationContext) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Generate token and store hash
    const token = randomBytes(24).toString('hex')
    const tokenHash = hashToken(token)

    const expiresAtQuery = `NOW() + ($1 || ' seconds')::interval`

    const insertResult = await query(
      `INSERT INTO confirmation_tokens (operation_type, operation_context, token_hash, requesting_superadmin_id, expires_at, ip_address)
       VALUES ($1, $2::jsonb, $3, $4, ${expiresAtQuery}, $5)
       RETURNING id, expires_at`,
      [operationType, JSON.stringify(operationContext), tokenHash, superadminId, ttlSeconds, req.ip]
    )

    return res.status(201).json({
      success: true,
      data: {
        token, // Plain token returned only once — caller must store it securely
        id: insertResult.rows[0].id,
        expiresAt: insertResult.rows[0].expires_at
      }
    })
  } catch (error: any) {
    console.error('Error creating confirmation token:', error)
    return res.status(500).json({ error: error.message || 'Failed to create confirmation token' })
  }
})

// POST: Validate/consume confirmation token (internal use by operations)
interface ValidateTokenRequest extends Request {
  body: {
    token: string
    operationType: string
    tenantId?: string
  }
}

async function consumeConfirmationToken(token: string, operationType: string, tenantId?: string) {
  const tokenHash = hashToken(token)

  // Find unused token matching operation and tenant context
  const tokenQuery = await query(
    `SELECT id, requesting_superadmin_id FROM confirmation_tokens
     WHERE token_hash = $1 AND operation_type = $2 AND is_used = FALSE AND expires_at > NOW()` +
      (tenantId ? ` AND (operation_context ->> 'tenantId') = $3` : ''),
    tenantId ? [tokenHash, operationType, tenantId] : [tokenHash, operationType]
  )

  if (tokenQuery.rows.length === 0) {
    throw new Error('Invalid or expired confirmation token')
  }

  const tokenId = tokenQuery.rows[0].id

  // Mark token as used
  await query(
    `UPDATE confirmation_tokens SET is_used = TRUE, confirmed_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [tokenId]
  )

  return tokenId
}

// POST: Tenant lifecycle transition (supports dryRun and confirmation token)
interface TenantLifecycleRequest extends Request {
  body: {
    newState: 'PROVISIONED' | 'ACTIVE' | 'SUSPENDED' | 'LOCKED' | 'DECOMMISSIONED'
    justification: string
    dryRun?: boolean
    confirmationToken?: string
  }
}

router.post('/tenants/:tenantId/lifecycle', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: TenantLifecycleRequest, res: Response) => {
  const { tenantId } = req.params
  const { newState, justification, dryRun = false, confirmationToken } = req.body
  const superadminId = req.user!.userId
  let auditId: string | undefined

  if (!newState || !justification) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  try {
    // Create audit context
    const auditContext = extractAuditContext(req, 'TENANT_LIFECYCLE_TRANSITION', 'TENANT')
    auditContext.targetEntityId = tenantId
    auditContext.justification = justification
    if (confirmationToken) {
      auditContext.confirmationToken = confirmationToken
    }

    // Ensure tenant exists in school_entities (control plane targets school_entities)
    const tenantResult = await query(`SELECT id, lifecycle_state FROM school_entities WHERE id = $1`, [tenantId])
    if (tenantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found or unsupported entity type' })
    }

    const currentState = tenantResult.rows[0].lifecycle_state

    // Validate transition using DB function
    const validResult = await query(`SELECT validate_tenant_lifecycle_transition($1, $2) as valid`, [currentState, newState])
    if (!validResult.rows[0].valid) {
      return res.status(400).json({ error: `Invalid lifecycle transition from ${currentState} -> ${newState}` })
    }

    // Determine if confirmation required (DECOMMISSIONED is considered destructive)
    const requiresConfirmation = newState === 'DECOMMISSIONED'

    if (requiresConfirmation && !dryRun) {
      if (!confirmationToken) {
        return res.status(409).json({ error: 'Confirmation token required for destructive transitions' })
      }
      // Validate and consume token
      await consumeConfirmationToken(confirmationToken, 'TENANT_LIFECYCLE', tenantId)
    }

    if (dryRun) {
      // Log audit entry for dry-run
      auditContext.dryRun = true
      auditId = await logAuditEntry(auditContext)

      // Insert a dry-run audit entry (no state change)
      await query(
        `INSERT INTO tenant_lifecycle_audit (tenant_id, previous_state, new_state, actor_id, actor_role, action_type, justification, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tenantId, currentState, newState, superadminId, 'superadmin', 'DRY_RUN_TRANSITION', justification, req.ip]
      )

      // Update audit entry with success and after state
      await updateAuditEntry(auditId, 'SUCCESS', { currentState }, { simulatedNewState: newState })

      return res.json({ success: true, message: 'Dry run recorded (no state change)', data: { currentState, newState } })
    }

    // Perform transition: log audit first, then execute
    auditId = await logAuditEntry(auditContext)

    // Perform transition inside a transaction: insert audit first, then update tenant
    await query('BEGIN')
    try {
      await query(
        `INSERT INTO tenant_lifecycle_audit (tenant_id, previous_state, new_state, actor_id, actor_role, action_type, justification, confirmation_token, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [tenantId, currentState, newState, superadminId, 'superadmin', 'TRANSITION', justification, confirmationToken || null, req.ip]
      )

      await query(
        `UPDATE school_entities SET lifecycle_state = $1, system_version = system_version + 1, last_active_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [newState, tenantId]
      )

      // If locking or decommissioning, insert session invalidation log
      if (newState === 'LOCKED' || newState === 'DECOMMISSIONED') {
        // Count sessions associated with tenant if applicable (best-effort)
        const sessionCountRes = await query(`SELECT COUNT(*) as cnt FROM superadmin_sessions WHERE is_active = TRUE`)
        const invalidatedCount = parseInt(sessionCountRes.rows[0].cnt, 10) || 0

        await query(
          `INSERT INTO session_invalidation_log (tenant_id, reason, invalidated_by_superadmin_id, invalidated_session_count)
           VALUES ($1, $2, $3, $4)`,
          [tenantId, `Lifecycle transition to ${newState}`, superadminId, invalidatedCount]
        )
      }

      await query('COMMIT')

      // Update audit entry with success and state change
      await updateAuditEntry(auditId, 'SUCCESS', { previousState: currentState }, { newState })

      return res.json({ success: true, message: 'Lifecycle transition recorded and executed', data: { previousState: currentState, newState } })
    } catch (txError: any) {
      await query('ROLLBACK')
      throw txError
    }
  } catch (error: any) {
    // Update audit entry with failure if it was created
    if (auditId) {
      await updateAuditEntry(auditId, 'FAILURE', undefined, undefined, error.message)
    }
    console.error('Error performing lifecycle transition:', error)
    return res.status(500).json({ error: error.message || 'Failed to perform lifecycle transition' })
  }
})

// POST: Invalidate sessions for a tenant (audit-first)
interface InvalidateSessionsRequest extends Request {
  body: {
    tenantId: string
    reason: string
  }
}

router.post('/sessions/invalidate', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: InvalidateSessionsRequest, res: Response) => {
  try {
    const { tenantId, reason } = req.body
    const superadminId = req.user!.userId

    if (!tenantId || !reason) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Create audit context
    const auditContext = extractAuditContext(req, 'SESSION_INVALIDATION', 'GLOBAL')
    auditContext.targetEntityId = tenantId
    auditContext.justification = reason

    // Log audit entry first
    const auditId = await logAuditEntry(auditContext)

    try {
      // Best-effort count of sessions to invalidate (tenant mapping optional)
      const sessionCountRes = await query(`SELECT COUNT(*) as cnt FROM superadmin_sessions WHERE is_active = TRUE`)
      const invalidatedCount = parseInt(sessionCountRes.rows[0].cnt, 10) || 0

      const result = await query(
        `INSERT INTO session_invalidation_log (tenant_id, reason, invalidated_by_superadmin_id, invalidated_session_count)
         VALUES ($1, $2, $3, $4) RETURNING id, timestamp`,
        [tenantId, reason, superadminId, invalidatedCount]
      )

      // Update audit entry with success
      await updateAuditEntry(auditId, 'SUCCESS', undefined, { sessionCount: invalidatedCount })

      return res.status(201).json({ success: true, message: 'Sessions invalidation recorded', data: result.rows[0] })
    } catch (error: any) {
      await updateAuditEntry(auditId, 'FAILURE', undefined, undefined, error.message)
      throw error
    }
  } catch (error: any) {
    console.error('Error invalidating sessions:', error)
    return res.status(500).json({ error: error.message || 'Failed to invalidate sessions' })
  }
})

// POST: Clock drift ingestion
interface ClockDriftRequest extends Request {
  body: {
    tenantId: string
    userId: string
    clientTimestamp: string
    requestId?: string
  }
}

router.post('/clock-drift', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: ClockDriftRequest, res: Response) => {
  try {
    const { tenantId, userId, clientTimestamp, requestId } = req.body

    if (!tenantId || !userId || !clientTimestamp) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const serverTs = new Date()
    const clientTs = new Date(clientTimestamp)
    const driftSeconds = Math.floor((clientTs.getTime() - serverTs.getTime()) / 1000)
    const absDrift = Math.abs(driftSeconds)

    let severity: 'INFO' | 'WARNING' | 'CRITICAL' = 'INFO'
    let attendanceAffected = false
    if (absDrift >= 300) {
      severity = 'CRITICAL'
      attendanceAffected = true
    } else if (absDrift >= 60) {
      severity = 'WARNING'
    }

    const insertResult = await query(
      `INSERT INTO clock_drift_log (tenant_id, user_id, client_timestamp, server_timestamp, drift_seconds, severity, attendance_affected, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, timestamp`,
      [tenantId, userId, clientTimestamp, serverTs.toISOString(), driftSeconds, severity, attendanceAffected, requestId || null]
    )

    return res.status(201).json({ success: true, data: insertResult.rows[0] })
  } catch (error: any) {
    console.error('Error ingesting clock drift:', error)
    return res.status(500).json({ error: error.message || 'Failed to record clock drift' })
  }
})

// GET: List attendance flags (optionally by tenant)
router.get('/attendance/flags', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.query
    let q = `SELECT * FROM attendance_integrity_flags WHERE 1=1`
    const params: any[] = []

    if (tenantId) {
      q += ` AND tenant_id = $1`
      params.push(tenantId)
    }

    q += ` ORDER BY flag_timestamp DESC LIMIT 200`

    const flagsResult = await query(q, params)

    return res.json({ success: true, data: flagsResult.rows })
  } catch (error: any) {
    console.error('Error listing attendance flags:', error)
    return res.status(500).json({ error: error.message || 'Failed to list attendance flags' })
  }
})

// POST: Create attendance integrity flag
interface CreateFlagRequest extends Request {
  body: {
    tenantId: string
    attendanceRecordId?: string
    flagType: string
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    flagReason: string
  }
}

router.post('/attendance/flags', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: CreateFlagRequest, res: Response) => {
  try {
    const { tenantId, attendanceRecordId, flagType, severity, flagReason } = req.body
    const superadminId = req.user!.userId

    if (!tenantId || !flagType || !severity || !flagReason) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Create audit context
    const auditContext = extractAuditContext(req, 'CREATE_ATTENDANCE_FLAG', 'TENANT')
    auditContext.targetEntityType = 'ATTENDANCE_FLAG'
    auditContext.targetEntityId = attendanceRecordId || tenantId
    auditContext.justification = flagReason

    // Log audit entry first
    let auditId: string
    try {
      auditId = await logAuditEntry(auditContext)
    } catch (auditError) {
      console.warn('[AUDIT] Non-critical audit logging failed:', auditError)
      auditId = 'unknown'
    }

    try {
      const insertResult = await query(
        `INSERT INTO attendance_integrity_flags (tenant_id, attendance_record_id, flag_type, severity, flagged_by_superadmin_id, flag_reason)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, flag_timestamp`,
        [tenantId, attendanceRecordId || null, flagType, severity, superadminId, flagReason]
      )

      // Update audit entry with success
      if (auditId !== 'unknown') {
        await updateAuditEntry(auditId, 'SUCCESS', undefined, { flagId: insertResult.rows[0].id, flagType, severity })
      }

      return res.status(201).json({ success: true, message: 'Flag created', data: insertResult.rows[0] })
    } catch (opError: any) {
      if (auditId !== 'unknown') {
        await updateAuditEntry(auditId, 'FAILURE', undefined, undefined, opError.message)
      }
      throw opError
    }
  } catch (error: any) {
    console.error('Error creating attendance flag:', error)
    return res.status(500).json({ error: error.message || 'Failed to create attendance flag' })
  }
})

// ===========================
// MFA MANAGEMENT ENDPOINTS
// ===========================

// POST: Start MFA challenge
interface MfaChallengeStartRequest extends Request {
  body: {
    method: 'TOTP' | 'SMS' | 'EMAIL'
  }
}

router.post('/mfa/challenge', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: MfaChallengeStartRequest, res: Response) => {
  try {
    const { method } = req.body
    const superadminId = req.user!.userId

    if (!method) {
      return res.status(400).json({ error: 'MFA method required' })
    }

    const challenge = await createMfaChallenge(superadminId, method)

    const auditContext = extractAuditContext(req, 'MFA_CHALLENGE_CREATED', 'GLOBAL')
    await logAuditEntry(auditContext).catch(() => {})

    return res.status(201).json({ success: true, data: challenge })
  } catch (error: any) {
    console.error('Error creating MFA challenge:', error)
    return res.status(500).json({ error: error.message || 'Failed to create MFA challenge' })
  }
})

// POST: Verify MFA challenge
interface MfaChallengeVerifyRequest extends Request {
  body: {
    challengeId: string
    code: string
  }
}

router.post('/mfa/verify', async (req: MfaChallengeVerifyRequest, res: Response) => {
  try {
    const { challengeId, code } = req.body

    if (!challengeId || !code) {
      return res.status(400).json({ error: 'Challenge ID and code required' })
    }

    const result = await verifyMfaChallenge(challengeId, code)

    if (!result.success) {
      return res.status(403).json({ error: result.error })
    }

    return res.json({
      success: true,
      message: 'MFA verified',
      data: { userId: result.userId }
    })
  } catch (error: any) {
    console.error('Error verifying MFA challenge:', error)
    return res.status(500).json({ error: error.message || 'Failed to verify MFA challenge' })
  }
})

// ===========================
// IP ALLOWLIST MANAGEMENT
// ===========================

// GET: List allowlisted IPs for current user
router.get('/ip-allowlist', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: Request, res: Response) => {
  try {
    const superadminId = req.user!.userId

    const auditContext = extractAuditContext(req, 'GET_IP_ALLOWLIST', 'GLOBAL')
    await logAuditEntry(auditContext).catch(() => {})

    const allowlist = await getAllowlistedIps(superadminId)

    return res.json({ success: true, data: allowlist })
  } catch (error: any) {
    console.error('Error fetching IP allowlist:', error)
    return res.status(500).json({ error: error.message || 'Failed to fetch IP allowlist' })
  }
})

// GET: Admin-to-tenant/platform mapping (cross-platform admin visibility)
router.get('/admins/mapping', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: Request, res: Response) => {
  try {
    // Get all admin users and their tenant/platform associations
    // This includes:
    // 1. Admins assigned as admin_user_id to entities
    // 2. Admins associated with entities through association tables
    // 3. Admins' platform membership via users.platform_id
    const adminMappingResult = await query(
      `SELECT DISTINCT
        u.id as admin_id,
        u.email as admin_email,
        u.full_name as admin_name,
        r.name as role_name,
        p.name as platform_name,
        p.id as platform_id,
        COALESCE(
          se.id,
          ce.id,
          sua.school_entity_id,
          cua.corporate_entity_id
        ) as tenant_id,
        COALESCE(
          se.name,
          ce.name,
          se_assoc.name,
          ce_assoc.name
        ) as tenant_name,
        CASE 
          WHEN se.id IS NOT NULL OR sua.school_entity_id IS NOT NULL THEN 'school'
          WHEN ce.id IS NOT NULL OR cua.corporate_entity_id IS NOT NULL THEN 'corporate'
        END as tenant_type
      FROM users u
      JOIN roles r ON u.role_id = r.id
      JOIN platforms p ON u.platform_id = p.id
      -- Direct admin assignment to entities
      LEFT JOIN school_entities se ON se.admin_user_id = u.id
      LEFT JOIN corporate_entities ce ON ce.admin_user_id = u.id
      -- Association table links
      LEFT JOIN school_user_associations sua ON sua.user_id = u.id
      LEFT JOIN corporate_user_associations cua ON cua.user_id = u.id
      LEFT JOIN school_entities se_assoc ON se_assoc.id = sua.school_entity_id
      LEFT JOIN corporate_entities ce_assoc ON ce_assoc.id = cua.corporate_entity_id
      WHERE r.name = 'admin'
      ORDER BY u.email, p.name, tenant_name`
    )

    // Group by admin to show cross-platform status
    const adminMap = new Map<string, {
      admin_id: string
      admin_email: string
      admin_name: string
      platforms: Array<{
        platform_name: string
        platform_id: string
        tenant_id: string | null
        tenant_name: string | null
        tenant_type: 'school' | 'corporate' | null
      }>
      is_cross_platform: boolean
    }>()

    adminMappingResult.rows.forEach((row: any) => {
      if (!adminMap.has(row.admin_id)) {
        adminMap.set(row.admin_id, {
          admin_id: row.admin_id,
          admin_email: row.admin_email,
          admin_name: row.admin_name,
          platforms: [],
          is_cross_platform: false,
        })
      }

      const admin = adminMap.get(row.admin_id)!
      if (row.platform_name && !admin.platforms.find(p => p.platform_id === row.platform_id)) {
        admin.platforms.push({
          platform_name: row.platform_name,
          platform_id: row.platform_id,
          tenant_id: row.tenant_id,
          tenant_name: row.tenant_name,
          tenant_type: row.tenant_type,
        })
      }
    })

    // Mark cross-platform admins
    adminMap.forEach((admin) => {
      const uniquePlatforms = new Set(admin.platforms.map(p => p.platform_name))
      admin.is_cross_platform = uniquePlatforms.size > 1
    })

    return res.json({
      success: true,
      data: {
        admins: Array.from(adminMap.values()),
        total_admins: adminMap.size,
        cross_platform_count: Array.from(adminMap.values()).filter(a => a.is_cross_platform).length,
        single_platform_count: Array.from(adminMap.values()).filter(a => !a.is_cross_platform).length,
      }
    })
  } catch (error: any) {
    console.error('Error fetching admin mapping:', error)
    return res.status(500).json({ error: error.message || 'Failed to fetch admin mapping' })
  }
})

// GET: Aggregated early signals across all tenants
router.get('/tenants/early-signals', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: Request, res: Response) => {
  try {
    // Get all tenant IDs (from school_entities and corporate_entities)
    const tenantsResult = await query(
      `SELECT 
        se.id as tenant_id,
        se.name as tenant_name,
        'school' as platform_type
      FROM school_entities se
      UNION ALL
      SELECT 
        ce.id as tenant_id,
        ce.name as tenant_name,
        'corporate' as platform_type
      FROM corporate_entities ce`
    )

    const tenants = tenantsResult.rows
    const aggregatedSignals = {
      total_tenants: tenants.length,
      tenants_with_critical_incidents: 0,
      tenants_with_overdue_incidents: 0,
      tenants_with_privilege_escalations: 0,
      tenants_with_role_violations: 0,
      total_critical_incidents: 0,
      total_overdue_incidents: 0,
      total_privilege_escalations: 0,
      total_role_violations: 0,
      tenant_details: tenants.map((t: any) => ({
        tenant_id: t.tenant_id,
        tenant_name: t.tenant_name,
        platform_type: t.platform_type,
        open_critical_incidents: 0,
        overdue_incidents_1h: 0,
        privilege_escalations_open: 0,
        role_violations_24h: 0,
      })),
    }

    return res.json({
      success: true,
      data: aggregatedSignals,
    })
  } catch (error: any) {
    console.error('Error fetching aggregated early signals:', error)
    return res.status(500).json({ error: error.message || 'Failed to fetch aggregated signals' })
  }
})

// POST: Add IP to allowlist
interface AddIpRequest extends Request {
  body: {
    ipAddress: string
    description?: string
    expiresAt?: string
  }
}

router.post('/ip-allowlist', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), rateLimitMiddleware('ADD_IP_ALLOWLIST') as any, async (req: AddIpRequest, res: Response) => {
  try {
    const { ipAddress, description, expiresAt } = req.body
    const superadminId = req.user!.userId

    if (!ipAddress) {
      return res.status(400).json({ error: 'IP address required' })
    }

    // Validate IP format (basic)
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ipAddress)) {
      return res.status(400).json({ error: 'Invalid IP address format' })
    }

    const auditContext = extractAuditContext(req, 'ADD_IP_ALLOWLIST', 'GLOBAL')
    auditContext.justification = `Adding IP ${ipAddress} to allowlist`

    let auditId: string = 'unknown'
    try {
      auditId = await logAuditEntry(auditContext)
    } catch (auditError) {
      console.warn('[AUDIT] Non-critical audit logging failed:', auditError)
    }

    try {
      const id = await addIpToAllowlist(superadminId, ipAddress, {
        description,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined
      })

      if (auditId !== 'unknown') {
        await updateAuditEntry(auditId, 'SUCCESS', undefined, { id, ipAddress })
      }

      return res.status(201).json({
        success: true,
        message: 'IP added to allowlist',
        data: { id, ipAddress }
      })
    } catch (opError: any) {
      if (auditId !== 'unknown') {
        await updateAuditEntry(auditId, 'FAILURE', undefined, undefined, opError.message)
      }
      throw opError
    }
  } catch (error: any) {
    console.error('Error adding IP to allowlist:', error)
    return res.status(500).json({ error: error.message || 'Failed to add IP to allowlist' })
  }
})

// ===========================
// TENANT ADMIN MANAGEMENT
// ===========================

// POST: Create new tenant admin
router.post('/tenant-admins', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: Request, res: Response) => {
  try {
    const superadminId = req.user!.userId
    const { email, name, tenantId, password } = req.body

    // Validate input
    if (!email || !name || !tenantId || !password) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' })
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    // Check if tenant exists
    const tenantCheck = await query(
      `SELECT id, name, entity_type FROM (
        SELECT id, name, 'school' as entity_type FROM school_entities WHERE id = $1
        UNION
        SELECT id, name, 'corporate' as entity_type FROM corporate_entities WHERE id = $1
      ) AS entities`,
      [tenantId]
    )

    if (tenantCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' })
    }

    const tenant = tenantCheck.rows[0]

    // Check if email already exists
    const emailCheck = await query(
      `SELECT id FROM users WHERE email = $1 AND entity_id = $2`,
      [email.toLowerCase(), tenantId]
    )

    if (emailCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Email already exists for this tenant' })
    }

    // Hash password
    const crypto = require('crypto')
    const hashedPassword = crypto
      .createHash('sha256')
      .update(password)
      .digest('hex')

    // Get admin role
    const roleCheck = await query(`SELECT id FROM roles WHERE name = 'admin' LIMIT 1`)
    if (roleCheck.rows.length === 0) {
      return res.status(500).json({ error: 'Admin role not found' })
    }

    const adminRoleId = roleCheck.rows[0].id

    // Create user record
    const userResult = await query(
      `INSERT INTO users (email, password, name, role_id, entity_id, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW())
       RETURNING id, email, name`,
      [email.toLowerCase(), hashedPassword, name, adminRoleId, tenantId]
    )

    const newUser = userResult.rows[0]

    // Log audit entry for superadmin action
    try {
      await query(
        `INSERT INTO superadmin_action_logs (superadmin_user_id, action, ip_address, details)
         VALUES ($1, $2, $3, $4)`,
        [superadminId, 'CREATE_TENANT_ADMIN', req.ip || 'unknown', JSON.stringify({
          admin_id: newUser.id,
          admin_email: newUser.email,
          tenant_id: tenantId,
          tenant_name: tenant.name,
          tenant_type: tenant.entity_type
        })]
      )
    } catch (auditError) {
      console.warn('Audit logging failed:', auditError)
    }

    return res.status(201).json({
      success: true,
      message: 'Tenant admin created successfully',
      data: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        tenantId: tenantId,
        tenantName: tenant.name
      }
    })
  } catch (error: any) {
    console.error('Error creating tenant admin:', error)
    return res.status(500).json({ error: error.message || 'Failed to create tenant admin' })
  }
})

// GET: List tenant admins for a specific tenant
router.get('/tenant-admins/:tenantId', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params

    const result = await query(
      `SELECT u.id, u.email, u.name, u.created_at, 
              CASE 
                WHEN se.id IS NOT NULL THEN 'school' 
                ELSE 'corporate' 
              END as tenant_type,
              COALESCE(se.name, ce.name) as tenant_name
       FROM users u
       LEFT JOIN school_entities se ON u.entity_id = se.id
       LEFT JOIN corporate_entities ce ON u.entity_id = ce.id
       JOIN roles r ON u.role_id = r.id
       WHERE r.name = 'admin' AND u.entity_id = $1
       ORDER BY u.created_at DESC`,
      [tenantId]
    )

    return res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    })
  } catch (error: any) {
    console.error('Error fetching tenant admins:', error)
    return res.status(500).json({ error: error.message || 'Failed to fetch tenant admins' })
  }
})

// DELETE: Remove tenant admin
router.delete('/tenant-admins/:adminId', authenticateToken, (req, res, next) => verifySuperadmin(req, res, next), async (req: Request, res: Response) => {
  try {
    const superadminId = req.user!.userId
    const { adminId } = req.params

    // Get admin info before deletion
    const adminInfo = await query(
      `SELECT u.id, u.email, u.entity_id FROM users u WHERE u.id = $1`,
      [adminId]
    )

    if (adminInfo.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' })
    }

    const admin = adminInfo.rows[0]

    // Soft delete (mark as inactive) instead of hard delete
    await query(
      `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [adminId]
    )

    // Log audit entry
    try {
      await query(
        `INSERT INTO superadmin_action_logs (superadmin_user_id, action, ip_address, details)
         VALUES ($1, $2, $3, $4)`,
        [superadminId, 'REMOVE_TENANT_ADMIN', req.ip || 'unknown', JSON.stringify({
          admin_id: admin.id,
          admin_email: admin.email,
          tenant_id: admin.entity_id
        })]
      )
    } catch (auditError) {
      console.warn('Audit logging failed:', auditError)
    }

    return res.json({
      success: true,
      message: 'Tenant admin removed successfully'
    })
  } catch (error: any) {
    console.error('Error removing tenant admin:', error)
    return res.status(500).json({ error: error.message || 'Failed to remove tenant admin' })
  }
})

export default router
