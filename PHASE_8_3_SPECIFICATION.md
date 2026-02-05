# PHASE 8.3 — SECURITY LOCKDOWN & OPERATIONAL HARDENING

**Date**: February 5, 2026, 18:30 UTC  
**Status**: SPECIFICATION IN PROGRESS  
**Approach**: Methodical, explicit, immutable-first  

---

## PHASE 8.3 DIRECTIVE

SmartAttend operates as **infrastructure for institutional truth**. All remediation follows:

- ✅ **Explicit rules over assumptions** — No implicit behavior
- ✅ **Immutability over convenience** — Write-once semantics where possible
- ✅ **Visibility over silent recovery** — Fail loudly, log everything
- ✅ **Methodical execution** — No rushing, no improvisation

---

## EXPLICIT RULE FRAMEWORK

### Rule Set 1: Escalation Detection (SEC-001)

**Explicit Rule**:
> All privilege elevation attempts must be detected by 5-point algorithm BEFORE state change. If any of 5 points match, escalation flag set to TRUE. Escalation event created in audit trail. User enters revalidation queue. No exception.

**5-Point Detection Algorithm**:

```
Point 1: Privilege Elevation
  IF (old_role IN ['student', 'teacher']) AND (new_role IN ['admin', 'superadmin'])
  THEN escalation_point_1 = TRUE

Point 2: Superadmin Jump
  IF (old_role != 'superadmin') AND (new_role == 'superadmin')
  THEN escalation_point_2 = TRUE AND severity = 'CRITICAL'

Point 3: Timing Anomaly
  IF (role_changes_in_last_60_minutes >= 2)
  THEN escalation_point_3 = TRUE

Point 4: Rules Violation
  IF (new_role requires_approval) AND (approval NOT present)
  THEN escalation_point_4 = TRUE

Point 5: Permission Jump
  IF (count(new_permissions) - count(old_permissions) >= 5)
  THEN escalation_point_5 = TRUE
```

**Immutability Constraint**:
- Once escalation detected, cannot be undone
- Audit entry permanent
- Revalidation queue entry cannot be deleted
- User must complete revalidation before privilege use

**Visibility Requirement**:
- Log escalation event with all 5-point results
- Include old_role, new_role, timestamp, actor
- Flag unresolved escalations in status endpoints
- Alert security team with 5-minute SLA

---

### Rule Set 2: Audit-First Enforcement (SEC-002)

**Explicit Rule**:
> Audit entry created BEFORE state change executes. Both operations in single database transaction. If audit creation fails, state change is rolled back. No partial commits.

**Pattern**:

```typescript
async function changeState(userId, newState, actor) {
  return await db.transaction(async (tx) => {
    // STEP 1: Create audit entry (FIRST)
    const audit = await auditLog.create(tx, {
      action: 'state_change',
      resource_id: userId,
      old_value: { state: currentState },
      new_value: { state: newState },
      actor_id: actor.id,
      timestamp: NOW(),
      status: 'initiated'
    })
    
    // STEP 2: Validate change (BEFORE execution)
    if (!isValidTransition(currentState, newState)) {
      throw new Error('Invalid transition')  // Rolls back entire transaction
    }
    
    // STEP 3: Execute state change
    await update(tx, userId, { state: newState })
    
    // STEP 4: Mark audit as completed
    await auditLog.updateStatus(tx, audit.id, 'completed')
    
    // STEP 5: Return with correlation
    return { changed: true, auditId: audit.id }
  })
}
```

**Immutability Constraint**:
- Audit entries immutable after commit (trigger enforced)
- If state change fails, audit entry remains (status = 'failed')
- Failed audit entries visible and permanent

**Visibility Requirement**:
- Every state change has corresponding audit entry
- Audit entry visible in real-time
- Status explicitly logged ('initiated', 'completed', 'failed')
- No orphaned state changes without audit

---

### Rule Set 3: Tenant Isolation (SEC-003)

**Explicit Rule**:
> Every row in every table must have platform_id. Queries filtered by platform_id. Cross-platform access impossible by design.

**Immutable Boundaries**:

```sql
-- Every table has platform_id
CREATE TABLE students (
  id UUID PRIMARY KEY,
  platform_id UUID NOT NULL,  -- IMMUTABLE
  student_name VARCHAR(255),
  FOREIGN KEY (platform_id) REFERENCES platforms(id)
);

-- Query must include platform_id filter
-- CORRECT:
SELECT * FROM students WHERE platform_id = $1 AND id = $2

-- WRONG (will fail):
SELECT * FROM students WHERE id = $1  -- Missing platform_id filter
```

