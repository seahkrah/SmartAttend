# PHASE 10 — ATTENDANCE TRUTH & INTEGRITY SPECIFICATION

**Priority**: 🔴 **HIGHEST**  
**Date**: February 5, 2026  
**Status**: Specification Phase  
**Duration**: 5-7 business days

---

## EXECUTIVE PRINCIPLE

> **"If attendance changes, the system must remember the lie it refused to tell."**

Attendance is the core truth object of the platform. Every transaction, correction, flag, and rejection must be:
1. **Explicit** — Never silent or automatic
2. **Immutable** — Cannot be erased or rewritten
3. **Justified** — Every change requires documented reason
4. **Auditable** — Every attempt (success AND failure) is logged
5. **Traceable** — Admins and users can see full history including rejections

---

## CURRENT STATE ASSESSMENT

### ✅ What Exists

| Component | Status | Evidence |
|-----------|--------|----------|
| **State Machine** | ✅ Implemented | States: VERIFIED, FLAGGED, REVOKED, MANUAL_OVERRIDE |
| **Transition Rules** | ✅ Implemented | Valid transitions enforced in code |
| **History Table** | ✅ Implemented | `attendance_state_history` tracks all changes |
| **Immutability** | ✅ Implemented | Database triggers prevent UPDATE/DELETE on history |
| **Required Reason** | ✅ Implemented | All transitions require `reason` field |
| **Audit Logging** | ✅ Partial | Successful transitions logged, failures not captured |

### ❌ Critical Gaps

| Gap | Impact | Severity |
|-----|--------|----------|
| **No standardized reason codes** | Admins cannot filter/analyze reasons programmatically | MEDIUM |
| **Rejection events not logged** | Failed transition attempts disappear silently | 🔴 CRITICAL |
| **No replay/duplication detection** | Same attendance marked twice goes unnoticed | 🔴 CRITICAL |
| **No timestamp ambiguity handling** | Clock skew could create "earlier than earlier" scenarios | 🔴 CRITICAL |
| **No admin/user visibility endpoints** | Users cannot see why their attendance was flagged/revoked | MEDIUM |
| **No conflict detection** | Concurrent state changes not handled | MEDIUM |

---

## PHASE 10 REQUIREMENTS

### 1️⃣ ATTENDANCE REASON CODES (Semantic Clarity)

**Objective**: Make all state transitions machine-readable and analyzable.

**System**: Structured reason codes + free-text description

#### 1.1 Reason Code Structure

All state transitions must include:
1. **Reason Code** (enum) — standardized identifier
2. **Reason Category** (enum) — classification
3. **Human Description** (text) — why this specific transition

**Example**:
```
Transition: PRESENT → FLAGGED
Code: FACE_MISMATCH
Category: SECURITY_REVIEW
Description: "Face recognition confidence < 85% threshold"
```

#### 1.2 Reason Code Taxonomy

| Category | Code | Valid For States | System/User | Example Scenario |
|----------|------|-----------------|------|-----------------|
| **INITIAL_MARKING** | AUTO_MARKED | VERIFIED | System | Biometric matched automatically |
| | MANUAL_VERIFIED | VERIFIED | Admin | Faculty member marked manually |
| **SECURITY_REVIEW** | FACE_MISMATCH | FLAGGED | System | Face confidence too low |
| | DUPLICATE_SAME_HOUR | FLAGGED | System | Same student marked twice |
| | TIME_ANOMALY | FLAGGED | System | Clock drift > 30 minutes |
| | IP_MISMATCH | FLAGGED | System | Check-in from different subnet |
| **INVESTIGATION** | ADMIN_REVIEW | FLAGGED | Admin | Manual flag for investigation |
| | SECURITY_HOLD | FLAGGED | Admin | Waiting on verification |
| **RESOLUTION** | FALSE_POSITIVE | VERIFIED | Admin | Investigation cleared student |
| | CONFIRMED_FRAUD | REVOKED | Admin | Fraud confirmed, removing attendance |
| | POLICY_EXCEPTION | MANUAL_OVERRIDE | Admin | Manual override with documentation |
| | SYSTEM_CORRECTION | VERIFIED | System | Corrected automa conflict |

#### 1.3 Implementation: Reason Code Table

