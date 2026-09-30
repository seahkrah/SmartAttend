import { query } from './connection.js'
import type { ResolvedTenantContext } from '../auth/tenantContextMiddleware.js'

/**
 * Tenant-scoped data access.
 *
 * Every helper here takes the server-resolved context and puts tenant_id into
 * the WHERE clause or the INSERT, as a bound parameter. The point is that a
 * handler cannot read or write another tenant's rows by forgetting a filter —
 * the filter is not the handler's to forget.
 *
 * Two rules these functions exist to enforce:
 *
 *   1. Filter in the database, never in the application. Fetching broadly and
 *      discarding afterwards leaks through counts, pagination, timing and any
 *      later refactor that drops the post-filter.
 *   2. Ownership is assigned by the server on create and is not updatable.
 *      `updateScoped` refuses to set tenant_id, so a tenant cannot hand its
 *      row to another tenant through an ordinary update.
 */

/** Tables whose rows belong to exactly one tenant. */
export const TENANT_OWNED_TABLES = new Set([
  'students',
  'faculty',
  'courses',
  'class_schedules',
  'rooms',
  'semesters',
  'school_departments',
  'school_attendance',
  'student_courses',
  'faculty_courses',
  'course_sessions',
  'employees',
  'corporate_departments',
  'corporate_checkins',
  'work_assignments',
  'attendance_corrections',
  'face_recognition_enrollments',
  'face_recognition_verifications',
  'notification_campaigns',
  'notifications',
  'attendance_discrepancy_reports',
  'attendance_submissions',
])

/** Which platform a tenant-owned table belongs to. */
const TABLE_PLATFORM: Record<string, 'school' | 'corporate'> = {
  students: 'school',
  faculty: 'school',
  courses: 'school',
  class_schedules: 'school',
  rooms: 'school',
  semesters: 'school',
  school_departments: 'school',
  school_attendance: 'school',
  student_courses: 'school',
  faculty_courses: 'school',
  course_sessions: 'school',
  attendance_submissions: 'school',
  employees: 'corporate',
  corporate_departments: 'corporate',
  corporate_checkins: 'corporate',
  work_assignments: 'corporate',
}

export class TenantScopeError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'TenantScopeError'
  }
}

function assertIdentifier(name: string): void {
  // Table and column names are interpolated, so they must be proven safe.
  // Values always go through bound parameters.
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new TenantScopeError(`Unsafe identifier: ${name}`, 500)
  }
}

function assertTenantOwned(table: string): void {
  assertIdentifier(table)
  if (!TENANT_OWNED_TABLES.has(table)) {
    throw new TenantScopeError(`${table} is not a tenant-owned table`, 500)
  }
}

/**
 * Rejects a cross-platform read or write outright.
 *
 * Access to SMS must not imply access to EMS. Without this, a corporate
 * identity holding a school tenant id could reach school tables.
 */
function assertPlatformMatches(table: string, ctx: ResolvedTenantContext): void {
  const required = TABLE_PLATFORM[table]
  if (!required) return
  if (ctx.isSuperadmin) return
  if (ctx.platformKind !== required) {
    throw new TenantScopeError(
      `This resource belongs to the ${required} platform`,
      403
    )
  }
}

function tenantOf(ctx: ResolvedTenantContext): string {
  if (!ctx.tenantId) {
    throw new TenantScopeError('No tenant in context', 403)
  }
  return ctx.tenantId
}

export interface ListOptions {
  /** Extra conditions, written with $n placeholders continuing from the tenant param. */
  where?: string
  params?: unknown[]
  orderBy?: string
  limit?: number
  offset?: number
  columns?: string
}

/**
 * SELECT scoped to the caller's tenant.
 *
 * The tenant predicate is always $1 and is prepended, so caller-supplied
 * conditions start at $2 and cannot displace it.
 */
export async function listScoped<T = any>(
  table: string,
  ctx: ResolvedTenantContext,
  opts: ListOptions = {}
): Promise<T[]> {
  assertTenantOwned(table)
  assertPlatformMatches(table, ctx)
  const tenantId = tenantOf(ctx)

  const params: unknown[] = [tenantId, ...(opts.params ?? [])]
  let sql = `SELECT ${opts.columns ?? '*'} FROM ${table} WHERE tenant_id = $1`
  if (opts.where) sql += ` AND (${opts.where})`
  if (opts.orderBy) {
    // Only a comma-separated column list with optional direction.
    if (!/^[a-z_][a-z0-9_]*( (asc|desc))?(, ?[a-z_][a-z0-9_]*( (asc|desc))?)*$/i.test(opts.orderBy)) {
      throw new TenantScopeError('Unsafe orderBy', 500)
    }
    sql += ` ORDER BY ${opts.orderBy}`
  }
  if (opts.limit !== undefined) {
    params.push(opts.limit)
    sql += ` LIMIT $${params.length}`
  }
  if (opts.offset !== undefined) {
    params.push(opts.offset)
    sql += ` OFFSET $${params.length}`
  }

  const result = await query(sql, params)
  return result.rows
}