**Visibility Requirement**:
- Every query logs platform_id being used
- Query logging includes `platform_id = X` in audit trail
- If query attempted without platform_id filter, log failed attempt
- Cross-platform queries generate security alert

**Migrations Required**:
```
Migration 006: ALTER TABLE school_entities ADD COLUMN platform_id UUID NOT NULL;
Migration 007: ALTER TABLE students ADD COLUMN platform_id UUID NOT NULL;
Migration 008: ALTER TABLE corporate_entities ADD COLUMN platform_id UUID NOT NULL;
```

---

### Rule Set 4: Session Invalidation (SEC-004)

**Explicit Rule**:
> When escalation detected, ALL sessions for user must be invalidated within 30 seconds. Invalidation logged. User cannot re-authenticate for 5 minutes. Exception: Supervisor revalidation sessions.

**Immutable Action Sequence**:

```typescript
async function handleEscalationDetected(userId) {
  // 1. Mark user as revalidation_required (immutable flag)
  await users.update(userId, { 
    revalidation_required: true,
    revalidation_at: NOW(),
    revalidation_expires_at: NOW() + 5_minutes
  })
  
  // 2. Find all sessions for user
  const sessions = await sessions.findByUserId(userId)
  
  // 3. Invalidate each session (immutable log entry per session)
  for (const session of sessions) {
    await sessions.invalidate(session.id, {
      reason: 'escalation_detected',
      invalidated_at: NOW()
    })
    
    await auditLog.create({
      action: 'session_invalidated',
      session_id: session.id,
      user_id: userId,
      reason: 'escalation_detected',
      timestamp: NOW()
    })
  }
  
  // 4. Block user from login for 5 minutes
  await loginAttempts.setLockout(userId, 5 * 60 * 1000)
}
```

**Visibility Requirement**:
- Log each session invalidation separately
- Log user lockout with expiration time
- Alert user: "Your account has suspicious activity. Please verify your identity."
- Return 403 Forbidden for any privileged action until revalidation

---

### Rule Set 5: Clock Drift Detection (SEC-005)

**Explicit Rule**:
> Client and server time must match within thresholds. Violations logged and flagged.

**Explicit Thresholds**:

```
Time Drift < 30 seconds:   OK (no action)
Time Drift 30-300 seconds: WARNING (logged, flagged)
Time Drift 300-600 seconds: CRITICAL (logged, flagged, requires investigation)
Time Drift > 600 seconds:   BLOCK (reject attendance, log security event)
```

**Immutable Action**:

```typescript
async function validateTimeDrift(clientTimestamp) {
  const serverTime = NOW()
  const drift = Math.abs(serverTime - clientTimestamp)
  
  if (drift > 600_000) {  // > 10 minutes
    await auditLog.create({
      action: 'clock_drift_critical',
      client_time: clientTimestamp,
      server_time: serverTime,
      drift_ms: drift,
      severity: 'BLOCKS_ATTENDANCE',
      timestamp: NOW()
    })
    throw new Error('Clock drift too extreme. Please sync time.')
  }
  
  if (drift > 300_000) {  // > 5 minutes
    await auditLog.create({
      action: 'clock_drift_warning',
      client_time: clientTimestamp,
      server_time: serverTime,
      drift_ms: drift,
      severity: 'CRITICAL',
      timestamp: NOW()
    })
    // Allow but flag
  }
  
  if (drift > 30_000) {  // > 30 seconds
    await auditLog.create({
      action: 'clock_drift_notice',
      client_time: clientTimestamp,
      server_time: serverTime,
      drift_ms: drift,
      severity: 'WARNING',
      timestamp: NOW()
    })
  }
}
```

**Visibility Requirement**:
- Every clock drift event logged explicitly
- Severity level immutable in log
- Dashboard shows clock drift trends
- Alert if same client has > 3 drifts in 1 hour

---

## IMMUTABILITY BOUNDARIES

### Immutable Data (Write-Once)

| Data | Immutable | Reason | Enforcement |
|------|-----------|--------|-------------|
| Audit logs | ✅ YES | Security trail cannot change | DB trigger |
| Escalation events | ✅ YES | Cannot deny escalation occurred | DB constraint |
| Session invalidation log | ✅ YES | Proof of defensive action | DB trigger |
| Clock drift records | ✅ YES | Proof of time anomalies | DB trigger |
| State transitions | ✅ YES | History must be permanent | DB constraint |
| User roles (historical) | ✅ YES | Cannot change past roles | trigger + check |
| Incident state history | ✅ YES | Investigation record immutable | DB trigger |

### Mutable Data (With Constraints)