```sql
CREATE TABLE attendance_reason_codes (
  code VARCHAR(50) PRIMARY KEY,
  category VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  valid_for_states VARCHAR(255),  -- comma-separated list
  is_system_generated BOOLEAN,
  requires_additional_justification BOOLEAN,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Example data:
INSERT INTO attendance_reason_codes VALUES
('FACE_MISMATCH', 'SECURITY_REVIEW', 'Face recognition confidence below threshold', 'FLAGGED', true, false),
('CONFIRMED_FRAUD', 'RESOLUTION', 'Fraud confirmed, removing attendance record', 'REVOKED', false, true),
('POLICY_EXCEPTION', 'RESOLUTION', 'Manual override with documented justification', 'MANUAL_OVERRIDE', false, true);
```

---

### 2️⃣ REJECTION EVENT LOGGING (Remember What It Refused)

**Objective**: "The system must remember the lie it refused to tell"

System **must** log every attempted state transition, whether successful or failed.

#### 2.1 Rejection Event Table

```sql
CREATE TABLE attendance_transition_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attendance_record_id UUID NOT NULL,
  record_type VARCHAR(50) NOT NULL,
  current_state VARCHAR(50) NOT NULL,
  requested_state VARCHAR(50) NOT NULL,
  reason_code VARCHAR(50),
  status VARCHAR(20) NOT NULL,  -- 'ACCEPTED' or 'REJECTED'
  rejection_reason VARCHAR(500),  -- WHY it was rejected
  requested_by_user_id UUID NOT NULL REFERENCES users(id),
  request_ip_address INET,
  attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_status CHECK (status IN ('ACCEPTED', 'REJECTED'))
);

CREATE INDEX idx_attempts_record ON attendance_transition_attempts(attendance_record_id, record_type);
CREATE INDEX idx_attempts_status ON attendance_transition_attempts(status);
CREATE INDEX idx_attempts_timestamp ON attendance_transition_attempts(attempted_at DESC);
```

#### 2.2 Rejection RuleSet

Transitions are rejected if:

1. **Invalid State Transition**
   - Current state → requested state not in `VALID_TRANSITIONS`
   - **Reject with**: "Invalid state transition from X to Y"

2. **Missing Required Reason**
   - Reason code not provided for states requiring justification
   - **Reject with**: "Reason code required for this transition"

3. **Authorization Mismatch**
   - User role insufficient for requested transition
   - **Reject with**: "Insufficient privileges for Y transition (requires X role)"

4. **Stale State**
   - Attendance state changed between request and execution
   - **Reject with**: "State changed since request. Current state: X. Please retry."

5. **Conflict Detected**
   - Concurrent transition detected (race condition)
   - **Reject with**: "Concurrent modification detected. Please refresh and retry."

#### 2.3 Logging at Point of Rejection

Every endpoint that attempts state transition must:

```typescript
// PSEUDO-CODE
async function attemptStateTransition(attendanceId, newState, reason) {
  // 1. Create attempt record (pre-flight)
  const attempt = await query(
    `INSERT INTO attendance_transition_attempts 
     (attendance_record_id, record_type, current_state, requested_state, ..., status)
     VALUES (?, ?, ?, ?, ..., 'PENDING')
     RETURNING id`
  )

  try {
    // 2. Validate transition
    const isValid = isValidTransition(currentState, newState)
    if (!isValid) {
      // REJECT: Update attempt with failure reason
      await query(
        `UPDATE attendance_transition_attempts 
         SET status = 'REJECTED', 
             rejection_reason = 'Invalid state transition from X to Y'
         WHERE id = ?`
      )
      throw new Error(...)
    }

    // 3. Execute transition (success)
    await updateAttendanceState(attendanceId, newState, reason)

    // 4. Mark attempt as ACCEPTED
    await query(
      `UPDATE attendance_transition_attempts 
       SET status = 'ACCEPTED'
       WHERE id = ?`
    )

    return { success: true, attemptId }
  } catch (error) {
    // Any exception → mark REJECTED
    await query(
      `UPDATE attendance_transition_attempts
       SET status = 'REJECTED', 
           rejection_reason = ?
       WHERE id = ?`,
      [error.message, attempt.id]
    )
    throw error
  }
}
```

---

### 3️⃣ REPLAY/DUPLICATION DETECTION (Same Attendance Twice)

