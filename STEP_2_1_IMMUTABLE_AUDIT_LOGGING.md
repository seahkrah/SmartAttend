# PHASE 2, STEP 2.1: Immutable Audit Logging

**Status**: COMPLETE  
**Date**: February 4, 2026  
**Objective**: Implement production-grade append-only audit logging at data layer

---

## Executive Summary

SmartAttend now has a comprehensive, immutable audit logging system that captures and preserves all domain operations. The system is designed to be:

- **Append-only** — No UPDATE/DELETE operations possible at database level
- **Tamper-proof** — SHA256 checksums verify integrity
- **Comprehensive** — Captures before/after state for all changes
- **Auditable** — Read-only access for compliance and investigation

### Key Guarantees

✅ **Immutable at database layer** — Triggers prevent UPDATE/DELETE on audit tables  
✅ **Complete state capture** — Before and after state for every operation  
✅ **Audit trail integrity** — Checksums detect tampering or corruption  
✅ **Read-only access** — Superadmin can query; no modification possible  
✅ **Multi-scope auditing** — GLOBAL, TENANT, and USER level operations tracked

---

## Architecture

### Two-Layer Audit System

```
┌─────────────────────────────────────────────┐
│  INFRASTRUCTURE AUDIT LOG                   │
│  (From Migration 006)                       │
├─────────────────────────────────────────────┤
│ superadmin_audit_log                        │
│ - Superadmin operations only                │
│ - Strict change tracking                    │
│ - Immutable constraints                     │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  DOMAIN AUDIT LOG (NEW - Step 2.1)          │
│  (From Migration 008)                       │
├─────────────────────────────────────────────┤
│ audit_logs                                  │
│ - All user-visible operations               │
│ - Capture before/after state                │
│ - Immutable + checksum integrity            │
│ - Multi-scope support (GLOBAL/TENANT/USER)  │
└─────────────────────────────────────────────┘
```

### Database Schema

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,                    -- Unique entry ID
  
  -- Actor
  actor_id UUID NOT NULL,                 -- Who made the change
  actor_role VARCHAR(100),                -- Their role at time of change
  
  -- Action
  action_type VARCHAR(100) NOT NULL,      -- What operation (CREATE, UPDATE, DELETE, etc)
  action_scope VARCHAR(50) NOT NULL,      -- Scope (GLOBAL, TENANT, USER)
  
  -- Resource
  resource_type VARCHAR(100),             -- What resource changed (e.g., 'attendance_record')
  resource_id UUID,                       -- Which resource instance
  
  -- State Snapshots
  before_state JSONB,                     -- Complete state BEFORE operation
  after_state JSONB,                      -- Complete state AFTER operation
  
  -- Justification
  justification TEXT,                     -- Why the change was made
  
  -- Context
  request_id VARCHAR(255),                -- Correlation ID
  ip_address INET NOT NULL,               -- Source IP address
  user_agent VARCHAR(500),                -- Browser/client info
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL,        -- When logged (cannot be changed)
  is_immutable BOOLEAN DEFAULT TRUE,      -- Integrity flag
  checksum VARCHAR(64)                    -- SHA256 for tampering detection
);

-- IMMUTABILITY ENFORCED BY TRIGGERS
CREATE TRIGGER prevent_audit_logs_update_trigger
BEFORE UPDATE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_logs_update();

CREATE TRIGGER prevent_audit_logs_delete_trigger
BEFORE DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_logs_delete();
```

### Immutability Constraints

**At Database Level:**
```sql
-- Attempt to update audit_logs
UPDATE audit_logs SET justification = 'hacked' WHERE id = 'abc'
-- Result: Exception: "Audit logs are immutable. UPDATE operations are not permitted."