| Data | Mutable | Constraint | Reason |
|------|---------|-----------|--------|
| Current user role | ✅ YES | Must have audit entry | Tracked in history |
| Session status | ✅ YES | Only active→invalid, not invalid→active | One-way transition |
| Revalidation status | ✅ YES | Can only move forward through queue | Cannot skip revalidation |
| Current user state | ✅ YES | Only valid transitions allowed | State machine enforced |

---

## VISIBILITY REQUIREMENTS

### Audit Events Required

#### Escalation Events (SEC-001)

```json
{
  "action": "escalation_detected",
  "points_matched": [1, 2, 5],
  "severity": "CRITICAL",
  "user_id": "uuid",
  "old_role": "teacher",
  "new_role": "superadmin",
  "actor_id": "superadmin-id",
  "timestamp": "2026-02-05T18:30:00Z",
  "recorded_at": "2026-02-05T18:30:00Z"
}
```

#### Session Invalidation Events (SEC-004)

```json
{
  "action": "session_invalidated",
  "session_id": "uuid",
  "user_id": "uuid",
  "reason": "escalation_detected",
  "invalidated_by": "system",
  "invalidated_at": "2026-02-05T18:30:00Z",
  "recorded_at": "2026-02-05T18:30:00Z"
}
```

#### Clock Drift Events (SEC-005)

```json
{
  "action": "clock_drift_detected",
  "client_time": "2026-02-05T18:30:00Z",
  "server_time": "2026-02-05T18:35:00Z",
  "drift_seconds": 300,
  "severity": "CRITICAL",
  "recorded_at": "2026-02-05T18:30:00Z"
}
```

#### State Transition Events (SEC-002)

```json
{
  "action": "state_transition",
  "resource_type": "tenant",
  "resource_id": "uuid",
  "from_state": "ACTIVE",
  "to_state": "SUSPENDED",
  "actor_id": "uuid",
  "timestamp": "2026-02-05T18:30:00Z",
  "audit_status": "completed",
  "recorded_at": "2026-02-05T18:30:00Z"
}
```

---

## FIX SEQUENCE (PHASE 8.3)

### Stage 1: Schema Foundation (Day 1)

**Objective**: Ensure database schema matches all requirements

```
Step 1.1: Deploy migration 006 (platform_id to school_entities)
Step 1.2: Deploy migration 007 (platform_id to students)
Step 1.3: Deploy migration 008 (platform_id to corporate_entities)
Step 1.4: Verify platform_id columns populated
Step 1.5: Deploy immutability triggers on audit_logs
Step 1.6: Verify trigger enforcement
```

**Verification Gate**: 
- Query students table: `SELECT COUNT(*) FROM students WHERE platform_id IS NOT NULL`
- Should equal total student count
- If not, fix data integrity before proceeding

---

### Stage 2: Escalation Detection (Days 1-2)

**Objective**: Implement 5-point algorithm, activate detection

```
Step 2.1: Implement checkEscalation(oldRole, newRole, user) function
Step 2.2: Implement 5-point calculation
Step 2.3: Hook into changeRole() endpoint BEFORE execution
Step 2.4: Create escalation_events table if missing
Step 2.5: Log escalation with all 5 points
Step 2.6: Queue user for revalidation on detection
Step 2.7: Test with synthetic escalations
```

**Verification Gate**:
- Call `checkEscalation('teacher', 'superadmin')` → should return `{ isEscalation: true, severity: 'CRITICAL', points: [1, 2] }`
- Escalation event created in DB
- Audit log entry created
- No assumptions, explicit output

---

### Stage 3: Audit-First Enforcement (Days 2-3)

**Objective**: Wrap all state changes in transaction-based audit

```
Step 3.1: Implement auditFirst() transaction wrapper
Step 3.2: Wrap changeRole() with audit-first pattern
Step 3.3: Wrap changeTenantState() with audit-first pattern
Step 3.4: Wrap changeIncidentState() with audit-first pattern
Step 3.5: Test rollback on audit creation failure
Step 3.6: Verify audit entries created before any state change
```

**Verification Gate**:
- Call changeRole(), kill database at step 2
- Verify audio-first: audit entry exists, state change does not
- If audit missing, state change must not happen (test this explicitly)

---

### Stage 4: Session Invalidation (Days 3)

**Objective**: Implement immediate session revocation on escalation

```
Step 4.1: Implement findUserSessions(userId) 
Step 4.2: Implement invalidateSession(sessionId, reason) with logging
Step 4.3: Hook into escalation detection
Step 4.4: Mark user revalidation_required on invalidation
Step 4.5: Block re-authentication for 5 minutes
Step 4.6: Test: Create session, detect escalation, verify session invalid
```

**Verification Gate**:
- Use session-only endpoint (privileged action)
- Trigger escalation detection
- Verify session immediately invalid (HTTP 401)
- Verify user locked out for 5 minutes

