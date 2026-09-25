# PHASE 2, STEP 2.2 — SERVER TIME AUTHORITY

**Status**: ✅ **IMPLEMENTATION COMPLETE**

**Objective**: Enforce server-side time as the single source of truth for all operations, detect and flag clock drift, and block attendance actions when clock drift exceeds acceptable thresholds.

---

## Overview

### The Problem
- Client devices (phones, tablets, computers) have unreliable clocks
- Clocks can drift by minutes or hours due to:
  - Network time sync failures
  - User manual adjustments
  - Device sleep/wake cycles
  - Timezone confusion
- Attendance records timestamped with client time are unreliable
- Attendance can be manipulated by changing device time

### The Solution
This implementation enforces **server-side time authority**:
1. **Server time is authoritative** — all operations use server's clock
2. **Client time is advisory** — used only for validation and flagging
3. **Clock drift is detected** — measured on every request
4. **Drift is logged** — complete audit trail of drift events
5. **Violations are flagged** — attendance records affected by drift are marked
6. **Critical violations are blocked** — operations exceeding thresholds are rejected

---

## Architecture

### Core Components

#### 1. **Time Authority Service** (`timeAuthorityService.ts`)
Central service for time-related operations:

```typescript
// Get server time (single source of truth)
getServerTime(): Date
getServerTimeISO(): string
getServerTimeMS(): number

// Calculate drift between client and server
calculateClockDrift(clientTimestamp, serverTimestamp?): number

// Classify severity based on drift magnitude
classifyDriftSeverity(driftSeconds): 'INFO' | 'WARNING' | 'CRITICAL'

// Log drift to database
logClockDrift(context): Promise<string>

// Retrieve drift history and statistics
getUserClockDriftHistory(userId, limit)
getTenantClockDriftStats(tenantId)
getCriticalDriftEvents(limit)

// Validate and block operations
shouldBlockAttendanceAction(driftSeconds, actionType)
validateClientTime(clientTimestamp, maxAcceptableDrift)

// Flag attendance affected by drift
flagAttendanceForDrift(attendanceRecordId, driftContext)

// Extract and format drift information
extractClientTimestamp(request)
formatDrift(driftSeconds)
```

**Key Guarantees**:
- ✅ Server time is always now — no caching, fresh on each call
- ✅ Drift calculation is consistent — uses millisecond-precision timestamps
- ✅ Severity classification is objective — based on configurable thresholds
- ✅ All operations logged — complete audit trail
- ✅ Type-safe — full TypeScript interfaces for all data

#### 2. **Clock Drift Detection Middleware** (`clockDriftDetectionMiddleware.ts`)
Middleware pipeline for drift detection and enforcement:

```typescript
// Core middleware: Detect drift on every request
clockDriftDetectionMiddleware()
  → Extracts client timestamp from headers/body
  → Calculates drift vs. server time
  → Logs to clock_drift_log table
  → Attaches context to request

// Attendance-specific: Validate and block
attendanceClockDriftValidationMiddleware()
  → Applied before attendance routes
  → Checks if drift exceeds attendance threshold
  → Returns 409 Conflict if blocked
  → Flags for review if warning level

// Audit integration: Attach drift context to audit logs
auditClockDriftContextMiddleware()
  → Adds drift info to audit context
  → Records in immutable audit_logs

// Response enhancement: Add drift headers
clockDriftWarningMiddleware()
  → Adds X-Clock-Drift-Warning header
  → Helps clients understand drift

// Strict enforcement: Block if drift exceeds threshold
strictClockDriftEnforcementMiddleware(maxDriftSeconds)
  → Reusable for critical operations
  → Blocks any operation beyond threshold
```

**Middleware Order** (in `index.ts`):
1. CORS
2. JSON parser
3. **Clock drift detection** ← Added globally
4. **Audit clock drift context** ← Added globally
5. Request logger
6. Routes mounted
7. **Attendance drift validation** ← Added before attendance routes

#### 3. **Time API Routes** (`routes/time.ts`)
Public and admin endpoints for time synchronization and management:

