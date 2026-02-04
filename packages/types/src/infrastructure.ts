/**
 * Infrastructure Control Plane Types
 * 
 * Defines the strict type contracts for superadmin infrastructure operations.
 * All operations follow append-only audit logging and immutable design patterns.
 */

// ===========================
// ERROR CONTRACTS (Standard)
// ===========================

export interface ErrorContract {
  code: string
  message: string
  recoveryHint?: string
  timestamp: string
  requestId?: string
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: ErrorContract
}

// ===========================
// TENANT LIFECYCLE
// ===========================

export type TenantLifecycleState = 'PROVISIONED' | 'ACTIVE' | 'SUSPENDED' | 'LOCKED' | 'DECOMMISSIONED'

export interface Tenant {
  id: string
  name: string
  type: 'SCHOOL' | 'CORPORATE'
  lifecycleState: TenantLifecycleState
  createdAt: string
  lastActiveAt: string
  systemVersion: number
  configHash: string
}

export interface TenantLifecycleAudit {
  id: string
  tenantId: string
  previousState: TenantLifecycleState | null
  newState: TenantLifecycleState
  actorId: string
  actorRole: string
  actionType: string
  justification: string
  confirmationToken?: string
  ipAddress: string
  timestamp: string
}

// Valid state transitions
export const VALID_LIFECYCLE_TRANSITIONS: Record<TenantLifecycleState, TenantLifecycleState[]> = {
  PROVISIONED: ['ACTIVE', 'DECOMMISSIONED'],
  ACTIVE: ['SUSPENDED', 'LOCKED', 'DECOMMISSIONED'],
  SUSPENDED: ['ACTIVE', 'LOCKED', 'DECOMMISSIONED'],
  LOCKED: ['ACTIVE', 'DECOMMISSIONED'],
  DECOMMISSIONED: [] // Terminal state
}

// ===========================
// SESSION MANAGEMENT
// ===========================

export interface SuperadminSession {
  id: string
  superadminUserId: string
  ipAddress: string
  userAgent: string
  createdAt: string
  expiresAt: string
  lastActivityAt: string
  isActive: boolean
}

export interface SessionInvalidationLog {
  id: string
  tenantId: string
  reason: string
  invalidatedBySupeRadminId: string
  invalidatedSessionCount: number
  timestamp: string
}

// ===========================
// TIME INTEGRITY
// ===========================

export type ClockDriftSeverity = 'INFO' | 'WARNING' | 'CRITICAL'

export interface ClockDriftEvent {
  id: string
  tenantId: string
  userId: string
  clientTimestamp: string
  serverTimestamp: string
  driftSeconds: number // Positive = client ahead, negative = client behind
  severity: ClockDriftSeverity
  attendanceAffected: boolean
  requestId: string
  timestamp: string
}

// Clock drift thresholds (in seconds)
export const CLOCK_DRIFT_THRESHOLDS = {
  WARNING: 30, // 30 seconds
  CRITICAL: 300, // 5 minutes
  BLOCK_ATTENDANCE: 600 // 10 minutes - block attendance if exceeded
}

// ===========================
// ATTENDANCE INTEGRITY (READ-ONLY)
// ===========================

export type AttendanceFlagType =
  | 'DUPLICATE_SUBMISSION'
  | 'REPLAY_ATTACK'
  | 'CLOCK_DRIFT_VIOLATION'
  | 'VERIFICATION_MISMATCH'
  | 'MANUAL_REVIEW_REQUESTED'
  | 'DATA_INCONSISTENCY'

export type AttendanceIntegrityState = 'FLAGGED' | 'UNDER_REVIEW' | 'RESOLVED' | 'REVOKED'

export interface AttendanceIntegrityFlag {
  id: string
  tenantId: string
  attendanceRecordId?: string
  flagType: AttendanceFlagType
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  state: AttendanceIntegrityState
  flaggedBySupeRadminId: string
  flagReason: string
  flagTimestamp: string
  resolvedByTenantUserId?: string
  resolutionNotes?: string
  resolvedAt?: string
}

/**
 * Superadmin can ONLY:
 * - READ attendance records
 * - FLAG records for tenant review
 * - Cannot directly edit or delete
 */
export interface AttendanceIntegrityAction {
  action: 'FLAG' | 'REVOKE_FLAG' // Only these two
  flagId?: string
  flagType?: AttendanceFlagType
  flagReason: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  attendanceRecordId?: string
}

// ===========================
// PRIVILEGE ESCALATION
// ===========================

export type EscalationSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface PrivilegeEscalationEvent {
  id: string
  userId: string
  tenantId: string
  previousRole: string | null
  newRole: string
  escalationSeverity: EscalationSeverity
  escalationReason?: string
  grantedByUserId?: string
  grantedAt: string
  flaggedBySupeRadminId?: string
  investigationStatus: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED'
  investigationNotes?: string
  investigatedAt?: string
}

// ===========================
// AUDIT LOGGING (IMMUTABLE)
// ===========================

export type AuditActionScope = 'GLOBAL' | 'TENANT' | 'USER' | 'SYSTEM'
export type AuditActionResult = 'SUCCESS' | 'FAILURE' | 'PARTIAL'

export interface SuperadminAuditLog {
  id: string
  actorId: string
  actorPlatform: 'system' // Only superadmin
  actionType: string
  actionScope: AuditActionScope
  targetEntityType?: string
  targetEntityId?: string
  beforeState?: Record<string, any>
  afterState?: Record<string, any>
  justification?: string
  confirmationToken?: string
  ipAddress: string
  userAgent?: string
  requestId?: string
  result: AuditActionResult
  errorMessage?: string
  timestamp: string
}

/**
 * Audit logging is APPEND-ONLY and IMMUTABLE.
 * No UPDATE or DELETE operations are allowed on audit records.
 * All superadmin actions must be audited before execution.
 */