-- Attempt to delete audit_logs
DELETE FROM audit_logs WHERE id = 'abc'
-- Result: Exception: "Audit logs are immutable. DELETE operations are not permitted."
```

**At Application Level:**
- No UPDATE or DELETE operations in `domainAuditService.ts`
- Only INSERT operations supported
- Read-only API endpoints
- Permission checks to prevent unauthorized access

---

## API Endpoints

### 1. Query Audit Logs

**GET** `/api/audit/logs`

Query audit logs with optional filtering.

**Query Parameters:**
- `actorId` — Filter by actor ID
- `actionType` — Filter by action type (CREATE, UPDATE, DELETE, etc)
- `actionScope` — Filter by scope (GLOBAL, TENANT, USER)
- `resourceType` — Filter by resource type (e.g., 'attendance_record')
- `resourceId` — Filter by specific resource ID
- `startTime` — ISO 8601 start timestamp
- `endTime` — ISO 8601 end timestamp
- `limit` — Max results (default: 100, max: 10000)
- `offset` — Pagination offset (default: 0)

**Permissions:**
- Superadmin: Can query all logs
- Regular users: Can only query their own logs (where actor_id = user_id)

**Example Request:**
```bash
GET /api/audit/logs?actionType=UPDATE&resourceType=attendance_record&limit=50
```

**Example Response:**
```json
{
  "success": true,
  "count": 2,
  "filters": {
    "actionType": "UPDATE",
    "resourceType": "attendance_record",
    "limit": 50
  },
  "logs": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "actor_id": "user-123",
      "actor_role": "admin",
      "action_type": "UPDATE",
      "action_scope": "TENANT",
      "resource_type": "attendance_record",
      "resource_id": "rec-456",
      "before_state": {
        "status": "present",
        "check_in_time": "2026-02-04T09:00:00Z"
      },
      "after_state": {
        "status": "late",
        "check_in_time": "2026-02-04T09:30:00Z"
      },
      "justification": "Manual correction for system clock issue",
      "created_at": "2026-02-04T14:30:00Z",
      "checksum": "a1b2c3d4e5f6..."
    }
  ]
}
```

---

### 2. Get Specific Audit Entry

**GET** `/api/audit/logs/:id`

Retrieve a specific audit log entry by ID.

**Permissions:**
- Superadmin: Can query any entry
- Regular users: Can only query their own entries

**Example Response:**
```json
{
  "success": true,
  "entry": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "actor_id": "user-123",
    "action_type": "UPDATE",
    "before_state": {...},
    "after_state": {...},
    "checksum": "a1b2c3d4e5f6..."
  }
}
```

---

### 3. Get Resource Audit Trail

**GET** `/api/audit/resource/:resourceType/:resourceId/trail`

Get complete audit trail for a specific resource showing all changes in chronological order.

**Example Request:**
```bash
GET /api/audit/resource/attendance_record/rec-456/trail
```

**Example Response:**
```json
{
  "success": true,
  "resourceType": "attendance_record",
  "resourceId": "rec-456",
  "changeCount": 3,
  "trail": [
    {
      "id": "first-change-id",
      "created_at": "2026-02-04T08:00:00Z",
      "action_type": "CREATE",
      "after_state": {"status": "present", "check_in_time": "2026-02-04T09:00:00Z"}
    },
    {
      "id": "second-change-id",
      "created_at": "2026-02-04T12:00:00Z",
      "action_type": "UPDATE",
      "before_state": {"status": "present"},
      "after_state": {"status": "absent"}
    },
    {
      "id": "third-change-id",
      "created_at": "2026-02-04T14:30:00Z",
      "action_type": "UPDATE",
      "before_state": {"status": "absent"},
      "after_state": {"status": "present"}
    }
  ]
}
```

**Shows complete history:** Create → Update → Update

---

### 4. Get Audit Summary

**GET** `/api/audit/summary`

Get aggregated audit log statistics.

**Permissions:** Superadmin only

**Example Response:**
```json
{
  "success": true,
  "summary": {
    "totalOperationsLogged": 2547,
    "topActionTypes": [
      {"action_type": "UPDATE", "count": 1823},
      {"action_type": "CREATE", "count": 524},
      {"action_type": "DELETE", "count": 200}
    ],
    "scopeDistribution": [
      {"action_scope": "USER", "count": 2000},
      {"action_scope": "TENANT", "count": 500},
      {"action_scope": "GLOBAL", "count": 47}
    ],
    "topActors": [
      {"actor_id": "user-123", "count": 450},
      {"actor_id": "user-456", "count": 325}
    ],
    "last24HoursOperations": 234,
    "lastUpdated": "2026-02-04T14:30:00Z"
  }
}
```

---

### 5. Search Audit Logs

**GET** `/api/audit/search`

Search audit logs by justification text using full-text search.

**Query Parameters:**
- `q` — Search query (required)
- `limit` — Max results (default: 100, max: 10000)

**Permissions:** Superadmin only

**Example Request:**
```bash
GET /api/audit/search?q=clock+issue&limit=20
```

---

### 6. Get Period Logs

**GET** `/api/audit/period`

Get audit logs for a specific time period (useful for compliance reporting).

**Query Parameters:**
- `startTime` — ISO 8601 start timestamp (required)
- `endTime` — ISO 8601 end timestamp (required)
- `actionScope` — Optional scope filter

**Permissions:** Superadmin only

**Example Request:**
```bash
GET /api/audit/period?startTime=2026-02-01T00:00:00Z&endTime=2026-02-04T23:59:59Z&actionScope=USER
```

---

### 7. Verify Audit Log Integrity

**GET** `/api/audit/logs/:id/verify`

Verify integrity of a specific audit log entry by recalculating checksum.

**Permissions:** Superadmin only

**Example Response:**
```json
{
  "success": true,
  "auditId": "550e8400-e29b-41d4-a716-446655440000",
  "verification": {
    "isValid": true,
    "storedChecksum": "a1b2c3d4e5f6...",
    "calculatedChecksum": "a1b2c3d4e5f6..."
  }
}
```

**If tampered:**
```json
{
  "success": true,
  "auditId": "550e8400-e29b-41d4-a716-446655440000",
  "verification": {
    "isValid": false,
    "storedChecksum": "a1b2c3d4e5f6...",
    "calculatedChecksum": "z9y8x7w6v5u4...",
    "entry": { /* full entry for investigation */ }
  }
}
```

---

### 8. Test Immutability Constraint

**POST** `/api/audit/test-immutability`

Test that immutability constraints are working (diagnostic endpoint).

**Permissions:** Superadmin only

**Example Response - Working:**
```json
{
  "success": true,
  "testResult": {
    "immutable": true,
    "message": "Immutability constraint is working correctly"
  }
}
```

**Example Response - Failed:**
```json
{
  "success": true,
  "testResult": {
    "immutable": false,
    "message": "WARNING: UPDATE succeeded (immutability constraint not working!)"
  }
}
```

---

## Service API

### TypeScript Service Functions

**Location:** `apps/backend/src/services/domainAuditService.ts`

```typescript
// Log an operation
async function logAudit(entry: AuditLogEntry): Promise<string>

