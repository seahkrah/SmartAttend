<!-- ===========================
     PHASE 4: ROLE BOUNDARIES & PRIVILEGE ESCALATION
     ============================ -->

# PHASE 4: ROLE BOUNDARIES & PRIVILEGE ESCALATION DETECTION
## Comprehensive Specification

**Title**: Enforce Role Membership Truth & Detect Silent Privilege Escalations  
**Priority**: CRITICAL (Trust Foundation)  
**Type**: Security & Integrity  
**Estimated Length**: 5-10 business days (5 stages)

---

## EXECUTIVE SUMMARY

### The Problem

**Role Boundaries Are Fuzzy**

```
RISK 1: Admin can override attendance
  → Claim: "I'm just admin"
  → Reality: Changed attendance directly
  → Detection: NONE (until audit review 3 days later)

RISK 2: Faculty bypasses checks
  →Claim: "I approved through normal flow"
  → Reality: Directly modified database
  → Detection: NONE (looks like normal operation)

RISK 3: Superadmin with silent power
  → Claim: "I only read data"
  → Reality: Changed 100 records silently
  → Detection: Buried in logs, no escalation
  
RISK 4: Role change undetected
  → Claim: "User was always admin"
  → Reality: Granted admin role 2 minutes ago
  → Detection: NONE (or requires manual audit)
```

### The Solution

**Four Layers of Role Boundary Enforcement**

```
Layer 1: SERVICE LAYER
  ├─ Role-based guards on every operation
  ├─ Service layer forces role check (not just middleware)
  └─ Prevents "bypass auth layer" vulnerabilities

Layer 2: IMMUTABLE ROLE HISTORY
  ├─ Every role change logged to immutable table
  ├─ Cannot modify role history after the fact
  └─ Chain of custody for role assignments

Layer 3: ESCALATION DETECTION
  ├─ Monitor for abnormal role changes
  ├─ Detect coordinated privilege elevation
  ├─ Flag temporal patterns (e.g., 10 admins created in 1 minute)
  └─ Auto-escalate to security team

Layer 4: REVALIDATION ON ANOMALY
  ├─ When abnormal pattern detected
  ├─ Force re-authentication on affected user
  ├─ Invalidate existing sessions
  └─ Require MFA to proceed
```

**Core Principle**: "No role should be able to lie convincingly"

---

## KEY GAPS & REQUIREMENTS

### Gap 1: Role Checks Only at Route Level
**Current State**:
- Route middleware checks role (verifySuperadmin)
- If middleware bypassed, role isn't verified
- Service layer has no guard

**Requirement 1: Service-Layer Guards**
```typescript
// Good
async function markAttendance(userId, attendanceData, requestingRole) {
  // GUARD 1: Who is calling? What role?
  if (!requestingRole || !['faculty', 'admin', 'superadmin'].includes(requestingRole)) {
    throw new Error('Unauthorized role')
  }
  
  // GUARD 2: Is this role allowed to mark attendance?
  if (requestingRole === 'superadmin') {
    throw new Error('Superadmin cannot directly mark attendance')
  }
  
  // Proceed...
}
```

### Gap 2: No Systematic Escalation Tracking
**Current State**:
- Role table exists
- No immutable history of changes
- Can't prove "user was NOT admin yesterday"

**Requirement 2: Immutable Role History**

Table: `role_assignment_history`
```
id UUID (primary key)
user_id UUID
role_id UUID
assigned_by_user_id UUID (who made the change)
assigned_at TIMESTAMPTZ (when)
revoked_at TIMESTAMPTZ (when removed)
reason TEXT
severity VARCHAR (SYSTEM_BOOTSTRAP, NORMAL, ESCALATION, EMERGENCY)
detection_flags TEXT[] (auto-filled, e.g., ["same_second_10_others"])
is_verified BOOLEAN (human reviewed?)
verified_by_user_id UUID
verified_at TIMESTAMPTZ
```

Immutable: triggers prevent UPDATE/DELETE

### Gap 3: No Escalation Pattern Detection
**Current State**:
- 10 users promoted to admin → checks "10 = new admins"
- Doesn't check "10 SAME SECOND" or "by same person"

**Requirement 3: Automatic Anomaly Detection**