**Objective**: Detect and log when same attendance is marked multiple times

#### 3.1 Idempotency Key System

Every attendance marking must include idempotency key:

| Source | Key | Example |
|--------|-----|---------|
| **Biometric system** | `face_recognition_event_id` | uuid-from-camera-system |
| **Manual faculty mark** | `request_id` | v4 UUID generated at marking time |
| **Visitor check-in** | `checkin_device_id + timestamp` | hashed(badge_reader_1 + 14:30:45) |

#### 3.2 Duplicate Detection Table

```sql
CREATE TABLE attendance_idempotency_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attendance_record_id UUID NOT NULL UNIQUE,
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  source_system VARCHAR(50),  -- 'biometric', 'manual', 'visitor'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_idempotency_key ON attendance_idempotency_keys(idempotency_key);
```

#### 3.3 Duplicate Detection Logic

```typescript
async function markAttendance(attendanceData) {
  const { student_id, course_id, idempotency_key } = attendanceData

  // 1. Check if this idempotency key already processed
  const existing = await query(
    `SELECT attendance_record_id FROM attendance_idempotency_keys 
     WHERE idempotency_key = $1`,
    [idempotency_key]
  )

  if (existing.rows.length > 0) {
    // Already marked with this key
    // LOG REJECTION: Duplicate attempt
    await logRejection({
      reason: 'DUPLICATE_IDEMPOTENCY_KEY',
      message: `Attendance already marked for this event (${existing.rows[0].attendance_record_id})`,
      originalRecordId: existing.rows[0].attendance_record_id
    })
    
    // Return existing record (idempotent)
    return { success: true, recordId: existing.rows[0].attendance_record_id, isDuplicate: true }
  }

  // 2. Create new attendance record
  const newRecord = await createAttendanceRecord(attendanceData)

  // 3. Register idempotency key
  await query(
    `INSERT INTO attendance_idempotency_keys 
     (attendance_record_id, idempotency_key, source_system)
     VALUES ($1, $2, $3)`,
    [newRecord.id, idempotency_key, attendanceData.source]
  )

  return { success: true, recordId: newRecord.id, isDuplicate: false }
}
```

#### 3.4 Duplicate Detection Reporting

Endpoint: `GET /attendance/duplicates`

```sql
-- Find suspicious patterns: same student marked multiple times in short window
SELECT 
  sa.student_id,
  sa.course_id,
  sa.attendance_date,
  COUNT(*) as mark_count,
  STRING_AGG(sa.id, ',') as record_ids,
  MIN(sa.created_at) as first_mark,
  MAX(sa.created_at) as last_mark,
  EXTRACT(EPOCH FROM (MAX(sa.created_at) - MIN(sa.created_at))) as seconds_between
FROM school_attendance sa
GROUP BY sa.student_id, sa.course_id, sa.attendance_date
HAVING COUNT(*) > 1
ORDER BY seconds_between ASC
```

---

### 4️⃣ TIMESTAMP AMBIGUITY HANDLING (Clock Skew)

**Objective**: Detect and log clock drift at marking time

#### 4.1 Timestamp Validation

Every attendance record must capture:

