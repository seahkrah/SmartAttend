/**
 * PHASE 5, STEP 5.1: Error Classification Service
 * Classifies errors by severity and category
 * Determines if error should automatically create an incident
 */

export type ErrorCategory = 'security' | 'integrity' | 'system' | 'business' | 'user'
export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface ErrorClassification {
  errorCode: string
  category: ErrorCategory
  severity: ErrorSeverity
  description: string
  autoCreateIncident: boolean
  requireEscalation: boolean
}

// Error classification map
const ERROR_CLASSIFICATIONS: Record<string, ErrorClassification> = {
  // SECURITY ERRORS - Always create incidents
  AUTH_FAILED: {
    errorCode: 'AUTH_FAILED',
    category: 'security',
    severity: 'high',
    description: 'Authentication failure',
    autoCreateIncident: true,
    requireEscalation: false,
  },
  UNAUTHORIZED_ACCESS: {
    errorCode: 'UNAUTHORIZED_ACCESS',
    category: 'security',
    severity: 'critical',
    description: 'Unauthorized access attempt',
    autoCreateIncident: true,
    requireEscalation: true,
  },
  PRIVILEGE_ESCALATION: {
    errorCode: 'PRIVILEGE_ESCALATION',
    category: 'security',
    severity: 'critical',
    description: 'Potential privilege escalation detected',
    autoCreateIncident: true,
    requireEscalation: true,
  },
  ROLE_MANIPULATION: {
    errorCode: 'ROLE_MANIPULATION',
    category: 'security',
    severity: 'critical',
    description: 'Unauthorized role change detected',
    autoCreateIncident: true,
    requireEscalation: true,
  },
  TENANT_BOUNDARY_VIOLATION: {
    errorCode: 'TENANT_BOUNDARY_VIOLATION',
    category: 'security',
    severity: 'critical',
    description: 'Cross-tenant data access detected',
    autoCreateIncident: true,
    requireEscalation: true,
  },
  TOKEN_MANIPULATION: {
    errorCode: 'TOKEN_MANIPULATION',
    category: 'security',
    severity: 'critical',
    description: 'JWT token manipulation detected',
    autoCreateIncident: true,
    requireEscalation: true,
  },

  // INTEGRITY ERRORS - Create incidents for data corruption
  DATA_INTEGRITY_VIOLATION: {
    errorCode: 'DATA_INTEGRITY_VIOLATION',
    category: 'integrity',
    severity: 'critical',
    description: 'Data integrity constraint violation',
    autoCreateIncident: true,
    requireEscalation: true,
  },
  DUPLICATE_ENTRY: {
    errorCode: 'DUPLICATE_ENTRY',
    category: 'integrity',
    severity: 'high',
    description: 'Duplicate entry attempt',
    autoCreateIncident: true,
    requireEscalation: false,
  },
  INVALID_STATE_TRANSITION: {
    errorCode: 'INVALID_STATE_TRANSITION',
    category: 'integrity',
    severity: 'high',
    description: 'Invalid state transition detected',
    autoCreateIncident: true,
    requireEscalation: false,
  },
  ORPHANED_RECORD: {
    errorCode: 'ORPHANED_RECORD',
    category: 'integrity',
    severity: 'high',
    description: 'Orphaned record detected (referential integrity broken)',
    autoCreateIncident: true,
    requireEscalation: true,
  },

  // SYSTEM ERRORS - Create incidents for critical system failures
  DATABASE_CONNECTION_FAILED: {
    errorCode: 'DATABASE_CONNECTION_FAILED',
    category: 'system',
    severity: 'critical',
    description: 'Database connection failure',
    autoCreateIncident: true,
    requireEscalation: true,
  },
  DATABASE_QUERY_TIMEOUT: {
    errorCode: 'DATABASE_QUERY_TIMEOUT',
    category: 'system',
    severity: 'high',
    description: 'Database query timeout',
    autoCreateIncident: true,
    requireEscalation: false,
  },
  SERVICE_UNAVAILABLE: {
    errorCode: 'SERVICE_UNAVAILABLE',
    category: 'system',
    severity: 'critical',
    description: 'Critical service unavailable',
    autoCreateIncident: true,
    requireEscalation: true,
  },
  MEMORY_EXHAUSTED: {
    errorCode: 'MEMORY_EXHAUSTED',
    category: 'system',
    severity: 'critical',
    description: 'Out of memory error',
    autoCreateIncident: true,
    requireEscalation: true,
  },
  DISK_SPACE_CRITICAL: {
    errorCode: 'DISK_SPACE_CRITICAL',
    category: 'system',
    severity: 'critical',
    description: 'Disk space critical',
    autoCreateIncident: true,
    requireEscalation: true,
  },
  MIGRATION_FAILED: {
    errorCode: 'MIGRATION_FAILED',
    category: 'system',
    severity: 'critical',
    description: 'Database migration failed',
    autoCreateIncident: true,
    requireEscalation: true,
  },
  EXTERNAL_SERVICE_FAILURE: {
    errorCode: 'EXTERNAL_SERVICE_FAILURE',
    category: 'system',
    severity: 'high',
    description: 'External service unavailable',
    autoCreateIncident: true,
    requireEscalation: false,
  },

  // BUSINESS ERRORS - May create incidents based on frequency
  BUSINESS_RULE_VIOLATION: {
    errorCode: 'BUSINESS_RULE_VIOLATION',
    category: 'business',
    severity: 'medium',
    description: 'Business rule violation',
    autoCreateIncident: false,
    requireEscalation: false,
  },
  QUOTA_EXCEEDED: {
    errorCode: 'QUOTA_EXCEEDED',
    category: 'business',
    severity: 'medium',
    description: 'Resource quota exceeded',
    autoCreateIncident: false,
    requireEscalation: false,
  },
  INVALID_OPERATION: {
    errorCode: 'INVALID_OPERATION',
    category: 'business',
    severity: 'medium',
    description: 'Invalid operation for current state',
    autoCreateIncident: false,
    requireEscalation: false,
  },

  // USER ERRORS - Typically don't create incidents
  VALIDATION_ERROR: {
    errorCode: 'VALIDATION_ERROR',
    category: 'user',
    severity: 'low',
    description: 'Input validation error',
    autoCreateIncident: false,
    requireEscalation: false,
  },
  RESOURCE_NOT_FOUND: {
    errorCode: 'RESOURCE_NOT_FOUND',
    category: 'user',
    severity: 'low',
    description: 'Requested resource not found',
    autoCreateIncident: false,
    requireEscalation: false,
  },
  INVALID_REQUEST: {
    errorCode: 'INVALID_REQUEST',
    category: 'user',
    severity: 'low',
    description: 'Invalid request format',
    autoCreateIncident: false,
    requireEscalation: false,
  },
}