Patterns to Flag:
```
TEMPORAL_CLUSTER:
  → 5+ role changes within 60 seconds
  → Severity: MEDIUM
  → Action: Flag for review

RECURSIVE_ESCALATION:
  → User A creates User B
  → User B creates User C
  → User C creates admin role
  → Severity: HIGH
  → Action: Revoke all three, investigate

BYPASS_PATTERN:
  → Role changed, then action taken immediately
  → No normal operation between
  → Severity: HIGH
  → Action: Revalidate user, check session age

COORDINATED_ELEVATION:
  → Multiple users promoted by same admin
  → All then perform similar actions
  → Severity: CRITICAL
  → Action: Automatic escalation + alert
```

### Gap 4: No Revalidation on Anomaly
**Current State**:
- Anomaly detected
- User keeps working
- Session still valid

**Requirement 4: Forced Revalidation**

When anomaly detected:
```
1. Flag user session as SUSPECT
2. Invalidate refresh tokens
3. Require MFA re-challenge
4. Log all actions in suspect period
5. Escalate to security team
6. Require manual approval to continue
```

### Gap 5: Silent Superadmin Operations
**Current State**:
- Superadmin performs action
- Logs it quietly
- No visible escalation

**Requirement 5: Superadmin Transparency**

When superadmin performs "unexpected" action:
```
ACTION: Modify attendance
→ Is this superadmin's normal job? NO
→ Severity: UNUSUAL
→ Action: Create incident, notify security team
→ Reason: Attendance modification is faculty/admin job

ACTION: Query another user's logs
→ Is this querying own data? NO
→ Severity: NORMAL (superadmin can do this)
→ But TRACKED: Who queried what, when
```

---

## 5-STAGE IMPLEMENTATION PLAN

### Stage 1: Role Boundary Specification (0.5 days)
**Deliverable**: Document what each role CAN and CANNOT do

Examples:
```
SUPERADMIN can:
  ✅ READ all logs (audit)
  ✅ READ all users
  ✅ CREATE platforms
  ✅ SUSPEND tenants
  ❌ MODIFY attendance records (not their job)
  ❌ APPROVE student registrations (not their job)
  
TENANT_ADMIN can:
  ✅ APPROVE user registrations for own tenant
  ✅ VIEW attendance for own tenant
  ✅ CREATE faculty/students
  ❌ VIEW other tenant's data
  ❌ GRANT admin role (not allowed)
  ❌ MODIFY time thresholds (not allowed)

FACULTY can:
  ✅ MARK attendance for own courses
  ✅ VIEW own attendance records
  ❌ MODIFY past attendance
  ❌ GRANT roles
  ❌ VIEW other faculty's data
```

**Output**: `ROLE_PERMISSIONS_MATRIX.md` (comprehensive)

### Stage 2: Database & Immutable History (1 day)

**Tables to Create/Update**:

1. **`role_assignment_history`** (NEW)
   - Immutable log of all role changes
   - Triggers prevent UPDATE/DELETE
   
2. **`privilege_escalation_events`** (NEW)
   - Detected anomalies
   - Severity levels
   - Auto-created by system
   
3. **`role_permissions`** (UPDATE if needed)
   - Add explicit permission definitions
   - Link to role_boundary_service
   
4. **Add columns to `users` table**:
   - `role_changed_at` - timestamp of last role change
   - `last_role_change_by_id` - who made the change
   - `role_may_be_compromised` - flag for anomaly

### Stage 3: Service Layer Enforcement (2 days)

**Files to Create**:

1. **`roleBoundaryService.ts`** (600+ lines)
   - `enforceRoleGuard(userId, requiredRole, action)`
   - `checkRoleAuthorization(userId, targetAction, targetResource)`
   - `isRoleChangeAnomalous(userId, newRole, changedBy)`
   - `detectPrivilegeEscalation(event)`
   - `logRoleChange(userId, oldRole, newRole, changedBy, reason)`

2. **`privilegeEscalationDetectionService.ts`** (400+ lines)
   - Pattern detection algorithms
   - Anomaly scoring
   - Auto-escalation logic
   - Time-series analysis (same-second clusters)

3. **Middleware updates**:
   - `roleVerificationMiddleware` - auto-attach role to request
   - `roleAnomalyMiddleware` - check if user's role is compromised

### Stage 4: Admin Endpoints & Incident Management (1.5 days)

**Endpoints**:

1. **`GET /api/admin/roles/history`** - Role change audit trail
2. **`GET /api/admin/roles/user/:userId`** - User's role history
3. **`GET /api/admin/escalation-events`** - Detected anomalies
4. **`POST /api/admin/escalation-events/:eventId/investigate`** - Manual investigation
5. **`GET /api/admin/role-violations`** - Permission boundary violations

### Stage 5: Testing & Verification (1 day)

**Test Cases**: 30+ integration tests

- Role guard enforcement
- Immutability verification
- Escalation detection algorithms
- Revalidation on anomaly
- Session invalidation

---

## THREAT MODEL

### Attack: Silent Admin Creation
```
Attacker goal: Create admin without detection

Attack sequence:
1. Compromise database credentials
2. INSERT into users table (direct DB)
3. UPDATE roles table (assign admin role)
4. No service layer to block
5. No history recorded (UPDATE is permanent)
6. Days later: "Wait, who created this admin?"

Defense (Phase 4):
1. Service layer ONLY way to change roles
2. Role changes logged to immutable table
3. Changes checked against anomaly patterns
4. If suspicious: revalidate user, invalidate sessions
5. Automatic escalation to security team
```

### Attack: Coordinated Privilege Elevation
```
Attacker goal: Create admin army quickly

Attack sequence:
1. Compromise User A (admin)
2. Use User A to create User B (admin)
3. Use User B to create User C (admin)
4. User ABC used to modify attendance records
5. "Looks normal" - multiple admins doing their job

Defense (Phase 4):
1. Detect temporal clustering (5+ changes in 60s)
2. Detect recursive escalation (elevation chain)
3. Detect coordinated behavior (same actions, different users)
4. Automatic alert + session invalidation
5. Force revalidation on all affected users
```

### Attack: Role Lying
```
Attacker goal: Bypass role check via logic error

Attack sequence:
1. Directly call service method (bypass middleware)
2. Service checks role from request context
3. Attacker modified request context in-memory
4. Service accepts fake role
5. Attendance modified as "superadmin"

Defense (Phase 4):
1. Service layer re-queries role from database
2. Cannot use request context (attackable)
3. Always fetch fresh role state
4. Verify consistency with JWT claims
5. Log discrepancy as anomaly
```

---

## LEGAL DEFENSIBILITY

Phase 4 enables these claims:

✅ **Claim 1**: "We have complete role change audit trail"  
   Evidence: Immutable `role_assignment_history` table with triggers

✅ **Claim 2**: "We detected this escalation automatically"  
   Evidence: `privilege_escalation_events` with timestamp + detection algorithm

✅ **Claim 3**: "This user's role change was anomalous"  
   Evidence: Temporal clustering, pattern analysis, correlation

✅ **Claim 4**: "Role boundaries are enforced at service layer"  
   Evidence: Service guards + unit tests proving enforcement

✅ **Claim 5**: "Users cannot lie about their roles"  
   Evidence: Fresh database queries + JWT validation

✅ **Claim 6**: "Suspicious role changes trigger automatic revalidation"  
   Evidence: Session invalidation logs + MFA requirements

---

## EXAMPLES

### Example 1: Admin Cannot Modify Attendance
```typescript
// In attendanceService.ts
async function markAttendance(
  userId: string,
  attendanceData: AttendanceData,
  requestingUserId: string  // Who's making this request?
) {
  // GUARD: What role is requesting this?
  const requestingRole = await roleBoundaryService.getUserRole(requestingUserId)
  
  // GUARD: Can this role perform this action?
  const isAllowed = await roleBoundaryService.checkRoleAuthorization(
    requestingUserId,
    'MARK_ATTENDANCE',
    { targetUserId: userId }
  )
  
  if (!isAllowed) {
    throw new Error('Your role cannot mark attendance')
  }
  
  // Only faculty + admin can mark (not superadmin!)
  if (requestingRole === 'superadmin') {
    throw new RoleViolationError('Superadmin cannot directly mark attendance')
  }
  
  // Proceed with marking
  await db.query(...)
  
  // Log the action with role info
  await domainAuditService.logAudit({
    actor: requestingUserId,
    actorRole: requestingRole,
    action: 'MARK_ATTENDANCE',
    resource: attendanceData,
    scope: 'USER'
  })
}
```

