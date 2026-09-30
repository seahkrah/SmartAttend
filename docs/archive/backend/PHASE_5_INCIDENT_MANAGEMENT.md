# PHASE 5, STEP 5.1: Error to Incident Pipeline

## Overview

The Error to Incident Pipeline is a comprehensive system that ensures no errors die silently in logs. It automatically classifies errors by severity, creates incidents for critical issues, and attaches error fingerprints to enable deduplication and pattern detection.

**Key Goals:**
- ✅ Classify errors by severity (critical, high, medium, low, info)
- ✅ Categorize errors (security, integrity, system, business, user)
- ✅ Automatically create incidents for critical errors
- ✅ Prevent security incidents from being missed
- ✅ Track error patterns with fingerprinting
- ✅ Provide complete audit trail
- ✅ Enable incident management and resolution workflow

---

## Architecture

### Components

#### 1. **Error Classification Service** (`errorClassificationService.ts`)
Classifies errors into categories and severity levels.

**Error Categories:**
- `security` - Authentication, authorization, privilege escalation
- `integrity` - Data corruption, constraint violations
- `system` - Database, service, memory, disk failures
- `business` - Business rule violations, quotas
- `user` - Validation, invalid requests

**Severity Levels:**
- `critical` - System down, data loss, security breach
- `high` - Significant malfunction, potential data loss
- `medium` - Error affecting operations
- `low` - Minor issues
- `info` - Informational messages

**Auto-Incident Creation:**
The following errors automatically create incidents:
- All security errors (UNAUTHORIZED_ACCESS, PRIVILEGE_ESCALATION, etc.)
- All integrity errors (DATA_INTEGRITY_VIOLATION, ORPHANED_RECORD, etc.)
- Critical system errors (DATABASE_CONNECTION_FAILED, SERVICE_UNAVAILABLE, etc.)

#### 2. **Error Fingerprinting Service** (`errorFingerprintService.ts`)
Creates unique fingerprints for errors to enable deduplication.

**Fingerprint Components:**
- Error code (normalized)
- Error message (normalized for pattern matching)
- Stack trace pattern (first 3 lines)

**Fingerprint Features:**
- SHA256 hash for uniqueness
- Message normalization (removes UUIDs, timestamps, numbers)
- Stack trace pattern extraction
- Similarity calculations
- Specialized fingerprinting for different error types

**Example:**

```typescript
const fingerprint = generateErrorFingerprint(
  'AUTH_FAILED',
  'Authentication failed for user abc-123',
  stackTrace
)
// Result: 
// {
//   hash: 'a3f5d8e2c1b9...',
//   errorCode: 'AUTH_FAILED',
//   errorMessage: 'Authentication failed for user abc-123',
//   stackTracePattern: 'at verifyToken ...|at middleware ...',
//   isRecurring: false
// }
```

#### 3. **Incident Service** (`incidentService.ts`)
Manages incident creation, updates, and retrieval.

**Incident Workflow:**
1. Error occurs
2. Error fingerprint is created/looked up
3. Incident is created in database
4. Timeline event is recorded
5. If escalation required, incident status is set to 'escalated'

**Incident Statuses:**
- `open` - Newly created incident
- `investigating` - Someone is investigating
- `mitigating` - Fix is being applied
- `resolved` - Issue is fixed
- `closed` - Incident is closed
- `escalated` - Requires higher-level attention

#### 4. **Error to Incident Middleware** (`errorToIncidentMiddleware.ts`)
Intercepts errors and automatically creates incidents.

**Key Functions:**
- `withIncidentTracking()` - Wraps route handlers to catch errors
- `errorToIncidentHandler()` - Global error handler
- `withDatabaseErrorTracking()` - Catches database errors
- `setupUncaughtHandlers()` - Handles process-level errors

---

## Database Schema

### Tables

#### `error_classifications`
Lookup table for error codes and their classification.

```sql
error_code: VARCHAR(50) UNIQUE -- 'AUTH_FAILED', 'PRIVILEGE_ESCALATION', etc.
error_category: VARCHAR(100)    -- 'security', 'integrity', 'system', etc.
severity: VARCHAR(20)           -- 'critical', 'high', 'medium', 'low', 'info'
auto_create_incident: BOOLEAN   -- Should this auto-create an incident?
require_escalation: BOOLEAN     -- Should this be escalated?
```