// Query logs with filters
async function queryAuditLogs(
  filters: {actorId?, actionType?, actionScope?, resourceType?, resourceId?, ...},
  superadminAccess: boolean
): Promise<any[]>

// Get specific entry
async function getAuditLogById(auditId: string): Promise<any | null>

// Get full trail for resource
async function getAuditTrailForResource(
  resourceType: string,
  resourceId: string
): Promise<any[]>

// Get summary statistics
async function getAuditSummary(): Promise<any>

// Verify integrity
async function verifyAuditLogIntegrity(auditId: string): Promise<{
  isValid: boolean,
  storedChecksum: string,
  calculatedChecksum: string
}>

// Search by justification
async function searchAuditLogsByJustification(
  searchText: string,
  limit: number
): Promise<any[]>

// Get logs for time period
async function getAuditLogsForPeriod(
  startTime: Date,
  endTime: Date,
  actionScope?: 'GLOBAL' | 'TENANT' | 'USER'
): Promise<any[]>

// Test immutability
async function testImmutabilityConstraint(): Promise<{
  immutable: boolean,
  message: string
}>
```

---

## Audit Middleware

### Automatic Operation Tracking

**Location:** `apps/backend/src/auth/auditOperationMiddleware.ts`

Middleware automatically captures and logs operations.

```typescript
// Basic audit middleware
auditOperationMiddleware(
  actionType: string,
  actionScope: 'GLOBAL' | 'TENANT' | 'USER' = 'USER',
  resourceTypeExtractor?: (req) => string
)

// Example usage in routes
router.post('/records', 
  auditOperationMiddleware('CREATE', 'USER', (req) => 'attendance_record'),
  createRecordHandler
)
```

**Captures automatically:**
- Actor ID and role
- Action type and scope
- Before state (for PUT/PATCH/DELETE)
- After state (from response)
- Justification (from request body)
- Request ID, IP address, user agent
- Timestamp

---

## Use Cases

### 1. Compliance Audit Trail

```bash
# Get all operations for a specific period
GET /api/audit/period?startTime=2026-02-01T00:00:00Z&endTime=2026-02-28T23:59:59Z

# Result: Complete record of every change made in February
```

### 2. Investigate Data Anomaly

```bash
# Get full history of a specific attendance record
GET /api/audit/resource/attendance_record/rec-123/trail

# Result: Shows every CREATE, UPDATE, DELETE with before/after state
# Can determine exactly when and how data changed
```

### 3. User Activity Report

```bash
# Get all operations by specific user
GET /api/audit/logs?actorId=user-456

# Result: Complete activity log for that user
```

### 4. Detect Tampering

```bash
# Verify integrity of critical entries
GET /api/audit/logs/entry-id-1/verify
GET /api/audit/logs/entry-id-2/verify

# If any checksum mismatch: Data has been tampered with!
# (Impossible if immutability constraints working)
```

### 5. Compliance Report Generation

```bash
# Search for specific justifications
GET /api/audit/search?q=manual+correction

# Get statistics
GET /api/audit/summary

# Export for audit
```

---

## Security Guarantees

### 1. No UPDATE Possible

```
Any attempt to UPDATE audit_logs:
  ↓
Database trigger fires
  ↓
Exception: "Audit logs are immutable. UPDATE operations are not permitted."
  ↓
Operation REJECTED ✗
```

### 2. No DELETE Possible

```
Any attempt to DELETE from audit_logs:
  ↓
Database trigger fires
  ↓
Exception: "Audit logs are immutable. DELETE operations are not permitted."
  ↓