| Field | Purpose | Example |
|-------|---------|---------|
| `client_timestamp` | Time on client device | 14:30:45 (student's phone) |
| `server_timestamp` | Server received time | 14:31:12 |
| `drift_seconds` | Calculated difference | 27 seconds |
| `drift_severity` | Classification | 'low' (< 1 min), 'medium' (1-5 min), 'high' (> 5 min) |

#### 4.2 Drift Detection at Marking

```typescript
async function captureAttendanceTimestamp(attendanceData) {
  const clientTimestamp = attendanceData.timestamp  // From client
  const serverTimestamp = new Date()
  const driftSeconds = Math.abs(
    (serverTimestamp.getTime() - new Date(clientTimestamp).getTime()) / 1000
  )

  // 1. Determine drift severity
  let severity = 'low'
  if (driftSeconds > 300) severity = 'high'      // > 5 minutes
  else if (driftSeconds > 60) severity = 'medium' // > 1 minute

  // 2. Log drift event
  if (severity !== 'low') {
    await query(
      `INSERT INTO clock_drift_log 
       (attendance_record_id, client_timestamp, server_timestamp, drift_seconds, severity)
       VALUES ($1, $2, $3, $4, $5)`,
      [attendanceData.id, clientTimestamp, serverTimestamp, driftSeconds, severity]
    )
  }

  // 3. If drift > 10 minutes, flag for review
  if (driftSeconds > 600) {
    await flagForReview({
      reason_code: 'TIME_ANOMALY',
      description: `Clock drift of ${driftSeconds}s detected. Review client device time.`,
      severity: 'high'
    })
  }

  return { clientTimestamp, serverTimestamp, driftSeconds, severity }
}
```

#### 4.3 Timeline Consistency Check

Prevent: "Earlier than earlier" scenarios

```sql
-- Flag: Later attendance record with earlier timestamp (impossible)
CREATE OR REPLACE FUNCTION check_attendance_timeline()
RETURNS TRIGGER AS $$
BEGIN
  -- Find if any earlier records have later timestamps
  IF EXISTS (
    SELECT 1 FROM school_attendance sa2
    WHERE sa2.course_id = NEW.course_id
      AND sa2.student_id = NEW.student_id
      AND sa2.attendance_date = NEW.attendance_date
      AND sa2.marked_at > NEW.marked_at  -- This record is older
      AND sa2.created_at < NEW.created_at  -- But created before new record
  ) THEN
    INSERT INTO attendance_integrity_flags 
    (attendance_record_id, flag_type, severity, reason)
    VALUES (NEW.id, 'TIMELINE_ANOMALY', 'high', 'Record marked after later record created');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_attendance_timeline_trigger
AFTER INSERT ON school_attendance
FOR EACH ROW
EXECUTE FUNCTION check_attendance_timeline();
```

---

### 5️⃣ ADMIN & USER VISIBILITY (Transparency)

**Objective**: Everyone can see why their attendance changed, except the actual person cannot bypass the system

#### 5.1 Admin Endpoints

**GET `/api/attendance/:id/history`** — Full audit trail

```json
{
  "attendance_id": "uuid...",
  "student_id": "uuid...",
  "current_state": "REVOKED",
  "timeline": [
    {
      "timestamp": "2026-02-05T14:30:00Z",
      "previous_state": null,
      "new_state": "VERIFIED",
      "reason_code": "MANUAL_VERIFIED",
      "reason_text": "Faculty member marked manually",
      "changed_by_user_id": "uuid...",
      "changed_by_name": "Dr. Johnson",
      "status": "ACCEPTED"
    },
    {
      "timestamp": "2026-02-05T15:45:30Z",
      "previous_state": "VERIFIED",
      "new_state": "FLAGGED",
      "reason_code": "DUPLICATE_SAME_HOUR",
      "reason_text": "Same student marked twice within 1 hour",
      "changed_by_user_id": "system",
      "changed_by_name": "System",
      "status": "ACCEPTED"
    },
    {
      "timestamp": "2026-02-05T16:20:00Z",
      "previous_state": "FLAGGED",
      "new_state": "REVOKED",
      "reason_code": "CONFIRMED_FRAUD",
      "reason_text": "Manual investigation confirmed duplicate marking. Removing from enrollment.",
      "changed_by_user_id": "uuid...",
      "changed_by_name": "Admin User",
      "status": "ACCEPTED"
    }
  ],
  "attempted_transitions": [
    {
      "timestamp": "2026-02-05T15:50:00Z",
      "attempted_from": "FLAGGED",
      "attempted_to": "VERIFIED",
      "reason_code": null,
      "status": "REJECTED",
      "rejection_reason": "Reason code required for FLAGGED→VERIFIED transition"
    }
  ]
}
```

**GET `/api/attendance/analysis/duplicates`** — Find duplicate markings

```json
{
  "suspicious_patterns": [
    {
      "student_id": "uuid...",
      "course_id": "uuid...",
      "date": "2026-02-05",
      "mark_count": 2,
      "record_ids": ["uuid1...", "uuid2..."],
      "time_between_marks_seconds": 37,
      "flag_severity": "high",
      "action_taken": "REVOKED"
    }
  ]
}
```

**GET `/api/attendance/analysis/clock-drift`** — Clock issues

```json
{
  "high_drift_events": [
    {
      "attendance_id": "uuid...",
      "drift_seconds": 847,
      "severity": "high",
      "client_timestamp": "2026-02-05T14:30:00Z",
      "server_timestamp": "2026-02-05T14:44:07Z",
      "flagged_for_review": true,
      "review_status": "pending"
    }
  ]
}
```

#### 5.2 Student/User Endpoints (Read-Only View)

**GET `/api/attendance/my-records`** — What the user sees about their own attendance

```json
{
  "records": [
    {
      "course_id": "uuid...",
      "course_name": "CS 101 - Intro to Programming",
      "date": "2026-02-05",
      "current_state": "VERIFIED",
      "marked_at": "2026-02-05T14:30:00Z",
      "changed_reason": "Manual marking by faculty",
      "change_details": {
        "changed_on": "2026-02-05T14:30:00Z",
        "changed_by": "Dr. Johnson"
      },
      "flagged": false,
      "user_can_appeal": true,
      "contact_for_questions": "registrar@institution.edu"
    },
    {
      "course_id": "uuid...",
      "course_name": "MATH 201 - Calculus II",
      "date": "2026-02-04",
      "current_state": "REVOKED",
      "marked_at": "2026-02-04T09:15:00Z",
      "changed_reason": "Removed: Confirmed as duplicate marking",
      "change_details": {
        "changed_on": "2026-02-04T16:45:00Z",
        "changed_by": "Admin System"
      },
      "flagged": true,
      "flag_reason": "Duplicate attendance marking detected",
      "user_can_appeal": true,
      "appeal_deadline": "2026-02-11",
      "contact_for_questions": "registrar@institution.edu"
    }
  ]
}
```

**PUT `/api/attendance/:id/appeal`** — Student can request review (but not override decision)

```json
{
  "appeal_reason": "I was definitely present in class",
  "evidence": "I have class notes from that day",
  "contact_email": "student@university.edu"
}

// Response:
{
  "appeal_id": "uuid...",
  "status": "submitted",
  "received_at": "2026-02-05T17:00:00Z",
  "admin_review_required": true,
  "review_deadline": "2026-02-12"
}
```

---

### 6️⃣ IMMUTABILITY & PROTECTION

#### 6.1 Immutability Guarantees

| Table | Immutability Mechanism | Protection |
|-------|----------------------|-----------|
| `attendance_state_history` | Database trigger | UPDATE/DELETE fails at DB level |
| `attendance_transition_attempts` | Database trigger | UPDATE/DELETE fails at DB level |
| `attendance_idempotency_keys` | Database trigger | Cannot modify or delete |
| `clock_drift_log` | Database trigger | Cannot modify drift records |

**Migration**: Add triggers to all new tables

```sql
CREATE OR REPLACE FUNCTION attendance_immutable_error()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Attendance history and logs are immutable. Cannot modify or delete records.'
      USING ERRCODE = '28000';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Apply to all audit/history tables
CREATE TRIGGER attendance_history_immutable_update
BEFORE UPDATE ON attendance_state_history
FOR EACH ROW EXECUTE FUNCTION attendance_immutable_error();

CREATE TRIGGER attendance_history_immutable_delete
BEFORE DELETE ON attendance_state_history
FOR EACH ROW EXECUTE FUNCTION attendance_immutable_error();

-- ... repeat for other tables
```

#### 6.2 Audit Logging for All Changes

Every transition writes to audit log:
- Who requested it
- When
- From where (IP)
- What they asked for
- Whether it succeeded or failed
- Why it failed (if rejected)

---

## IMPLEMENTATION ROADMAP

### Stage 1: Database Foundation (Days 1-2)
- [ ] Create `attendance_reason_codes` table with taxonomy
- [ ] Create `attendance_transition_attempts` table
- [ ] Create `attendance_idempotency_keys` table
- [ ] Create `clock_drift_log` enhancement
- [ ] Add immutability triggers to all new tables
- [ ] Deploy migrations to test database

### Stage 2: Service Layer (Days 2-3)
- [ ] Implement `recordStateTransition()` with rejection logging
- [ ] Implement `detectDuplicate()` with idempotency keys
- [ ] Implement `analyzeClockDrift()` at marking time
- [ ] Update `changeSchoolAttendanceState()` to use reason codes
- [ ] Update `changeCorporateCheckinState()` similarly

### Stage 3: API Endpoints (Days 3-4)
- [ ] `GET /api/attendance/:id/history` — Full audit trail
- [ ] `GET /api/attendance/:id/attempts` — Rejected transitions
- [ ] `GET /api/attendance/analysis/duplicates` — Duplicate patterns
- [ ] `GET /api/attendance/analysis/clock-drift` — Clock issues
- [ ] `GET /api/attendance/my-records` — Student view
- [ ] `PUT /api/attendance/:id/appeal` — Student appeal

### Stage 4: Validation & Testing (Days 4-5)
- [ ] Unit tests for state transitions with reason codes
- [ ] Integration tests for rejection logging
- [ ] Tests for duplicate detection
- [ ] Tests for clock drift detection
- [ ] Immutability verification tests
- [ ] API endpoint tests

### Stage 5: Documentation & Rollout (Days 5-7)
- [ ] API documentation updated
- [ ] Admin guide for viewing attendance history
- [ ] Student guide for appeals process
- [ ] Deployment guide
- [ ] Production readiness checklist

---

## SUCCESS CRITERIA

✅ **Attendance Truth is Verifiable**
- Admins can see every state change in timeline order
- Every change has immutable reason code + description
- Timeline is consistent (no "earlier than later")

✅ **Duplicates Cannot Be Hidden**
- All duplicate attempts logged and visible
- Idempotency keys prevent re-marking
- Duplicate patterns reported automatically

✅ **Rejections Are Transparent**
- Failed transitions visible in admin interface
- Rejection reasons clear and actionable
- Appeals process visible to users

✅ **Clock Issues Detected**
- Drift > 1 minute flagged automatically
- Drift > 5 minutes escalated to admin
- Timeline anomalies caught before data corrupts

✅ **Students Have Recourse**
- Can see why attendance was changed
- Can request review/appeal
- Cannot override system decision (but can dispute)

✅ **System Remembers What It Refused**
- Every rejected transition logged
- Admins can see attempted vs. accepted changes
- Pattern analysis reveals conflict hotspots

---

## DEFENDING AGAINST ATTACKS

### Attack: "Change my REVOKED attendance back to VERIFIED"
**Defense**: Version 1 (current) would fail at state machine level. Version 2 will also log the rejection.
```
Attempted: REVOKED → VERIFIED
Status: REJECTED
Reason: "Invalid state transition from REVOKED to VERIFIED"
Logged in: attendance_transition_attempts
Visible to: Admins, eventually student
```

### Attack: "Mark me present twice for the same class"
**Defense**: Idempotency key prevents duplicate:
```
First mark: idempotency_key = "class_session_20260205_143000"
Second attempt: Same key detected → REJECTED (duplicate)
Status: "Attendance already marked for this event"
Original record returned (idempotent)
```

### Attack: "Mark me present with a device that claims it's 6 hours in the past"
**Defense**: Clock drift detection catches it:
```
Client timestamp: 2026-02-05 08:30:00
Server timestamp: 2026-02-05 14:30:00
Drift: 21,600 seconds (6 hours)
Severity: HIGH
Action: Flagged for review, not processed
Logged in: clock_drift_log
```

### Attack: "Update the audit log to remove evidence of the fraud"
**Defense**: Immutability trigger blocks it:
```
UPDATE attendance_state_history SET reason = 'MODIFIED'
→ ERROR: Attendance history and logs are immutable. Cannot modify or delete records.
```

### Attack: "Mark the same attendance but with different reasons to confuse auditors"
**Defense**: Idempotency key + full history:
```
First attempt: VERIFIED (reason: MANUAL_VERIFIED)
Second attempt: VERIFIED (reason: AUTO_MARKED)
→ REJECTED: Attendance already marked (duplicate idempotency_key)
Only first reason in history
```

---

## KEY PRINCIPLE RESTATEMENT

> **"If attendance changes, the system must remember the lie it refused to tell."**

Concrete manifestation:
1. **The truth**: Attendance record current state + history of how it got there
2. **The lie it refused to tell**: All rejected state transitions (attempts to forge or corrupt)
3. **Memory**: Full audit trail of successes AND failures, immutable at database level

Result: **Complete chain of custody.** No ambiguity. No erasure. No replay.

---

**END OF PHASE 10 SPECIFICATION**

**Next Action**: Begin Stage 1 database implementation
