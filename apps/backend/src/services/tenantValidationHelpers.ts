/**
 * PHASE 4, STEP 4.1: TENANT VALIDATION HELPERS FOR SERVICES
 * 
 * Decorators and utilities for service layer tenant validation
 * Makes tenant checks explicit in business logic
 */

import type { TenantContext } from '../types/tenantContext.js'
import { TenantIsolationService } from './tenantIsolationService.js'

/**
 * Validate tenant context for service method
 * Used in service layer functions to ensure tenant is present
 */
export function validateTenantContext(tenant: TenantContext | undefined): asserts tenant is TenantContext {
  if (!tenant) {
    throw new Error('Tenant context required for this operation')
  }
  if (!tenant.tenantId) {
    throw new Error('Invalid tenant context: missing tenant ID')
  }
  if (!tenant.userId) {
    throw new Error('Invalid tenant context: missing user ID')
  }
}

/**
 * Validate resource ownership
 * Ensures a resource belongs to the authenticated tenant
 */
export async function validateResourceOwnership(
  tenant: TenantContext,
  resource: any,
  table: string,
  resourceName: string = 'Resource'
): Promise<void> {
  if (!resource) {
    throw new Error(`${resourceName} not found`)
  }

  const tableInfo = require('../types/tenantContext.js').TENANT_ENABLED_TABLES[table]
  if (!tableInfo) {
    throw new Error(`Table ${table} not registered for tenant isolation`)
  }

  const resourceTenantId = resource[tableInfo.tenantColumn]
  
  if (resourceTenantId !== tenant.tenantId) {
    const tenantFromDb = resourceTenantId?.substring(0, 8) || 'unknown'
    const authTenant = tenant.tenantId.substring(0, 8)
    console.warn(
      `[SECURITY] Tenant boundary violation: User from tenant ${authTenant} attempted to access ${resourceName} in tenant ${tenantFromDb}`
    )
    throw new Error(`${resourceName} access denied: not owned by your tenant`)
  }
}

/**
 * Validate cross-tenant relationship
 * For operations that involve multiple resources, ensure all belong to same tenant
 */
export async function validateRelationshipTenant(
  tenant: TenantContext,
  relationships: Array<{
    resource: any
    table: string
    name: string
  }>
): Promise<void> {
  for (const { resource, table, name } of relationships) {
    await validateResourceOwnership(tenant, resource, table, name)
  }
}

/**
 * Validate bulk operation ownership
 * Ensures all records in a batch belong to tenant
 */
export async function validateBulkOwnership(
  tenant: TenantContext,
  resources: any[],
  table: string,
  resourceName: string = 'Resource'
): Promise<void> {
  const tableInfo = require('../types/tenantContext.js').TENANT_ENABLED_TABLES[table]
  if (!tableInfo) {
    throw new Error(`Table ${table} not registered for tenant isolation`)
  }

  for (const resource of resources) {
    const resourceTenantId = resource[tableInfo.tenantColumn]
    
    if (resourceTenantId !== tenant.tenantId) {
      throw new Error(`${resourceName} access denied: not all records belong to your tenant`)
    }
  }
}

/**
 * Service layer wrapper for tenant-safe operations
 * Provides transaction-like safety for multi-step operations
 */
export class TenantSafeOperation {
  constructor(private tenant: TenantContext) {
    validateTenantContext(tenant)
  }

  /**
   * Execute operation with automatic tenant verification
   */
  async execute<T>(
    operation: (tenant: TenantContext) => Promise<T>,
    description: string = 'Operation'
  ): Promise<T> {
    try {
      console.log(`[TENANT_OP] ${description} for tenant ${this.tenant.tenantId.substring(0, 8)}...`)
      const result = await operation(this.tenant)
      console.log(`[TENANT_OP] ✓ ${description} completed`)
      return result
    } catch (error: any) {
      console.error(`[TENANT_OP_ERROR] ${description} failed:`, error.message)
      throw error
    }
  }

  /**
   * Get resource and verify ownership in one operation
   */
  async getResourceAndVerify(
    table: string,
    resourceId: string,
    resourceName: string = 'Resource'
  ) {
    const resource = await TenantIsolationService.getRecordByIdAndTenant(
      this.tenant,
      table,
      resourceId
    )
    
    // Double verification (service already does this, but explicit in code)
    await validateResourceOwnership(this.tenant, resource, table, resourceName)
    
    return resource
  }

  /**
   * List resources for tenant with filtering
   */
  async listResources(
    table: string,
    options: {
      where?: { [key: string]: any }
      orderBy?: string
      limit?: number
      offset?: number
    } = {}
  ) {
    return TenantIsolationService.listRecordsByTenant(
      this.tenant,
      table,
      options
    )
  }

  /**
   * Create resource automatically scoped to tenant
   */
  async createResource(table: string, data: any) {
    return TenantIsolationService.insertRecordWithTenant(
      this.tenant,
      table,
      data
    )
  }