```
GET  /api/time/sync
     → Returns server time for client synchronization
     → Public endpoint (no auth required)
     → Response: { timestamp, iso, unix, timezone }

GET  /api/time/sync/precise
     → High-precision time sync with latency estimation
     → Helps clients compensate for network latency
     → Response: { requestTime, responseTime, estimatedLatencyMs }

GET  /api/time/validate
     → Validate client time against server
     → Query: ?clientTimestamp=ISO_STRING_OR_MS
     → Response: { serverTime, clientTime, driftSeconds, isValid, recommendation }

GET  /api/time/drift/history
     → User's recent drift history
     → Auth required
     → Response: List of drift events

GET  /api/time/drift/stats
     → Tenant-wide drift statistics
     → Superadmin only
     → Response: { overall, topDrifters }

GET  /api/time/drift/critical
     → Critical drift events requiring investigation
     → Superadmin only
     → Response: List of critical events

POST /api/time/drift/investigate
     → Investigation of specific drift event
     → Superadmin only
     → Body: { driftEventId, action, notes }

GET  /api/time/status
     → System status and configuration
     → Superadmin only
     → Response: { status, serverTime, features }
```

---

## Database Schema

### `clock_drift_log` Table
Records every detected drift event:

```sql
CREATE TABLE clock_drift_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES school_entities(id),
  user_id UUID NOT NULL REFERENCES users(id),
  
  client_timestamp TIMESTAMPTZ NOT NULL,
  server_timestamp TIMESTAMPTZ NOT NULL,
  drift_seconds INTEGER NOT NULL,
  
  severity VARCHAR(20) CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  attendance_affected BOOLEAN DEFAULT FALSE,
  request_id VARCHAR(255),
  
  timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX idx_clock_drift_tenant ON clock_drift_log(tenant_id);
CREATE INDEX idx_clock_drift_severity ON clock_drift_log(severity);
CREATE INDEX idx_clock_drift_user ON clock_drift_log(user_id);
CREATE INDEX idx_clock_drift_timestamp ON clock_drift_log(timestamp DESC);
```

**Columns**:
- `drift_seconds`: Positive = client ahead, Negative = client behind
- `severity`: INFO (±5s), WARNING (±60s), CRITICAL (>±60s)
- `attendance_affected`: Flag set if drift is CRITICAL and action is attendance
- `request_id`: Correlates with audit logs

### `attendance_integrity_flags` Table
Existing table, used to flag attendance affected by drift:

```sql
CREATE TABLE attendance_integrity_flags (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  attendance_record_id UUID NOT NULL,
  
  flag_type VARCHAR(50),  -- 'CLOCK_DRIFT_VIOLATION', etc.
  severity VARCHAR(20),   -- 'HIGH', 'MEDIUM', 'LOW'
  state VARCHAR(20),      -- 'OPEN', 'RESOLVED'
  
  flagged_by_superadmin_id UUID,
  flag_reason TEXT,
  resolved_by_tenant_user_id UUID,
  resolution_notes TEXT,
  
  timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

---

## Integration with PHASE 2, STEP 2.1 (Immutable Audit Logging)

### Guaranteed Compatibility

✅ **Audit logs are immutable** — Drift is logged separately in `clock_drift_log`
✅ **No modifications** — Never UPDATE/DELETE drift events
✅ **Separate concerns** — Drift logging ≠ audit logging
✅ **Cross-referenced** — `request_id` links drift events to audit entries
✅ **Time-consistent** — Both use server time

### Audit Integration

When operations are audited (PHASE 2.1), drift context is attached:

```typescript
// Audit entry includes drift information
{
  actor_id: "user-uuid",
  action_type: "ATTENDANCE_CHECKIN",
  scope: "ATTENDANCE",
  resource_id: "record-uuid",
  
  before_state: { ... },
  after_state: { ... },
  
  // NEW in Step 2.2
  clock_drift_detected: true,
  drift_seconds: 45,
  drift_severity: "WARNING",
  
  justification: "Employee arrived late, approved by supervisor",
  request_id: "req-123",
  ip_address: "192.168.1.100",
  timestamp: "2026-02-15T14:30:00Z"
}
```

### Why Separate Tables?

| Aspect | `audit_logs` | `clock_drift_log` |
|--------|--------------|------------------|
| **Purpose** | Track all operations | Track time violations |
| **Retention** | 90+ days | Long-term compliance |
| **Immutability** | Strict (DB constraints) | Strict (append-only) |
| **Volume** | Every operation | Only drift events |
| **Query Pattern** | By action, actor, resource | By severity, user, tenant |
| **Compliance** | Regulatory audit trail | Time authority compliance |

---

## Severity Classification

### Severity Levels

**INFO** (Drift: ±5 seconds)
- Normal clock skew
- No action taken
- Logged for statistics
- Typical cause: Network delays in time sync

**WARNING** (Drift: ±6 to ±60 seconds)
- Notable clock drift
- Attendance flagged for review
- Superadmin can investigate
- Typical cause: Device sleep/wake, manual time adjustment

**CRITICAL** (Drift: >±60 seconds)
- Severe clock drift
- Attendance action blocked or flagged
- Mandatory investigation
- Typical cause: Deliberate manipulation, major clock sync failure

### Thresholds

```typescript
// Drift classification
DRIFT_INFO_THRESHOLD = 5       // seconds
DRIFT_WARNING_THRESHOLD = 60   // seconds

