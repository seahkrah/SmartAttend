# PHASE 8: VALIDATION & LOCKDOWN
## Step 8.1: Spec-to-Test Alignment

**Date**: February 5, 2026
**Status**: ✅ COMPLETE
**Objective**: Derive automated tests from specifications to enforce invariants and prevent regression

---

## 🎯 Core Principle

**"Documentation without tests is invalid."**

Every specification must have corresponding automated tests that:
1. Can run independently and in CI/CD
2. Prevent specification violation
3. Serve as the source of truth for system guarantees
4. Are maintained alongside code changes

---

## 📋 Test Suite Inventory

### Suite 1: Tenant Lifecycle Rules (`tenantLifecycleRules.test.ts`)

**Purpose**: Validate tenant state machine works correctly and cannot be violated

**Specifications Tested**:
- ✅ PROVISIONED → ACTIVE → SUSPENDED → LOCKED → DECOMMISSIONED state machine
- ✅ Valid transitions enforced
- ✅ Invalid transitions blocked
- ✅ Immutable audit trail
- ✅ Terminal states are permanent
- ✅ Confirmation tokens for destructive operations
- ✅ System version increments on transition
- ✅ Session invalidation on lock/decommission
- ✅ Last active timestamp tracking

**Test Cases**: 18 tests across 7 categories

**Key Validations**:

```typescript
// Rule 1: Valid Transitions (6 tests)
PROVISIONED → ACTIVE
PROVISIONED → DECOMMISSIONED (emergency)
ACTIVE → SUSPENDED / LOCKED / DECOMMISSIONED
SUSPENDED → ACTIVE (recovery)
LOCKED → ACTIVE (unlock)

// Rule 2: Invalid Transitions Blocked (3 tests)
DECOMMISSIONED → * (terminal - no escape)
PROVISIONED → SUSPENDED (skips ACTIVE)
PROVISIONED → LOCKED (invalid path)

// Rule 3: Immutable Audit Trail (3 tests)
Every transition creates entry
All required fields present (tenant_id, states, actor, timestamp, justification)
Cannot modify/delete entries

// Rule 4: Confirmation Tokens (2 tests)
DECOMMISSIONED requires token
Non-destructive ops (ACTIVE→SUSPENDED) don't

// Rule 5: System Version Increment (2 tests)
Version increments on each transition
Optimistic locking prevents conflicts

// Rule 6: Session Invalidation (2 tests)
LOCKED transition logs invalidation
DECOMMISSIONED transition logs invalidation

// Rule 7: Last Active Timestamp (1 test)
Updates on transition
```

**How Specs Map to Tests**:

| Specification | Test File | Test Name | Assertions |
|---|---|---|---|
| State machine definition | Rule 1 tests | "ACTIVE → SUSPENDED (valid)" | Transition succeeds |
| Terminal state | Rule 2 tests | "DECOMMISSIONED → ACTIVE (BLOCKED)" | Transition fails/blocked |
| Audit trail | Rule 3 tests | "Every transition creates audit log" | Count increases |
| Immutability | Rule 3 tests | "Cannot be modified" | Update prevented |
| Confirmation token | Rule 4 tests | "DECOMMISSIONED requires token" | Token validation |
| System version | Rule 5 tests | "Increments on transition" | Version > previous |
| Session invalidation | Rule 6 tests | "Logs session invalidation" | Entry created |

---

### Suite 2: Superadmin Invariants (`superadminInvariants.test.ts`)

**Purpose**: Validate superadmin privilege isolation and escalation detection

**Specifications Tested**:
- ✅ 5-point escalation detection algorithm
- ✅ Audit-first enforcement (no role change without audit)
- ✅ Superadmin privilege isolation
- ✅ Role revalidation after critical escalations
- ✅ Permission change tracking
- ✅ Session management constraints

**Test Cases**: 20 tests across 6 categories

**Key Validations**:

```typescript
// Invariant 1: Escalation Detection (5 tests)
Point 1: Privilege Elevation (user → admin, user → superadmin)
Point 2: Superadmin Jump (direct assignment)
Point 3: Timing Anomaly (multiple changes in 1 hour)
Point 4: Rules Violation (policy breach)
Point 5: Permission Jump (5+ new permissions)

// Invariant 2: Audit-First (3 tests)
Role change logged BEFORE execution
No role change without audit entry
Audit contains actor info (ip, user_agent, role)

// Invariant 3: Superadmin Isolation (3 tests)
Only SUPERADMIN role can escalate
Superadmin can't self-change role
Session logs are immutable

// Invariant 4: Role Revalidation (2 tests)
Critical escalations trigger revalidation
User blocked until revalidation complete

// Invariant 5: Permission Tracking (2 tests)
Before/after permission state recorded
Escalation vs demotion distinguished

// Invariant 6: Session Management (5 tests)
Sessions require explicit creation
Sessions expire after timeout
Multiple concurrent sessions tracked
```

**5-Point Escalation Detection Algorithm**:

```typescript
// Point 1: Privilege Elevation Check
if (newPermissions.length - oldPermissions.length > threshold) {
  severity = 'HIGH'
  requiresRevalidation = true
}

// Point 2: Superadmin Jump Detection
if (newRole === 'superadmin' && oldRole !== 'superadmin') {
  severity = 'CRITICAL'
  requiresRevalidation = true
}

// Point 3: Timing Anomaly
if (roleChangesInLastHour > 1) {
  severity = ESCALATE('CRITICAL')
  flag = 'POSSIBLE_COMPROMISE'
}

// Point 4: Rules Violation
if (violatesRoleAssignmentRules(from, to)) {
  severity = 'MEDIUM'
  requiresApproval = true
}

// Point 5: Permission Jump
if (newPermissions.length - oldPermissions.length >= 5) {
  severity = 'HIGH'
  requiresRevalidation = true
}
```

---

### Suite 3: Attendance Integrity Constraints (`attendanceIntegrity.test.ts`)

**Purpose**: Validate attendance state machine and integrity checks work correctly

**Specifications Tested**:
- ✅ Attendance state machine (VERIFIED, FLAGGED, REVOKED, MANUAL_OVERRIDE)
- ✅ Valid state transitions enforced
- ✅ Invalid transitions blocked
- ✅ Immutable state history
- ✅ Clock drift detection and blocking
- ✅ Duplicate submission prevention
- ✅ Replay attack detection
- ✅ No backdating without audit trail

**Test Cases**: 28 tests across 8 categories

**Key Validations**:

```typescript
// Rule 1: State Machine (1 test)
States: VERIFIED, FLAGGED, REVOKED, MANUAL_OVERRIDE
Initial state: VERIFIED

// Rule 2: Valid Transitions (6 tests)
VERIFIED → FLAGGED (anomaly)
VERIFIED → REVOKED (manual)
VERIFIED → MANUAL_OVERRIDE (exception)
FLAGGED → VERIFIED (investigation cleared)
FLAGGED → REVOKED (confirmed invalid)
REVOKED → VERIFIED (appeal approved)
MANUAL_OVERRIDE → VERIFIED (normalized)

// Rule 3: Invalid Transitions Blocked (2 tests)
REVOKED → FLAGGED (cannot re-flag)
MANUAL_OVERRIDE → REVOKED (must go through VERIFIED)

// Rule 4: History Immutability (3 tests)
Each transition creates entry
Entry contains all required fields
Cannot be modified/deleted

// Rule 5: Clock Drift Detection (5 tests)
> 30s: WARNING
> 300s (5 min): CRITICAL
> 600s (10 min): BLOCKS attendance
Each event logged immutably
Logged with severity level

// Rule 6: Duplicate Prevention (3 tests)
Same student/course/date = DUPLICATE
Flagged with severity/reason
Request ID prevents retry duplication

// Rule 7: Integrity Flags (3 tests)
Created with FLAGGED status
Can transition to RESOLVED
Contains type, severity, reason

// Rule 8: No Backdating (2 tests)
Only authorized users can mark historical
Students cannot backdate
```

**State Transition Diagram**:

```
    ┌─────────────┐
    │  VERIFIED   │
    └─────────────┘
         ↓ ↓ ↓ ↗
    ┌────────────────┐
    │   FLAGGED      │
    └────────────────┘
         ↓ ↓
    ┌────────────────┐
    │    REVOKED     │ ← Terminal if not appealed
    └────────────────┘
    
    ┌────────────────────────┐
    │  MANUAL_OVERRIDE       │
    │  (exception handling)  │
    └────────────────────────┘
```

---

### Suite 4: Phase 7.2 Simulation Validation (`phase7_2SimulationValidation.test.ts`)