---

### Stage 5: Clock Drift Detection (Days 3-4)

**Objective**: Validate time sync, block extreme drifts

```
Step 5.1: Implement getTimeDrift(clientTime) function
Step 5.2: Implement thresholds (30s, 300s, 600s)
Step 5.3: Hook into attendance API
Step 5.4: Log all drift events (even < 30s) for visibility
Step 5.5: Block attendance if > 600s drift
Step 5.6: Test with synthesized time differences
```

**Verification Gate**:
- Call attendance API with clientTime = NOW() + 11 minutes
- Should reject with error message including timeout
- Verify log entry created
- No silent acceptance

---

### Stage 6: Test Suite Repair (Days 4-5)

**Objective**: Fix tests to pass with new implementations

```
Step 6.1: Fix schema-related failures (migrations deployed)
Step 6.2: Fix UUID test data (generate proper UUIDs)
Step 6.3: Fix test data isolation (use unique identifiers)
Step 6.4: Fix assertion failures (implementations now working)
Step 6.5: Run full test suite
Step 6.6: Target: 95%+ pass rate (212+ of 226 tests)
```

**Verification Gate**:
- `npm run test` → results show 212+ passing
- All critical component tests passing
- Zero skipped tests (complete coverage)

---

### Stage 7: Verification & Validation (Days 5-6)

**Objective**: Comprehensive testing of all implementations

```
Step 7.1: Execute penetration testing (5 phases)
Step 7.2: Verify escalation detection catches all attempts
Step 7.3: Verify audit trail immutability
Step 7.4: Verify tenant isolation (cross-tenant access impossible)
Step 7.5: Verify session invalidation immediate
Step 7.6: Verify clock drift detection at all thresholds
Step 7.7: Generate compliance report (SOC 2, GDPR, FERPA)
```

**Verification Gate**:
- Penetration report: 0 critical findings
- Compliance score > 80% for all frameworks
- Security team sign-off

---

### Stage 8: Production Readiness (Day 7+)

**Objective**: Prepare for deployment

```
Step 8.1: Create deployment playbook
Step 8.2: Document rollback procedures
Step 8.3: Configure monitoring & alerts
Step 8.4: Brief incident response team
Step 8.5: Scheduled deployment window
Step 8.6: Execute staged rollout
```

---

## VERIFICATION GATES (NO PASSING WITHOUT EXPLICIT PROOF)

### Gate 1: Schema Deployment
**Passes When**: 
- All 3 migrations (006-008) deployed without error
- `SELECT COUNT(*) FROM students WHERE platform_id IS NOT NULL` = total students
- Zero errors in `\d students` inspection

### Gate 2: Escalation Detection
**Passes When**:
- `checkEscalation('teacher', 'superadmin')` returns `isEscalation: true`
- Escalation event in DB with all 5 points calculated
- Audit entry created
- User queued for revalidation

### Gate 3: Audit-First Enforcement
**Passes When**:
- Simulat e DB failure after audit creation → state change does NOT execute
- All state changes have corresponding audit entries
- Audit status transitions: initiated → completed

### Gate 4: Session Invalidation
**Passes When**:
- Login successful, get session token
- Trigger escalation
- Use session token immediately → HTTP 401 Unauthorized
- User locked out for exactly 5 minutes

### Gate 5: Clock Drift Detection
**Passes When**:
- Attendance with +25s drift → accepted, logged as WARNING
- Attendance with +350s drift → accepted, logged as CRITICAL
- Attendance with +700s drift → rejected, logged as BLOCKED
- All events in audit log with correct severity

### Gate 6: Test Suite
**Passes When**:
- `npm run test` → 212+ of 226 passing
- 0 critical component test failures
- All Phase 8.2 identified issues have corresponding passing tests

---

## ROLLBACK PROCEDURE (If Any Stage Fails)

```
IF (verification gate fails) THEN:
  1. Stop further changes
  2. Revert to prior Git commit (if code change caused failure)
  3. Investigate root cause (without fixes)
  4. Document failure explicitly
  5. Do NOT attempt to work around
  6. Restart stage after fix approved
```

**No workarounds. No assumptions. No improvisation.**

---

## STATUS TRACKING

**Current Phase 8.3 Status**: SPECIFICATION COMPLETE ✅

**Next**: Begin Stage 1 (Schema Foundation)

**Estimated Completion**: February 10-12, 2026

**Rule**: Report actual results, not assumptions.

---

**PHASE 8.3 READY TO EXECUTE**

No assumptions. All rules explicit. All outcomes measurable. All changes immutable. All visibility permanent.

Awaiting "Begin Stage 1" directive.

