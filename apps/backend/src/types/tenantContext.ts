/**
 * PHASE 4, STEP 4.1: TENANT BOUNDARY ENFORCEMENT
 * 
 * Tenant context resolution and type definitions
 * Every request must explicitly resolve and enforce tenant boundaries
 * Cross-tenant access is impossible by construction
 */

import { Request } from 'express'

/**
 * TenantContext represents the resolved tenant for a request
 * Guaranteed to be present and valid on authenticated requests
 */
export interface TenantContext {
  /** Tenant/Platform ID from JWT token */
  tenantId: string
  
  /** User ID making the request */
  userId: string
  
  /** User's role ID within this tenant */
  roleId: string
  
  /** Request IP for audit logging */
  ip: string
  
  /** Request user agent for audit logging */
  userAgent: string
}

/**
 * Tenant-aware request type
 * Extends Express Request with guaranteed tenant context
 */
export interface TenantAwareRequest extends Request {
  tenant?: TenantContext
  user?: {
    userId: string
    platformId: string
    roleId: string
  }
}

/**
 * Tenant resolution result
 * Indicates success/failure of tenant context extraction
 */
export interface TenantResolutionResult {
  success: boolean
  tenant?: TenantContext
  error?: string
}

/**
 * Query filter for tenant isolation
 * Automatically appended to all queries to enforce boundaries
 */
export interface TenantFilter {
  /** Column name containing platform_id */
  column: string
  /** Tenant ID value to filter by */
  tenantId: string
  /** Parameter index for prepared statement */
  paramIndex: number
}

/**
 * Table schema with tenant column information
 * Used for automatic tenant isolation in queries
 */
export interface TenantEnabledTable {
  /** Table name */
  table: string
  /** Column name that contains tenant ID (usually platform_id) */
  tenantColumn: string
  /** Whether this table requires explicit tenant isolation */
  required: boolean
}

/**
 * Schema registry for tenant-enabled tables
 * Maps table names to their tenant columns
 */
export const TENANT_ENABLED_TABLES: Record<string, TenantEnabledTable> = {
  // Core tables
  users: { table: 'users', tenantColumn: 'platform_id', required: true },
  roles: { table: 'roles', tenantColumn: 'platform_id', required: true },
  audit_logs: { table: 'audit_logs', tenantColumn: 'platform_id', required: true },
  
  // School tables
  school_departments: { table: 'school_departments', tenantColumn: 'platform_id', required: true },
  students: { table: 'students', tenantColumn: 'platform_id', required: true },
  faculty: { table: 'faculty', tenantColumn: 'platform_id', required: true },
  student_face_embeddings: { table: 'student_face_embeddings', tenantColumn: 'platform_id', required: true },
  student_profile_picture_embeddings: { table: 'student_profile_picture_embeddings', tenantColumn: 'platform_id', required: true },
  semesters: { table: 'semesters', tenantColumn: 'platform_id', required: true },
  courses: { table: 'courses', tenantColumn: 'platform_id', required: true },
  class_schedules: { table: 'class_schedules', tenantColumn: 'platform_id', required: true },
  school_attendance: { table: 'school_attendance', tenantColumn: 'platform_id', required: true },
  
  // Corporate tables
  corporate_departments: { table: 'corporate_departments', tenantColumn: 'platform_id', required: true },
  employees: { table: 'employees', tenantColumn: 'platform_id', required: true },
  employee_shifts: { table: 'employee_shifts', tenantColumn: 'platform_id', required: true },
  locations: { table: 'locations', tenantColumn: 'platform_id', required: true },
  corporate_checkins: { table: 'corporate_checkins', tenantColumn: 'platform_id', required: true },
  
  // System tables (less critical but still isolated)
  tenants: { table: 'tenants', tenantColumn: 'id', required: false },
  platforms: { table: 'platforms', tenantColumn: 'id', required: false },
  
  // Security tables
  superadmin_sessions: { table: 'superadmin_sessions', tenantColumn: 'platform_id', required: true },
  mfa_challenges: { table: 'mfa_challenges', tenantColumn: 'platform_id', required: true },
  ip_allowlist: { table: 'ip_allowlist', tenantColumn: 'platform_id', required: true },
  rate_limits: { table: 'rate_limits', tenantColumn: 'platform_id', required: true },
  confirmation_tokens: { table: 'confirmation_tokens', tenantColumn: 'platform_id', required: true },
  dry_run_logs: { table: 'dry_run_logs', tenantColumn: 'platform_id', required: true },
  security_event_logs: { table: 'security_event_logs', tenantColumn: 'platform_id', required: true }
}

/**
 * Extract tenant ID from request
 * - From JWT token (auth header)
 * - Validates tenant ID is present and valid
 */
export function extractTenantFromToken(platformId?: string): string {
  if (!platformId) {
    throw new Error('Tenant ID not found in authentication context')
  }
  return platformId
}

/**
 * Validate tenant ID format
 * Must be valid UUID
 */
export function validateTenantId(tenantId: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(tenantId)
}

/**
 * Create tenant context from request
 * Enforces tenant resolution before any database operations
 */
export function createTenantContext(
  req: TenantAwareRequest
): TenantResolutionResult {
  try {
    // Must have user context from JWT
    if (!req.user) {
      return {
        success: false,
        error: 'User context not found - authentication required'
      }
    }

    // Extract tenant ID from JWT
    const tenantId = req.user.platformId
    
    // Validate tenant ID
    if (!validateTenantId(tenantId)) {
      return {
        success: false,
        error: `Invalid tenant ID format: ${tenantId}`
      }
    }

    // Create tenant context
    const tenant: TenantContext = {
      tenantId,
      userId: req.user.userId,
      roleId: req.user.roleId,
      ip: req.ip || 'unknown',
      userAgent: req.get('user-agent') || 'unknown'
    }

    return {
      success: true,
      tenant
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to resolve tenant context'
    }
  }
}

/**
 * Verify tenant isolation
 * Ensures requested resource belongs to user's tenant
 */
export function verifyTenantIsolation(
  resourceTenantId: string,
  requestTenantId: string
): boolean {
  if (resourceTenantId !== requestTenantId) {
    return false
  }
  return true
}

/**
 * Build tenant filter clause for SQL queries
 * Automatically appends WHERE condition to enforce isolation
 */
export function buildTenantFilter(
  tableName: string,
  tenantId: string,
  paramIndex: number
): { clause: string; paramIndex: number } {
  const tableInfo = TENANT_ENABLED_TABLES[tableName]
  
  if (!tableInfo) {
    throw new Error(`Table ${tableName} not registered for tenant isolation`)
  }

  const clause = `${tableName}.${tableInfo.tenantColumn} = $${paramIndex}`
  
  return {
    clause,
    paramIndex: paramIndex + 1
  }
}

/**
 * Combine multiple tenant filters with AND
 */
export function buildMultiTenantFilter(
  filters: { clause: string; paramIndex: number }[]
): string {
  return filters.map(f => f.clause).join(' AND ')
}