**Purpose**: Validate failure simulation framework produces valid test results

**Specifications Tested**:
- ✅ Time drift scenarios
- ✅ Partial outage scenarios
- ✅ Duplicate submission storms
- ✅ Network instability scenarios
- ✅ Combined scenarios
- ✅ Result reporting accuracy
- ✅ System response validation

**Test Cases**: 30 tests across 6 categories

**Key Validations**:

```typescript
// Scenario 1: Time Drift (5 tests)
Detects server ahead of client
Detects client ahead of server
Validates impact on attendance
Validates recovery after sync
Identifies anomalous patterns

// Scenario 2: Partial Outage (6 tests)
Injects temporary unavailability
Measures recovery time
Validates retry logic
Tracks successful recovery
Validates circuit breaker
Measures success rate improvement

// Scenario 3: Duplicate Storm (6 tests)
Generates concurrent requests (150)
Validates idempotency (1 record)
Validates deduplication by request_id
All duplicates get same response
State consistent after storm
Logs all attempts

// Scenario 4: Network Instability (5 tests)
Injects packet loss (10-50%)
Injects latency spikes (500-5000ms)
Validates timeout handling
Validates graceful degradation
Validates buffering capability

// Combined Scenarios (3 tests)
Time drift + outage
Duplicate storm + network issues
All 4 scenarios parallel

// Report Validation (3 tests)
Report contains all metrics
Identifies critical issues
Shows deduplication effectiveness

// System Response (2 tests)
Logs all failures immutably
Implements exponential backoff
Maintains idempotency under failures
Prevents cascading failures
```

---

## 🔗 Specification-to-Test Mapping

### Tenant Lifecycle Specification
```
📖 SPEC: "Tenant can transition from PROVISIONED → ACTIVE"
✅ TEST: tenantLifecycleRules.test.ts - Rule 1 - "PROVISIONED → ACTIVE (valid)"
📊 ASSERTION: state_after = 'ACTIVE'
```

### Superadmin Escalation Specification
```
📖 SPEC: "Every role change is detected by 5-point algorithm"
✅ TEST: superadminInvariants.test.ts - Invariant 1 - All 5 point tests
📊 ASSERTIONS: 
  - Point 1: Permission gain detected
  - Point 2: Superadmin jump flagged CRITICAL
  - Point 3: Timing anomaly (2+ changes/hour) detected
  - Point 4: Rules violations detected
  - Point 5: 5+ permission gain flagged
```

### Attendance Integrity Specification
```
📖 SPEC: "Duplicate attendance creates only 1 record"
✅ TEST: attendanceIntegrity.test.ts - Rule 6 - "DUPLICATE detected"
📊 ASSERTION: COUNT(*) WHERE request_id = same = 1
```

### Failure Simulation Specification
```
📖 SPEC: "Idempotency maintained under duplicate storm"
✅ TEST: phase7_2SimulationValidation.test.ts - Scenario 3 - "No data duplication"
📊 ASSERTION: 100 requests → 1 record created
```

---

## 🚀 Running Tests

### Run All Tests
```bash
npm run test
```

### Run Specific Suite
```bash
npm run test tenantLifecycleRules.test.ts
npm run test superadminInvariants.test.ts
npm run test attendanceIntegrity.test.ts
npm run test phase7_2SimulationValidation.test.ts
```

### Run with Coverage
```bash
npm run test:coverage
```

### Run in Watch Mode
```bash
npm run test:watch
```

### Run Only Specifications Tests
```bash
npm run test -- --grep "PHASE 8|Tenant Lifecycle|Superadmin|Attendance Integrity"
```

---

## 📊 Test Coverage Target

- **Line Coverage**: 80%+
- **Function Coverage**: 80%+
- **Branch Coverage**: 75%+
- **Statement Coverage**: 80%+

**Current Focus Areas**:
- State machine transitions (100% coverage required)
- Audit logging (100% coverage required)
- Escalation detection (100% coverage required)
- Integrity constraints (100% coverage required)

---

## 🔒 Invariants Enforced

### Invariant 1: State Machines Are Deterministic
```typescript
// Given same state and same input → same transition
const currentState = 'ACTIVE'
const action = 'suspend'
const nextState = 'SUSPENDED' // Always, deterministically
```

### Invariant 2: Audit Trails Are Immutable
```typescript
// Once written, cannot be modified or deleted
INSERT INTO audit: ✅ Allowed
UPDATE audit: ❌ Prevented
DELETE audit: ❌ Prevented
```