// ===========================
// INCIDENT MANAGEMENT
// ===========================

export type IncidentType = 'SECURITY' | 'DATA' | 'SYSTEM' | 'INFRASTRUCTURE'
export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'CONTAINED' | 'RESOLVED' | 'CLOSED'

export interface InfrastructureIncident {
  id: string
  incidentNumber: number
  incidentType: IncidentType
  severity: IncidentSeverity
  title: string
  description: string
  status: IncidentStatus
  escalationLevel: number
  createdBySupeRadminId: string
  assignedToSupeRadminId?: string
  acknowledgedBySupeRadminId?: string
  affectedTenantId?: string
  affectedEntityCount: number
  affectedUserCount: number
  createdAt: string
  acknowledgedAt?: string
  resolvedAt?: string
  closedAt?: string
  rootCause?: string
  resolutionSummary?: string
  lessonsLearned?: string
}

export interface IncidentActivityLog {
  id: string
  incidentId: string
  activityType: string
  activityDescription: string
  actorId: string
  actorRole: string
  stateChangeFrom?: IncidentStatus
  stateChangeTo?: IncidentStatus
  timestamp: string
}

export interface CreateIncidentRequest {
  incidentType: IncidentType
  severity: IncidentSeverity
  title: string
  description: string
  affectedTenantId?: string
  affectedEntityCount?: number
  affectedUserCount?: number
}

export interface UpdateIncidentRequest {
  status?: IncidentStatus
  escalationLevel?: number
  assignedToSupeRadminId?: string
  rootCause?: string
  resolutionSummary?: string
  lessonsLearned?: string
}

// ===========================
// SAFETY CONTROLS
// ===========================

export interface ConfirmationToken {
  id: string
  operationType: string
  operationContext: Record<string, any>
  tokenHash: string
  requestingSupeRadminId: string
  createdAt: string
  expiresAt: string
  confirmedAt?: string
  isUsed: boolean
}

export interface DryRunRequest {
  dryRun: true
  operationType: string
  operationData: Record<string, any>
}

export interface ConfirmationRequest {
  confirmationToken: string
  finalApproval: boolean
}

// ===========================
// SYSTEM HEALTH & OBSERVABILITY
// ===========================

export type ServiceStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN'

export interface ServiceHealthCheck {
  id: string
  serviceName: string
  status: ServiceStatus
  responseTimeMs?: number
  errorRatePercent?: number
  lastErrorMessage?: string
  checkedAt: string
  checkedBy?: string
}

export interface SystemMetricTimeseries {
  id: string
  metricName: string
  metricValue: number
  metricUnit?: string
  serviceName?: string
  tenantId?: string
  recordedAt: string
  isAnomolous: boolean
}

// ===========================
// BULK OPERATIONS
// ===========================

export interface BulkOperationRequest {
  operationType: string
  tenantIds: string[]
  actionData: Record<string, any>
  dryRun?: boolean
}

export interface BulkOperationResult {
  operationType: string
  totalRequested: number
  successCount: number
  failureCount: number
  results: {
    tenantId: string
    status: 'SUCCESS' | 'FAILURE'
    error?: string
  }[]
}

// ===========================
// INFRASTRUCTURE REQUEST CONTEXT
// ===========================

/**
 * Enhanced request context for infrastructure operations.
 * Captured automatically for all superadmin actions.
 */
export interface InfrastructureRequestContext {
  requestId: string
  superadminUserId: string
  timestamp: string
  ipAddress: string
  userAgent?: string
  correlationId?: string
  dryRun?: boolean
  confirmationToken?: string
}

// ===========================
// MFA & AUTHENTICATION
// ===========================

export interface MfaChallenge {
  id: string
  userId: string
  method: 'TOTP' | 'SMS' | 'EMAIL'
  expiresAt: string
  attempts: number
  maxAttempts: number
}

export interface SuperadminAuthRequest {
  email: string
  password: string
  mfaToken?: string
}

export interface SuperadminAuthResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  sessionId: string
  mfaChallengeId?: string // If MFA required
}

// ===========================
// CONSTANTS & LIMITS
// ===========================

export const INFRASTRUCTURE_CONSTANTS = {
  SESSION_TTL_MINUTES: 30, // Short TTL for superadmin sessions
  REFRESH_TOKEN_TTL_DAYS: 7,
  CONFIRMATION_TOKEN_TTL_MINUTES: 5,
  MAX_MFA_ATTEMPTS: 3,
  RATE_LIMIT_DESTRUCTIVE_OPS: 10, // Per minute
  AUDIT_LOG_RETENTION_YEARS: 7,
  CLOCK_DRIFT_CHECK_INTERVAL_SECONDS: 3600
}

export const AUDIT_ACTION_TYPES = {
  TENANT_LIFECYCLE_CHANGE: 'TENANT_LIFECYCLE_CHANGE',
  SESSION_INVALIDATION: 'SESSION_INVALIDATION',
  PRIVILEGE_ESCALATION_INVESTIGATION: 'PRIVILEGE_ESCALATION_INVESTIGATION',
  INCIDENT_CREATED: 'INCIDENT_CREATED',
  INCIDENT_STATUS_CHANGE: 'INCIDENT_STATUS_CHANGE',
  ATTENDANCE_FLAG_CREATED: 'ATTENDANCE_FLAG_CREATED',
  ATTENDANCE_FLAG_REVOKED: 'ATTENDANCE_FLAG_REVOKED',
  CLOCK_DRIFT_DETECTED: 'CLOCK_DRIFT_DETECTED',
  MFA_DISABLED: 'MFA_DISABLED',
  SESSION_REVOKED: 'SESSION_REVOKED'
}
