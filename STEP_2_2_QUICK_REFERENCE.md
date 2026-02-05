# STEP 2.2 — SERVER TIME AUTHORITY: QUICK REFERENCE

## Summary

Server time is now the authoritative clock for all SmartAttend operations. Client timestamps are detected, validated, and logged. Clock drift is classified by severity and can block attendance actions if it exceeds thresholds.

---

## Key Guarantees

| Guarantee | Implementation | Verification |
|-----------|----------------|--------------|
| ✅ **Server time is authoritative** | All operations use `getServerTime()` | Server timestamp in all DB records |
| ✅ **Client time is advisory only** | Used for drift detection, not operations | Drift logged separately |
| ✅ **Drift is always detected** | Global middleware on every request | Check `clock_drift_log` table |
| ✅ **Violations are blocked** | Attendance exceeding threshold returns 409 | Try `X-Client-Timestamp: 1900-01-01` |
| ✅ **Everything is logged** | Immutable `clock_drift_log` table | Cannot UPDATE/DELETE drift logs |

---

## Components Created

### Services
- **`timeAuthorityService.ts`** (360+ lines)
  - `getServerTime()`, `calculateClockDrift()`, `classifyDriftSeverity()`
  - `logClockDrift()`, `shouldBlockAttendanceAction()`, `flagAttendanceForDrift()`
  - Statistics: `getUserClockDriftHistory()`, `getTenantClockDriftStats()`, `getCriticalDriftEvents()`

### Middleware
- **`clockDriftDetectionMiddleware.ts`** (220+ lines)
  - `clockDriftDetectionMiddleware()` — Detect drift on every request
  - `attendanceClockDriftValidationMiddleware()` — Block/flag attendance
  - `auditClockDriftContextMiddleware()` — Integrate with audit logs
  - `clockDriftWarningMiddleware()` — Add response headers

### API Routes
- **`routes/time.ts`** (250+ lines)
  - `GET /api/time/sync` — Client time synchronization
  - `GET /api/time/sync/precise` — High-precision sync with latency
  - `GET /api/time/validate` — Validate client time
  - `GET /api/time/drift/history` — User's drift history
  - `GET /api/time/drift/stats` — Tenant statistics (admin)
  - `GET /api/time/drift/critical` — Critical events (admin)
  - `POST /api/time/drift/investigate` — Investigate events (admin)
  - `GET /api/time/status` — System status (admin)

### Integration
- **`index.ts`** — Updated to:
  - Import time routes and middleware
  - Apply clock drift detection globally
  - Apply audit context middleware globally
  - Mount time routes at `/api/time`
  - Apply attendance validation before attendance routes

---

## Database

### New Table: `clock_drift_log`
(Created by existing migration 006)

```sql
clock_drift_log (
  id UUID,
  tenant_id UUID,
  user_id UUID,
  client_timestamp TIMESTAMPTZ,
  server_timestamp TIMESTAMPTZ,
  drift_seconds INTEGER,
  severity VARCHAR (INFO|WARNING|CRITICAL),
  attendance_affected BOOLEAN,
  request_id VARCHAR,
  timestamp TIMESTAMPTZ
)

Indexes:
  - idx_clock_drift_tenant (tenant_id)
  - idx_clock_drift_severity (severity)
  - idx_clock_drift_user (user_id)
  - idx_clock_drift_timestamp (timestamp DESC)
```

### Updated Tables: `attendance_integrity_flags`
(Existing table, now used to flag drift-affected attendance)

```sql
Flag Type: 'CLOCK_DRIFT_VIOLATION'
Severity: 'HIGH' (CRITICAL drift) | 'MEDIUM' (WARNING drift)
Reason: Includes drift details and timestamps
```

---

## Severity Classification

| Severity | Drift Range | Action | Example |
|----------|-------------|--------|---------|
| **INFO** | ±0 to ±5s | Log only | Normal variation |
| **WARNING** | ±6 to ±60s | Log + flag attendance | Clock skew detected |
| **CRITICAL** | >±60s | Log + flag + potentially block | Extreme drift |

### Attendance Action Policy

- **Drift < 5 min**: ✅ Allowed (flagged at WARNING level for review)
- **Drift > 5 min**: ❌ Blocked (409 Conflict)