### Example 2: Detect Escalation Pattern
```typescript
// In privilegeEscalationDetectionService.ts
async function detectEscalation(event: RoleChangeEvent) {
  // Pattern: Same user modified 10 roles in 10 seconds
  const recentChanges = await db.query(
    `SELECT COUNT(*) FROM role_assignment_history
     WHERE assigned_by_user_id = $1
       AND assigned_at > NOW() - INTERVAL '10 seconds'`,
    [event.assignedByUserId]
  )
  
  if (recentChanges.rows[0].count >= 5) {
    // ANOMALY DETECTED
    escalationEvent = {
      type: 'TEMPORAL_CLUSTER',
      severity: 'MEDIUM',
      flags: ['same_second_cluster', 'multiple_assignments'],
      detectedAt: new Date(),
      triggeredBy: event
    }
    
    await db.query(
      `INSERT INTO privilege_escalation_events (...)
       VALUES (...)`,
      [escalationEvent]
    )
    
    // Auto-action: Invalidate session
    await sessionService.invalidateSessions(event.assignedByUserId)
    
    // Auto-action: Escalate to security
    await securityTeam.alert({
      incident: escalationEvent,
      urgency: 'HIGH'
    })
  }
}
```

### Example 3: Revalidation on Anomaly
```typescript
// In middleware/roleAnomalyMiddleware.ts

app.use(async (req, res, next) => {
  const userId = req.user?.id
  
  // Check if user has suspicious role
  const suspiciousFlag = await db.query(
    `SELECT role_may_be_compromised FROM users WHERE id = $1`,
    [userId]
  )
  
  if (suspiciousFlag.rows[0].role_may_be_compromised) {
    // User's role might be compromised
    return res.status(401).json({
      error: 'ROLE_REVALIDATION_REQUIRED',
      message: 'Your role requires revalidation. Please authenticate again.',
      action: 'FORCE_REAUTH_WITH_MFA'
    })
  }
  
  next()
})
```

---

## SUCCESS CRITERIA

✅ **Criteria 1**: Service layer enforces role guards on every operation  
✅ **Criteria 2**: Role changes are immutably logged  
✅ **Criteria 3**: Temporal clusters detected within 2 seconds  
✅ **Criteria 4**: Recursive escalation chains detected  
✅ **Criteria 5**: Coordinated behavior patterns detected  
✅ **Criteria 6**: Anomalous roles trigger session invalidation  
✅ **Criteria 7**: All role decisions logged immutably  
✅ **Criteria 8**: Superadmin can see all role changes  
✅ **Criteria 9**: Legal team can prove role boundaries enforced  
✅ **Criteria 10**: No integration test bypasses role checks

---

## TIMELINE

| Stage | Task | Duration | Owner |
|-------|------|----------|-------|
| 1 | Create permission matrix | 4 hours | Security |
| 2 | Database schema + migrations | 4 hours | Database |
| 3 | Service layer implementation | 8 hours | Backend |
| 4 | Admin endpoints + API | 6 hours | Backend |
| 5 | Tests + verification | 4 hours | QA |
| **Total** | | **26 hours** | **All** |

---

## DEPLOYMENT CHECKLIST

- [ ] Stage 1: Permission matrix reviewed by security team
- [ ] Stage 2: Migration 018 syntax verified + tested
- [ ] Stage 3: Service layer 100% code coverage
- [ ] Stage 4: Admin endpoints secured (superadmin-only)
- [ ] Stage 5: All integration tests passing
- [ ] All role guards added to critical paths
- [ ] Backward compatibility verified
- [ ] Staging deployment successful
- [ ] Security team sign-off
- [ ] Production deployment

---

## NEXT PHASES

After Phase 4 (Role Boundaries) completes:

- **Phase 5**: Integration with attendance endpoints
- **Phase 6**: Dashboard UI for role management
- **Phase 7**: Long-term role history analysis
- **Phase 8**: ML-based anomaly detection

---

## STAKEHOLDER QUESTIONS

**For Security Team**:
- Q: Can we detect if an attacker compromised a role?
- A: Yes. Escalation detection catches abnormal changes within seconds.

**For Operations**:
- Q: Will this break existing workflows?
- A: No. Normal operations will proceed; only anomalies are flagged.

**For Legal**:
- Q: Can we defend in court against role-based attacks?
- A: Yes. Immutable history + automatic detection provides evidence.

---

**Status**: 🟡 SPECIFICATION COMPLETE, IMPLEMENTATION PENDING  
**Priority**: CRITICAL (Trust Foundation)  
**Estimated Completion**: 5-10 business days