#### `error_fingerprints`
Deduplicates errors by fingerprint hash.

```sql
fingerprint_hash: VARCHAR(255) UNIQUE -- SHA256 hash
error_code: VARCHAR(50)               -- Reference to classification
error_message: TEXT                   -- Original message
stack_trace_pattern: TEXT             -- First N lines of stack
occurrence_count: INT                 -- How many times seen
first_occurrence: TIMESTAMP           -- When first seen
last_occurrence: TIMESTAMP            -- Most recent occurrence
is_active: BOOLEAN                    -- Is this error still occurring?
```

#### `incidents`
Main incident records.

```sql
platform_id: UUID                          -- Which platform
incident_type: VARCHAR(100)                -- 'error', 'security_breach', etc.
title: VARCHAR(255)                        -- Human-readable title
description: TEXT                          -- Detailed description
severity: VARCHAR(20)                      -- 'critical', 'high', etc.
status: VARCHAR(50)                        -- 'open', 'resolved', etc.
category: VARCHAR(100)                     -- 'security', 'integrity', etc.
error_fingerprint_id: UUID                 -- Link to error fingerprint
error_count: INT                           -- How many errors triggered this?
detected_by_user_id: UUID                  -- Who/what detected it
detection_method: VARCHAR(100)             -- 'automated', 'user_report', etc.
detection_source: VARCHAR(255)             -- Which service detected it
affected_users: INT                        -- Estimated user impact
affected_systems: TEXT (JSON)              -- Which systems affected
business_impact: VARCHAR(255)              -- Business description
root_cause: TEXT                           -- What caused it?
remediation_steps: TEXT                    -- How was it fixed?
prevention_measures: TEXT                  -- How to prevent recurrence?
```

#### `error_logs`
Detailed logs of every error that occurred.

```sql
incident_id: UUID               -- Link to incident
error_fingerprint_id: UUID      -- Link to fingerprint
error_code: VARCHAR(50)         -- Error code
error_message: TEXT             -- Error message
error_type: VARCHAR(100)        -- TypeError, ValidationError, etc.
stack_trace: TEXT               -- Full stack trace
service_name: VARCHAR(100)      -- Which service had the error
operation_name: VARCHAR(100)    -- Which operation failed
user_id: UUID                   -- Who triggered the error
ip_address: VARCHAR(45)         -- Request origin
severity: VARCHAR(20)           -- Severity level
is_recoverable: BOOLEAN         -- Can the operation be retried?
metadata: JSONB                 -- Additional context
```

#### `incident_timeline_events`
Complete audit trail of all incident state changes.

```sql
incident_id: UUID               -- Which incident
event_type: VARCHAR(100)        -- 'created', 'status_changed', etc.
old_value: TEXT                 -- Previous value
new_value: TEXT                 -- New value
description: TEXT               -- Human description
performed_by_user_id: UUID      -- Who made the change
performed_by_system: VARCHAR    -- If automated
```

#### `incident_statistics`
Aggregated metrics for dashboards.

```sql
platform_id: UUID               -- Which platform
date: DATE                       -- Date
total_incidents: INT            -- Count
critical_incidents: INT         -- Count
resolved_incidents: INT         -- Count
avg_resolution_time: INT        -- Minutes
mttr: INT                        -- Mean time to resolution
mttd: INT                        -- Mean time to detection
```

---

## Usage

### 1. Automatic Incident Creation

When critical errors occur, incidents are automatically created:

```typescript
// In a route handler
try {
  await someOperation()
} catch (error) {
  // Error is caught by withIncidentTracking middleware
  // If it's a security error:
  // - Error is classified
  // - Fingerprint is generated
  // - Incident is created automatically
  // - Timeline event is recorded
  // - If escalation needed, status is set to 'escalated'
  throw error
}
```

### 2. Manual Incident Creation

You can also manually create incidents:

```typescript
import { createIncident } from '@/services/incidentService'

const incidentId = await createIncident({
  platformId: 'school-platform-uuid',
  errorCode: 'UNAUTHORIZED_ACCESS',
  errorMessage: 'User attempted unauthorized access to admin panel',
  errorType: 'SecurityError',
  detectionMethod: 'monitoring',
  detectionSource: 'security_scanner',
  affectedUsers: 1,
  affectedSystems: ['admin_panel'],
  businessImpact: 'Security breach attempt detected'
})
```

### 3. Query Incidents

```typescript
// Get critical open incidents
const critical = await getCriticalIncidents(platformId)

// Get all open incidents
const open = await getOpenIncidents(platformId)

// Get specific incident
const incident = await getIncident(incidentId)

// Get statistics
const stats = await getIncidentStatistics(platformId)
```

### 4. Update Incident Status

```typescript
import { updateIncident } from '@/services/incidentService'

await updateIncident(incidentId, {
  status: 'investigating',
  acknowledgedByUserId: userId
})

// Resolved incident
await updateIncident(incidentId, {
  status: 'resolved',
  resolvedByUserId: userId,
  rootCause: 'Database connection pool exhausted',
  remediationSteps: 'Increased pool size and restarted service',
  preventionMeasures: 'Added automated pool monitoring and alerts'
})
```

### 5. API Endpoints

```
GET  /api/incidents/critical        # Get critical incidents
GET  /api/incidents/open            # Get open incidents
GET  /api/incidents/:id             # Get incident details
PATCH /api/incidents/:id            # Update incident
GET  /api/incidents/stats           # Get statistics
```

---

## Error Classification Examples

### Security Errors (Auto-Create Incidents)

```
AUTH_FAILED                    → High severity security incident
UNAUTHORIZED_ACCESS            → Critical security incident (escalated)
PRIVILEGE_ESCALATION           → Critical security incident (escalated)
ROLE_MANIPULATION              → Critical security incident (escalated)
TENANT_BOUNDARY_VIOLATION      → Critical security incident (escalated)
TOKEN_MANIPULATION             → Critical security incident (escalated)
```

### Integrity Errors (Auto-Create Incidents)

```
DATA_INTEGRITY_VIOLATION       → Critical integrity incident (escalated)
DUPLICATE_ENTRY                → High integrity incident
INVALID_STATE_TRANSITION       → High integrity incident
ORPHANED_RECORD                → High integrity incident (escalated)
```

### System Errors (Auto-Create Incidents)

```
DATABASE_CONNECTION_FAILED     → Critical system incident (escalated)
DATABASE_QUERY_TIMEOUT         → High system incident
SERVICE_UNAVAILABLE            → Critical system incident (escalated)
MEMORY_EXHAUSTED               → Critical system incident (escalated)
DISK_SPACE_CRITICAL            → Critical system incident (escalated)
MIGRATION_FAILED               → Critical system incident (escalated)
EXTERNAL_SERVICE_FAILURE       → High system incident
```

### Business Errors (Manual or Frequency-Based)

```
BUSINESS_RULE_VIOLATION        → Medium - manual review
QUOTA_EXCEEDED                 → Medium - track frequency
INVALID_OPERATION              → Medium - no auto-incident
```

### User Errors (No Auto-Incident)

```
VALIDATION_ERROR               → Low - no incident created
RESOURCE_NOT_FOUND             → Low - no incident created
INVALID_REQUEST                → Low - no incident created
```

---

## Key Features

### 1. **No Silent Failures**

- Every critical error creates an incident
- Uncaught exceptions are logged and tracked
- Unhandled promise rejections are captured
- Database errors trigger incident creation

### 2. **Error Deduplication**

Fingerprints group similar errors:

```
Error 1: "User 123 unauthorized access"
Error 2: "User 456 unauthorized access"
Error 3: "User 789 unauthorized access"

→ Same fingerprint
→ Single incident with error_count = 3
→ Pattern recognized
```

### 3. **Automatic Escalation**

Critical errors are automatically escalated:

```
PRIVILEGE_ESCALATION error
  → incident.severity = 'critical'
  → incident.status = 'escalated'
  → Automatically triggers notification
```

### 4. **Complete Audit Trail**

Every change is recorded:

```
2024-02-05 14:30:45 - Incident created (UNAUTHORIZED_ACCESS)
2024-02-05 14:31:12 - Acknowledged by admin (John Smith)
2024-02-05 14:35:20 - Status changed: investigating
2024-02-05 14:42:50 - Status changed: resolved
2024-02-05 14:43:01 - Root cause: Session token not validated
```

### 5. **Context Preservation**

Each error log includes:

```
- User information (who triggered it)
- Request context (path, method, IP)
- Environment info (dev/staging/prod)
- Full stack trace
- Normalized error fingerprint
- Metadata (JSON for additional context)
```

---

## Integration

### In Route Handlers

```typescript
import { withIncidentTracking } from '@/middleware/errorToIncidentMiddleware'

router.post(
  '/sensitive-operation',
  withIncidentTracking(async (req, res) => {
    // If this throws a security error:
    // 1. Error is caught
    // 2. Classified as security
    // 3. Incident automatically created
    // 4. Timeline recorded
    // 5. Error handler sends response
    await performSensitiveOperation()
  })
)
```

### In Server Setup

```typescript
import { setupUncaughtHandlers } from '@/middleware/errorToIncidentMiddleware'

// Setup process-level error handlers
setupUncaughtHandlers()

// Add global error handler (must be last)
app.use(errorToIncidentHandler)
```

---

## Monitoring & Dashboards

### Key Metrics

- **Total Incidents**: Count of all incidents
- **Critical Count**: How many critical incidents
- **Open Count**: Incidents still being investigated
- **Resolved Count**: Successfully resolved incidents
- **MTTR** (Mean Time To Resolution): Average resolution time
- **MTTD** (Mean Time To Detection): How fast are errors detected?
- **Recurrence Rate**: How often do same errors happen?

### Query Examples

```typescript
// Get incidents from last 24 hours
const recentIncidents = await query(`
  SELECT * FROM incidents 
  WHERE platform_id = $1 AND created_at > NOW() - INTERVAL '1 day'
  ORDER BY created_at DESC
`)

// Get most common error patterns
const commonErrors = await query(`
  SELECT 
    ef.error_code,
    ef.error_message,
    COUNT(el.*) as occurrence_count,
    COUNT(DISTINCT el.incident_id) as incident_count
  FROM error_fingerprints ef
  LEFT JOIN error_logs el ON ef.id = el.error_fingerprint_id
  WHERE ef.is_active = true
  GROUP BY ef.id
  ORDER BY occurrence_count DESC
  LIMIT 10
`)

// Get incidents by category
const byCategory = await query(`
  SELECT 
    category,
    COUNT(*) as count,
    SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count
  FROM incidents
  WHERE platform_id = $1
  GROUP BY category
`)
```

---

## Best Practices

### 1. **Always Use Classification**
Let the system classify errors - don't hardcode severity.

### 2. **Catch Database Errors**
Use `withDatabaseErrorTracking()` for database operations.

### 3. **Provide Context**
Include relevant context in error messages:
```typescript
throw new Error(`Failed to update user ${userId} in platform ${platformId}`)
```

### 4. **Don't Suppress Errors**
Never silently catch and ignore errors:
```typescript
// ❌ BAD
try {
  await operation()
} catch (e) {
  // silent failure
}

// ✅ GOOD
try {
  await operation()
} catch (e) {
  console.error('Operation failed:', e)
  throw e // Let middleware handle it
}
```

### 5. **Review Critical Incidents**
Set up monitoring to alert on critical incidents.

---

## Troubleshooting

### Incident Not Created

1. Check if error classification has `autoCreateIncident: true`
2. Verify middleware is properly registered
3. Check database connection
4. Look for errors in `error_logs` table

### Fingerprints Not Deduplicating

1. Ensure fingerprint hash is consistent
2. Check if stack traces are similar enough
3. Verify message normalization is working
4. Review similarity threshold

### Missing Error Logs

1. Verify `error_logs` table exists
2. Check database write permissions
3. Look for SQL errors in server logs
4. Ensure fingerprint creation succeeded

---

## Next Steps

- Add incident notification system (email, Slack)
- Implement incident escalation workflow
- Create incident dashboard
- Add automated remediation for common errors
- Integrate with monitoring systems