/** COUNT scoped to the caller's tenant, for correct pagination totals. */
export async function countScoped(
  table: string,
  ctx: ResolvedTenantContext,
  where?: string,
  params: unknown[] = []
): Promise<number> {
  assertTenantOwned(table)
  assertPlatformMatches(table, ctx)
  const tenantId = tenantOf(ctx)

  let sql = `SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1`
  if (where) sql += ` AND (${where})`
  const result = await query(sql, [tenantId, ...params])
  return result.rows[0]?.n ?? 0
}

/**
 * Fetch one row by id, scoped.
 *
 * Returns null for a row that exists but belongs to another tenant, which is
 * what makes an id guess indistinguishable from a miss — the defence against
 * IDOR/BOLA and against probing ids for existence.
 */
export async function findScoped<T = any>(
  table: string,
  ctx: ResolvedTenantContext,
  id: string,
  idColumn = 'id'
): Promise<T | null> {
  assertTenantOwned(table)
  assertIdentifier(idColumn)
  assertPlatformMatches(table, ctx)
  const tenantId = tenantOf(ctx)

  const result = await query(
    `SELECT * FROM ${table} WHERE tenant_id = $1 AND ${idColumn} = $2 LIMIT 1`,
    [tenantId, id]
  )
  return result.rows[0] ?? null
}

/**
 * INSERT with tenant ownership set by the server.
 *
 * Any tenant_id in `data` is discarded: ownership follows the authenticated
 * context, so a crafted body cannot plant a row in another tenant.
 */
export async function insertScoped<T = any>(
  table: string,
  ctx: ResolvedTenantContext,
  data: Record<string, unknown>
): Promise<T> {
  assertTenantOwned(table)
  assertPlatformMatches(table, ctx)
  const tenantId = tenantOf(ctx)

  const entries = Object.entries(data).filter(([k]) => k !== 'tenant_id' && k !== 'id')
  for (const [k] of entries) assertIdentifier(k)

  const columns = ['tenant_id', ...entries.map(([k]) => k)]
  const values = [tenantId, ...entries.map(([, v]) => v)]
  const placeholders = values.map((_, i) => `$${i + 1}`)

  const result = await query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    values
  )
  return result.rows[0]
}

/**
 * UPDATE scoped to the caller's tenant.
 *
 * tenant_id is never settable here. Reassigning ownership is a deliberate
 * administrative act, not something an ordinary update may do.
 *
 * Returns null when the row does not exist in this tenant, so the caller
 * answers 404 rather than revealing that the id belongs to someone else.
 */
export async function updateScoped<T = any>(
  table: string,
  ctx: ResolvedTenantContext,
  id: string,
  data: Record<string, unknown>,
  idColumn = 'id'
): Promise<T | null> {
  assertTenantOwned(table)
  assertIdentifier(idColumn)
  assertPlatformMatches(table, ctx)
  const tenantId = tenantOf(ctx)

  const entries = Object.entries(data).filter(
    ([k]) => k !== 'tenant_id' && k !== 'id' && k !== idColumn
  )
  if (entries.length === 0) {
    throw new TenantScopeError('No updatable fields supplied', 400)
  }
  for (const [k] of entries) assertIdentifier(k)

  const sets = entries.map(([k], i) => `${k} = $${i + 3}`)
  const values = [tenantId, id, ...entries.map(([, v]) => v)]

  const result = await query(
    `UPDATE ${table} SET ${sets.join(', ')}
      WHERE tenant_id = $1 AND ${idColumn} = $2
      RETURNING *`,
    values
  )
  return result.rows[0] ?? null
}

/** DELETE scoped to the caller's tenant. Null when not found in this tenant. */
export async function deleteScoped<T = any>(
  table: string,
  ctx: ResolvedTenantContext,
  id: string,
  idColumn = 'id'
): Promise<T | null> {
  assertTenantOwned(table)
  assertIdentifier(idColumn)
  assertPlatformMatches(table, ctx)
  const tenantId = tenantOf(ctx)

  const result = await query(
    `DELETE FROM ${table} WHERE tenant_id = $1 AND ${idColumn} = $2 RETURNING *`,
    [tenantId, id]
  )
  return result.rows[0] ?? null
}

/**
 * Confirms a set of ids all belong to the caller's tenant.
 *
 * For requests that reference related rows — enrolling students on a course,
 * assigning a room to a schedule — where each referenced id is its own
 * opportunity to reach across a tenant boundary.
 */
export async function assertAllInTenant(
  table: string,
  ctx: ResolvedTenantContext,
  ids: string[],
  idColumn = 'id'
): Promise<void> {
  if (ids.length === 0) return
  assertTenantOwned(table)
  assertIdentifier(idColumn)
  assertPlatformMatches(table, ctx)
  const tenantId = tenantOf(ctx)

  const unique = [...new Set(ids)]
  const result = await query(
    `SELECT ${idColumn} FROM ${table} WHERE tenant_id = $1 AND ${idColumn} = ANY($2::uuid[])`,
    [tenantId, unique]
  )
  if (result.rows.length !== unique.length) {
    throw new TenantScopeError('One or more referenced records do not exist in this tenant', 404)
  }
}
