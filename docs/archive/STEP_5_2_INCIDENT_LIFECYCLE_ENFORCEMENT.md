# PHASE 5, STEP 5.2: Incident Lifecycle Enforcement

**Date**: February 5, 2026  
**Status**: ✅ COMPLETE  
**Version**: 1.0.0

---

## Overview

Step 5.2 implements **incident lifecycle enforcement** to ensure incidents are treated as operational, actionable objects rather than passive notes. The system enforces strict state transitions and requires completion of critical information before advancing to terminal states.

**Core Principle**: *"Incidents are operational objects, not notes."*

---

## Key Features

### 1. Incident State Machine

Incidents follow a defined lifecycle with allowed transitions:

```
open 
  ├─→ acknowledged
  │    ├─→ investigating
  │    │    ├─→ mitigating
  │    │    │    ├─→ resolved ──→ closed
  │    │    │    └─→ escalated
  │    │    └─→ escalated
  │    └─→ escalated
  └─→ escalated
```

**Valid Status Values**:
- `open`: Initial state when incident is created
- `acknowledged`: Incident has been reviewed and acknowledged by team
- `investigating`: Active investigation underway
- `escalated`: Escalated to higher authority level
- `mitigating`: Mitigation efforts in progress
- `resolved`: Incident resolved with complete summary
- `closed`: Incident formally closed (terminal state)

### 2. Acknowledgement

**Endpoint**: `POST /api/incidents/:incidentId/acknowledge`

**Purpose**: Formally acknowledge an incident and confirm receipt

**Allowed Transitions**: 
- `open` → `acknowledged`
- `investigating` → `acknowledged`

**Request Body**:
```json
{
  "acknowledgementNote": "Received and assigned to team"  // optional
}
```

**Response**:
```json
{
  "success": true,
  "message": "Incident acknowledged successfully",
  "incidentId": "uuid"
}
```

**Validation**:
- User must have admin, security_officer, or superadmin role
- Incident must be in `open` or `investigating` state
- Captures user ID and timestamp automatically

---

### 3. Escalation

**Endpoint**: `POST /api/incidents/:incidentId/escalate`

**Purpose**: Escalate incident to higher severity level with authority involvement

**Allowed Transitions**: Any open/investigating state → `escalated`

**Escalation Levels**:
- `level_1`: First-line escalation (frontline team lead)
- `level_2`: Department management escalation
- `level_3`: Executive escalation
- `executive`: C-level/Board escalation

**Request Body**:
```json
{
  "escalationLevel": "level_2",           // required
  "escalationReason": "User data breach", // required
  "escalationNote": "Potential regulatory impact",  // optional
  "escalationRecipients": ["user1@com", "user2@com"]  // optional
}
```

**Response**:
```json
{
  "success": true,
  "message": "Incident escalated successfully",
  "incidentId": "uuid",
  "escalationLevel": "level_2"
}
```

**Validation**:
- Escalation level must match or exceed incident severity
- Severity mapping:
  - `critical` requires minimum `level_3` or `executive`
  - `high` requires minimum `level_2` or higher
  - `medium` can use `level_1` or higher
  - `low` can use `level_1`
- Creates immutable escalation record with timestamp
- Tracks escalation reason for audit trail

---

### 4. Root Cause Assignment

**Endpoint**: `POST /api/incidents/:incidentId/assign-root-cause`

**Purpose**: Document root cause analysis with confidence level

**Allowed Transitions**: 
- `open` → `investigating` (if not already investigating)
- `acknowledged` → `investigating`
- `investigating` → `investigating`
- `escalated` → `escalated`

**Request Body**:
```json
{
  "rootCause": "Database query timeout in authentication service under high load",  // min 10 chars, required
  "confidence": "high",                           // 'low' | 'medium' | 'high', required
  "analysisNotes": "Load testing showed 50% timeout rate at >5000 concurrent users",  // optional
  "analysisEvidence": {                           // optional JSONB
    "logs": ["error_log_ref_123", "error_log_ref_124"],
    "metrics": { "response_time_p99": 5000, "timeout_rate": 0.50 }
  }
}
```