// Attendance action validation
ATTENDANCE_DRIFT_THRESHOLD = 300  // 5 minutes (CRITICAL)
```

---

## Request/Response Examples

### 1. Client Drift Detection (Every Request)

**Request**:
```http
POST /api/attendance/checkin
X-Client-Timestamp: 2026-02-15T14:35:22.000Z
Content-Type: application/json
Authorization: Bearer TOKEN

{
  "locationId": "loc-123",
  "reason": "Standard check-in"
}
```

**Server Processing**:
1. Extracts `X-Client-Timestamp` → `2026-02-15T14:35:22.000Z`
2. Gets server time → `2026-02-15T14:35:47.000Z` (25 seconds later)
3. Calculates drift → `-25 seconds` (client is behind)
4. Classifies severity → `WARNING`
5. Logs to `clock_drift_log`
6. Checks threshold → Within limit, operation allowed
7. Returns response with drift headers

**Response** (Success):
```json
{
  "id": "checkin-456",
  "status": "success",
  "timestamp": "2026-02-15T14:35:47.000Z",
  "message": "Check-in recorded"
}
```

**Response Headers**:
```http
X-Server-Time: 2026-02-15T14:35:47.000Z
X-Clock-Drift: -25s
X-Clock-Drift-Severity: WARNING
```

### 2. Blocked Operation (Excessive Drift)

**Request**:
```http
POST /api/attendance/checkin
X-Client-Timestamp: 2026-02-15T13:58:00.000Z  # 37 minutes behind!
Content-Type: application/json

{
  "locationId": "loc-123"
}
```

**Server Processing**:
1. Extracts client time → `2026-02-15T13:58:00.000Z`
2. Gets server time → `2026-02-15T14:35:00.000Z`
3. Calculates drift → `-2100 seconds` (35 minutes behind)
4. Classifies → `CRITICAL`
5. Checks threshold → Exceeds 300s limit
6. **Blocks operation** → Returns 409

**Response** (Blocked):
```json
{
  "error": "CLOCK_DRIFT_VIOLATION",
  "message": "Clock drift exceeds threshold: 2100s (max 300s)",
  "severity": "CRITICAL",
  "drift": -2100,
  "serverTime": "2026-02-15T14:35:00.000Z",
  "clientTime": "2026-02-15T13:58:00.000Z",
  "action": "Please synchronize your device clock and retry"
}
```

### 3. Time Synchronization Endpoint

**Request**:
```http
GET /api/time/sync
```

**Response**:
```json
{
  "timestamp": 1739621747000,
  "iso": "2026-02-15T14:35:47.000Z",
  "unix": 1739621747,
  "timezone": "America/New_York"
}
```

**Client-side usage**:
```javascript
// Client measures time after receiving response
const responseTime = Date.now();
const serverTime = response.timestamp;
const clientTime = responseTime;
const drift = clientTime - serverTime;

