# Step 5.2 - Incident Lifecycle Enforcement: Testing Guide

**Date**: February 5, 2026  
**Feature**: Incident Lifecycle Management (Acknowledgement, Escalation, Root Cause, Resolution)

---

## Quick Test Scenarios

### Scenario 1: Full Incident Lifecycle

Complete workflow from creation to closure:

```bash
# 1. Create incident (via error-to-incident pipeline, or manually)
POST /api/incidents
{
  "errorCode": "DB_TIMEOUT",
  "errorMessage": "Database query exceeded 30s timeout",
  "incidentType": "error",
  "detectionSource": "auth-service"
}

# 2. Acknowledge the incident
POST /api/incidents/{ID}/acknowledge
{
  "acknowledgementNote": "Escalation team notified"
}

# 3. Start investigation
POST /api/incidents/{ID}/start-investigation
{
  "investigationNote": "Checking database logs"
}

# 4. Assign root cause
POST /api/incidents/{ID}/assign-root-cause
{
  "rootCause": "Connection pool exhaustion due to slow queries on users table",
  "confidence": "high",
  "analysisNotes": "Identified N+1 queries in user profile endpoint"
}

# 5. Begin mitigation
POST /api/incidents/{ID}/begin-mitigation
{
  "mitigationPlan": "Implementing query optimization and connection pool increase"
}

# 6. Resolve incident with summary (REQUIRED FIELDS)
POST /api/incidents/{ID}/resolve
{
  "rootCause": "Connection pool exhaustion due to inefficient N+1 queries in user profile endpoint",
  "remediationSteps": "1. Fixed N+1 query pattern in user profile service\n2. Added query caching layer\n3. Increased connection pool from 25 to 50",
  "preventionMeasures": "1. Implement automatic query analysis in CI/CD\n2. Add connection pool monitoring with alerts\n3. Review all ORM query patterns quarterly",
  "postMortemUrl": "https://example.com/postmortems/2026-02-05-db-timeout"
}

# 7. Close the incident
POST /api/incidents/{ID}/close
{
  "closureNote": "All prevention measures verified and deployed to production"
}

# 8. View complete timeline
GET /api/incidents/{ID}/timeline

# Response shows audit trail:
{
  "timeline": [
    { "eventType": "created", "status": "open", ... },
    { "eventType": "acknowledged", "status": "acknowledged", ... },
    { "eventType": "investigation_started", "status": "investigating", ... },
    { "eventType": "root_cause_assigned", ... },
    { "eventType": "mitigation_started", "status": "mitigating", ... },
    { "eventType": "resolved", "status": "resolved", ... },
    { "eventType": "closed", "status": "closed", ... }
  ]
}
```

---

### Scenario 2: Escalation Path

Testing escalation with severity validation:

```bash
# Create critical severity incident
POST /api/incidents
{
  "errorMessage": "Production database unreachable",
  "severity": "critical",
  "detectionMethod": "automated"
}

# Try invalid escalation (should fail - level not sufficient)
POST /api/incidents/{ID}/escalate
{
  "escalationLevel": "level_1",  
  "escalationReason": "Database down"
}
# ERROR: "Escalation level 'level_1' is insufficient for 'critical' severity"

# Correct escalation to level_3
POST /api/incidents/{ID}/escalate
{
  "escalationLevel": "level_3",
  "escalationReason": "Production database completely down - 100% traffic impact",
  "escalationNote": "Notifying VP of Engineering and Network Ops"
}

# View escalation history
GET /api/incidents/{ID}/escalations
{
  "escalations": [
    {
      "escalationLevel": "level_3",
      "reason": "Production database completely down...",
      "escalatedByUserId": "user-123",
      "createdAt": "2026-02-05T09:30:00Z"
    }
  ]
}
```

---

### Scenario 3: Resolution Summary Enforcement

Testing strict requirement for all 3 fields before resolution:

```bash
# Attempt 1: Missing remediationSteps (should fail)
POST /api/incidents/{ID}/resolve
{
  "rootCause": "Connection pool exhausted",
  "preventionMeasures": "Increase pool size"
  // Missing: remediationSteps
}
# ERROR 400: "remediationSteps is required for resolution"

# Attempt 2: Empty rootCause (should fail)
POST /api/incidents/{ID}/resolve
{
  "rootCause": "",  // Empty
  "remediationSteps": "Increased connection pool",
  "preventionMeasures": "Add monitoring"
}
# ERROR 400: "rootCause is required for resolution"

# Attempt 3: All required fields provided (success)
POST /api/incidents/{ID}/resolve
{
  "rootCause": "Connection pool exhausted during load spike at 2026-02-05 08:45 UTC",
  "remediationSteps": "1. Identified root cause via database logs\n2. Increased connection pool from 25 to 50\n3. Deployed fix at 09:15 UTC\n4. Verified recovery at 09:30 UTC",
  "preventionMeasures": "1. Implement auto-scaling for connection pool\n2. Set up connection pool exhaustion alerts\n3. Review capacity planning quarterly",
  "postMortemUrl": "https://example.com/postmortems/2026-02-05-pool-exhaustion"
}
# SUCCESS 200
```

---

### Scenario 4: State Transition Validation

Testing invalid state transitions:

```bash
# Create and try invalid transitions
POST /api/incidents → status: "open"

# Invalid: Can't escalate from "closed" state
POST /api/incidents/{ID}/escalate (when already closed)
# ERROR: "Cannot escalate incident with status 'closed'"

# Invalid: Can't close without being resolved first
POST /api/incidents/{ID}/close (when status is "investigating")
# ERROR: "Cannot close incident with status 'investigating'. Only 'resolved' incidents can be closed"

# Invalid: Can't acknowledge resolved incident
POST /api/incidents/{ID}/acknowledge (when status is "resolved")
# ERROR: "Cannot acknowledge incident with status 'resolved'. Only 'open' or 'investigating' incidents can be acknowledged"
```

---

### Scenario 5: Root Cause Analysis with Evidence

Testing root cause assignment with supporting data:

```bash
POST /api/incidents/{ID}/assign-root-cause
{
  "rootCause": "Inefficient database query causing N+1 problem in user profile endpoint",
  "confidence": "high",
  "analysisNotes": "Correlation between spike in query count and endpoint load",
  "analysisEvidence": {
    "logs": ["2026-02-05T08:45:23Z user_profile_query_count=500"],
    "metrics": {
      "query_duration_avg_ms": 2500,
      "query_count_per_request": 45,
      "cache_hit_rate": 0.05
    },
    "correlation": "Query spike correlates with 10x traffic increase"
  }
}

# Retrieve analysis
GET /api/incidents/{ID}/root-cause
{
  "rootCauseAnalysis": [
    {
      "rootCause": "Inefficient database query...",
      "confidence": "high",
      "analysisNotes": "Correlation between...",
      "analysisEvidence": { ... },
      "assignedAt": "2026-02-05T09:00:00Z"
    }
  ]
}
```

---

### Scenario 6: Timeline Event Tracking

View all lifecycle events in chronological order:

```bash
GET /api/incidents/{ID}/timeline

{
  "incidentId": "uuid-123",
  "currentStatus": "closed",
  "timeline": [
    {
      "eventType": "created",
      "oldValue": null,
      "newValue": "open",
      "description": "Incident automatically created from error",
      "performedByUserId": null,
      "createdAt": "2026-02-05T08:45:00Z"
    },
    {
      "eventType": "acknowledged",
      "oldValue": "open",
      "newValue": "acknowledged",
      "description": "Incident acknowledged",
      "performedByUserId": "user-123",
      "createdAt": "2026-02-05T08:47:00Z"
    },
    {
      "eventType": "investigation_started",
      "oldValue": "acknowledged",
      "newValue": "investigating",
      "description": "Investigation started",
      "performedByUserId": "user-123",
      "createdAt": "2026-02-05T08:50:00Z"
    },
    {
      "eventType": "root_cause_assigned",
      "oldValue": null,
      "newValue": "Inefficient queries...",
      "description": "Root cause assigned (high confidence)",
      "performedByUserId": "user-123",
      "createdAt": "2026-02-05T09:00:00Z"
    },
    {
      "eventType": "mitigation_started",
      "oldValue": "investigating",
      "newValue": "mitigating",
      "description": "Mitigation started",
      "performedByUserId": "user-456",
      "createdAt": "2026-02-05T09:10:00Z"
    },
    {
      "eventType": "resolved",
      "oldValue": "mitigating",
      "newValue": "resolved",
      "description": "Incident resolved with comprehensive summary provided",
      "performedByUserId": "user-456",
      "createdAt": "2026-02-05T09:45:00Z"
    },
    {
      "eventType": "closed",
      "oldValue": "resolved",
      "newValue": "closed",
      "description": "Incident closed",
      "performedByUserId": "user-789",
      "createdAt": "2026-02-05T10:00:00Z"
    }
  ],
  "eventCount": 7
}
```