  /**
   * Update resource with automatic ownership verification
   */
  async updateResource(
    table: string,
    resourceId: string,
    updates: any,
    idColumn: string = 'id'
  ) {
    return TenantIsolationService.updateRecordWithTenant(
      this.tenant,
      table,
      resourceId,
      updates,
      idColumn
    )
  }

  /**
   * Delete resource with automatic ownership verification
   */
  async deleteResource(
    table: string,
    resourceId: string,
    idColumn: string = 'id'
  ) {
    return TenantIsolationService.deleteRecordWithTenant(
      this.tenant,
      table,
      resourceId,
      idColumn
    )
  }

  /**
   * Execute raw query scoped to tenant
   */
  async query(sql: string, params: any[] = []) {
    return TenantIsolationService.queryWithTenant(
      this.tenant,
      sql,
      params
    )
  }

  /**
   * Count resources matching filter
   */
  async countResources(table: string, where?: any) {
    return TenantIsolationService.countRecordsByTenant(
      this.tenant,
      table,
      where
    )
  }

  /**
   * Get aggregate statistics
   */
  async getAggregates(table: string, aggregates: { [key: string]: string }) {
    return TenantIsolationService.getAggregateStats(
      this.tenant,
      table,
      aggregates
    )
  }

  /**
   * Multi-step operation with rollback on error
   */
  async transaction<T>(
    steps: Array<() => Promise<any>>,
    description: string = 'Multi-step operation'
  ): Promise<T> {
    const results: any[] = []
    
    try {
      for (let i = 0; i < steps.length; i++) {
        console.log(`[TENANT_TRANSACTION] Step ${i + 1}/${steps.length}`)
        const result = await steps[i]()
        results.push(result)
      }
      console.log(`[TENANT_TRANSACTION] ✓ All steps completed for ${description}`)
      return results as any as T
    } catch (error: any) {
      console.error(`[TENANT_TRANSACTION_ERROR] Step ${results.length + 1} failed:`, error.message)
      throw new Error(`${description} failed at step ${results.length + 1}: ${error.message}`)
    }
  }
}

/**
 * Validation result type for service operations
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validate operation is allowed for tenant
 * Useful for permission checks combined with tenant checks
 */
export function createTenantOperationValidator(tenant: TenantContext) {
  return {
    /**
     * Validate user is in correct tenant
     */
    validateTenant(): ValidationResult {
      const errors: string[] = []
      
      if (!tenant.tenantId) {
        errors.push('Tenant ID missing')
      }
      if (!tenant.userId) {
        errors.push('User ID missing')
      }
      
      return {
        valid: errors.length === 0,
        errors,
        warnings: []
      }
    },

    /**
     * Validate resource belongs to tenant
     */
    async validateResource(resource: any, table: string): Promise<ValidationResult> {
      const errors: string[] = []
      const warnings: string[] = []

      if (!resource) {
        errors.push('Resource not found')
        return { valid: false, errors, warnings }
      }

      try {
        await validateResourceOwnership(tenant, resource, table)
      } catch (error: any) {
        errors.push(error.message)
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings
      }
    },

    /**
     * Validate operation prerequisites
     */
    validatePrerequisites(checks: Array<() => boolean>): ValidationResult {
      const errors: string[] = []
      
      checks.forEach((check, i) => {
        if (!check()) {
          errors.push(`Prerequisite check ${i + 1} failed`)
        }
      })

      return {
        valid: errors.length === 0,
        errors,
        warnings: []
      }
    }
  }
}

/**
 * Example service method pattern with tenant validation
 * 
 * Usage:
 *   export class StudentService {
 *     async getStudentWithCourses(tenant: TenantContext, studentId: string) {
 *       return await new TenantSafeOperation(tenant).execute(
 *         async (t) => {
 *           const student = await this.getStudent(t, studentId)
 *           const courses = await this.getStudentCourses(t, studentId)
 *           return { student, courses }
 *         },
 *         'Fetch student with courses'
 *       )
 *     }
 *
 *     private async getStudent(tenant: TenantContext, studentId: string) {
 *       const student = await TenantIsolationService.getRecordByIdAndTenant(
 *         tenant,
 *         'students',
 *         studentId
 *       )
 *       return student
 *     }
 *
 *     private async getStudentCourses(tenant: TenantContext, studentId: string) {
 *       return await TenantIsolationService.queryWithTenant(
 *         tenant,
 *         `SELECT c.* FROM courses c
 *          JOIN enrollments e ON c.id = e.course_id
 *          WHERE e.student_id = $1`,
 *         [studentId]
 *       )
 *     }
 *   }
 */

export default {
  validateTenantContext,
  validateResourceOwnership,
  validateRelationshipTenant,
  validateBulkOwnership,
  TenantSafeOperation,
  createTenantOperationValidator
}