**Response**:
```json
{
  "success": true,
  "message": "Root cause assigned successfully",
  "incidentId": "uuid",
  "confidence": "high"
}
```

**Validation**:
- Root cause must be at least 10 characters
- Confidence must be one of: low, medium, high
- Creates root cause analysis record with analyst ID and timestamp
- Stored separately for audit trail and trend analysis
- Automatically transitions incident to `investigating` if in `open` state

---

### 5. Investigation Workflow

**Start Investigation**: `POST /api/incidents/:incidentId/start-investigation`

**Purpose**: Formally begin investigation of incident

**Allowed Transitions**: 
- `open` → `investigating`
- `acknowledged` → `investigating`
- `escalated` → `investigating`

**Request Body**:
```json
{
  "investigationNote": "Assigned to Security Team for forensic analysis"  // optional
}
```

---

### 6. Mitigation Workflow

**Begin Mitigation**: `POST /api/incidents/:incidentId/begin-mitigation`

**Purpose**: Transition from investigation to active mitigation

**Allowed Transitions**: 
- `investigating` → `mitigating`

**Request Body**:
```json
{
  "mitigationPlan": "Deploying emergency patch to all affected services"  // optional
}
```

**Response**:
```json
{
  "success": true,
  "message": "Mitigation started successfully",
  "incidentId": "uuid"
}
```

---

### 7. Resolution (CRITICAL - Must Include Summary)

**Endpoint**: `POST /api/incidents/:incidentId/resolve`

**Purpose**: Resolve incident with complete operational summary

**⚠️ CRITICAL**: Cannot proceed without ALL required fields:

**Request Body** (ALL REQUIRED):
```json
{
  "rootCause": "Inadequate connection pool sizing during peak load...",  // min 1 char, required
  "remediationSteps": "1. Increased connection pool from 50 to 200\n2. Deployed configuration...",  // required
  "preventionMeasures": "1. Implement auto-scaling for connection pools\n2. Add monitoring...",  // required
  "postMortemUrl": "https://postmortem.example.com/incident-2026-02-05",  // optional but recommended
  "estimatedImpact": "Prevented 2-3 hours of system downtime for 50k users"  // optional
}
```

**Response** (only on success):
```json
{
  "success": true,
  "message": "Incident resolved successfully",
  "incidentId": "uuid",
  "status": "resolved"
}
```

**Validation**:
- **rootCause**: Must not be empty, non-whitespace only
- **remediationSteps**: Must not be empty, must describe actionable steps taken
- **preventionMeasures**: Must not be empty, must describe how to prevent recurrence
- If any field is missing or empty, returns 400 error with field name
- Error message specifies which field(s) are required
- Captured user ID and timestamp automatically
- Cannot be undone - incident transitions to `resolved` state

**Error Example**:
```json
{
  "success": false,
  "error": "remediationSteps is required for resolution"
}
```

---

### 8. Closure (Terminal State)

**Endpoint**: `POST /api/incidents/:incidentId/close`

**Purpose**: Formally close resolved incident

**Allowed Transitions**: 
- `resolved` → `closed`

**Request Body**:
```json
{
  "closureNote": "All prevention measures implemented and verified"  // optional
}
```

**Response**:
```json
{
  "success": true,
  "message": "Incident closed successfully",
  "incidentId": "uuid",
  "status": "closed"
}
```

**Validation**:
- Incident must be in `resolved` state
- Must have complete resolution summary (root cause, remediation, prevention)
- Cannot reopen closed incidents - this is terminal state
- Creates immutable closure record

---

## Audit & Tracking

### Timeline Events

**Endpoint**: `GET /api/incidents/:incidentId/timeline`

Returns complete audit trail of all incident state changes:

```json
{
  "success": true,
  "data": {
    "incidentId": "uuid",
    "currentStatus": "resolved",
    "timeline": [
      {
        "id": "uuid",
        "eventType": "created",
        "oldValue": null,
        "newValue": "open",
        "description": "Incident automatically created from error",
        "performedByUserId": null,
        "createdAt": "2026-02-05T08:00:00Z"
      },
      {
        "id": "uuid",
        "eventType": "acknowledged",
        "oldValue": "open",
        "newValue": "acknowledged",
        "description": "Incident acknowledged",
        "performedByUserId": "user-123",
        "createdAt": "2026-02-05T08:05:00Z"
      },
      // ... more events
    ],
    "eventCount": 8
  }
}
```

**Event Types Tracked**:
- `created`: Incident creation
- `acknowledged`: Acknowledgement
- `escalated`: Escalation with level details
- `investigation_started`: Investigation began
- `root_cause_assigned`: Root cause documented
- `mitigation_started`: Mitigation efforts began
- `resolved`: Resolution with summary
- `closed`: Closure
- And various metadata update events

### Escalation History

**Endpoint**: `GET /api/incidents/:incidentId/escalations`

```json
{
  "success": true,
  "data": {
    "incidentId": "uuid",
    "escalations": [
      {
        "id": "uuid",
        "escalationLevel": "level_2",
        "reason": "User data potentially exposed",
        "escalatedByUserId": "user-456",
        "escalationNote": "Notified legal team",
        "createdAt": "2026-02-05T08:10:00Z"
      }
    ],
    "escalationCount": 1
  }
}
```

### Root Cause Analysis

**Endpoint**: `GET /api/incidents/:incidentId/root-cause`

```json
{
  "success": true,
  "data": {
    "incidentId": "uuid",
    "rootCauseAnalysis": [
      {
        "id": "uuid",
        "rootCause": "Database connection pool exhaustion",
        "assignedByUserId": "user-789",
        "confidenceLevel": "high",
        "analysisNotes": "Correlation with load spike at 16:45 UTC",
        "analysisEvidence": { ... },
        "assignedAt": "2026-02-05T08:15:00Z"
      }
    ],
    "analysisCount": 1
  }
}
```

---

## Database Schema

### Tables Created

1. **incident_escalations**: Immutable escalation records
2. **incident_root_cause_analyses**: Root cause analysis audit trail
3. **incident_timeline_events**: Complete lifecycle event log
4. **incident_acknowledgements**: Acknowledgement records
5. **incident_resolution_summaries**: Resolution summaries (enforces completion)
6. **incident_assignments**: Incident assignment tracking
7. **incident_sla_tracking**: SLA compliance monitoring

---

## Requirements & Constraints

### Authorization

All lifecycle endpoints require one of:
- `admin` role
- `security_officer` role
- `superadmin` role

### State Transition Rules

| From | To | Requires | Notes |
|------|----|-----------|----|
| open | acknowledged | User acknowledgement | Can't skip acknowledgement |
| open | investigating | Investigation start | Auto-transitions on root cause assignment |
| acknowledged | investigating | Investigation start | Must acknowledge first |
| investigating | mitigating | Mitigation plan | Can have multiple iterations |
| any | escalated | Escalation criteria met | Can escalate from any open state |
| any | resolved | Complete summary | **Must include all 3 fields** |
| resolved | closed | Closure approval | Terminal state - cannot reopen |

### Required Field Validation

**For Resolution** (STRICT):
```
✓ rootCause: non-empty string
✓ remediationSteps: non-empty string  
✓ preventionMeasures: non-empty string
```

**For Root Cause** (STRICT):
```
✓ rootCause: min 10 characters
✓ confidence: 'low' | 'medium' | 'high'
```

**For Escalation** (STRICT):
```
✓ escalationLevel: 'level_1' | 'level_2' | 'level_3' | 'executive'
✓ escalationReason: non-empty string
✓ Escalation level ≥ severity level requirement
```

---

## Error Handling

### Common Error Responses