/**
 * Classify an error based on its code or message
 */
export function classifyError(
  errorCode?: string,
  errorMessage?: string,
  errorType?: string
): ErrorClassification {
  // Try to find classification by error code
  if (errorCode && ERROR_CLASSIFICATIONS[errorCode]) {
    return ERROR_CLASSIFICATIONS[errorCode]
  }

  // Try to infer from error type
  if (errorType) {
    if (errorType.includes('ValidationError')) {
      return ERROR_CLASSIFICATIONS.VALIDATION_ERROR
    }
    if (errorType.includes('NotFound')) {
      return ERROR_CLASSIFICATIONS.RESOURCE_NOT_FOUND
    }
    if (errorType.includes('Database') || errorType.includes('Query')) {
      return ERROR_CLASSIFICATIONS.DATABASE_QUERY_TIMEOUT
    }
    if (errorType.includes('Auth')) {
      return ERROR_CLASSIFICATIONS.AUTH_FAILED
    }
  }

  // Try to infer from message
  if (errorMessage) {
    const msg = errorMessage.toLowerCase()
    if (msg.includes('authentication') || msg.includes('unauthorized')) {
      return ERROR_CLASSIFICATIONS.AUTH_FAILED
    }
    if (msg.includes('privilege') || msg.includes('escalation')) {
      return ERROR_CLASSIFICATIONS.PRIVILEGE_ESCALATION
    }
    if (msg.includes('tenant') || msg.includes('boundary')) {
      return ERROR_CLASSIFICATIONS.TENANT_BOUNDARY_VIOLATION
    }
    if (msg.includes('integrity') || msg.includes('constraint')) {
      return ERROR_CLASSIFICATIONS.DATA_INTEGRITY_VIOLATION
    }
    if (msg.includes('database') || msg.includes('connection')) {
      return ERROR_CLASSIFICATIONS.DATABASE_CONNECTION_FAILED
    }
    if (msg.includes('not found')) {
      return ERROR_CLASSIFICATIONS.RESOURCE_NOT_FOUND
    }
    if (msg.includes('validation')) {
      return ERROR_CLASSIFICATIONS.VALIDATION_ERROR
    }
  }

  // Default to generic system error
  return {
    errorCode: 'UNKNOWN_ERROR',
    category: 'system',
    severity: 'medium',
    description: 'Unknown error',
    autoCreateIncident: false,
    requireEscalation: false,
  }
}

/**
 * Get all error classifications
 */
export function getAllClassifications(): ErrorClassification[] {
  return Object.values(ERROR_CLASSIFICATIONS)
}

/**
 * Check if error should automatically create an incident
 */
export function shouldCreateIncident(classification: ErrorClassification): boolean {
  return classification.autoCreateIncident
}

/**
 * Check if error requires escalation
 */
export function requiresEscalation(classification: ErrorClassification): boolean {
  return classification.requireEscalation
}

/**
 * Get classification by error code
 */
export function getClassificationByCode(
  errorCode: string
): ErrorClassification | undefined {
  return ERROR_CLASSIFICATIONS[errorCode]
}
