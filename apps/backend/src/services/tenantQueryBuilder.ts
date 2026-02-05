/**
 * PHASE 4, STEP 4.1: TENANT-AWARE QUERY BUILDER
 * 
 * Fluent query builder that automatically enforces tenant boundaries
 * Inspired by Knex/QueryBuilder patterns but with forced tenant isolation
 * 
 * Usage:
 *   const users = await TenantQuery.from('users')
 *     .where('role_id', roleId)
 *     .select('id', 'email')
 *     .withTenant(tenant)
 *     .execute()
 */

import { query } from '../db/connection.js'
import { TENANT_ENABLED_TABLES } from '../types/tenantContext.js'
import type { TenantContext } from '../types/tenantContext.js'

interface WhereCondition {
  column: string
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'IN' | 'LIKE'
  value: any
}

interface JoinCondition {
  type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'
  table: string
  on: string
}

/**
 * Tenant-aware query builder
 * Makes it impossible to query data outside of tenant context
 */
export class TenantQuery {
  private tableName: string
  private selectColumns: string[] = ['*']
  private conditions: WhereCondition[] = []
  private joinConditions: JoinCondition[] = []
  private orderByClause?: string
  private limitValue?: number
  private offsetValue?: number
  private tenant?: TenantContext
  private params: any[] = []

  private constructor(table: string) {
    this.tableName = table
  }

  /**
   * Create a query builder for a table
   */
  static from(table: string): TenantQuery {
    const tableInfo = TENANT_ENABLED_TABLES[table]
    if (!tableInfo) {
      throw new Error(`Table ${table} not registered for tenant isolation`)
    }
    return new TenantQuery(table)
  }

  /**
   * Select specific columns (default: *)
   */
  select(...columns: string[]): TenantQuery {
    if (columns.length > 0) {
      this.selectColumns = columns
    }
    return this
  }

  /**
   * Add WHERE condition
   */
  where(column: string, operator: string, value?: any): TenantQuery {
    // Handle where(column, value) syntax
    if (value === undefined) {
      value = operator
      operator = '='
    }

    this.conditions.push({
      column,
      operator: operator as any,
      value
    })
    return this
  }

