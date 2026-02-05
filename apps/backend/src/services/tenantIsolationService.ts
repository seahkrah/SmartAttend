/**
 * PHASE 4, STEP 4.1: TENANT ISOLATION SERVICE
 * 
 * Service layer that enforces tenant boundaries
 * All data access operations must go through this layer
 * Makes cross-tenant access impossible by construction
 */

import { query } from '../db/connection.js'
import type { TenantContext } from '../types/tenantContext.js'
import { verifyTenantIsolation, TENANT_ENABLED_TABLES } from '../types/tenantContext.js'

/**
 * Tenant Isolation Service
 * Every database operation is automatically scoped to tenant
 * Violations throw errors instead of failing silently
 */
export class TenantIsolationService {
  /**
   * Execute query with automatic tenant filtering
   * 
   * Usage:
   *   const users = await tenantService.queryWithTenant(
   *     tenant,
   *     'SELECT * FROM users WHERE role_id = $1',
   *     [roleId]
   *   )
   * 
   * Automatically becomes:
   *   SELECT * FROM users WHERE role_id = $1 AND platform_id = $2
   */
  static async queryWithTenant(
    tenant: TenantContext,
    sql: string,
    params: any[] = []
  ) {
    // Automatically append tenant filter
    const tenantFiltered = this.appendTenantFilter(sql, tenant.tenantId, params.length + 1)
    
    return query(tenantFiltered.sql, [...params, tenant.tenantId])
  }

  /**
   * Get single record scoped to tenant
   * Throws if record doesn't exist or belongs to different tenant
   */
  static async getRecordByIdAndTenant(
    tenant: TenantContext,
    table: string,
    recordId: string,
    idColumn: string = 'id'
  ) {
    const tableInfo = TENANT_ENABLED_TABLES[table]
    if (!tableInfo) {
      throw new Error(`Table ${table} not registered for tenant isolation`)
    }

    const sql = `
      SELECT * FROM ${table}
      WHERE ${idColumn} = $1 AND ${tableInfo.tenantColumn} = $2
    `
    
    const result = await query(sql, [recordId, tenant.tenantId])
    
    if (result.rows.length === 0) {
      throw new Error(`${table} record not found or access denied`)
    }
    
    return result.rows[0]
  }

  /**
   * List records scoped to tenant with filtering
   */
  static async listRecordsByTenant(
    tenant: TenantContext,
    table: string,
    options: {
      where?: { [key: string]: any }
      orderBy?: string
      limit?: number
      offset?: number
    } = {}
  ) {
    const tableInfo = TENANT_ENABLED_TABLES[table]
    if (!tableInfo) {
      throw new Error(`Table ${table} not registered for tenant isolation`)
    }

    let sql = `SELECT * FROM ${table} WHERE ${tableInfo.tenantColumn} = $1`
    const params: any[] = [tenant.tenantId]

    // Add additional filters
    if (options.where) {
      Object.entries(options.where).forEach(([key, value]) => {
        sql += ` AND ${key} = $${params.length + 1}`
        params.push(value)
      })
    }

    // Add ordering
    if (options.orderBy) {
      sql += ` ORDER BY ${options.orderBy}`
    }

    // Add pagination
    if (options.limit) {
      sql += ` LIMIT $${params.length + 1}`
      params.push(options.limit)
    }
    if (options.offset) {
      sql += ` OFFSET $${params.length + 1}`
      params.push(options.offset)
    }

    const result = await query(sql, params)
    
    return {
      records: result.rows,
      count: result.rows.length,
      total: result.rowCount || 0
    }
  }

