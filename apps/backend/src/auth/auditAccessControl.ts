/**
 * Audit Access Control & Scope Enforcement
 * 
 * Phase 10.2: Role-based access control for audit logs
 * 
 * Implements:
 * - Scope-based access restrictions (GLOBAL, TENANT, USER)
 * - Role-based filtering (superadmin, tenant_admin, user)
 * - Audit access logging (audit the auditors)
 */

import { query } from '../db/connection.js'
import { Request } from 'express'

export type UserRole = 'superadmin' | 'tenant_admin' | 'user'
export type AuditScope = 'GLOBAL' | 'TENANT' | 'USER'

/**
 * Access Control Rules
 * 
 * Determines what scope of logs a user can access based on their role
 */

export const AUDIT_ACCESS_RULES = {
  superadmin: {
    canRead: ['GLOBAL', 'TENANT', 'USER'] as AuditScope[],
    canAccessAllActors: true,
    description: 'Read all logs (GLOBAL, TENANT, USER)',
  },
  tenant_admin: {
    canRead: ['TENANT', 'USER'] as AuditScope[],
    canAccessAllActors: false, // Limited to tenant
    description: 'Read TENANT and USER logs for own tenant',
  },
  user: {
    canRead: ['USER'] as AuditScope[],
    canAccessAllActors: false, // Can only read own logs
    description: 'Read USER logs for own user only',
  },
} as const;

/**
 * Validate that a user has permission to access logs of a specific scope
 * 
 * @param userRole - Role of the user requesting access
 * @param requestedScope - Scope of logs they're trying to access
 * @returns - true if allowed, false if denied
 */
export function canAccessScope(userRole: UserRole, requestedScope?: AuditScope): boolean {
  const rules = AUDIT_ACCESS_RULES[userRole];
  
  // If no scope specified, allow (will be filtered by actor)
  if (!requestedScope) {
    return true;
  }
  
  return rules.canRead.includes(requestedScope);
}

/**
 * Build access-controlled WHERE clause for audit log queries
 * 
 * Enforces:
 * - Scope filtering based on role
 * - Actor filtering (non-superadmin can't see all actors)
 * 
 * @param userRole - Role of the requesting user
 * @param userId - ID of the requesting user
 * @param tenantId - Tenant ID (for tenant_admin scope)
 * @param requestedScope - Requested scope filter
 * @returns - WHERE clause conditions to enforce access control
 */
export function buildAccessControlWhere(
  userRole: UserRole,
  userId: string,
  tenantId?: string,
  requestedScope?: AuditScope
): { whereConditions: string[]; params: any[] } {
  const whereConditions: string[] = [];
  const params: any[] = [];
  let paramNum = 1;

  // Enforce scope access based on role
  if (userRole === 'superadmin') {
    // Superadmin can see all scopes
    if (requestedScope) {
      whereConditions.push(`action_scope = $${paramNum}`);
      params.push(requestedScope);
      paramNum++;
    }
  } else if (userRole === 'tenant_admin') {
    // Tenant admin can only see TENANT and USER scopes
    whereConditions.push(`action_scope IN ('TENANT', 'USER')`);
    
    // Further restrict to own tenant
    if (requestedScope) {
      if (!AUDIT_ACCESS_RULES.tenant_admin.canRead.includes(requestedScope)) {
        throw new Error(`Access Denied: tenant_admin cannot access ${requestedScope} scope`);
      }
    }
  } else if (userRole === 'user') {
    // Regular user can only see USER scope
    whereConditions.push(`action_scope = 'USER'`);
    
    if (requestedScope && requestedScope !== 'USER') {
      throw new Error(`Access Denied: user cannot access ${requestedScope} scope`);
    }
  }

  // Enforce actor filtering (what user the log is about)
  if (userRole === 'superadmin') {
    // Superadmin can see all actors
    // No additional filtering unless specifically requested
  } else if (userRole === 'tenant_admin') {
    // Tenant admin can only see logs from their tenant.
    // Enforce strict tenant-based filtering using tenant_id.
    if (!tenantId) {
      throw new Error('Tenant ID required for tenant_admin audit access');
    }
    whereConditions.push(`tenant_id = $${paramNum}`);
    params.push(tenantId);
    paramNum++;
  } else {
    // Regular user can only see their own logs
    whereConditions.push(`actor_id = $${paramNum}`);
    params.push(userId);
    paramNum++;
  }

  return { whereConditions, params };
}

/**
 * Log an audit access event
 * 
 * Tracks who accessed audit logs and what they viewed
 * This log is immutable (append-only)
 * 
 * @param event - Access event to log
 * @returns - ID of created access log entry
 */