  /**
   * Add WHERE IN condition
   */
  whereIn(column: string, values: any[]): TenantQuery {
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error('whereIn requires a non-empty array')
    }
    this.conditions.push({
      column,
      operator: 'IN',
      value: values
    })
    return this
  }

  /**
   * Add WHERE LIKE condition
   */
  whereLike(column: string, pattern: string): TenantQuery {
    this.conditions.push({
      column,
      operator: 'LIKE',
      value: pattern
    })
    return this
  }

  /**
   * Add JOIN clause
   */
  join(table: string, onCondition: string, type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' = 'INNER'): TenantQuery {
    this.joinConditions.push({ type, table, on: onCondition })
    return this
  }

  /**
   * Add ORDER BY clause
   */
  orderBy(clause: string): TenantQuery {
    this.orderByClause = clause
    return this
  }

  /**
   * Add LIMIT
   */
  limit(count: number): TenantQuery {
    this.limitValue = count
    return this
  }

  /**
   * Add OFFSET
   */
  offset(count: number): TenantQuery {
    this.offsetValue = count
    return this
  }

  /**
   * REQUIRED: Attach tenant context
   * Query cannot be executed without this
   */
  withTenant(tenant: TenantContext): TenantQuery {
    this.tenant = tenant
    return this
  }

  /**
   * Build the SQL query string
   * Automatically includes tenant filter
   */
  private buildSQL(): { sql: string; params: any[] } {
    if (!this.tenant) {
      throw new Error('Tenant context required - call withTenant() before executing')
    }

    const tableInfo = TENANT_ENABLED_TABLES[this.tableName]
    if (!tableInfo) {
      throw new Error(`Table ${this.tableName} not registered for tenant isolation`)
    }

    let sql = `SELECT ${this.selectColumns.join(', ')} FROM ${this.tableName}`
    let paramIndex = 1
    const params: any[] = []

    // Add JOINs
    for (const join of this.joinConditions) {
      sql += ` ${join.type} JOIN ${join.table} ON ${join.on}`
    }

    // Add WHERE clause with tenant enforcement
    const whereConditions: string[] = []
    
    // Always include tenant filter
    whereConditions.push(`${this.tableName}.${tableInfo.tenantColumn} = $${paramIndex}`)
    params.push(this.tenant.tenantId)
    paramIndex++

    // Add user-specified conditions
    for (const cond of this.conditions) {
      if (cond.operator === 'IN') {
        const placeholders = (cond.value as any[])
          .map(() => `$${paramIndex++}`)
          .join(', ')
        whereConditions.push(`${cond.column} IN (${placeholders})`)
        params.push(...(cond.value as any[]))
      } else if (cond.operator === 'LIKE') {
        whereConditions.push(`${cond.column} LIKE $${paramIndex}`)
        params.push(cond.value)
        paramIndex++
      } else {
        whereConditions.push(`${cond.column} ${cond.operator} $${paramIndex}`)
        params.push(cond.value)
        paramIndex++
      }
    }

    if (whereConditions.length > 0) {
      sql += ` WHERE ${whereConditions.join(' AND ')}`
    }

    // Add ORDER BY
    if (this.orderByClause) {
      sql += ` ORDER BY ${this.orderByClause}`
    }

    // Add LIMIT
    if (this.limitValue !== undefined) {
      sql += ` LIMIT $${paramIndex}`
      params.push(this.limitValue)
      paramIndex++
    }

    // Add OFFSET
    if (this.offsetValue !== undefined) {
      sql += ` OFFSET $${paramIndex}`
      params.push(this.offsetValue)
      paramIndex++
    }

    return { sql, params }
  }

  /**
   * Execute query and return all rows
   */
  async execute() {
    const { sql, params } = this.buildSQL()
    const result = await query(sql, params)
    return result.rows
  }

  /**
   * Execute query and return first row only
   */
  async first() {
    const { sql, params } = this.buildSQL()
    const result = await query(sql, params)
    return result.rows[0] || null
  }

  /**
   * Count rows matching query
   */
  async count(): Promise<number> {
    if (!this.tenant) {
      throw new Error('Tenant context required - call withTenant() before executing')
    }

    const tableInfo = TENANT_ENABLED_TABLES[this.tableName]
    
    let sql = `SELECT COUNT(*) as count FROM ${this.tableName}`
    let paramIndex = 1
    const params: any[] = []

    // Add JOINs (for correct counting with joins)
    for (const join of this.joinConditions) {
      sql += ` ${join.type} JOIN ${join.table} ON ${join.on}`
    }

    // Add WHERE clause
    const whereConditions: string[] = []
    
    whereConditions.push(`${this.tableName}.${tableInfo.tenantColumn} = $${paramIndex}`)
    params.push(this.tenant.tenantId)
    paramIndex++

    for (const cond of this.conditions) {
      if (cond.operator === 'IN') {
        const placeholders = (cond.value as any[])
          .map(() => `$${paramIndex++}`)
          .join(', ')
        whereConditions.push(`${cond.column} IN (${placeholders})`)
        params.push(...(cond.value as any[]))
      } else if (cond.operator === 'LIKE') {
        whereConditions.push(`${cond.column} LIKE $${paramIndex}`)
        params.push(cond.value)
        paramIndex++
      } else {
        whereConditions.push(`${cond.column} ${cond.operator} $${paramIndex}`)
        params.push(cond.value)
        paramIndex++
      }
    }

    if (whereConditions.length > 0) {
      sql += ` WHERE ${whereConditions.join(' AND ')}`
    }

    const result = await query(sql, params)
    return parseInt(result.rows[0].count, 10)
  }

  /**
   * Get SQL string without executing
   * Useful for debugging
   */
  toSQL(): string {
    const { sql } = this.buildSQL()
    return sql
  }

  /**
   * Get full SQL with params for debugging
   */
  debug(): { sql: string; params: any[] } {
    return this.buildSQL()
  }
}