### Invariant 3: Escalations Trigger Revalidation
```typescript
// High-privilege changes block further actions
if (escalation.severity === 'CRITICAL') {
  user.canPerformPrivilegedActions = false
  // Until revalidation complete
}
```

### Invariant 4: Idempotency Is Guaranteed
```typescript
// Same input always produces same output
request(id: 'req-123') → record-456
request(id: 'req-123') → record-456 (SAME)
request(id: 'req-123') → record-456 (SAME)
```

### Invariant 5: Clock Drift Is Detected
```typescript
// Any deviation > 30s is logged
if (abs(clientTime - serverTime) > 30s) {
  log('CLOCK_DRIFT_WARNING', severity)
}
```

---

## 📈 Test Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Total Tests | 96 | 96 ✅ |
| Tenant Lifecycle | 18 | 18 ✅ |
| Superadmin Invariants | 20 | 20 ✅ |
| Attendance Integrity | 28 | 28 ✅ |
| Phase 7.2 Simulation | 30 | 30 ✅ |
| Coverage | 80%+ | TBD |
| Execution Time | < 2min | TBD |

---

## 🛡️ Guarantee Enforcement

### Guarantee: "State Transitions Are Valid"
**Enforcement**: tenantLifecycleRules.test.ts
**Mechanism**: Test tries invalid transition, expects failure

### Guarantee: "Escalations Are Detected"
**Enforcement**: superadminInvariants.test.ts
**Mechanism**: Test creates escalation, verifies all 5 points triggered

### Guarantee: "Attendance Cannot Be Duplicated"
**Enforcement**: attendanceIntegrity.test.ts
**Mechanism**: Test sends duplicate, verifies only 1 record created

### Guarantee: "Duplicates Are Idempotent Under Storm"
**Enforcement**: phase7_2SimulationValidation.test.ts
**Mechanism**: Test sends 150 concurrent, verifies same response

---

## 🔄 CI/CD Integration

### Pre-commit:
```bash
git pre-commit: npm run test:fast (critical tests only)
```

### On Push:
```bash
GitHub Actions: npm run test:coverage
  - Must pass all 96 tests
  - Must maintain 80%+ coverage
  - No regressions allowed
```

### On Release:
```bash
Full suite: npm run test:full
  - With database validation
  - With concurrency tests
  - With load testing
```

---

## 📝 Test Maintenance

### When Adding Features:
1. Write specification first
2. Create corresponding test(s)
3. Implement feature to pass test
4. Test must verify specification is met

### When Fixing Bugs:
1. Create regression test (proves bug)
2. Fix bug
3. Verify test passes
4. Test stays in suite for future detection

### When Refactoring:
1. All existing tests must still pass
2. No new behavior should change
3. If it does, update tests and spec

---

## 🎓 Test Patterns Used

### Pattern 1: Assertion After Action
```typescript
// Perform action
await query(UPDATE ...)

// Verify result
const result = await query(SELECT ...)
expect(result.rows[0].state).toBe('ACTIVE')
```

### Pattern 2: Before-After Comparison
```typescript
const before = await query(SELECT COUNT ...)
// Action
const after = await query(SELECT COUNT ...)
expect(after).toBeGreaterThan(before)
```

### Pattern 3: Contract Validation
```typescript
// Specification says "cannot do this"
// Implementation should prevent it
// Test verifies contract is enforced
expect(() => invalidOperation()).toThrow()
```

### Pattern 4: Immutability Verification
```typescript
// Write entry
const entry = await insert(...)

// Try to modify (should fail)
await update(...) // Should throw or have 0 rows affected
expect(updateResult.rowCount).toBe(0)
```

---

## ✅ Phase 8.1 Complete

**Deliverables**:
- ✅ 96 automated tests
- ✅ 4 test suites covering all specifications
- ✅ Specification-to-test mapping documented
- ✅ CI/CD integration guidance
- ✅ Test framework configured (vitest)
- ✅ All invariants have enforcement tests

**Next Phase (8.2)**: Execute tests and identify failures for lockdown

---

**Status**: 🟢 READY FOR EXECUTION
**Last Updated**: February 5, 2026
**Test Framework**: Vitest + Node.js PostgreSQL
**Database Required**: Yes (PostgreSQL)
