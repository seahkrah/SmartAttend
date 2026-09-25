# PHASE 8.1 TEST SUITE - QUICK REFERENCE

**Total Tests**: 96
**Status**: ✅ READY FOR EXECUTION
**Framework**: Vitest (Node.js, PostgreSQL)

---

## Test Suite Overview

### 1️⃣ Tenant Lifecycle Rules (18 tests)
**File**: `src/tests/tenantLifecycleRules.test.ts`

**Purpose**: Validate tenant state machine

**Test Categories**:
- ✅ Valid Transitions (6 tests)
- ✅ Invalid Transitions Blocked (3 tests)
- ✅ Audit Trail Immutability (3 tests)
- ✅ Confirmation Tokens (2 tests)
- ✅ System Version Increment (2 tests)
- ✅ Session Invalidation (2 tests)
- ✅ Last Active Timestamp (1 test)

**Run**: `npm run test tenantLifecycleRules.test.ts`

**Key Assertions**:
```
✓ PROVISIONED → ACTIVE transitions successfully
✓ DECOMMISSIONED is terminal state
✓ Every transition creates audit entry
✓ System version increments on change
✓ Session invalidation logged on LOCK/DECOMMISSION
```

---

### 2️⃣ Superadmin Invariants (20 tests)
**File**: `src/tests/superadminInvariants.test.ts`

**Purpose**: Validate privilege isolation and escalation detection

**Test Categories**:
- ✅ Escalation Detection (5 tests - 5-point algorithm)
- ✅ Audit-First Enforcement (3 tests)
- ✅ Superadmin Isolation (3 tests)
- ✅ Role Revalidation (2 tests)
- ✅ Permission Tracking (2 tests)
- ✅ Session Management (5 tests)

**Run**: `npm run test superadminInvariants.test.ts`

**Key Assertions**:
```
✓ Point 1: Privilege elevation detected
✓ Point 2: Superadmin jump flagged CRITICAL
✓ Point 3: Timing anomaly (2+ changes/hour) detected
✓ Point 4: Rules violations detected
✓ Point 5: 5+ permission jump flagged
✓ No role change without audit entry
✓ Superadmin cannot self-escalate
✓ Sessions tracked and expire
```

---

### 3️⃣ Attendance Integrity (28 tests)
**File**: `src/tests/attendanceIntegrity.test.ts`

**Purpose**: Validate attendance state machine and integrity checks

**Test Categories**:
- ✅ State Machine Definition (1 test)
- ✅ Valid State Transitions (6 tests)
- ✅ Invalid Transitions Blocked (2 tests)
- ✅ State History Immutability (3 tests)
- ✅ Clock Drift Detection (5 tests)
- ✅ Duplicate Prevention (3 tests)
- ✅ Integrity Flag Lifecycle (3 tests)
- ✅ No Backdating (2 tests)

**Run**: `npm run test attendanceIntegrity.test.ts`

**Key Assertions**:
```
✓ Valid states: VERIFIED, FLAGGED, REVOKED, MANUAL_OVERRIDE
✓ VERIFIED → FLAGGED transitions successfully
✓ History entries immutable
✓ Clock drift > 30s triggers WARNING
✓ Clock drift > 600s BLOCKS attendance
✓ Duplicate submissions create only 1 record
✓ No backdating without authorization
```

---

### 4️⃣ Phase 7.2 Simulation Validation (30 tests)
**File**: `src/tests/phase7_2SimulationValidation.test.ts`

**Purpose**: Validate failure simulation framework produces valid results

**Test Categories**:
- ✅ Time Drift Scenario (5 tests)
- ✅ Partial Outage Scenario (6 tests)
- ✅ Duplicate Storm Scenario (6 tests)
- ✅ Network Instability Scenario (5 tests)
- ✅ Combined Scenarios (3 tests)
- ✅ Report Validation (3 tests)
- ✅ System Response (2 tests)

**Run**: `npm run test phase7_2SimulationValidation.test.ts`

