# SmartAttend Superadmin Dashboard - Schema & API Design

**Version:** 1.0  
**Date:** February 2026  
**Status:** Production-Ready Architecture

---

## Table of Contents

1. [Database Schema](#database-schema)
2. [Type Definitions](#type-definitions)
3. [API Endpoints](#api-endpoints)
4. [Security Architecture](#security-architecture)
5. [Design Decisions](#design-decisions)

---

## Database Schema

### Core Principle
All tables follow **ACID compliance** with immutable audit trails. Superadmin actions generate atomic transactions.

### A. Tenant Management

```sql
-- Tenants: Core multi-tenant isolation
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('SCHOOL', 'CORPORATE')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'LOCKED')) DEFAULT 'ACTIVE',
  
  -- Metadata
  description TEXT,
  logo_url TEXT,
  primary_contact_email VARCHAR(255),
  primary_contact_phone VARCHAR(20),
  
  -- Timestamps (server time, immutable)
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at TIMESTAMPTZ,
  system_version VARCHAR(20) DEFAULT '1.0',
  
  -- Soft delete (audit compliance)
  deleted_at TIMESTAMPTZ,
  
  -- Indexing for query performance
  CONSTRAINT tenant_name_unique UNIQUE (name, deleted_at IS NULL),
  INDEX idx_tenant_status (status),
  INDEX idx_tenant_type (type),
  INDEX idx_tenant_created (created_at DESC)
);

-- Tenant Configuration: Audit trail for tenant settings
CREATE TABLE tenant_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  
  config_key VARCHAR(100) NOT NULL,
  config_value JSONB NOT NULL,
  
  -- Immutable history
  set_by_user_id UUID NOT NULL,
  set_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Audit context
  ip_address INET,
  change_reason TEXT,
  
  CONSTRAINT tenant_config_unique UNIQUE (tenant_id, config_key),
  INDEX idx_tenant_config (tenant_id)
);

-- Tenant Lock Events: Incident response tracking
CREATE TABLE tenant_lock_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  
  action VARCHAR(20) NOT NULL CHECK (action IN ('LOCKED', 'UNLOCKED')),
  reason TEXT NOT NULL,
  locked_by_superadmin_id UUID NOT NULL,
  
  locked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unlocked_at TIMESTAMPTZ,
  
  -- Duration tracking
  duration_seconds BIGINT GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM COALESCE(unlocked_at, CURRENT_TIMESTAMP) - locked_at)
  ) STORED,
  
  INDEX idx_tenant_lock (tenant_id),
  INDEX idx_lock_action (action)
);
```

---

### B. Identity & Role Integrity

```sql
-- Users: Global visibility (read-only for superadmin)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  
  status VARCHAR(20) NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')) DEFAULT 'ACTIVE',
  is_active BOOLEAN DEFAULT true,
  
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT user_email_tenant_unique UNIQUE (email, tenant_id),
  INDEX idx_user_status (status),
  INDEX idx_user_tenant (tenant_id)
);

-- Roles: Define permissions (system-wide schema)
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  
  name VARCHAR(100) NOT NULL,
  description TEXT,
  
  -- Permissions stored as JSONB array for flexibility
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  is_system_role BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT role_name_unique UNIQUE (name, platform_id),
  INDEX idx_role_system (is_system_role)
);

-- Role Assignments: Audit trail for privilege changes
CREATE TABLE role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  
  -- Who made the change
  assigned_by_superadmin_id UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  
  -- Context
  reason TEXT,
  ip_address INET,
  
  -- Soft delete (audit trail)
  is_active BOOLEAN DEFAULT true,
  
  INDEX idx_user_roles (user_id),
  INDEX idx_role_assignments_tenant (tenant_id),
  INDEX idx_assignment_active (is_active)
);

-- Privilege Escalation Events: Security flag detection
CREATE TABLE privilege_escalation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  
  -- What privilege was added
  old_role_id UUID,
  new_role_id UUID NOT NULL REFERENCES roles(id),
  
  escalation_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  
  -- Detection details
  detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  investigation_status VARCHAR(20) DEFAULT 'OPEN',
  
  -- Audit
  flagged_by_superadmin_id UUID,
  investigation_notes TEXT,
  
  INDEX idx_escalation_user (user_id),
  INDEX idx_escalation_severity (severity)
);

-- Session Management: For forced invalidation
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  
  access_token_hash VARCHAR(255) NOT NULL,
  refresh_token_hash VARCHAR(255),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  invalidated_at TIMESTAMPTZ,
  
  ip_address INET,
  user_agent TEXT,
  
  INDEX idx_session_user (user_id),
  INDEX idx_session_invalid (invalidated_at)
);
```

---

### C. System Health & Observability

```sql
-- System Health Status
CREATE TABLE system_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  service_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('HEALTHY', 'DEGRADED', 'DOWN')),
  
  -- Health metrics
  response_time_ms INTEGER,
  error_rate_percent DECIMAL(5,2),
  cpu_percent DECIMAL(5,2),
  memory_percent DECIMAL(5,2),
  
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_by VARCHAR(50), -- service that checked it
  
  diagnostic_details JSONB,
  
  CONSTRAINT system_health_unique UNIQUE (service_name, last_checked_at),
  INDEX idx_service_status (service_name, status)
);

-- Metrics: Time-series friendly design
CREATE TABLE system_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  tenant_id UUID REFERENCES tenants(id), -- NULL for platform-wide
  metric_name VARCHAR(100) NOT NULL,
  metric_value DECIMAL(15,4) NOT NULL,
  
  -- Time series bucketing (1min, 5min, 1hour)
  bucket_size VARCHAR(10) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Context
  dimensions JSONB, -- tags like {environment: 'prod', region: 'us-east'}
  
  INDEX idx_metric_tenant_time (tenant_id, metric_name, recorded_at DESC),
  INDEX idx_metric_name (metric_name)
);

-- Examples of metrics to track:
-- - api_request_latency_ms
-- - attendance_write_failures
-- - verification_mismatch_count
-- - qr_scan_failures
-- - face_recognition_failures
-- - session_creation_rate
-- - token_validation_failures

-- Alert Configuration: Rules for anomaly detection
CREATE TABLE alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  alert_name VARCHAR(100) NOT NULL,
  metric_name VARCHAR(100) NOT NULL,
  
  -- Threshold-based alerting
  condition VARCHAR(20) NOT NULL CHECK (condition IN ('>', '<', '>=', '<=', '=')),
  threshold DECIMAL(15,4) NOT NULL,
  
  -- Evaluation window (seconds)
  evaluation_window_seconds INTEGER DEFAULT 300,
  breach_threshold INTEGER DEFAULT 2, -- breaches to trigger alert
  
  severity VARCHAR(20) NOT NULL,
  enabled BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_alert_enabled (enabled)
);
```

---

### D. Attendance Integrity (Read-Only)

```sql
-- Attendance Summary: Superadmin read-only view
CREATE TABLE attendance_records_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  
  -- Record context
  entity_id UUID NOT NULL, -- school_entities.id or corporate_entities.id
  course_or_department VARCHAR(255),
  user_id UUID NOT NULL REFERENCES users(id),
  
  -- Verification details
  verification_method VARCHAR(50) NOT NULL CHECK (
    verification_method IN ('QR_CODE', 'FACE_RECOGNITION', 'RFID', 'MANUAL_ENTRY', 'TOKEN')
  ),
  verification_state VARCHAR(20) NOT NULL CHECK (
    verification_state IN ('VERIFIED', 'FLAGGED', 'REVOKED', 'PENDING_REVIEW')
  ),
  
  -- Record integrity
  timestamp TIMESTAMPTZ NOT NULL,
  server_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  time_drift_seconds INTEGER, -- |device_time - server_time|
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT record_time_drift_check CHECK (time_drift_seconds < 300), -- 5 min max
  INDEX idx_attendance_tenant (tenant_id),
  INDEX idx_attendance_state (verification_state),
  INDEX idx_attendance_timestamp (timestamp DESC)
);

-- Attendance Flags: Mark suspicious records for review
CREATE TABLE attendance_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES attendance_records_summary(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  
  flag_type VARCHAR(50) NOT NULL CHECK (
    flag_type IN (
      'DUPLICATE_ATTEMPT',
      'REPLAY_ATTACK',
      'TIME_DRIFT_VIOLATION',
      'DEVICE_MISMATCH',
      'GEOLOCATION_ANOMALY',
      'UNUSUAL_TIME',
      'MANUAL_REVIEW_REQUESTED'
    )
  ),
  
  severity VARCHAR(20) NOT NULL,
  description TEXT NOT NULL,
  
  -- Manual review tracking
  reviewed_by_superadmin_id UUID,
  review_notes TEXT,
  review_action VARCHAR(20) CHECK (review_action IN ('APPROVED', 'REVOKED', 'PENDING')),
  reviewed_at TIMESTAMPTZ,
  
  flagged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_flag_tenant (tenant_id),
  INDEX idx_flag_type (flag_type),
  INDEX idx_flag_severity (severity)
);
```

---

### E. Incident Management

```sql
-- Incidents: Security/data/system events
CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  incident_type VARCHAR(50) NOT NULL CHECK (
    incident_type IN ('SECURITY', 'DATA', 'SYSTEM', 'COMPLIANCE')
  ),
  severity VARCHAR(20) NOT NULL CHECK (
    severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
  ),
  status VARCHAR(20) NOT NULL CHECK (
    status IN ('OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED')
  ) DEFAULT 'OPEN',
  
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  
  -- Root cause analysis
  root_cause TEXT,
  affected_tenants_count INTEGER,
  affected_users_count INTEGER,
  
  -- Lifecycle
  created_by_superadmin_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  
  -- Context
  context_data JSONB, -- arbitrary incident details
  
  CONSTRAINT incident_resolve_check CHECK (
    CASE 
      WHEN status = 'RESOLVED' THEN resolved_at IS NOT NULL
      WHEN status = 'CLOSED' THEN closed_at IS NOT NULL
      ELSE true
    END
  ),
  
  INDEX idx_incident_status (status),
  INDEX idx_incident_severity (severity),
  INDEX idx_incident_created (created_at DESC)
);

-- Incident Timeline: Immutable action log
CREATE TABLE incident_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  
  event_type VARCHAR(100) NOT NULL,
  event_description TEXT NOT NULL,
  
  -- Who took action
  actor_superadmin_id UUID NOT NULL,
  actor_ip_address INET,
  
  -- Event data (e.g., evidence, investigation notes)
  event_data JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_timeline_incident (incident_id),
  INDEX idx_timeline_created (created_at DESC)
);

-- Affected Entities per Incident
CREATE TABLE incident_affected_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  affected_user_count INTEGER DEFAULT 0,
  
  -- Impact assessment
  data_exposure_level VARCHAR(20),
  recovery_status VARCHAR(20) DEFAULT 'PENDING',
  
  INDEX idx_incident_entity (incident_id, tenant_id)
);
```

---

### F. Audit Logging (Immutable & Mandatory)

```sql
-- Superadmin Action Log: Core audit trail
CREATE TABLE superadmin_action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Actor
  superadmin_user_id UUID NOT NULL REFERENCES users(id),
  
  -- Action
  action_type VARCHAR(100) NOT NULL,
  action_description TEXT,
  
  -- Target
  target_entity_type VARCHAR(50), -- 'TENANT', 'USER', 'ROLE', 'INCIDENT'
  target_entity_id UUID,
  target_tenant_id UUID REFERENCES tenants(id),
  
  -- State changes
  before_state JSONB,
  after_state JSONB,
  
  -- Audit context
  ip_address INET NOT NULL,
  user_agent TEXT,
  session_id UUID,
  
  -- Timestamps (immutable)
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Retention (never deleted)
  is_archived BOOLEAN DEFAULT false,
  archived_at TIMESTAMPTZ,
  
  CONSTRAINT audit_log_immutable CHECK (
    -- Can only transition to archived, never deleted
    CASE WHEN is_archived THEN archived_at IS NOT NULL ELSE true END
  ),
  
  INDEX idx_audit_superadmin (superadmin_user_id, created_at DESC),
  INDEX idx_audit_target (target_entity_type, target_entity_id),
  INDEX idx_audit_action (action_type),
  INDEX idx_audit_created (created_at DESC),
  INDEX idx_audit_tenant (target_tenant_id)
);

-- Role Change Log: Specific audit trail for role changes
CREATE TABLE role_change_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  user_id UUID NOT NULL REFERENCES users(id),
  old_role_id UUID,
  new_role_id UUID,
  
  changed_by_superadmin_id UUID NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  reason TEXT,
  ip_address INET,
  
  INDEX idx_role_change_user (user_id),
  INDEX idx_role_change_timestamp (changed_at DESC)
);

-- Tenant State Change Log: Track all tenant modifications
CREATE TABLE tenant_change_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  
  change_type VARCHAR(50) NOT NULL, -- 'STATUS_CHANGE', 'CONFIG_UPDATE', 'LOCK'
  before_state JSONB NOT NULL,
  after_state JSONB NOT NULL,
  
  changed_by_superadmin_id UUID NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  ip_address INET,
  reason TEXT,
  
  INDEX idx_tenant_audit (tenant_id, changed_at DESC)
);

-- Session Invalidation Log: Track forced logouts
CREATE TABLE session_invalidation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  session_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  tenant_id UUID REFERENCES tenants(id),
  
  invalidation_reason VARCHAR(100) NOT NULL,
  invalidated_by_superadmin_id UUID,
  invalidated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  ip_address INET,
  
  INDEX idx_invalidation_user (user_id),
  INDEX idx_invalidation_timestamp (invalidated_at DESC)
);
```

---

## Type Definitions

### Core Types (TypeScript)

```typescript
// === TENANT TYPES ===

export enum TenantType {
  SCHOOL = 'SCHOOL',
  CORPORATE = 'CORPORATE'
}

export enum TenantStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  LOCKED = 'LOCKED'
}

export interface Tenant {
  id: string
  name: string
  type: TenantType
  status: TenantStatus
  description?: string
  logoUrl?: string
  primaryContactEmail?: string
  createdAt: Date
  lastActiveAt?: Date
  systemVersion: string
}

export interface TenantMetadata extends Tenant {
  userCount: number
  activeSessionCount: number
  dataUsageBytes: number
  lastIncidentAt?: Date
}

export interface TenantLockEvent {
  id: string
  tenantId: string
  action: 'LOCKED' | 'UNLOCKED'
  reason: string
  lockedBySuperadminId: string
  lockedAt: Date
  unlockedAt?: Date
  durationSeconds?: number
}

// === IDENTITY & ROLE TYPES ===

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED'
}

export interface User {
  id: string
  tenantId: string
  email: string
  fullName: string
  status: UserStatus
  lastLogin?: Date
  createdAt: Date
}

export interface RoleAssignment {
  id: string
  userId: string
  roleId: string
  tenantId: string
  role: Role
  assignedAt: Date
  revokedAt?: Date
  assignedBySuperadminId: string
  reason?: string
}

export interface Role {
  id: string
  name: string
  permissions: Permission[]
  isSystemRole: boolean
}

export interface PrivilegeEscalationEvent {
  id: string
  userId: string
  oldRoleId?: string
  newRoleId: string
  escalationType: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  detectedAt: Date
  investigationStatus: 'OPEN' | 'INVESTIGATED' | 'RESOLVED'
  flaggedBySuperadminId?: string
}

// === HEALTH & OBSERVABILITY TYPES ===

export enum ServiceStatus {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  DOWN = 'DOWN'
}

export interface SystemHealth {
  id: string
  serviceName: string
  status: ServiceStatus
  responseTimeMs?: number
  errorRatePercent?: number
  cpuPercent?: number
  memoryPercent?: number
  lastCheckedAt: Date
  diagnosticDetails?: Record<string, any>
}

export interface SystemMetric {
  id: string
  tenantId?: string // null for platform-wide
  metricName: string
  metricValue: number
  bucketSize: '1min' | '5min' | '1hour'
  recordedAt: Date
  dimensions?: Record<string, string>
}

export interface AlertRule {
  id: string
  alertName: string
  metricName: string
  condition: '>' | '<' | '>=' | '<=' | '='
  threshold: number
  evaluationWindowSeconds: number
  breachThreshold: number
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  enabled: boolean
}

// === ATTENDANCE INTEGRITY TYPES ===

export enum VerificationMethod {
  QR_CODE = 'QR_CODE',
  FACE_RECOGNITION = 'FACE_RECOGNITION',
  RFID = 'RFID',
  MANUAL_ENTRY = 'MANUAL_ENTRY',
  TOKEN = 'TOKEN'
}

export enum VerificationState {
  VERIFIED = 'VERIFIED',
  FLAGGED = 'FLAGGED',
  REVOKED = 'REVOKED',
  PENDING_REVIEW = 'PENDING_REVIEW'
}

export interface AttendanceRecordSummary {
  id: string
  tenantId: string
  entityId: string
  courseOrDepartment?: string
  userId: string
  verificationMethod: VerificationMethod
  verificationState: VerificationState
  timestamp: Date
  serverTimestamp: Date
  timeDriftSeconds: number
}

export enum AttendanceFlagType {
  DUPLICATE_ATTEMPT = 'DUPLICATE_ATTEMPT',
  REPLAY_ATTACK = 'REPLAY_ATTACK',
  TIME_DRIFT_VIOLATION = 'TIME_DRIFT_VIOLATION',
  DEVICE_MISMATCH = 'DEVICE_MISMATCH',
  GEOLOCATION_ANOMALY = 'GEOLOCATION_ANOMALY',
  UNUSUAL_TIME = 'UNUSUAL_TIME',
  MANUAL_REVIEW_REQUESTED = 'MANUAL_REVIEW_REQUESTED'
}

export interface AttendanceFlag {
  id: string
  recordId: string
  tenantId: string
  flagType: AttendanceFlagType
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  description: string
  reviewedBySuperadminId?: string
  reviewAction?: 'APPROVED' | 'REVOKED' | 'PENDING'
  reviewedAt?: Date
}

// === INCIDENT TYPES ===

export enum IncidentType {
  SECURITY = 'SECURITY',
  DATA = 'DATA',
  SYSTEM = 'SYSTEM',
  COMPLIANCE = 'COMPLIANCE'
}

export enum IncidentSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export enum IncidentStatus {
  OPEN = 'OPEN',
  INVESTIGATING = 'INVESTIGATING',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED'
}

export interface Incident {
  id: string
  type: IncidentType
  severity: IncidentSeverity
  status: IncidentStatus
  title: string
  description: string
  rootCause?: string
  affectedTenantsCount: number
  affectedUsersCount: number
  createdAt: Date
  resolvedAt?: Date
  closedAt?: Date
  contextData?: Record<string, any>
}

export interface IncidentTimeline {
  id: string
  incidentId: string
  eventType: string
  eventDescription: string
  actorSuperadminId: string
  eventData?: Record<string, any>
  createdAt: Date
}

// === AUDIT TYPES ===

export enum SuperadminActionType {
  TENANT_CREATE = 'TENANT_CREATE',
  TENANT_SUSPEND = 'TENANT_SUSPEND',
  TENANT_LOCK = 'TENANT_LOCK',
  ROLE_ASSIGN = 'ROLE_ASSIGN',
  ROLE_REVOKE = 'ROLE_REVOKE',
  SESSION_INVALIDATE = 'SESSION_INVALIDATE',
  INCIDENT_CREATE = 'INCIDENT_CREATE',
  INCIDENT_RESOLVE = 'INCIDENT_RESOLVE',
  CONFIG_UPDATE = 'CONFIG_UPDATE'
}

export interface SuperadminActionLog {
  id: string
  superadminUserId: string
  actionType: SuperadminActionType
  actionDescription?: string
  targetEntityType?: string
  targetEntityId?: string
  targetTenantId?: string
  beforeState?: Record<string, any>
  afterState?: Record<string, any>
  ipAddress: string
  createdAt: Date
}
```

---

## API Endpoints

### Base URL
```
POST   /api/v1/superadmin/*
GET    /api/v1/superadmin/*
```

All endpoints require:
- `Authorization: Bearer {jwt_token}`
- Superadmin role validation
- MFA verification (via middleware)

---

### A. Tenant Management Endpoints

```typescript
// === TENANT CRUD ===

/**
 * GET /api/v1/superadmin/tenants
 * List all tenants with filtering/pagination
 * 
 * Query params:
 * - status: ACTIVE | SUSPENDED | LOCKED
 * - type: SCHOOL | CORPORATE
 * - page: number
 * - limit: 1-100
 * 
 * Response: { tenants: Tenant[], total: number, hasMore: boolean }
 */
GET /api/v1/superadmin/tenants

/**
 * GET /api/v1/superadmin/tenants/:tenantId
 * Get tenant details and metadata
 * 
 * Response: TenantMetadata
 */
GET /api/v1/superadmin/tenants/:tenantId

/**
 * POST /api/v1/superadmin/tenants
 * Create new tenant
 * 
 * Body: {
 *   name: string
 *   type: SCHOOL | CORPORATE
 *   description?: string
 *   primaryContactEmail?: string
 * }
 * 
 * Response: { tenant: Tenant }
 * Audit: Creates TENANT_CREATE log
 */
POST /api/v1/superadmin/tenants

/**
 * PATCH /api/v1/superadmin/tenants/:tenantId
 * Update tenant configuration
 * 
 * Body: {
 *   status?: ACTIVE | SUSPENDED | LOCKED
 *   name?: string
 *   description?: string
 *   configKey?: string
 *   configValue?: any
 *   changeReason: string (required)
 * }
 * 
 * Response: { tenant: Tenant }
 * Audit: Creates CONFIG_UPDATE or TENANT_SUSPEND log
 */
PATCH /api/v1/superadmin/tenants/:tenantId

/**
 * POST /api/v1/superadmin/tenants/:tenantId/lock
 * Emergency lock - suspend all operations
 * 
 * Body: {
 *   reason: string
 *   requiresConfirmation?: boolean
 * }
 * 
 * Response: { tenant: Tenant, lockEvent: TenantLockEvent }
 * Audit: Creates TENANT_LOCK log
 * Note: Requires explicit confirmation (password re-entry)
 */
POST /api/v1/superadmin/tenants/:tenantId/lock

/**
 * POST /api/v1/superadmin/tenants/:tenantId/unlock
 * Unlock tenant
 * 
 * Body: { reason: string }
 * 
 * Response: { tenant: Tenant }
 * Audit: Creates audit entry
 */
POST /api/v1/superadmin/tenants/:tenantId/unlock

/**
 * POST /api/v1/superadmin/tenants/:tenantId/invalidate-sessions
 * Force all user sessions in tenant to logout
 * 
 * Body: { reason: string }
 * 
 * Response: { invalidatedCount: number }
 * Audit: Creates SESSION_INVALIDATE logs
 */
POST /api/v1/superadmin/tenants/:tenantId/invalidate-sessions
```

---

### B. Identity & Role Endpoints

```typescript
/**
 * GET /api/v1/superadmin/users
 * List all users with optional tenant filter
 * 
 * Query params:
 * - tenantId?: string
 * - status?: ACTIVE | INACTIVE | SUSPENDED
 * - page: number
 * - limit: 1-100
 * 
 * Response: { users: User[], total: number }
 * Note: READ-ONLY for superadmin
 */
GET /api/v1/superadmin/users

/**
 * GET /api/v1/superadmin/users/:userId/roles
 * Get user's role history (audit trail)
 * 
 * Query params:
 * - limit: 1-100
 * - offset: number
 * 
 * Response: { roleHistory: RoleAssignment[] }
 */
GET /api/v1/superadmin/users/:userId/roles

/**
 * GET /api/v1/superadmin/roles
 * List all available roles
 * 
 * Response: { roles: Role[] }
 */
GET /api/v1/superadmin/roles

/**
 * POST /api/v1/superadmin/users/:userId/roles/:roleId/assign
 * Assign role to user
 * 
 * Body: {
 *   tenantId: string
 *   reason: string
 * }
 * 
 * Response: { assignment: RoleAssignment }
 * Audit: Creates ROLE_ASSIGN log + detects escalation
 */
POST /api/v1/superadmin/users/:userId/roles/:roleId/assign

/**
 * POST /api/v1/superadmin/users/:userId/roles/:roleId/revoke
 * Revoke role from user
 * 
 * Body: { reason: string }
 * 
 * Response: { assignment: RoleAssignment }
 * Audit: Creates ROLE_REVOKE log
 */
POST /api/v1/superadmin/users/:userId/roles/:roleId/revoke

/**
 * GET /api/v1/superadmin/privilege-escalations
 * Detect and list suspicious privilege escalations
 * 
 * Query params:
 * - severity?: LOW | MEDIUM | HIGH | CRITICAL
 * - status?: OPEN | INVESTIGATED | RESOLVED
 * 
 * Response: { escalations: PrivilegeEscalationEvent[] }
 */
GET /api/v1/superadmin/privilege-escalations

/**
 * POST /api/v1/superadmin/users/:userId/sessions/invalidate
 * Force logout of specific user
 * 
 * Body: {
 *   reason: string
 *   allSessions?: boolean
 * }
 * 
 * Response: { invalidatedSessionCount: number }
 * Audit: Creates SESSION_INVALIDATE logs
 */
POST /api/v1/superadmin/users/:userId/sessions/invalidate
```

---

### C. System Health Endpoints

```typescript
/**
 * GET /api/v1/superadmin/system/health
 * Real-time system status
 * 
 * Response: {
 *   overallStatus: ServiceStatus
 *   services: SystemHealth[]
 *   timestamp: Date
 * }
 */
GET /api/v1/superadmin/system/health

/**
 * GET /api/v1/superadmin/system/health/:serviceName/history
 * Historical health data
 * 
 * Query params:
 * - timeRange: 1h | 6h | 24h | 7d
 * 
 * Response: { healthHistory: SystemHealth[] }
 */
GET /api/v1/superadmin/system/health/:serviceName/history

/**
 * GET /api/v1/superadmin/system/metrics
 * Fetch metrics
 * 
 * Query params:
 * - metricName: string
 * - tenantId?: string
 * - timeRange: 1h | 6h | 24h | 7d
 * - bucketSize: 1min | 5min | 1hour
 * 
 * Response: { metrics: SystemMetric[] }
 */
GET /api/v1/superadmin/system/metrics

/**
 * GET /api/v1/superadmin/system/alerts
 * List active alerts based on rules
 * 
 * Response: { activeAlerts: Alert[] }
 */
GET /api/v1/superadmin/system/alerts

/**
 * POST /api/v1/superadmin/system/alert-rules
 * Create alert rule
 * 
 * Body: AlertRule
 * Response: { alertRule: AlertRule }
 */
POST /api/v1/superadmin/system/alert-rules
```

---

### D. Attendance Integrity Endpoints

```typescript
/**
 * GET /api/v1/superadmin/attendance/flags
 * List flagged attendance records
 * 
 * Query params:
 * - flagType?: AttendanceFlagType
 * - severity?: LOW | MEDIUM | HIGH | CRITICAL
 * - tenantId?: string
 * - page: number
 * - limit: 1-100
 * 
 * Response: { flags: AttendanceFlag[], total: number }
 */
GET /api/v1/superadmin/attendance/flags

/**
 * GET /api/v1/superadmin/attendance/flags/:flagId
 * Get flag details with record context
 * 
 * Response: { flag: AttendanceFlag, record: AttendanceRecordSummary }
 */
GET /api/v1/superadmin/attendance/flags/:flagId

/**
 * POST /api/v1/superadmin/attendance/flags/:flagId/review
 * Review flagged record
 * 
 * Body: {
 *   action: APPROVED | REVOKED | PENDING
 *   notes?: string
 * }
 * 
 * Response: { flag: AttendanceFlag }
 * Audit: Creates audit entry
 */
POST /api/v1/superadmin/attendance/flags/:flagId/review

/**
 * GET /api/v1/superadmin/attendance/stats
 * Attendance integrity statistics
 * 
 * Query params:
 * - tenantId?: string
 * - timeRange: 1h | 6h | 24h | 7d
 * 
 * Response: {
 *   totalRecords: number
 *   verifiedCount: number
 *   flaggedCount: number
 *   flagRate: number (percent)
 *   commonIssues: { [flagType]: count }
 * }
 */
GET /api/v1/superadmin/attendance/stats
```

---

### E. Incident Management Endpoints

```typescript
/**
 * GET /api/v1/superadmin/incidents
 * List incidents with filtering
 * 
 * Query params:
 * - status?: OPEN | INVESTIGATING | RESOLVED | CLOSED
 * - severity?: LOW | MEDIUM | HIGH | CRITICAL
 * - type?: SECURITY | DATA | SYSTEM | COMPLIANCE
 * - page: number
 * - limit: 1-100
 * 
 * Response: { incidents: Incident[], total: number }
 */
GET /api/v1/superadmin/incidents

/**
 * GET /api/v1/superadmin/incidents/:incidentId
 * Get incident details with timeline
 * 
 * Response: {
 *   incident: Incident
 *   timeline: IncidentTimeline[]
 *   affectedTenants: { tenantId, affectedUserCount }[]
 * }
 */
GET /api/v1/superadmin/incidents/:incidentId

/**
 * POST /api/v1/superadmin/incidents
 * Create new incident
 * 
 * Body: {
 *   type: SECURITY | DATA | SYSTEM | COMPLIANCE
 *   severity: LOW | MEDIUM | HIGH | CRITICAL
 *   title: string
 *   description: string
 *   contextData?: any
 * }
 * 
 * Response: { incident: Incident }
 * Audit: Creates INCIDENT_CREATE log
 */
POST /api/v1/superadmin/incidents

/**
 * POST /api/v1/superadmin/incidents/:incidentId/timeline
 * Add event to incident timeline
 * 
 * Body: {
 *   eventType: string
 *   eventDescription: string
 *   eventData?: any
 * }
 * 
 * Response: { timelineEntry: IncidentTimeline }
 * Audit: Immutable append-only
 */
POST /api/v1/superadmin/incidents/:incidentId/timeline

/**
 * PATCH /api/v1/superadmin/incidents/:incidentId
 * Update incident status/root cause
 * 
 * Body: {
 *   status?: INVESTIGATING | RESOLVED | CLOSED
 *   rootCause?: string
 * }
 * 
 * Response: { incident: Incident }
 * Audit: Creates audit entry
 */
PATCH /api/v1/superadmin/incidents/:incidentId

/**
 * POST /api/v1/superadmin/incidents/:incidentId/affected-tenants
 * Mark tenants as affected
 * 
 * Body: {
 *   tenantId: string
 *   affectedUserCount: number
 *   dataExposureLevel?: string
 * }
 * 
 * Response: { affectedEntity: IncidentAffectedEntity }
 */
POST /api/v1/superadmin/incidents/:incidentId/affected-tenants
```

---

### F. Audit Logging Endpoints

```typescript
/**
 * GET /api/v1/superadmin/audit-logs
 * Retrieve superadmin action logs
 * 
 * Query params:
 * - actionType?: SuperadminActionType
 * - superadminId?: string
 * - targetEntityType?: string
 * - targetEntityId?: string
 * - timeRange: 1h | 6h | 24h | 7d | 30d
 * - page: number
 * - limit: 1-1000
 * 
 * Response: { logs: SuperadminActionLog[], total: number }
 * Note: Immutable and tamper-proof
 */
GET /api/v1/superadmin/audit-logs

/**
 * GET /api/v1/superadmin/audit-logs/export
 * Export audit logs for compliance
 * 
 * Query params:
 * - format: json | csv
 * - timeRange: 1h | 6h | 24h | 7d | 30d | custom
 * - startDate?: ISO8601
 * - endDate?: ISO8601
 * 
 * Response: File download (signed URL or stream)
 * Note: Creates audit entry for export action
 */
GET /api/v1/superadmin/audit-logs/export

/**
 * GET /api/v1/superadmin/audit-logs/integrity-check
 * Verify audit log hasn't been tampered with
 * 
 * Response: {
 *   integrityCheckPassed: boolean
 *   lastVerifiedAt: Date
 *   logCount: number
 * }
 */
GET /api/v1/superadmin/audit-logs/integrity-check

/**
 * GET /api/v1/superadmin/role-change-history
 * View role assignment history
 * 
 * Query params:
 * - userId?: string
 * - timeRange: 7d | 30d | 90d
 * - page: number
 * 
 * Response: { roleChanges: RoleChangeAudit[] }
 */
GET /api/v1/superadmin/role-change-history

/**
 * GET /api/v1/superadmin/tenant-change-history/:tenantId
 * View all changes to a tenant
 * 
 * Query params:
 * - page: number
 * 
 * Response: { changes: TenantChangeAudit[] }
 */
GET /api/v1/superadmin/tenant-change-history/:tenantId
```

---

## Security Architecture

### 1. Authentication & Authorization

```typescript
// Superadmin Session
interface SuperadminSession {
  userId: string
  role: 'superadmin'
  sessionId: string
  createdAt: Date
  expiresAt: Date // 4 hours max
  mfaVerifiedAt: Date // Must be recent (< 1 hour)
  ipAddress: string
  userAgent: string
  
  isValid(): boolean {
    return this.expiresAt > new Date() && 
           this.mfaVerifiedAt > new Date(Date.now() - 3600000) // 1 hour
  }
}

// Middleware Chain
app.use('/api/v1/superadmin', [
  // 1. JWT validation
  validateJWT(),
  
  // 2. Superadmin role check
  requireRole('superadmin'),
  
  // 3. MFA verification (< 1 hour old)
  requireRecentMFA(3600000),
  
  // 4. IP allowlist check (optional)
  checkIPAllowlist(),
  
  // 5. Rate limiting
  rateLimitDestructiveActions(),
  
  // 6. Request audit logging
  auditLog(),
  
  // 7. Route handler
])
```

### 2. Rate Limiting Strategy

```typescript
// Destructive actions require tighter limits
const rateLimitConfig = {
  // Read endpoints: 100 requests/minute
  readLimits: {
    windowMs: 60000,
    maxRequests: 100
  },
  
  // Modify endpoints: 20 requests/minute
  modifyLimits: {
    windowMs: 60000,
    maxRequests: 20
  },
  
  // Destructive endpoints (lock, invalidate): 5 requests/minute
  destructiveLimits: {
    windowMs: 60000,
    maxRequests: 5
  },
  
  // Confirmation-required endpoints: 2 requests/minute
  criticalLimits: {
    windowMs: 60000,
    maxRequests: 2
  }
}
```

### 3. IP Allowlisting

```typescript
// Optional but recommended
interface SuperadminIPAllowlist {
  superadminUserId: string
  allowedIPs: string[]
  createdAt: Date
  createdBySecurityTeam: boolean
}

// Check on each request
function checkIPAllowlist(req: Request) {
  const superadminId = req.user.id
  const clientIP = req.ip
  
  const allowlist = getAllowlist(superadminId)
  
  if (allowlist && allowlist.allowedIPs.length > 0) {
    if (!allowlist.allowedIPs.includes(clientIP)) {
      // Log security event
      logSecurityEvent('UNAUTHORIZED_IP', {
        superadminId,
        attemptedIP: clientIP,
        allowedIPs: allowlist.allowedIPs
      })
      
      throw new UnauthorizedException('IP not allowlisted')
    }
  }
}
```

### 4. Confirmation for Destructive Actions

```typescript
// Some actions require explicit password re-entry
interface DestructiveActionConfirmation {
  actionType: 'LOCK_TENANT' | 'INVALIDATE_ALL_SESSIONS' | 'DELETE_INCIDENT'
  passwordHash: string
  confirmedAt: Date
  expiresAt: Date // 5 minutes
}

// Endpoint example
POST /api/v1/superadmin/tenants/:tenantId/lock {
  reason: string
  confirmation: {
    password: string
  }
}
```

---

## Design Decisions

### 1. **Immutable Audit Trail**
- All audit logs are **append-only**, never deleted
- Uses `created_at` as single source of truth
- Supports `is_archived` for retention policies but never hard deletes
- **Why**: Legal compliance, forensic analysis, tamper detection

### 2. **Time-Series Metrics**
- Metrics bucketed into 1min, 5min, 1hour granules
- Separate table design for performance at scale
- **Why**: Enables efficient charting, alerting, and retention policies

### 3. **Multi-Tenant Isolation**
- Every table has `tenant_id` for logical isolation
- Database-level row security (RLS) recommended for PostgreSQL
- **Why**: Prevents accidental data leaks, enables compliance audits

### 4. **JSONB for Flexibility**
- `permissions`, `context_data`, `before_state`, `after_state` use JSONB
- Allows schema evolution without migrations
- Indexed for queryability
- **Why**: Superadmin operations are diverse; need flexibility

### 5. **Session-Based Invalidation**
- Sessions stored separately from audit trail
- Can invalidate all sessions for a user/tenant instantly
- **Why**: Critical for incident response (compromised credentials)

### 6. **Incident Timelines**
- Append-only event log per incident
- Immutable history of investigation steps
- **Why**: Legal requirement, chain of custody

### 7. **Privilege Escalation Detection**
- Separate table for flagging suspicious role changes
- Automated detection via triggers/stored procedures
- **Why**: Early warning system for security incidents

### 8. **Soft Deletes**
- Tenants have `deleted_at` for audit compliance
- Cascade behavior carefully managed
- **Why**: Regulatory requirement (GDPR, HIPAA)

---

## Scalability Considerations

- **Metrics table**: Partition by `recorded_at` (monthly) for archive-friendly management
- **Audit logs**: Partition by `created_at` (monthly) for retention policies
- **Indexes**: All foreign keys and filter columns indexed for query performance
- **Read Replicas**: Audit log reads can go to replicas; writes to primary
- **Caching**: System health can cache for 30 seconds; metrics for 1 minute

---

## Next Steps

1. **Implement schema** in PostgreSQL
2. **Implement API endpoints** with validation
3. **Add MFA middleware** (TOTP or WebAuthn)
4. **Set up background job** for alert rule evaluation
5. **Implement audit log export** with signing for compliance
6. **Add dashboard UI** (separate from this spec)
7. **Configure monitoring** to track superadmin actions
8. **Load test** for 10,000+ tenants

