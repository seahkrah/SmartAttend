<!-- markdownlint-disable MD033 -->

# PHASE 5: INCIDENT MANAGEMENT & FAILURE VISIBILITY

**Priority**: 🔴 Critical  
**Objective**: "Failures should be loud, structured, and educational"  
**Rule**: No silent failures. All high-severity errors escalate to incidents automatically.

---

## 🎯 CORE PRINCIPLE

**Failures are inevitable. Silent failures are fatal.**

The system must detect failures automatically, escalate them structurally, require human acknowledgment and root cause analysis before closure, and maintain an immutable incident timeline for learning.

---

## ⚠️ RISK SIGNALS

| Risk | Impact | Example |
|------|--------|---------|
| **Errors logged but not escalated** | CRITICAL | Database fails silently, nobody knows |
| **No acknowledgment workflow** | HIGH | Errors disappear - who's investigating? |
| **No root cause tracking** | HIGH | Same error happens 3x, no lessons learned |
| **Silent API failures** | CRITICAL | API returns 500 error, system keeps retrying |
| **Incident timelines mutable** | HIGH | Investigation data can be tampered with |
| **No escalation hierarchy** | HIGH | P0 errors treated same as informational logs |

---

## 📋 REQUIREMENTS

### 1. Automatic Incident Creation from Errors
When an error reaches HIGH or CRITICAL severity, automatically create an incident.

**Trigger Conditions**:
- Error severity >= HIGH
- Error type in [DATABASE_ERROR, AUTH_FAILURE, ROLE_VIOLATION, ATTENDANCE_CALC_ERROR, EXTERNAL_API_FAILURE]
- Incident doesn't already exist for this error within 5 minutes (deduplication)

**Auto-Incident Fields**:
- `incident_id` (UUID)
- `incident_type` (derived from error type)
- `severity` (derived from error)
- `created_from_error_id` (link to audit_logs)
- `description` (from error message)
- `status` (REPORTED → ACKNOWLEDGED → INVESTIGATING → RESOLVED → CLOSED)
- `created_at` (immutable)
- `created_by_system` (TRUE for auto-incidents)

### 2. Acknowledgment Workflow (Enforced)
Once incident is created, it cannot proceed without explicit human acknowledgment.

**ACK Requirements**:
- Superadmin or relevant role must acknowledge
- Acknowledgment is immutable (logged)
- Cannot resolve incident before ACK
- If not ACK'd in 1 hour, escalate alert