**Key Assertions**:
```
✓ Time drift detection identifies anomalies
✓ Partial outage recovery measured
✓ 150 concurrent duplicates → 1 record (idempotency)
✓ Network instability handled gracefully
✓ Combined scenarios work in parallel
✓ Reports identify critical issues
✓ Exponential backoff implemented
```

---

## 🚀 Running Tests

### All Tests
```bash
npm run test
```

### Specific Suite
```bash
npm run test tenantLifecycleRules.test.ts
npm run test superadminInvariants.test.ts
npm run test attendanceIntegrity.test.ts
npm run test phase7_2SimulationValidation.test.ts
```

### With Coverage Report
```bash
npm run test:coverage
```

### Watch Mode (Auto-rerun on changes)
```bash
npm run test:watch
```

### Parallel Execution
```bash
npm run test -- --reporter=verbose
```

### CI/CD Mode
```bash
npm run test:ci
```

---

## 📊 Test Statistics

| Category | Tests | Status |
|----------|-------|--------|
| Tenant Lifecycle | 18 | ✅ Ready |
| Superadmin Invariants | 20 | ✅ Ready |
| Attendance Integrity | 28 | ✅ Ready |
| Phase 7.2 Simulation | 30 | ✅ Ready |
| **TOTAL** | **96** | **✅ READY** |

---

## 🔍 Test Execution Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Setup Test Environment                                  │
│    - Load .env configuration                               │
│    - Connect to PostgreSQL                                 │
│    - Initialize test database                              │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Run Test Suites (Parallel or Sequential)                │
│    - tenantLifecycleRules.test.ts (18 tests)              │
│    - superadminInvariants.test.ts (20 tests)              │
│    - attendanceIntegrity.test.ts (28 tests)               │
│    - phase7_2SimulationValidation.test.ts (30 tests)      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Each Test: Setup → Execute → Assert → Teardown         │
│                                                             │
│    For each test:                                          │
│    a) beforeEach: Create test data                         │
│    b) Execute: Run test scenario                           │
│    c) Assert: Verify results match spec                    │
│    d) Cleanup: Remove test data                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Generate Report                                          │
│    - Total tests run: 96                                   │
│    - Passed: ??                                            │
│    - Failed: ??                                            │
│    - Coverage: ??%                                         │
│    - Execution time: ?? ms                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔗 Specification Mapping

### Tenant Lifecycle
```
Spec: "State machine from PROVISIONED to DECOMMISSIONED"
↓
Test: tenantLifecycleRules.test.ts
├── Rule 1: Valid Transitions
│   ├── PROVISIONED → ACTIVE ✓
│   ├── ACTIVE → SUSPENDED ✓
│   └── ... (6 total)
├── Rule 2: Invalid Transitions
│   ├── DECOMMISSIONED → * BLOCKED ✓
│   └── ... (3 total)
├── Rule 3-7: Other invariants
└── Total: 18 tests
```

### Superadmin Escalation
```
Spec: "5-point escalation detection algorithm"
↓
Test: superadminInvariants.test.ts
├── Point 1: Privilege Elevation ✓
├── Point 2: Superadmin Jump ✓
├── Point 3: Timing Anomaly ✓
├── Point 4: Rules Violation ✓
├── Point 5: Permission Jump ✓
└── + 15 more tests on invariants
    Total: 20 tests
```

### Attendance State Machine
```
Spec: "Attendance states: VERIFIED → FLAGGED → REVOKED → MANUAL_OVERRIDE"
↓
Test: attendanceIntegrity.test.ts
├── Rule 1: State Machine Definition ✓
├── Rule 2: Valid Transitions (6 tests) ✓
├── Rule 3: Invalid Transitions Blocked ✓
├── Rule 4-8: Other integrity checks
└── Total: 28 tests
```

### Phase 7.2 Failure Simulation
```
Spec: "Failure simulation validates system resilience"
↓
Test: phase7_2SimulationValidation.test.ts
├── Scenario 1: Time Drift ✓
├── Scenario 2: Partial Outage ✓
├── Scenario 3: Duplicate Storm ✓
├── Scenario 4: Network Instability ✓
├── Combined Scenarios ✓
├── Report Validation ✓
└── System Response ✓
    Total: 30 tests
```