// Adjust future requests
const adjustedTimestamp = Date.now() - drift;
```

### 4. Drift Statistics (Superadmin)

**Request**:
```http
GET /api/time/drift/stats?tenantId=tenant-123
Authorization: Bearer SUPERADMIN_TOKEN
```

**Response**:
```json
{
  "tenantId": "tenant-123",
  "timestamp": "2026-02-15T14:35:47.000Z",
  "overall": {
    "total_drift_events": 1247,
    "critical_count": 34,
    "warning_count": 156,
    "info_count": 1057,
    "avg_drift_seconds": 2.3,
    "max_drift_seconds": 3420
  },
  "topDrifters": [
    {
      "user_id": "user-456",
      "drift_count": 87,
      "critical_count": 12,
      "avg_drift": 45.2
    },
    {
      "user_id": "user-789",
      "drift_count": 63,
      "critical_count": 8,
      "avg_drift": 38.1
    }
  ]
}
```

---

## Client-Side Integration

### Detecting Drift (Frontend)

```typescript
// On attendance check-in, include client timestamp
const checkIn = async () => {
  const clientTime = new Date();
  
  const response = await fetch('/api/attendance/checkin', {
    method: 'POST',
    headers: {
      'X-Client-Timestamp': clientTime.toISOString(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      locationId: currentLocation.id,
      reason: 'Standard check-in'
    })
  });

  if (response.status === 409) {
    // Drift violation
    const error = await response.json();
    setError(`Clock drift: ${error.message}`);
    
    // Offer time sync
    offerTimeSync();
    return;
  }

  const driftHeader = response.headers.get('X-Clock-Drift');
  if (driftHeader) {
    console.warn(`Clock drift detected: ${driftHeader}`);
  }
};
```

### Synchronizing Client Clock

```typescript
// Sync with server time
const syncClientTime = async () => {
  const requestTime = Date.now();
  
  const response = await fetch('/api/time/sync/precise');
  const data = await response.json();
  
  const responseTime = Date.now();
  const serverTime = data.requestTime.timestamp;
  const estimatedLatency = data.estimatedLatencyMs;
  
  // Calculate drift
  const drift = ((requestTime + responseTime) / 2) - serverTime;
  const correctedTime = Date.now() - drift;
  
  return {
    drift,
    correctedTime,
    latency: estimatedLatency
  };
};
```

---

## Configuration & Thresholds

### Environment Variables

```env
# Time authority configuration
TIME_AUTHORITY_ENABLED=true
TIME_AUTHORITY_DRIFT_INFO_THRESHOLD=5              # seconds
TIME_AUTHORITY_DRIFT_WARNING_THRESHOLD=60          # seconds
TIME_AUTHORITY_ATTENDANCE_BLOCK_THRESHOLD=300      # 5 minutes

# Clock sync
TIME_SYNC_ENDPOINT_ENABLED=true
TIME_PRECISION_MODE=high                           # high, normal, low
```

### Runtime Configuration

```typescript
const config = {
  timeAuthority: {
    enabled: process.env.TIME_AUTHORITY_ENABLED === 'true',
    
    // Drift severity thresholds
    thresholds: {
      info: 5,           // ±5 seconds
      warning: 60,       // ±60 seconds
      critical: 300      // ±5 minutes
    },
    
    // Attendance action policy
    attendance: {
      blockThreshold: 300,     // 5 minutes
      flagThreshold: 60,       // 1 minute
      requireSync: false       // Force sync before checkin?
    },
    
    // Logging policy
    logging: {
      logAllDrift: true,           // Log even INFO level?
      archiveAfterDays: 90,
      deleteAfterDays: 365
    }
  }
}
```

---

## Testing & Verification

### 1. Unit Tests

```typescript
import { calculateClockDrift, classifyDriftSeverity, shouldBlockAttendanceAction } from '../services/timeAuthorityService'

describe('Time Authority Service', () => {
  test('calculates drift correctly', () => {
    const client = new Date('2026-02-15T14:35:00Z');
    const server = new Date('2026-02-15T14:35:30Z');
    
    expect(calculateClockDrift(client, server)).toBe(-30);
  });

  test('classifies severity correctly', () => {
    expect(classifyDriftSeverity(2)).toBe('INFO');
    expect(classifyDriftSeverity(45)).toBe('WARNING');
    expect(classifyDriftSeverity(500)).toBe('CRITICAL');
  });

  test('blocks excessive drift', () => {
    const result = shouldBlockAttendanceAction(350, 'attendance_checkin');
    expect(result.shouldBlock).toBe(true);
  });
});
```

### 2. Integration Tests

```bash
# Test time sync endpoint
curl http://localhost:3000/api/time/sync

# Test drift detection with manual time
curl -X POST http://localhost:3000/api/attendance/checkin \
  -H "X-Client-Timestamp: 2026-02-01T00:00:00Z" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"locationId":"loc-123"}'

# Expected: 409 Conflict if drift > threshold
```

### 3. Verification Queries

```sql
-- Check recent drift events
SELECT * FROM clock_drift_log 
ORDER BY timestamp DESC 
LIMIT 20;

-- Find users with high drift
SELECT user_id, COUNT(*) as drift_count, AVG(ABS(drift_seconds)) as avg_drift
FROM clock_drift_log
WHERE timestamp > NOW() - INTERVAL '7 days'
GROUP BY user_id
ORDER BY drift_count DESC;

-- Check critical events affecting attendance
SELECT * FROM clock_drift_log
WHERE severity = 'CRITICAL'
AND attendance_affected = true
ORDER BY timestamp DESC;