**ACK Fields**:
- `ack_by_user_id`
- `ack_at` (timestamp)
- `ack_notes` (why was this ACK'd?)

### 3. Root Cause Requirement Before Resolution
An incident cannot be RESOLVED or CLOSED without recorded root cause.

**Root Cause Fields**:
- `root_cause_summary` (required to move past INVESTIGATING)
- `root_cause_category` (User Error | System Defect | External Dependency | Configuration | Unknown)
- `root_cause_at` (when was root cause identified)
- `identified_by_user_id` (who identified it)
- `remediation_steps` (what was done to fix)

### 4. Immutable Incident Timeline
Once created, incident timeline cannot be modified. All changes logged separately.

**Immutability Model**:
- `incidents` table: immutable core (created_at, created_from_error_id, description)
- `incident_lifecycle` table: immutable append-only log of all changes
- `incident_events` table: immutable events (ack, investigate, resolve)
- Cannot UPDATE incident fields
- All transitions logged as events
- Checksums verify integrity

**Timeline Record**:
```
incidents
├─ created_at (immutable)
├─ severity (immutable)
├─ description (immutable)
├─ created_from_error_id (immutable)
└─ (references to current state via incident_lifecycle view)

incident_lifecycle (append-only)
├─ event_type (ACK, STARTED_INVESTIGATION, ROOT_CAUSE_IDENTIFIED, RESOLVED, CLOSED)
├─ event_timestamp (server time)
├─ actor_user_id
├─ status_before
├─ status_after
└─ checksum
```

### 5. Auto-Escalation Alerts
Incidents not ACK'd within threshold → auto-escalate.

**Escalation Rules**:
- No ACK in 1 hour (CRITICAL): Page on-call
- No ACK in 4 hours (HIGH): Executive alert
- No root cause in 24 hours: Escalate for emergency

### 6. Incident Severity Levels
High-severity errors map to incident priority.

| Error Severity | Incident Type | Requires | Timeline |
|---|---|---|---|
| CRITICAL | P0_INCIDENT | Immediate ACK | < 1 hour |
| HIGH | P1_INCIDENT | ACK < 2 hours | < 4 hours |
| MEDIUM | P2_INCIDENT | ACK < 6 hours | < 24 hours |

---

## 🏗️ DATABASE SCHEMA

### Table: incidents
Core immutable incident record.

```sql
CREATE TABLE incidents (
  id UUID PRIMARY KEY,
  incident_type VARCHAR(50),          -- P0_INCIDENT, P1_INCIDENT, P2_INCIDENT
  severity VARCHAR(20),                -- CRITICAL, HIGH, MEDIUM
  description TEXT,                    -- Error message / description
  created_from_error_id VARCHAR,       -- Link to audit_logs
  created_at TIMESTAMP DEFAULT NOW(),  -- Server time, immutable
  created_by_system BOOLEAN DEFAULT FALSE,
  total_events INT DEFAULT 0,          -- For quick stats
  current_severity VARCHAR(20),        -- Can escalate but not downgrade
  checksum VARCHAR(64)                 -- SHA256 for integrity
);

-- Immutable: no updates, no deletes
CREATE TRIGGER prevent_incidents_update BEFORE UPDATE ON incidents
  FOR EACH ROW RAISE EXCEPTION 'Incidents are immutable';

CREATE TRIGGER prevent_incidents_delete BEFORE DELETE ON incidents
  FOR EACH ROW RAISE EXCEPTION 'Incidents cannot be deleted';
```

### Table: incident_lifecycle
Append-only log of all incident state transitions.

```sql
CREATE TABLE incident_lifecycle (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES incidents(id),
  event_type VARCHAR(50),              -- ACK, STARTED_INVESTIGATION, ROOT_CAUSE_IDENTIFIED, RESOLVED, CLOSED
  status_before VARCHAR(50),           -- REPORTED, ACKNOWLEDGED, INVESTIGATING, RESOLVED, CLOSED
  status_after VARCHAR(50),
  actor_user_id UUID,                  -- Who made this change
  actor_role VARCHAR(50),              -- What role did they have
  metadata JSONB,                      -- Additional context
  event_at TIMESTAMP DEFAULT NOW(),    -- Server time, immutable
  checksum VARCHAR(64),                -- SHA256 for integrity
  CONSTRAINT no_update CHECK (true)    -- Append-only, no updates
);

-- Immutable: append-only
CREATE TRIGGER prevent_lifecycle_update BEFORE UPDATE ON incident_lifecycle
  FOR EACH ROW RAISE EXCEPTION 'Incident lifecycle is append-only';

CREATE TRIGGER prevent_lifecycle_delete BEFORE DELETE ON incident_lifecycle
  FOR EACH ROW RAISE EXCEPTION 'Incident lifecycle cannot be deleted';
```

### Table: incident_acknowledgments
Immutable acknowledgment records.

```sql
CREATE TABLE incident_acknowledgments (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES incidents(id),
  ack_by_user_id UUID NOT NULL,
  ack_at TIMESTAMP DEFAULT NOW(),
  ack_notes TEXT,
  severity_at_ack VARCHAR(20),         -- What was severity when ACK'd
  checksum VARCHAR(64)
);

-- Immutable
CREATE TRIGGER prevent_ack_update BEFORE UPDATE ON incident_acknowledgments
  FOR EACH ROW RAISE EXCEPTION 'Acknowledgments are immutable';

CREATE TRIGGER prevent_ack_delete BEFORE DELETE ON incident_acknowledgments
  FOR EACH ROW RAISE EXCEPTION 'Acknowledgments cannot be deleted';
```

### Table: incident_root_causes
Root cause analysis records (immutable).

```sql
CREATE TABLE incident_root_causes (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES incidents(id),
  root_cause_summary TEXT NOT NULL,
  root_cause_category VARCHAR(50),     -- User Error, System Defect, External Dependency, Configuration, Unknown
  identified_by_user_id UUID NOT NULL,
  identified_at TIMESTAMP DEFAULT NOW(),
  remediation_steps TEXT,              -- What was done to fix
  verified_at TIMESTAMP,               -- When fix was verified
  checksum VARCHAR(64)
);

-- Immutable
CREATE TRIGGER prevent_root_cause_update BEFORE UPDATE ON incident_root_causes
  FOR EACH ROW RAISE EXCEPTION 'Root causes are immutable';

CREATE TRIGGER prevent_root_cause_delete BEFORE DELETE ON incident_root_causes
  FOR EACH ROW RAISE EXCEPTION 'Root causes cannot be deleted';
```

### Table: incident_escalations
Escalation records (append-only, for audit).

```sql
CREATE TABLE incident_escalations (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES incidents(id),
  escalation_reason VARCHAR(100),      -- NO_ACK_1HR, NO_ROOT_CAUSE_24HR, etc
  escalated_to_user_id UUID NOT NULL,
  escalated_at TIMESTAMP DEFAULT NOW(),
  acknowledged_at TIMESTAMP,           -- When escalation was acknowledged
  checksum VARCHAR(64)
);

-- Immutable
CREATE TRIGGER prevent_escalation_update BEFORE UPDATE ON incident_escalations
  FOR EACH ROW RAISE EXCEPTION 'Escalations are immutable';

CREATE TRIGGER prevent_escalation_delete BEFORE DELETE ON incident_escalations
  FOR EACH ROW RAISE EXCEPTION 'Escalations cannot be deleted';
```

### Table: incident_resolution
Final resolution records (immutable one per incident).

```sql
CREATE TABLE incident_resolution (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL UNIQUE REFERENCES incidents(id),
  resolved_by_user_id UUID NOT NULL,
  resolved_at TIMESTAMP DEFAULT NOW(),
  resolution_summary TEXT,
  resolution_notes TEXT,
  impact_assessment TEXT,              -- What was affected?
  lessons_learned TEXT,                -- What should we change?
  follow_up_actions TEXT,              -- What's next?
  status_after_resolution VARCHAR(50), -- CLOSED, NEEDS_FOLLOWUP
  checksum VARCHAR(64)
);

-- Immutable
CREATE TRIGGER prevent_resolution_update BEFORE UPDATE ON incident_resolution
  FOR EACH ROW RAISE EXCEPTION 'Resolution records are immutable';

CREATE TRIGGER prevent_resolution_delete BEFORE DELETE ON incident_resolution
  FOR EACH ROW RAISE EXCEPTION 'Resolution records cannot be deleted';
```

### Views: Incident Status Queries

```sql
-- Current incident status
CREATE VIEW current_incident_status AS
SELECT 
  i.id, i.incident_type, i.severity, i.description, i.created_at,
  (SELECT status_after FROM incident_lifecycle 
   WHERE incident_id = i.id 
   ORDER BY event_at DESC LIMIT 1) as current_status,
  (SELECT ack_by_user_id FROM incident_acknowledgments 
   WHERE incident_id = i.id LIMIT 1) as acknowledged_by,
  (SELECT COUNT(*) FROM incident_lifecycle WHERE incident_id = i.id) as event_count,
  (SELECT root_cause_summary FROM incident_root_causes 
   WHERE incident_id = i.id LIMIT 1) as root_cause
FROM incidents i;

-- Open incidents (not CLOSED)
CREATE VIEW open_incidents AS
SELECT i.*, cs.current_status 
FROM incidents i
JOIN current_incident_status cs ON i.id = cs.id
WHERE cs.current_status != 'CLOSED'
ORDER BY i.created_at DESC;

-- Overdue incidents (no ACK in threshold)
CREATE VIEW overdue_incidents AS
SELECT i.*, 
  EXTRACT(EPOCH FROM (NOW() - i.created_at)) / 3600 as hours_since_creation
FROM incidents i
WHERE (SELECT status_after FROM incident_lifecycle 
       WHERE incident_id = i.id 
       ORDER BY event_at DESC LIMIT 1) = 'REPORTED'
AND i.created_at < NOW() - INTERVAL '1 hour'
ORDER BY i.created_at ASC;
```

---

## 🔄 INCIDENT LIFECYCLE

```
┌──────────────────────────────┐
│ 1. REPORTED                  │
│ (Auto-created from error)    │
│ ╔════════════════════════════╗│
│ ║ Alert: New incident!       ║│
│ ║ Requires immediate ACK     ║│
│ ╚════════════════════════════╝│
└──────────────┬───────────────┘
               │
        ┌──────┴───────┐
        │ TIMEOUT?     │
        │ 1 hour No ACK│
        │              │
        ▼              ▼
    ┌─────────┐   ┌──────────────┐
    │ESCALATE │   │ 2. ACKNOWLEDGED
    │(PAGE    │   │ (Human ACK'd) │
    │on-call) │   │ ╔════════════╗│
    └─────────┘   │ ║Now investi-║│
                   │ ║gate & find ║│
                   │ ║ root cause ║│
                   │ ╚════════════╝│
                   └──────┬────────┘
                          │
                   ┌──────┴─────────┐
                   │ INVESTIGATE    │
                   │ (working on)   │
                   │ 3. INVESTIGATING
                   └──────┬─────────┘
                          │
                   ┌──────┴──────────────┐
                   │ Root cause found?   │
                   │ Fix applied?        │
                   └──────┬──────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
         ▼    │                       ▼
    TIMEOUT?  │               ┌──────────────┐
    24hr no   │               │ 4. RESOLVED  │
   root cause │               │ (Fixed)      │
              │               │ ╔═══════════╗│
         ┌────┴────┐          │ ║Immutable  ║│
         │ESCALATE │          │ ║record of  ║│
         │(exec    │          │ ║fix + RC   ║│
         │alert)   │          │ ╚═══════════╝│
         └────┬────┘          └──────┬───────┘
              │                      │
              └──────────┬───────────┘
                         │
                ┌────────┴────────┐
                │ 5. CLOSED       │
                │ (Archived)      │
                │ ╔═════════════╗ │
                │ ║Lessons      ║ │
                │ ║learned &    ║ │
                │ ║documented   ║ │
                │ ╚═════════════╝ │
                └─────────────────┘
```

---

## 🎯 IMPLEMENTATION PLAN

### Stage 1: Specification + Database (Current)
- [x] Define incident lifecycle
- [x] Design immutable schema
- [ ] Create migration 019

### Stage 2: Service Layer
- [ ] Create incidentManagementService.ts
  - Auto-create incidents from high-severity errors
  - Enforce ACK workflow
  - Enforce root cause requirement
  - Field validation before state transitions
- [ ] Create incidentEscalationService.ts
  - Monitor overdue acknowledges
  - Monitor overdue root causes  
  - Auto-escalate per rules
  - Page on-call if needed

### Stage 3: Middleware + Admin Endpoints
- [ ] Create incidentAckMiddleware.ts
  - Prevent operations if critical incident not ACK'd
  - Force user to ACK before proceeding
- [ ] Create incidentAdminRoutes.ts
  - GET /api/admin/incidents - List open incidents
  - GET /api/admin/incidents/:id - Full incident details
  - POST /api/admin/incidents/:id/acknowledge - ACK incident
  - POST /api/admin/incidents/:id/root-cause - Record root cause
  - POST /api/admin/incidents/:id/resolve - Mark resolved
  - POST /api/admin/incidents/:id/close - Archive
  - GET /api/admin/incidents/stats - Dashboard stats

### Stage 4: Integration + Testing
- [ ] Integrate with error logging (audit_logs)
  - On HIGH/CRITICAL error, trigger incident creation
- [ ] Create incidentManagement.test.ts
  - Test auto-creation from errors
  - Test ACK enforcement
  - Test root cause enforcement
  - Test immutability
  - Test escalation rules
  - Test end-to-end lifecycle

---

## ✅ SUCCESS CRITERIA

| Criterion | How to Verify |
|-----------|--------------|
| High-severity errors auto-create incidents | Query incidents table, see auto-created entries |
| Cannot resolve without ACK | Try to resolve unack'd incident, get error |
| Cannot resolve without root cause | Try to resolve with no RC, get error |
| Immutable incidents table | Try UPDATE on incidents, trigger fires |
| Immutable lifecycle records | Try DELETE from incident_lifecycle, trigger fires |
| Escalation alerts work | Wait 1 hour, see escalation event created |
| Incident timeline readable | GET /api/admin/incidents/:id shows full history |
| Lessons learned captured | Incident closed with lessons_learned populated |

---

## 📊 SCOPE & COMPLEXITY

| Component | Lines | Complexity | Notes |
|-----------|-------|-----------|-------|
| Database Schema | 150 | Medium | 6 tables + 3 views + triggers |
| Service Layer | 500 | High | State machine + validation |
| Escalation Logic | 300 | High | Time-based rules + alerts |
| Admin Endpoints | 400 | Medium | Read-heavy, audit logging |
| Tests | 500 | High | Full lifecycle + edge cases |
| Middleware | 150 | Low | Permission checks |
| **TOTAL** | **2,000** | **High** | Full system |

---

## 🔐 GUARANTEES

✅ **Failures are loud** - Auto-escalate to incidents  
✅ **Failures are structured** - Immutable incident records  
✅ **Failures are educational** - Root cause + lessons learned  
✅ **No silent errors** - HIGH/CRITICAL always creates incident  
✅ **Timeline immutable** - Cannot tamper with investigation  
✅ **Accountability** - Who ACK'd, when, with what notes  

---

## 🎓 DESIGN PRINCIPLES

1. **Append-Only Audit Trail** - Like Phase 4 (immutable history)
2. **Workflow Enforcement** - Cannot skip ACK or root cause
3. **Auto-Escalation** - Silence breaks on time thresholds
4. **Educational** - Lessons learned must be documented
5. **Tamper-Proof** - Checksums + triggers prevent tampering

---

## 🚀 NEXT STEPS

1. Create migration 019 (database schema)
2. Implement incidentManagementService
3. Implement incidentEscalationService
4. Create admin endpoints
5. Integrate with error logging
6. Comprehensive testing
7. Staging validation