---

## ⚙️ Test Configuration

### File: `vitest.config.ts`
```typescript
- Environment: Node.js
- Test match: **/*.test.ts
- Timeout: 30 seconds per test
- Coverage threshold: 80%+
- Report formats: text, json, html
```

### File: `src/tests/setup.ts`
```typescript
- Load environment variables
- Verify DATABASE_URL set
- Initialize test database connection
- Setup global test helpers
```

---

## 📋 Prerequisites

### Required
✅ Node.js 18+
✅ npm 8+
✅ PostgreSQL running
✅ DATABASE_URL environment variable set
✅ Vitest installed

### Optional
❓ GitHub Actions (for CI/CD)
❓ Coverage reporter (for HTML reports)

---

## ✅ Execution Checklist

Before running tests:

- [ ] PostgreSQL is running
- [ ] DATABASE_URL is set in `.env`
- [ ] Backend dependencies installed (`npm install`)
- [ ] Backend is built (`npm run build`)
- [ ] No lingering test data in database

```bash
# Quick checklist
echo "Checking prerequisites..."
test -n "$DATABASE_URL" && echo "✓ DATABASE_URL set" || echo "✗ DATABASE_URL missing"
psql -c "SELECT 1" 2>/dev/null && echo "✓ PostgreSQL running" || echo "✗ PostgreSQL not accessible"
```

---

## 🐛 Debugging Failed Tests

### If a test fails:

1. **Read the error message carefully**
   ```bash
   Expected: 'ACTIVE'
   Received: 'SUSPENDED'
   ```

2. **Check the assertion**
   ```typescript
   expect(result.rows[0].state).toBe('ACTIVE')
                               //    ^^^^^^^^
                               // What did we expect?
   ```

3. **Run test in isolation**
   ```bash
   npm run test tenantLifecycleRules.test.ts -- --reporter=verbose
   ```

4. **Add debugging output**
   ```typescript
   console.log('Result:', result.rows[0])
   ```

5. **Check database state**
   ```bash
   SELECT * FROM school_entities WHERE id = 'test-id';
   ```

---

## 📈 Expected Results

When all tests pass, you should see:

```
✓ tenantLifecycleRules.test.ts (18)
  ✓ Rule 1: Valid State Transitions (6)
  ✓ Rule 2: Invalid Transitions are Blocked (3)
  ✓ Rule 3: Audit Trail is Immutable (3)
  ✓ Rule 4: Confirmation Tokens for Destructive (2)
  ✓ Rule 5: System Version Increment (2)
  ✓ Rule 6: Session Invalidation (2)
  ✓ Rule 7: Last Active Timestamp (1)

✓ superadminInvariants.test.ts (20)
  ✓ Invariant 1: Escalation Detection (5)
  ✓ Invariant 2: Audit-First Enforcement (3)
  ✓ Invariant 3: Superadmin Isolation (3)
  ✓ Invariant 4: Role Revalidation (2)
  ✓ Invariant 5: Permission Tracking (2)
  ✓ Invariant 6: Session Management (5)

✓ attendanceIntegrity.test.ts (28)
✓ phase7_2SimulationValidation.test.ts (30)

Test Files  4 passed (4)
     Tests  96 passed (96)
  Start at  14:32:45
  Duration  2.43s
```

---

## 🔐 What These Tests Guarantee

If all 96 tests pass, we guarantee:

✅ **Tenant Lifecycle**: State machine is enforced, never violated
✅ **Superadmin Security**: Escalations detected, audit trail immutable
✅ **Attendance Integrity**: Duplicates prevented, clock drift handled
✅ **Failure Resilience**: System survives concurrent failures
✅ **Specification Compliance**: All specs have enforcement tests

---

**Last Updated**: February 5, 2026
**Framework**: Vitest
**Next Execution Target**: Immediate (before Phase 8.2 Lockdown)