---

## Error Message Verification

Test that error messages are clear and actionable:

```bash
# Test 1: Field validation errors
POST /api/incidents/{ID}/resolve
{
  "rootCause": "Pool issue",
  "remediationSteps": ""  # Empty
}
# Expected: "remediationSteps is required for resolution"

# Test 2: State transition errors
POST /api/incidents/{ID}/close (when investigating)
# Expected: "Cannot close incident with status 'investigating'. Only 'resolved' incidents can be closed."

# Test 3: Permission errors
POST /api/incidents/{ID}/resolve (as non-admin user)
# Expected: "Insufficient permissions to resolve incidents"

# Test 4: Severity/Level mismatch
POST /api/incidents/{ID}/escalate
{
  "escalationLevel": "level_1",
  "escalationReason": "...",
  "severity": "critical"
}
# Expected: "Escalation level 'level_1' is insufficient for 'critical' severity incident"
```

---

## Authorization Testing

Test role-based access control:

```bash
# Create test users with different roles
- admin_user: role = 'admin'
- security_user: role = 'security_officer'  
- basic_user: role = 'user'

# Test each user can/cannot access endpoints
POST /api/incidents/{ID}/acknowledge (as basic_user)
# Expected 403: "Insufficient permissions to acknowledge incidents"

POST /api/incidents/{ID}/acknowledge (as security_user)
# Expected 200: Success

POST /api/incidents/{ID}/acknowledge (as admin_user)
# Expected 200: Success
```

---

## Performance Considerations

Test with multiple incidents:

```bash
# Create 100 incidents and test bulk operations
# Verify:
# - Timeline retrieval < 500ms
# - Escalation history < 300ms
# - Root cause analysis < 300ms
# - State transitions complete < 100ms

# Monitor queries:
# - Each operation should use indexed fields
# - No N+1 queries in timeline retrieval
# - Compound index optimization on (incident_id, created_at)
```

---

## Data Integrity Checks

```bash
# After resolving incident:
SELECT * FROM incidents WHERE id = '{ID}';
-- Verify:
-- - status = 'resolved'
-- - root_cause is populated
-- - remediation_steps is populated
-- - prevention_measures is populated
-- - resolved_by_user_id is set
-- - resolved_at has timestamp

# Check timeline immutability:
SELECT * FROM incident_timeline_events WHERE incident_id = '{ID}';
-- Verify:
-- - All events have created_at (not updated_at - immutable)
-- - No events are missing
-- - Events in correct chronological order

# Check escalation audit trail:
SELECT * FROM incident_escalations WHERE incident_id = '{ID}';
-- Verify:
-- - Escalations in correct order
-- - Each has escalated_by_user_id
-- - Each has created_at timestamp
```

---

## Edge Cases

### 1. Multiple Acknowledgements
```bash
# Acknowledge same incident twice
POST /api/incidents/{ID}/acknowledge
POST /api/incidents/{ID}/acknowledge
# Expected: Both should succeed, second is idempotent
```

### 2. Multiple Root Causes
```bash
# Assign root cause, then investigate further and assign again
POST /api/incidents/{ID}/assign-root-cause (v1)
POST /api/incidents/{ID}/assign-root-cause (v2) 
# Expected: Both recorded in root_cause_analyses table, latest used in incidents table
```

### 3. Escalation then De-escalation Prevention
```bash
POST /api/incidents/{ID}/escalate (to level_3)
# Try to "de-escalate" by acknowledging? Should work (different operation)
POST /api/incidents/{ID}/acknowledge
# Expected: Can transition back to acknowledged even after escalation
```

---

## Cleanup

After testing:

```bash
# Archive test incidents
UPDATE incidents SET status = 'closed' WHERE id IN (test_incident_ids);

# Verify no orphaned records
SELECT COUNT(*) FROM incident_timeline_events 
WHERE incident_id NOT IN (SELECT id FROM incidents);
-- Expected: 0 rows
```

---

## Success Criteria

- [ ] All state transitions work as documented
- [ ] Resolution requires all 3 fields (no empty strings)
- [ ] Timeline shows complete audit trail
- [ ] Escalation enforces level >= severity requirement
- [ ] Authorization checks working for all endpoints
- [ ] Error messages are descriptive and actionable
- [ ] Closed incidents cannot be modified
- [ ] Root cause analysis is append-only (immutable)
- [ ] All timestamps recorded correctly
- [ ] User attribution on all operations

---

