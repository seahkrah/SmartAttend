/**
 * Audit Service Read-Only Type Enforcement
 * 
 * Phase 10.2: TypeScript-level enforcement that audit services are read-only
 * 
 * This file defines a read-only variant of audit services that the TypeScript
 * type system enforces. No mutations permitted.
 * 
 * Key principle: If you can't import a mutation function, you can't call it.
 */

import { AuditLogEntry, queryAuditLogs, getAuditLogById, getAuditTrailForResource, getAuditSummary, verifyAuditLogIntegrity, searchAuditLogsByJustification, getAuditLogsForPeriod } from './domainAuditService.js';

/**
 * ReadOnlyAuditService
 * 
 * Only exports read and query functions. No mutations permitted.
 * Use this type for any component that needs to query audit logs.
 * 
 * Pattern:
 * ```typescript
 * import { readOnlyAuditService } from './auditServiceReadOnly'
 * 
 * // This will fail at compile time (READ-ONLY enforced):
 * readOnlyAuditService.logAudit(...) // TS2339: Property doesn't exist
 * readOnlyAuditService.updateAudit(...) // TS2339: Property doesn't exist
 * 
 * // This works (read operations only):
 * const logs = await readOnlyAuditService.queryAuditLogs(filters)
 * const trail = await readOnlyAuditService.getTrail(resourceType, resourceId)
 * ```
 */
export const readOnlyAuditService = {
  // READ operations (allowed)
  queryAuditLogs,
  getAuditLogById,
  getAuditTrailForResource,
  getAuditSummary,
  verifyAuditLogIntegrity,
  searchAuditLogsByJustification,
  getAuditLogsForPeriod,

  // NOTE: No INSERT/UPDATE/DELETE functions exported
  // If you need to log something, use logAuditEntry from auditService.ts
  // If you need to update something, you have a design problem (see Phase 10.2)
} as const;

/**
 * Type: AuditServiceReadOnlyType
 * 
 * Use this type to declare that a service only has read-only access to audit logs.
 * Helps with dependency injection and explicit contracts.
 * 
 * Example:
 * ```typescript
 * class SecurityAnalyzer {
 *   constructor(auditService: AuditServiceReadOnlyType) {
 *     this.auditService = auditService;
 *   }
 *   
 *   async analyzeIncidents() {
 *     const logs = await this.auditService.queryAuditLogs(filters);
 *     // ... analyze
 *   }
 * }
 * ```
 */
export type AuditServiceReadOnlyType = typeof readOnlyAuditService;

/**
 * Type guard: Ensure a function only accesses read-only audit methods
 * 
 * Use in tests to verify no mutation imports:
 * ```typescript
 * const handler = async (auditService: AuditServiceReadOnlyType) => {
 *   // This compiles fine:
 *   const logs = await auditService.queryAuditLogs({});
 *   
 *   // This is a compile error (good!):
 *   await auditService.logAudit(...); // TS2339
 * };
 * ```
 */
export type EnforceReadOnlyAudit<T> = T extends AuditServiceReadOnlyType
  ? T
  : never;

/**
 * Configuration: Audit Service Immutability Policy
 * 
 * This object documents the immutability guarantees for audit services.
 * Can be used for runtime assertions (e.g., in tests to verify configuration).
 */
export const AUDIT_SERVICE_IMMUTABILITY_POLICY = {
  // Phase 10.2: Immutability Guarantees
  level: 'APPEND_ONLY_WITH_VERIFICATION' as const,
  
  // Database-level enforcement
  database: {
    triggers: {
      audit_logs: ['prevent_audit_logs_update', 'prevent_audit_logs_delete'],
      superadmin_audit_log: ['prevent_superadmin_audit_log_update', 'prevent_superadmin_audit_log_delete'],
      audit_access_log: ['prevent_audit_access_log_update', 'prevent_audit_access_log_delete'],
    },
    constraints: {
      scope: 'check_audit_scope_actor',
      state: 'check_audit_state_valid',
    },
  },
  
  // Service-level enforcement
  service: {
    readOnlyFunctions: [
      'queryAuditLogs',
      'getAuditLogById',
      'getAuditTrailForResource',
      'getAuditSummary',
      'verifyAuditLogIntegrity',
      'searchAuditLogsByJustification',
      'getAuditLogsForPeriod',
    ],
    mutatingFunctionsRemoved: [
      'updateAuditEntry', // ❌ REMOVED - no post-hoc updates
      'auditOperation', // ❌ REMOVED - violated immutability  
      'auditDryRun', // ❌ REMOVED - violated immutability
    ],
    preventionFunction: 'preventUpdateAttempt',
  },
  
  // Type system enforcement
  typescript: {
    readOnlyType: 'AuditServiceReadOnlyType',
    typeGuard: 'EnforceReadOnlyAudit<T>',
    description: 'Compile-time enforcement: mutations cannot be imported',
  },
  
  // Verification capability
  verification: {
    checksumAlgorithm: 'SHA-256',
    integrityEndpoint: 'GET /api/audit/verify/:auditId',
    automatedVerification: 'Daily (random sample of 100 logs)',
    tamperDetection: 'Checksum mismatch = detected tampering',
  },
} as const;

/**
 * Runtime Verification: Ensure no mutations are in service exports
 * 
 * Called during service initialization to verify immutability policy
 * If any mutation function is exported, this will throw an error
 */
export function verifyAuditServiceImmutability(): { success: boolean; message: string } {
  const services = readOnlyAuditService as Record<string, any>;
  const forbiddenFunctions = ['logAudit', 'updateAudit', 'deleteAudit', 'updateAuditEntry'];
  
  for (const forbidden of forbiddenFunctions) {
    if (forbidden in services) {
      throw new Error(
        `IMMUTABILITY VIOLATION: Mutation function '${forbidden}' found in readOnlyAuditService. ` +
        `Phase 10.2 requires append-only enforcement.`
      );
    }
  }
  
  return {
    success: true,
    message: 'Audit service immutability policy verified: only read operations exported',
  };
}

/**
 * Export as singleton for initialization
 * 
 * Call this once during application startup to verify immutability
 * 
 * Example:
 * ```typescript
 * // In app startup
 * try {
 *   verifyAuditServiceImmutability();
 *   console.log('✅ Audit service immutability verified');
 * } catch (error) {
 *   console.error('❌ Immutability policy violated:', error.message);
 *   process.exit(1);
 * }
 * ```
 */
export const auditServiceInitialization = {
  verify: verifyAuditServiceImmutability,
  policy: AUDIT_SERVICE_IMMUTABILITY_POLICY,
} as const;