-- Verify attendance flags
SELECT * FROM attendance_integrity_flags
WHERE flag_type = 'CLOCK_DRIFT_VIOLATION'
AND timestamp > NOW() - INTERVAL '30 days'
ORDER BY timestamp DESC;
```

---

## Monitoring & Alerts

### Metrics to Track

| Metric | Purpose | Alert Threshold |
|--------|---------|-----------------|
| Total drift events/day | Overall system health | >10,000 |
| Critical drift events | Severe violations | >100/day |
| Blocked operations | Enforcement effectiveness | >50/day |
| Avg drift (users) | Typical device state | >30s |
| Max drift (users) | Outliers | >3600s |

### Alert Conditions

```typescript
// Alert if critical drift spike
if (criticalDriftToday > 100) {
  sendAlert('CRITICAL_DRIFT_SPIKE', {
    count: criticalDriftToday,
    severity: 'high'
  });
}

// Alert if user repeatedly blocked
if (userBlockCount > 5) {
  sendAlert('REPEATED_DRIFT_VIOLATIONS', {
    userId,
    blockCount: userBlockCount
  });
}

// Alert if max drift suspicious
if (maxDrift > 86400) {
  // > 1 day drift
  sendAlert('EXTREME_CLOCK_DRIFT', {
    maxDrift,
    severity: 'critical'
  });
}
```

---

## Deployment Checklist

- [ ] **Migration**: Run `008_immutable_audit_logging.sql` (provides `clock_drift_log` table)
- [ ] **Code**: Deploy `timeAuthorityService.ts`, `clockDriftDetectionMiddleware.ts`, `routes/time.ts`
- [ ] **Integration**: Update `index.ts` to mount routes and middleware
- [ ] **Testing**: Verify middleware is applied globally
- [ ] **Monitoring**: Set up alerts for critical drift events
- [ ] **Documentation**: Share API docs with frontend team
- [ ] **Client Update**: Clients should send `X-Client-Timestamp` header
- [ ] **Verification**: Query `clock_drift_log` to confirm logging works

---

## Security Considerations

### 1. Drift Manipulation

**Risk**: Attacker manipulates their device time to cheat attendance

**Mitigation**:
- ✅ Server time is source of truth (client time rejected)
- ✅ Drift is logged (audit trail)
- ✅ Excessive drift blocks operation (409 Conflict)
- ✅ Attendance flagged for review (manual verification)

### 2. Spoofed Timestamps

**Risk**: Attacker sends fake `X-Client-Timestamp` header

**Mitigation**:
- ✅ Client time only affects drift detection (doesn't change server timestamp)
- ✅ All operations use server time (immutable)
- ✅ Audit logs use server time (can't forge)

### 3. DOS via Drift Logging

**Risk**: Attacker creates huge number of drift logs

**Mitigation**:
- ✅ Logging is asynchronous (doesn't block)
- ✅ Database has indexes (queries remain fast)
- ✅ Archive strategy (old logs archived)
- ✅ Rate limiting on affected operations

---

## Common Issues & Solutions

### Issue: "Drift detected but operation not blocked"

**Cause**: Drift below threshold

**Solution**: Check thresholds are configured correctly
```typescript
ATTENDANCE_DRIFT_THRESHOLD_SECONDS = 300  // 5 minutes
```

### Issue: "No drift logs being created"

**Cause**: Middleware not applied globally or database connection failing

**Solution**: 
1. Verify middleware in `index.ts` is applied before routes
2. Check database connection: `SELECT * FROM clock_drift_log LIMIT 1`

### Issue: "Clients getting 409 on valid requests"

**Cause**: Client time is significantly off

**Solution**: Client should call `GET /api/time/sync` to synchronize

---

## Roadmap

### Phase 2.2 Complete
- ✅ Time authority service
- ✅ Drift detection middleware
- ✅ Clock drift logging
- ✅ Attendance validation
- ✅ Time sync endpoints
- ✅ REST API for drift queries
- ✅ Superadmin dashboard endpoints

### Future Enhancements
- [ ] Automated time sync on client startup
- [ ] Geographic timezone detection
- [ ] Network latency compensation
- [ ] Drift prediction/preemption
- [ ] Integration with device NTP sync status
- [ ] Blockchain verification for critical operations
- [ ] Hardware time-tracking device support

---

## Related Documentation

- [PHASE 2, STEP 2.1 — Immutable Audit Logging](STEP_2_1_IMMUTABLE_AUDIT_LOGGING.md)
- [PHASE 1 — Repository & Runtime Hygiene](README.md)
- [API Documentation](API_DOCUMENTATION.md)
- [Database Schema](ARCHITECTURE_DIAGRAM.md)

---

**Implementation Status**: ✅ COMPLETE

**Last Updated**: February 15, 2026

**Next Step**: PHASE 2, STEP 2.3 — User Authentication & Authorization Hardening