  /**
   * Insert record with automatic tenant assignment
   * Makes it impossible to insert record into wrong tenant
   */
  static async insertRecordWithTenant(
    tenant: TenantContext,
    table: string,
    data: { [key: string]: any }
  ) {
    const tableInfo = TENANT_ENABLED_TABLES[table]
    if (!tableInfo) {
      throw new Error(`Table ${table} not registered for tenant isolation`)
    }

    // Force tenant ID in data
    const dataWithTenant = {
      ...data,
      [tableInfo.tenantColumn]: tenant.tenantId
    }

    const columns = Object.keys(dataWithTenant)
    const values = Object.values(dataWithTenant)
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ')

    const sql = `
      INSERT INTO ${table} (${columns.join(', ')})
      VALUES (${placeholders})
      RETURNING *
    `

    const result = await query(sql, values)
    
    if (result.rows.length === 0) {
      throw new Error(`Failed to insert record into ${table}`)
    }
    
    return result.rows[0]
  }

  /**
   * Update record with tenant verification
   * Ensures update only happens on tenant's own records
   */
  static async updateRecordWithTenant(
    tenant: TenantContext,
    table: string,
    recordId: string,
    updates: { [key: string]: any },
    idColumn: string = 'id'
  ) {
    const tableInfo = TENANT_ENABLED_TABLES[table]
    if (!tableInfo) {
      throw new Error(`Table ${table} not registered for tenant isolation`)
    }

    // Verify record belongs to tenant before updating
    await this.getRecordByIdAndTenant(tenant, table, recordId, idColumn)

    const setColumns = Object.keys(updates)
      .map((col, i) => `${col} = $${i + 2}`)
      .join(', ')

    const sql = `
      UPDATE ${table}
      SET ${setColumns}
      WHERE ${idColumn} = $1 AND ${tableInfo.tenantColumn} = $${Object.keys(updates).length + 2}
      RETURNING *
    `

    const values = [recordId, ...Object.values(updates), tenant.tenantId]
    const result = await query(sql, values)
    
    if (result.rows.length === 0) {
      throw new Error(`Failed to update ${table} record`)
    }
    
    return result.rows[0]
  }

  /**
   * Delete record with tenant verification
   * Impossible to delete record from wrong tenant
   */
  static async deleteRecordWithTenant(
    tenant: TenantContext,
    table: string,
    recordId: string,
    idColumn: string = 'id'
  ) {
    const tableInfo = TENANT_ENABLED_TABLES[table]
    if (!tableInfo) {
      throw new Error(`Table ${table} not registered for tenant isolation`)
    }

    // Verify record belongs to tenant before deleting
    await this.getRecordByIdAndTenant(tenant, table, recordId, idColumn)

    const sql = `
      DELETE FROM ${table}
      WHERE ${idColumn} = $1 AND ${tableInfo.tenantColumn} = $2
      RETURNING *
    `

    const result = await query(sql, [recordId, tenant.tenantId])
    
    if (result.rows.length === 0) {
      throw new Error(`Failed to delete ${table} record`)
    }
    
    return result.rows[0]
  }

  /**
   * Count records for tenant
   */
  static async countRecordsByTenant(
    tenant: TenantContext,
    table: string,
    where?: { [key: string]: any }
  ): Promise<number> {
    const tableInfo = TENANT_ENABLED_TABLES[table]
    if (!tableInfo) {
      throw new Error(`Table ${table} not registered for tenant isolation`)
    }

    let sql = `SELECT COUNT(*) as count FROM ${table} WHERE ${tableInfo.tenantColumn} = $1`
    const params: any[] = [tenant.tenantId]

    if (where) {
      Object.entries(where).forEach(([key, value]) => {
        sql += ` AND ${key} = $${params.length + 1}`
        params.push(value)
      })
    }

    const result = await query(sql, params)
    return parseInt(result.rows[0].count, 10)
  }

  /**
   * Execute JOIN query with automatic tenant filtering on primary table
   * Joins are safe but the WHERE condition enforces tenant on main table
   */
  static async queryWithJoinAndTenant(
    tenant: TenantContext,
    primaryTable: string,
    sql: string,
    params: any[] = []
  ) {
    const tableInfo = TENANT_ENABLED_TABLES[primaryTable]
    if (!tableInfo) {
      throw new Error(`Table ${primaryTable} not registered for tenant isolation`)
    }

    // Append tenant filter for primary table
    const tenantFiltered = this.appendTenantFilter(
      sql,
      tenant.tenantId,
      params.length + 1,
      primaryTable
    )

    return query(tenantFiltered.sql, [...params, tenant.tenantId])
  }