---

## API Quick Examples

### 1. Get Server Time (Public)
```bash
curl http://localhost:3000/api/time/sync

# Response:
{
  "timestamp": 1739621747000,
  "iso": "2026-02-15T14:35:47.000Z",
  "unix": 1739621747,
  "timezone": "America/New_York"
}
```

### 2. Check-in with Client Timestamp
```bash
curl -X POST http://localhost:3000/api/attendance/checkin \
  -H "X-Client-Timestamp: 2026-02-15T14:35:22.000Z" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"locationId":"loc-123"}'

# If drift OK:
# HTTP 200: Success

# If drift > 5 min:
# HTTP 409: Clock drift violation
{
  "error": "CLOCK_DRIFT_VIOLATION",
  "message": "Clock drift exceeds threshold: 350s (max 300s)",
  "severity": "CRITICAL",
  "drift": 350,
  "action": "Please synchronize your device clock and retry"
}
```

### 3. Get Drift History (Auth Required)
```bash
curl http://localhost:3000/api/time/drift/history \
  -H "Authorization: Bearer TOKEN"

# Response:
{
  "userId": "user-456",
  "count": 5,
  "drift": [
    {
      "id": "drift-1",
      "timestamp": "2026-02-15T14:35:47.000Z",
      "driftSeconds": -25,
      "severity": "WARNING",
      "attendanceAffected": true
    }
  ]
}
```

### 4. Get Drift Statistics (Superadmin Only)
```bash
curl "http://localhost:3000/api/time/drift/stats?tenantId=tenant-123" \
  -H "Authorization: Bearer SUPERADMIN_TOKEN"

# Response:
{
  "tenantId": "tenant-123",
  "overall": {
    "total_drift_events": 1247,
    "critical_count": 34,
    "warning_count": 156,
    "info_count": 1057,
    "avg_drift_seconds": 2.3
  },
  "topDrifters": [
    {
      "user_id": "user-456",
      "drift_count": 87,
      "critical_count": 12,
      "avg_drift": 45.2
    }
  ]
}
```

---

## Middleware Order (Request Flow)

```
Request arrives
  ↓
CORS middleware
  ↓
JSON parser
  ↓
Clock drift detection ← Extracts client time, calculates drift, logs to DB
  ↓
Audit context middleware ← Attaches drift to audit context
  ↓
Request logger
  ↓
Route matching
  ↓
For /api/attendance routes:
  ↓
Attendance drift validation ← Checks if drift exceeds threshold, returns 409 if blocked
  ↓
Route handler
  ↓
Response
```

---

## Testing Scenarios

### Scenario 1: Normal Operation
```bash
# Send checkin with current time
curl -X POST /api/attendance/checkin \
  -H "X-Client-Timestamp: 2026-02-15T14:35:47.000Z" \
  -H "Authorization: Bearer TOKEN"

# Expected: 200 OK, attendance recorded, drift logged as INFO
```

### Scenario 2: Minor Drift (Warning Level)
```bash
# Send checkin with time 45 seconds behind
curl -X POST /api/attendance/checkin \
  -H "X-Client-Timestamp: 2026-02-15T14:35:02.000Z" \  # 45s behind current
  -H "Authorization: Bearer TOKEN"

# Expected: 200 OK, attendance recorded, drift logged as WARNING, attendance flagged
```

### Scenario 3: Excessive Drift (Blocked)
```bash
# Send checkin with time 10 minutes behind
curl -X POST /api/attendance/checkin \
  -H "X-Client-Timestamp: 2026-02-15T14:25:47.000Z" \  # 10 min behind
  -H "Authorization: Bearer TOKEN"

# Expected: 409 Conflict, attendance NOT recorded, drift logged as CRITICAL
```

### Scenario 4: No Client Time (Allowed)
```bash
# Send checkin without X-Client-Timestamp header
curl -X POST /api/attendance/checkin \
  -H "Authorization: Bearer TOKEN"

# Expected: 200 OK, attendance recorded, no drift detection
```

---

## Monitoring Queries