export async function logAuditAccess(event: {
  actorId: string;
  actorRole: UserRole;
  accessType: string;
  scopeAccessed?: AuditScope;
  filtersApplied?: any;
  resultsCount?: number;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  verificationAttempt?: boolean;
}): Promise<string> {
  try {
    const result = await query(
      `INSERT INTO audit_access_log 
       (actor_id, actor_role, access_type, scope_accessed, filters_applied, results_count,
        ip_address, user_agent, request_id, verification_attempt, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
       RETURNING id`,
      [
        event.actorId,
        event.actorRole,
        event.accessType,
        event.scopeAccessed || null,
        event.filtersApplied ? JSON.stringify(event.filtersApplied) : null,
        event.resultsCount || 0,
        event.ipAddress || null,
        event.userAgent || null,
        event.requestId || null,
        event.verificationAttempt || false,
      ]
    );

    return result.rows[0].id;
  } catch (error) {
    console.error('[AUDIT] Failed to log audit access:', error);
    throw error;
  }
}

/**
 * Middleware: Enforce audit log access control
 * 
 * Validates user has permission to access requested audit logs
 * Logs the access attempt
 * 
 * @param req - Express request (must have user object)
 * @param requestedScope - Scope being requested
 * @returns - Access control decision + any WHERE clause enforcement
 * @throws - If access denied
 */
export async function enforceAuditAccess(
  req: Request,
  requestedScope?: AuditScope
): Promise<{
  allowed: boolean;
  where: ReturnType<typeof buildAccessControlWhere>;
  accessLogId: string;
}> {
  const user = req.user as any;
  const userRole = user?.role as UserRole || 'user';
  const userId = user?.userId || 'unknown';

  // Check scope access
  if (!canAccessScope(userRole, requestedScope)) {
    // Log the denied access attempt
    try {
      await logAuditAccess({
        actorId: userId,
        actorRole: userRole,
        accessType: 'READ_AUDIT_LOGS_DENIED',
        scopeAccessed: requestedScope,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestId: (req as any).requestId,
      });
    } catch (e) {
      console.warn('[AUDIT] Could not log denied access:', e);
    }

    throw new Error(
      `Access Denied: ${userRole} cannot access ${requestedScope || 'AUDIT'} scope logs`
    );
  }

  // Build WHERE clause for access control
  const where = buildAccessControlWhere(
    userRole,
    userId,
    user?.tenantId,
    requestedScope
  );

  // Log the allowed access
  const accessLogId = await logAuditAccess({
    actorId: userId,
    actorRole: userRole,
    accessType: 'READ_AUDIT_LOGS',
    scopeAccessed: requestedScope,
    filtersApplied: { /* Provide actual filters used */ },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    requestId: (req as any).requestId,
  });

  return {
    allowed: true,
    where,
    accessLogId,
  };
}

/**
 * Query audit logs with enforced access control
 * 
 * This is the function that should be used in route handlers
 * It enforces all access control rules
 * 
 * @param req - Express request
 * @param baseFilters - Base query filters
 * @returns - Results of access-controlled query
 */
export async function queryAuditLogsWithAccessControl(
  req: Request,
  baseFilters?: {
    actionType?: string;
    actionScope?: string;
    resourceType?: string;
    resourceId?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
    offset?: number;
  }
): Promise<any[]> {
  const user = req.user as any;
  const userRole = user?.role as UserRole || 'user';

  // Enforce access control
  const access = await enforceAuditAccess(req, baseFilters?.actionScope as AuditScope);

  // Build SQL query with access control WHERE clause
  let sql = 'SELECT * FROM audit_logs WHERE 1=1';
  const params: any[] = [];
  let paramNum = 1;

  // Add access control WHERE conditions
  for (const condition of access.where.whereConditions) {
    sql += ` AND ${condition}`;
  }
  params.push(...access.where.params);
  paramNum += access.where.params.length;

  // Add filter conditions
  if (baseFilters?.actionType) {
    sql += ` AND action_type = $${paramNum}`;
    params.push(baseFilters.actionType);
    paramNum++;
  }

  if (baseFilters?.resourceType) {
    sql += ` AND resource_type = $${paramNum}`;
    params.push(baseFilters.resourceType);
    paramNum++;
  }

  if (baseFilters?.resourceId) {
    sql += ` AND resource_id = $${paramNum}`;
    params.push(baseFilters.resourceId);
    paramNum++;
  }

  if (baseFilters?.startTime) {
    sql += ` AND created_at >= $${paramNum}`;
    params.push(baseFilters.startTime);
    paramNum++;
  }

  if (baseFilters?.endTime) {
    sql += ` AND created_at <= $${paramNum}`;
    params.push(baseFilters.endTime);
    paramNum++;
  }

  // Add pagination
  const limit = Math.min(baseFilters?.limit || 100, 10000);
  const offset = baseFilters?.offset || 0;

  sql += ` ORDER BY created_at DESC LIMIT $${paramNum} OFFSET $${paramNum + 1}`;
  params.push(limit, offset);

  // Execute query
  const result = await query(sql, params);

  // Log the successful query with result count
  try {
    await logAuditAccess({
      actorId: user?.userId || 'unknown',
      actorRole: userRole,
      accessType: 'READ_AUDIT_LOGS_SUCCESS',
      scopeAccessed: baseFilters?.actionScope as AuditScope,
      filtersApplied: baseFilters,
      resultsCount: result.rows.length,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestId: (req as any).requestId,
    });
  } catch (e) {
    console.warn('[AUDIT] Could not log result count:', e);
  }

  return result.rows;
}