  /**
   * Get tenant's aggregated statistics
   * Counts, sums, etc. automatically scoped to tenant
   */
  static async getAggregateStats(
    tenant: TenantContext,
    table: string,
    aggregates: { [key: string]: string }
  ) {
    const tableInfo = TENANT_ENABLED_TABLES[table]
    if (!tableInfo) {
      throw new Error(`Table ${table} not registered for tenant isolation`)
    }

    const aggregateColumns = Object.entries(aggregates)
      .map(([alias, agg]) => `${agg} as ${alias}`)
      .join(', ')

    const sql = `
      SELECT ${aggregateColumns}
      FROM ${table}
      WHERE ${tableInfo.tenantColumn} = $1
    `

    const result = await query(sql, [tenant.tenantId])
    return result.rows[0] || {}
  }

  /**
   * Helper: Append tenant filter to existing SQL
   * Handles WHERE clause presence detection
   */
  private static appendTenantFilter(
    sql: string,
    tenantId: string,
    paramIndex: number,
    tableName?: string
  ): { sql: string; paramIndex: number } {
    const prefix = tableName ? `${tableName}.` : ''
    const tenantFilter = `${prefix}platform_id = $${paramIndex}`

    let filteredSql = sql

    // Check if SQL already has WHERE clause
    if (sql.toUpperCase().includes('WHERE')) {
      // Add to existing WHERE with AND
      filteredSql = sql.replace(/WHERE\s+/i, `WHERE ${tenantFilter} AND `)
    } else {
      // Add new WHERE clause
      // Find appropriate place (before ORDER BY, LIMIT, etc)
      const orderByMatch = sql.match(/\s+(ORDER BY|GROUP BY|LIMIT|OFFSET)/i)
      if (orderByMatch) {
        const index = sql.indexOf(orderByMatch[0])
        filteredSql = sql.slice(0, index) + ` WHERE ${tenantFilter} ` + sql.slice(index)
      } else {
        filteredSql = sql + ` WHERE ${tenantFilter}`
      }
    }

    return {
      sql: filteredSql,
      paramIndex: paramIndex + 1
    }
  }
}

/**
 * Type-safe wrapper for common operations
 * Use this to ensure tenant context is always passed
 */
export function createTenantBoundaryChecker(tenant: TenantContext) {
  return {
    // Verify a resource belongs to this tenant
    async verify<T extends { platform_id?: string }>(
      resource: T,
      resourceName: string = 'Resource'
    ): Promise<T> {
      if (!resource || resource.platform_id !== tenant.tenantId) {
        throw new Error(`${resourceName} access denied: tenant boundary violation`)
      }
      return resource
    },

    // Query wrapper
    query: (sql: string, params?: any[]) =>
      TenantIsolationService.queryWithTenant(tenant, sql, params),

    // Common operations
    getById: (table: string, id: string, idCol?: string) =>
      TenantIsolationService.getRecordByIdAndTenant(tenant, table, id, idCol),

    list: (table: string, options?: any) =>
      TenantIsolationService.listRecordsByTenant(tenant, table, options),

    insert: (table: string, data: any) =>
      TenantIsolationService.insertRecordWithTenant(tenant, table, data),

    update: (table: string, id: string, updates: any, idCol?: string) =>
      TenantIsolationService.updateRecordWithTenant(tenant, table, id, updates, idCol),

    delete: (table: string, id: string, idCol?: string) =>
      TenantIsolationService.deleteRecordWithTenant(tenant, table, id, idCol),

    count: (table: string, where?: any) =>
      TenantIsolationService.countRecordsByTenant(tenant, table, where)
  }
}