### Active Drift Events (Last 24 hours)
```sql
SELECT 
  user_id, 
  COUNT(*) as event_count,
  COUNT(CASE WHEN severity = 'CRITICAL' THEN 1 END) as critical,
  AVG(ABS(drift_seconds)) as avg_drift
FROM clock_drift_log
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY user_id
ORDER BY critical DESC, event_count DESC;
```

### Critical Drift Events Affecting Attendance
```sql
SELECT 
  cdl.user_id,
  cdl.timestamp,
  cdl.drift_seconds,
  aif.attendance_record_id,
  aif.flag_reason
FROM clock_drift_log cdl
LEFT JOIN attendance_integrity_flags aif 
  ON cdl.user_id = aif.flagged_by_superadmin_id
WHERE cdl.severity = 'CRITICAL'
  AND cdl.attendance_affected = true
ORDER BY cdl.timestamp DESC;
```

### Drift Trends by Tenant
```sql
SELECT 
  DATE(timestamp) as date,
  COUNT(*) as total_events,
  COUNT(CASE WHEN severity = 'CRITICAL' THEN 1 END) as critical_events,
  AVG(ABS(drift_seconds)) as avg_drift
FROM clock_drift_log
WHERE tenant_id = $1
GROUP BY DATE(timestamp)
ORDER BY date DESC;
```

---

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| 409 Conflict on valid check-in | Client clock too far behind | Client should call `/api/time/sync` to sync |
| No drift logs created | Middleware not applied | Check middleware in `index.ts` is before routes |
| Drift not affecting attendance | Threshold too high | Check `ATTENDANCE_DRIFT_THRESHOLD_SECONDS` config |
| Excessive drift log growth | No archival policy | Check migration has archive table |
| Clock drift warning headers missing | Middleware not applied | Verify `clockDriftWarningMiddleware()` in routes |

---

## Configuration

### Environment Variables
```env
TIME_AUTHORITY_ENABLED=true
TIME_AUTHORITY_DRIFT_INFO_THRESHOLD=5
TIME_AUTHORITY_DRIFT_WARNING_THRESHOLD=60
TIME_AUTHORITY_ATTENDANCE_BLOCK_THRESHOLD=300
TIME_SYNC_ENDPOINT_ENABLED=true
```

### Runtime Config (in service)
```typescript
// Drift severity thresholds
const DRIFT_INFO_THRESHOLD = 5;           // ±5 seconds
const DRIFT_WARNING_THRESHOLD = 60;       // ±60 seconds

// Attendance action policy
const ATTENDANCE_DRIFT_THRESHOLD_SECONDS = 300;  // 5 minutes
```

---

## Files Summary

| File | Lines | Purpose |
|------|-------|---------|
| `timeAuthorityService.ts` | 360+ | Core time authority logic |
| `clockDriftDetectionMiddleware.ts` | 220+ | Middleware pipeline |
| `routes/time.ts` | 250+ | REST API endpoints |
| `index.ts` | Modified | Integrate routes and middleware |
| `STEP_2_2_SERVER_TIME_AUTHORITY.md` | 700+ | Complete technical guide (this document) |

---

## Guarantees Maintained

✅ **PHASE 2.1** (Immutable Audit Logging): Fully compatible
- Drift events are separate from audit logs
- Both use immutable append-only strategy
- No UPDATE/DELETE allowed on either
- Cross-referenced via `request_id`

✅ **PHASE 1** (Repository Hygiene): Fully compatible
- No runtime artifacts introduced
- All configuration via environment
- Reproducible builds

---

## Next Steps

1. ✅ Deploy `timeAuthorityService.ts`, `clockDriftDetectionMiddleware.ts`, `routes/time.ts`
2. ✅ Update `index.ts` to mount routes and middleware
3. ✅ Verify database has `clock_drift_log` table (migration 006)
4. ✅ Test with `curl` examples above
5. ⏭️ Update frontend to send `X-Client-Timestamp` header
6. ⏭️ Update frontend to handle 409 responses gracefully
7. ⏭️ Set up monitoring alerts for critical drift
8. ⏭️ PHASE 2, STEP 2.3: User authentication hardening (coming next)

---

**Status**: ✅ COMPLETE | **Version**: 1.0 | **Date**: February 15, 2026