/**
 * Helper for bulk operations with tenant enforcement
 */
export class TenantBulkOperation {
  private tenant: TenantContext

  constructor(tenant: TenantContext) {
    this.tenant = tenant
  }

  /**
   * Batch insert multiple records
   * All records automatically assigned to tenant
   */
  async insertMany(table: string, records: any[]) {
    if (records.length === 0) {
      return { inserted: 0, records: [] }
    }

    const tableInfo = TENANT_ENABLED_TABLES[table]
    if (!tableInfo) {
      throw new Error(`Table ${table} not registered for tenant isolation`)
    }

    // Add tenant to all records
    const recordsWithTenant = records.map(r => ({
      ...r,
      [tableInfo.tenantColumn]: this.tenant.tenantId
    }))

    const firstRecord = recordsWithTenant[0]
    const columns = Object.keys(firstRecord)
    
    // Validate all records have same columns
    for (const record of recordsWithTenant) {
      if (Object.keys(record).join(',') !== columns.join(',')) {
        throw new Error('All records must have identical columns')
      }
    }

    let sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n`
    const params: any[] = []
    let paramIndex = 1

    for (let i = 0; i < recordsWithTenant.length; i++) {
      const placeholders = columns.map(() => `$${paramIndex++}`).join(', ')
      sql += `(${placeholders})${i < recordsWithTenant.length - 1 ? ',\n' : '\n'}`
      params.push(...columns.map(col => recordsWithTenant[i][col]))
    }

    sql += ' RETURNING *'

    const result = await query(sql, params)
    
    return {
      inserted: result.rows.length,
      records: result.rows
    }
  }

  /**
   * Batch update with WHERE conditions
   */
  async updateWhere(
    table: string,
    updates: { [key: string]: any },
    whereConditions: { [key: string]: any }
  ) {
    const tableInfo = TENANT_ENABLED_TABLES[table]
    if (!tableInfo) {
      throw new Error(`Table ${table} not registered for tenant isolation`)
    }

    const updateColumns = Object.keys(updates)
      .map((col, i) => `${col} = $${i + 1}`)
      .join(', ')

    let sql = `UPDATE ${table} SET ${updateColumns} WHERE ${tableInfo.tenantColumn} = $${Object.keys(updates).length + 1}`
    const params: any[] = [...Object.values(updates), this.tenant.tenantId]
    let paramIndex = Object.keys(updates).length + 2

    // Add WHERE conditions
    for (const [col, val] of Object.entries(whereConditions)) {
      sql += ` AND ${col} = $${paramIndex}`
      params.push(val)
      paramIndex++
    }

    sql += ' RETURNING *'

    const result = await query(sql, params)
    
    return {
      updated: result.rowCount || 0,
      records: result.rows
    }
  }

  /**
   * Batch delete with WHERE conditions
   */
  async deleteWhere(
    table: string,
    whereConditions: { [key: string]: any }
  ) {
    const tableInfo = TENANT_ENABLED_TABLES[table]
    if (!tableInfo) {
      throw new Error(`Table ${table} not registered for tenant isolation`)
    }

    let sql = `DELETE FROM ${table} WHERE ${tableInfo.tenantColumn} = $1`
    const params: any[] = [this.tenant.tenantId]
    let paramIndex = 2

    for (const [col, val] of Object.entries(whereConditions)) {
      sql += ` AND ${col} = $${paramIndex}`
      params.push(val)
      paramIndex++
    }

    sql += ' RETURNING *'

    const result = await query(sql, params)
    
    return {
      deleted: result.rowCount || 0,
      records: result.rows
    }
  }
}