**Invalid State Transition**:
```json
{
  "success": false,
  "error": "Cannot acknowledge incident with status 'resolved'. Only 'open' or 'investigating' incidents can be acknowledged."
}
```

**Missing Required Field**:
```json
{
  "success": false,
  "error": "rootCause is required for resolution"
}
```

**Insufficient Permissions**:
```json
{
  "success": false,
  "error": "Insufficient permissions to resolve incidents"
}
```

**Invalid Escalation Level**:
```json
{
  "success": false,
  "error": "Escalation level 'level_1' is insufficient for 'critical' severity incident"
}
```

---

## Best Practices

### For Incident Managers

1. **Always acknowledge** incidents within SLA to confirm receipt
2. **Escalate promptly** for critical/high severity with clear reasoning
3. **Assign root causes** with supporting evidence and confidence level
4. **Complete resolution summaries** with actionable prevention measures
5. **Use post-mortem links** for complex incidents with detailed analysis
6. **Close incidents formally** only when prevention measures verified

### For Incident Responders

1. Start investigation immediately after acknowledgement
2. Document findings as root cause analysis progresses
3. Provide updates via timeline comments during mitigation
4. Ensure all remediation steps are documented before resolution
5. Add prevention measures based on lessons learned

### For Monitoring/Escalation

1. Track incident → acknowledged time (SLA target: 15 min)
2. Track acknowledged → mitigating time (SLA target: 1 hour for critical)
3. Track mitigating → resolved time (SLA target: varies by severity)
4. Monitor escalation patterns to identify systemic issues
5. Audit root causes for trend analysis

---

## Integration Points

### With Error-to-Incident Pipeline (5.1)

- Step 5.1 creates incidents automatically
- Step 5.2 ensures proper lifecycle management
- Escalation can be triggered by classification severity
- Root cause analysis feeds into error fingerprinting

### With SLA System

- Tracks acknowledgement time vs SLA
- Tracks resolution time vs SLA
- Calculates SLA compliance metrics
- Alerts on SLA breaches

### With Timeline System

- Every state change creates timeline event
- Non-repudiable audit trail
- User attribution for all actions
- Timestamp proof for regulatory compliance

---

## API Reference

### Lifecycle Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/incidents/:id/acknowledge` | Acknowledge incident |
| POST | `/api/incidents/:id/escalate` | Escalate to higher level |
| POST | `/api/incidents/:id/assign-root-cause` | Document root cause |
| POST | `/api/incidents/:id/start-investigation` | Begin investigation |
| POST | `/api/incidents/:id/begin-mitigation` | Start mitigation |
| POST | `/api/incidents/:id/resolve` | Resolve with summary |
| POST | `/api/incidents/:id/close` | Close resolved incident |
| GET | `/api/incidents/:id/timeline` | Get audit trail |
| GET | `/api/incidents/:id/escalations` | Get escalation history |
| GET | `/api/incidents/:id/root-cause` | Get root cause analysis |

---

## Testing Checklist

- [x] State transitions validated
- [x] Resolution summary enforcement working
- [x] Escalation level validation implemented
- [x] Timeline tracking captured all events
- [x] Authorization checks in place
- [x] Database schema created
- [x] Error messages comprehensive
- [x] Audit trail immutable
- [x] User timestamps captured

---

## Known Limitations

1. Cannot reopen closed incidents (by design)
2. Root cause must be reassigned, not edited (for audit trail)
3. Escalation history is append-only (no deletion)
4. Resolution summary is write-once (cannot update after resolved)

---

## Next Steps (Phase 5, Step 5.3)

Step 5.3 will implement:
- Incident metrics and dashboards
- SLA tracking and alerts
- Batch incident operations
- Incident search and filtering

---

## Support

For questions or issues with incident lifecycle enforcement:
1. Check error message - it specifies exact validation failure
2. Review state machine diagram for valid transitions
3. Ensure all required fields provided for resolution
4. Verify user has required role for operation

---

**Version History**:
- v1.0.0 (Feb 5, 2026): Initial implementation
