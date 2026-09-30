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
import type { ResolvedTenantContext, TenantRequest } from './tenantContextMiddleware.js'

export type UserRole = 'superadmin' | 'tenant_admin' | 'user'
export type AuditScope = 'GLOBAL' | 'TENANT' | 'USER'

/**
 * Maps a real role name onto the three audit access levels.
 *
 * The rules table is keyed on 'tenant_admin', a name no role in this system
 * actually has. Every administrator therefore looked up an undefined rule and
 * the access check threw — which failed closed, but meant the audit API was
 * unusable for anyone but a superadmin.
 *
 * Anything unrecognised is a plain user, so a new role does not silently
 * acquire the ability to read other people's audit trail.
 */
const TENANT_ADMIN_ROLES = new Set(['admin', 'hr_director', 'manager', 'it'])

export function auditRoleOf(ctx: ResolvedTenantContext): UserRole {
  if (ctx.isSuperadmin) return 'superadmin'
  if (TENANT_ADMIN_ROLES.has(ctx.roleName)) return 'tenant_admin'
  return 'user'
}

/** The resolved context, or a refusal if the request never established one. */
export function contextOf(req: Request): ResolvedTenantContext {
  const ctx = (req as TenantRequest).ctx
  if (!ctx) {
    throw new Error('Access Denied: no resolved identity for this request')
  }
  return ctx
}

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
    if (requestedScope) {
      if (!AUDIT_ACCESS_RULES.tenant_admin.canRead.includes(requestedScope)) {
        throw new Error(`Access Denied: tenant_admin cannot access ${requestedScope} scope`);
      }
      whereConditions.push(`action_scope = $${paramNum}`);
      params.push(requestedScope);
      paramNum++;
    }
    // No implicit `action_scope IN ('TENANT','USER')` filter. action_scope is
    // set only by the newer service writers; the database triggers that record
    // attendance and enrolment changes leave it NULL, so that condition
    // silently hid most of the trail. Confinement is the tenant predicate
    // below, which is the thing that actually means "this school's history".
  } else if (userRole === 'user') {
    if (requestedScope && requestedScope !== 'USER') {
      throw new Error(`Access Denied: user cannot access ${requestedScope} scope`);
    }
    // Likewise: the actor predicate below is what confines a user to their own
    // entries, and it does not depend on a column half the writers never set.
  }

  // Enforce actor filtering (what user the log is about)
  if (userRole === 'superadmin') {
    // Superadmin can see all actors
    // No additional filtering unless specifically requested
  } else if (userRole === 'tenant_admin') {
    // An administrator sees their own tenant's trail and nothing else. Rows
    // with no tenant are platform-level events and are excluded, which
    // `tenant_id = $n` does by itself since NULL never matches.
    if (!tenantId) {
      throw new Error('Tenant ID required for tenant_admin audit access');
    }
    whereConditions.push(`tenant_id = $${paramNum}`);
    params.push(tenantId);
    paramNum++;
  } else {
    // A regular user sees only entries about themselves. Writers populate
    // either actor_id or user_id depending on which era of the schema they
    // were written against, so both are matched.
    whereConditions.push(`(actor_id = $${paramNum} OR user_id = $${paramNum})`);
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
  tenantId?: string;
}): Promise<string> {
  try {
    const result = await query(
      `INSERT INTO audit_access_log 
       (actor_id, actor_role, access_type, scope_accessed, filters_applied, results_count,
        ip_address, user_agent, request_id, verification_attempt, tenant_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
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
        event.tenantId || null,
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
  const ctx = contextOf(req);
  const userRole = auditRoleOf(ctx);
  const userId = ctx.userId;

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
    ctx.tenantId ?? undefined,
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
    tenantId: ctx.tenantId ?? undefined,
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
  const ctx = contextOf(req);
  const userRole = auditRoleOf(ctx);

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
      actorId: ctx.userId,
      actorRole: userRole,
      accessType: 'READ_AUDIT_LOGS_SUCCESS',
      scopeAccessed: baseFilters?.actionScope as AuditScope,
      filtersApplied: baseFilters,
      resultsCount: result.rows.length,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestId: (req as any).requestId,
      tenantId: ctx.tenantId ?? undefined,
    });
  } catch (e) {
    console.warn('[AUDIT] Could not log result count:', e);
  }

  return result.rows;
}


/**
 * The predicate that confines an audit read to what the caller may see.
 *
 * Returned as SQL plus bound parameters so callers can splice it into their
 * own query rather than fetching broadly and discarding afterwards. A
 * post-filter leaks through counts, pagination and the next refactor that
 * forgets it.
 *
 * `startAt` is the first placeholder number this predicate may use, so it
 * composes with a query that already binds parameters.
 */
export function auditVisibilityPredicate(
  ctx: ResolvedTenantContext,
  startAt = 1
): { sql: string; params: any[] } {
  const role = auditRoleOf(ctx)

  if (role === 'superadmin') {
    return { sql: 'TRUE', params: [] }
  }

  if (role === 'tenant_admin') {
    if (!ctx.tenantId) {
      throw new Error('Access Denied: no tenant resolved for this administrator')
    }
    return { sql: `tenant_id = $${startAt}`, params: [ctx.tenantId] }
  }

  return {
    sql: `(actor_id = $${startAt} OR user_id = $${startAt})`,
    params: [ctx.userId],
  }
}