Operation REJECTED ✗
```

### 3. Tampering Detection

```
If database storage corrupted/tampered:
  ↓
Checksum recalculated
  ↓
Checksum != stored checksum
  ↓
Mismatch detected and reported ✓
```

### 4. Permission Enforcement

```
Non-superadmin user queries:
  ↓
Service checks user role
  ↓
Filters to actor_id = current_user_id
  ↓
User can only see their own operations ✓

Superadmin queries:
  ↓
Can access all logs ✓
  ↓
Cannot modify any log ✗ (database constraint)
```

---

## Performance Considerations

### Indexes for Read Performance

```sql
CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX idx_audit_logs_action_scope ON audit_logs(action_scope);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_actor_timestamp ON audit_logs(actor_id, created_at DESC);
```

### Query Optimization

- Indexes enable fast filtering
- Limit results to max 10,000 per query
- Offset-based pagination for compliance dumps
- Time-based partitioning possible for very large datasets

### Archival Strategy

```
Recent Data (0-90 days): HOT table (audit_logs)
  - Fast queries
  - Full indexing
  - Immediate access

Historical Data (90+ days): Archive table (audit_logs_archive)
  - Compress storage
  - Retain for compliance
  - Infrequent access

Maintenance Task:
  INSERT INTO audit_logs_archive 
  SELECT * FROM audit_logs 
  WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
```

---

## Migration & Deployment

### Database Migration

```bash
# Apply migration
psql -d smartattend -f apps/backend/src/db/migrations/008_immutable_audit_logging.sql

# Verify
SELECT * FROM information_schema.tables WHERE table_name = 'audit_logs';
```

### Application Startup

```bash
# Start backend
cd apps/backend
npm run dev

# Audit tables created and ready
# API endpoints available at /api/audit/*
```

### Verification

```bash
# Test immutability constraint
curl -X POST http://localhost:3000/api/audit/test-immutability

# Should return:
{
  "success": true,
  "testResult": {
    "immutable": true,
    "message": "Immutability constraint is working correctly"
  }
}
```

---

## Files Modified/Created

### Created Files (Step 2.1)

| File | Purpose |
|------|---------|
| `apps/backend/src/db/migrations/008_immutable_audit_logging.sql` | Database schema, triggers, functions |
| `apps/backend/src/services/domainAuditService.ts` | Service API for audit operations |
| `apps/backend/src/auth/auditOperationMiddleware.ts` | Middleware for automatic operation tracking |
| `apps/backend/src/routes/audit.ts` | REST API endpoints for querying audit logs |

### Modified Files (Step 2.1)

| File | Changes |
|------|---------|
| `apps/backend/src/index.ts` | Added import and mount for audit routes |

### Existing Files (Pre-Step 2.1)

| File | Purpose |
|------|---------|
| `apps/backend/src/db/migrations/006_infrastructure_control_plane.sql` | Infrastructure audit log (superadmin-specific) |
| `apps/backend/src/services/auditService.ts` | Infrastructure audit service |

---

## Verification Checklist

- ✅ Migration 008 creates `audit_logs` table with proper schema
- ✅ Immutability triggers prevent UPDATE/DELETE operations
- ✅ Checksum calculation on INSERT
- ✅ Indexes created for query performance
- ✅ `domainAuditService.ts` provides comprehensive API
- ✅ `auditOperationMiddleware.ts` captures operations automatically
- ✅ `audit.ts` routes provide read-only REST endpoints
- ✅ Permission checks enforce superadmin-only access where needed
- ✅ Service module mounts in index.ts
- ✅ All TypeScript compiles without errors
- ✅ Pre-commit hooks allow configuration files

---

## Next Steps: PHASE 2, STEP 2.2

With Step 2.1 complete, next will implement:

**Step 2.2 — Authority Matrix**
- Role-based access control hierarchy
- Cross-tenant isolation rules
- Permission inheritance and delegation
- Authority verification middleware

---

## Troubleshooting

### Issue: UPDATE succeeds on audit_logs

**Cause:** Immutability triggers not attached  
**Fix:** Verify triggers via query
```sql
SELECT * FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass;
```

### Issue: Checksum mismatch

**Cause:** Data corruption or tampering  
**Action:** Investigate via full audit trail and database logs

### Issue: Slow audit queries

**Cause:** Missing indexes  
**Fix:** Verify indexes created
```sql
SELECT * FROM pg_indexes WHERE tablename = 'audit_logs';
```

---

## Summary

**PHASE 2, STEP 2.1 is COMPLETE**

SmartAttend now has production-grade immutable audit logging that:

✅ Records all operations with before/after state  
✅ Prevents tampering via database constraints  
✅ Enables compliance reporting and investigations  
✅ Maintains complete audit trails  
✅ Provides read-only superadmin access  
✅ Scales for growing data volumes  

**Ready for Step 2.2: Authority Matrix**
