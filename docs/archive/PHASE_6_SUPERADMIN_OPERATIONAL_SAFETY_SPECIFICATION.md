<!-- markdownlint-disable MD033 -->

# PHASE 6: SUPERADMIN OPERATIONAL SAFETY

**Core Principle**: Power must be slowed down

**Risk Level**: CRITICAL (Superadmin can destroy the entire system unintentionally)

---

## 📋 RISK SIGNALS (5)

### 1. Script-Based Control
**Signal**: Superadmin running bash scripts or automation directly  
**Risk**: A single script error can destroy production data  
**Example**: `rm -rf /var/data/*` executed by accident  
**Impact**: TOTAL DATA LOSS

### 2. No Dry-Run
**Signal**: Destructive actions execute immediately  
**Risk**: Database deletes, permission revokes, user wipes happen immediately  
**Example**: DELETE FROM users; (no preview, no rollback)  
**Impact**: DATA LOSS + NO RECOVERY

### 3. Long-Lived Sessions
**Signal**: Superadmin sessions live > 8 hours  
**Risk**: Stolen token keeps working, attacker has ample time  
**Example**: Session expires at midnight, session leaked at 4am, attacker operates until 8pm  
**Impact**: 16+ hours of unauthorized access

### 4. No Mandatory MFA
**Signal**: MFA not required for sensitive operations  
**Risk**: Single compromised password = full system access  
**Example**: Leaked credentials used to DELETE production database  
**Impact**: NO 2ND FACTOR DEFENSE

### 5. No IP Allowlisting
**Signal**: Access allowed from any IP  
**Risk**: Attacker in any geography can access superadmin API  
**Example**: Credential leaked, attacker in different country operates immediately  
**Impact**: NO GEOGRAPHIC DEFENSE

---

## ✅ CORE REQUIREMENTS (6)

### Requirement 1: API-Only Operations
```
MUST: Superadmin operations ONLY via REST API, NEVER direct CLI

┌─────────────────────────────────────────┐
│ Superadmin Request                      │
│ POST /api/admin/operations/execute      │
│ {                                       │
│   "operation_type": "delete_role",      │
│   "operation_params": {                 │
│     "role_id": 42                       │
│   },                                    │
│   "requires_authorization": true        │
│ }                                       │
└────────────────┬────────────────────────┘
                 │
         [MFA Challenge]
                 │
         [IP Verification]
                 │
         [Dry-Run Preview]
                 │
         [Human Confirmation]
                 │
         [Execution Recorded]
```

**Implementation**:
- No shell command exposure
- All operations defined in enum
- Request validation layer
- Audit trail on every operation

---

### Requirement 2: Dry-Run for Destructive Actions
```
MUST: All DELETE/UPDATE operations preview before executing

Workflow for: DELETE 100 users from role
└── Step 1: Preview (dry-run)
    ├─ Query: SELECT * FROM users WHERE role_id = 42
    ├─ Response: "Will affect 45 users"
    ├─ Show: names, emails, last_login
    └─ Confirm: "Do you want to proceed?"
    
└── Step 2: Human confirms
    
└── Step 3: Execute with transaction
    ├─ BEGIN TRANSACTION
    ├─ DELETE FROM users WHERE ...
    ├─ Record operation in superadmin_operations log
    ├─ COMMIT
    └─ Response: "Deleted 45 users"
    
└── Step 4: Immutable record
    └─ superadmin_operations table (append-only)
```

**Guarantees**:
- Dry-run shows EXACT rows that will be affected
- No surprises at execution time
- Records immutably in superadmin_operations
- Cannot modify logs after creation

---

### Requirement 3: Short Session TTL
```
MUST: Superadmin sessions expire quickly

Session Creation
├─ Normal user session: 8 hours
└─ Superadmin session: 15 MINUTES

Timeline:
├─ T+0: User authenticates + MFA pass
├─ T+5min: First operation
├─ T+10min: Second operation
├─ T+15min: SESSION EXPIRED
│   └─ Next request: 401 UNAUTHORIZED
│   └─ User must re-authenticate + MFA
│
├─ Session Refresh Policy: NO REFRESH
│   └─ Superadmin must re-auth every 15 minutes
│   └─ Cannot extend session
│
└─ Reason: Limit exposure window to 15 minutes max
    └─ Even if token is stolen at T+14min:
       └─ Attacker has < 1 minute to operate
```

**Configuration**:
- SUPERADMIN_SESSION_TTL = 15 minutes
- SUPERADMIN_SESSION_REFRESH_ALLOWED = false
- Checked on every request
- Enforced at middleware level

---

### Requirement 4: Mandatory MFA for All Operations
```
MUST: MFA required on EVERY superadmin operation

Request Flow:
┌─────────────────────────────────────────────────┐
│ Superadmin API Request (any operation)          │
│ POST /api/admin/operations/execute              │
└────────────────┬────────────────────────────────┘
                 │
        [Check: Is session MFA-verified?]
                 │
            YES ─┴─ NO
            │       │
            │   [Challenge MFA]
            │   ├─ Send TOTP challenge
            │   ├─ User enters code
            │   ├─ Verify: valid?
            │   │
            │   ├─ If fail: Block request + alert
            │   │
            │   └─ If pass: Mark session as MFA-verified-for-operation
            │               TTL: 5 minutes for this specific operation
            │
            ├─ Proceed with request
            └─ Execute operation

MFA Verification:
├─ TOTP code verified
├─ Session marked: mfa_verified_at = NOW()
├─ Operation proceeds
├─ After 5 minutes: MFA verification expires
└─ Next operation requires new MFA challenge
```

**MFA Store**:
- superadmin_mfa_verifications (append-only)
- Immutable record of every MFA event
- Tracks: verified_at, operation_type, result (pass/fail)

---

### Requirement 5: IP Allowlisting
```
MUST: Superadmin access restricted to allowlisted IPs

IP Allowlist Table:
├─ superadmin_ip_allowlist
│  ├─ ip_address: 192.168.1.100
│  ├─ ip_range: 10.0.0.0/8
│  ├─ label: "NYC Office"
│  ├─ added_by: superadmin1
│  ├─ added_at: 2026-02-06
│  └─ is_active: true
│
├─ superadmin_ip_violations
│  ├─ ip_address: 203.0.113.42
│  ├─ user_id: superadmin1
│  ├─ attempted_operation: "delete_user"
│  ├─ denied_at: 2026-02-06 14:32:00
│  └─ alert_sent: true (PAGED ON-CALL)

Request Flow:
┌────────────────────────────────┐
│ Superadmin API Request         │
│ FROM: 203.0.113.42             │
└────────────┬────────────────────┘
             │
    [Check: Is IP allowlisted?]
             │
        YES ─┴─ NO (DENY)
        │       │
        │   ┌──────────────────────┐
        │   │ BLOCK REQUEST        │
        │   │ ├─ Return: 403       │
        │   │ ├─ Log violation     │
        │   │ ├─ Alert: ON-CALL    │
        │   │ ├─ Notify superadmin │
        │   │ └─ Reason: IP NOT    │
        │   │   ALLOWLISTED        │
        │   └──────────────────────┘
        │
        ├─ Proceed with request
        └─ Continue...

IP Allowlist Management:
├─ Add IP: POST /api/admin/ip-allowlist
│  └─ Requires: Current superadmin + MFA + current IP
│
├─ Remove IP: DELETE /api/admin/ip-allowlist/:id
│  └─ Requires: Current superadmin + MFA + current IP
│
└─ List IPs: GET /api/admin/ip-allowlist
   └─ Requires: Superadmin access
```

**Guarantees**:
- Only pre-approved IPs can access
- Script running from wrong location blocked immediately
- Violations logged immutably
- On-call alerted on every violation

---

### Requirement 6: Immutable Operation Log
```
MUST: Action log is append-only, never modified

superadmin_operations Table:
├─ id: uuid (PK)
├─ session_id: uuid (FK → sessions)
├─ user_id: uuid (FK → users)
├─ operation_type: ENUM
│  ├─ DELETE_ROLE
│  ├─ DELETE_USER
│  ├─ UPDATE_PERMISSION
│  ├─ RESET_MFA
│  ├─ UPDATE_IP_ALLOWLIST
│  └─ [etc]
├─ operation_params: JSONB (encrypted)
│  └─ The parameters (e.g., which user IDs to delete)
├─ dry_run_result: JSONB
│  └─ What would have happened
├─ dry_run_confirmed: boolean
├─ execution_status: ENUM
│  ├─ PENDING (dry-run completed, waiting for confirmation)
│  ├─ EXECUTING (transaction in progress)
│  ├─ COMPLETED (transaction committed)
│  ├─ FAILED (transaction rolled back)
│  └─ ROLLED_BACK (admin initiated rollback)
├─ affected_rows_count: integer
├─ ip_address: inet
├─ mfa_verified: boolean
├─ mfa_verified_at: timestamp
├─ performed_at: timestamp
├─ completed_at: timestamp
├─ notes: text
├─ reviewed_by: uuid (superadmin who reviewed it)
├─ reviewed_at: timestamp
├─ checksum: text
│  └─ SHA256(user_id || operation_type || params || performed_at)
├─ is_immutable: boolean (trigger prevents UPDATE/DELETE)
└─ indexes: user_id, operation_type, performed_at, execution_status

Immutability Trigger:
┌──────────────────────────────────┐
│ prevent_superadmin_operations    │
│ UPDATE/DELETE on                 │
│ superadmin_operations?           │
│                                  │
│ RAISE EXCEPTION                  │
│ 'Cannot modify audit log'        │
└──────────────────────────────────┘

Query Examples:
┌─────────────────────────────────────────┐
│ Show all delete operations today        │
│ SELECT * FROM superadmin_operations     │
│ WHERE operation_type = 'DELETE_USER'    │
│   AND DATE(performed_at) = TODAY()      │
│ ORDER BY performed_at DESC              │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ Show operations by specific user        │
│ SELECT * FROM superadmin_operations     │
│ WHERE user_id = $1                      │
│ ORDER BY performed_at DESC              │
│ LIMIT 100                               │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ Show failed operations (rollbacks)      │
│ SELECT * FROM superadmin_operations     │
│ WHERE execution_status IN                │
│   ('FAILED', 'ROLLED_BACK')             │
│ ORDER BY performed_at DESC              │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ Verify operation wasn't tampered        │
│ SELECT * FROM superadmin_operations     │
│ WHERE id = $1                           │
│ THEN: Recalculate checksum              │
│ IF checksum_stored != checksum_calc:    │
│   ALARM: "Audit log tampered!"          │
└─────────────────────────────────────────┘
```

**Guarantees**:
- Once recorded, NEVER modified
- Database trigger prevents all changes
- Checksums verify integrity
- Timeline preserved forever

---

## 🏗️ DATABASE SCHEMA (4 Tables)

### superadmin_operations (Immutable)
```sql
CREATE TABLE superadmin_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id),
    user_id UUID NOT NULL REFERENCES users(id),
    operation_type VARCHAR(50) NOT NULL,
    operation_params JSONB,
    dry_run_result JSONB,
    dry_run_confirmed BOOLEAN DEFAULT false,
    execution_status VARCHAR(20) DEFAULT 'PENDING',
    affected_rows_count INTEGER,
    ip_address INET NOT NULL,
    mfa_verified BOOLEAN NOT NULL DEFAULT false,
    mfa_verified_at TIMESTAMP,
    performed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    notes TEXT,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP,
    checksum TEXT NOT NULL,
    is_immutable BOOLEAN DEFAULT true,
    CHECK (execution_status IN ('PENDING', 'EXECUTING', 'COMPLETED', 'FAILED', 'ROLLED_BACK'))
) WITH (autovacuum_vacuum_scale_factor = 0.01);

-- Immutability Trigger
CREATE TRIGGER prevent_superadmin_operations_update
BEFORE UPDATE ON superadmin_operations
FOR EACH ROW EXECUTE FUNCTION prevent_table_update('superadmin_operations');

CREATE TRIGGER prevent_superadmin_operations_delete
BEFORE DELETE ON superadmin_operations
FOR EACH ROW EXECUTE FUNCTION prevent_table_delete('superadmin_operations');

-- Indexes
CREATE INDEX idx_superadmin_operations_user_id ON superadmin_operations(user_id);
CREATE INDEX idx_superadmin_operations_operation_type ON superadmin_operations(operation_type);
CREATE INDEX idx_superadmin_operations_performed_at ON superadmin_operations(performed_at DESC);
CREATE INDEX idx_superadmin_operations_execution_status ON superadmin_operations(execution_status);
CREATE INDEX idx_superadmin_operations_session_id ON superadmin_operations(session_id);
```

### superadmin_ip_allowlist
```sql
CREATE TABLE superadmin_ip_allowlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    superadmin_user_id UUID NOT NULL REFERENCES users(id),
    ip_address INET,
    ip_range CIDR,
    label VARCHAR(100),
    added_by UUID NOT NULL REFERENCES users(id),
    added_at TIMESTAMP NOT NULL DEFAULT NOW(),
    removed_by UUID REFERENCES users(id),
    removed_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    CHECK ((ip_address IS NOT NULL OR ip_range IS NOT NULL))
);

-- Indexes
CREATE INDEX idx_superadmin_ip_allowlist_user_id ON superadmin_ip_allowlist(superadmin_user_id);
CREATE INDEX idx_superadmin_ip_allowlist_is_active ON superadmin_ip_allowlist(is_active);
```

### superadmin_ip_violations
```sql
CREATE TABLE superadmin_ip_violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address INET NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    attempted_operation VARCHAR(200),
    denied_at TIMESTAMP NOT NULL DEFAULT NOW(),
    alert_sent BOOLEAN DEFAULT false,
    alert_sent_at TIMESTAMP,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP
);

-- Indexes
CREATE INDEX idx_superadmin_ip_violations_ip_address ON superadmin_ip_violations(ip_address);
CREATE INDEX idx_superadmin_ip_violations_user_id ON superadmin_ip_violations(user_id);
CREATE INDEX idx_superadmin_ip_violations_denied_at ON superadmin_ip_violations(denied_at DESC);
```

### superadmin_mfa_verifications (Immutable)
```sql
CREATE TABLE superadmin_mfa_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id),
    user_id UUID NOT NULL REFERENCES users(id),
    mfa_method VARCHAR(50),
    verification_result VARCHAR(20),
    operation_type VARCHAR(50),
    verified_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP,
    ip_address INET
);

-- Immutability Trigger
CREATE TRIGGER prevent_superadmin_mfa_verifications_update
BEFORE UPDATE ON superadmin_mfa_verifications
FOR EACH ROW EXECUTE FUNCTION prevent_table_update('superadmin_mfa_verifications');

-- Indexes
CREATE INDEX idx_superadmin_mfa_verifications_user_id ON superadmin_mfa_verifications(user_id);
CREATE INDEX idx_superadmin_mfa_verifications_verified_at ON superadmin_mfa_verifications(verified_at DESC);
```

---

## 🔐 OPERATIONAL SAFETY ENFORCEMENT

### Session Management
```
Normal User             Superadmin User
├─ TTL: 8 hours        ├─ TTL: 15 minutes (NO EXCEPTIONS)
├─ MFA required        ├─ MFA required on EVERY operation
├─ Any IP OK           ├─ Only allowlisted IPs
├─ Login is enough     └─ Login + MFA + IP check
└─ Refresh allowed
```

### Operation Execution Flow
```
Superadmin requests operation (e.g., DELETE users from role)
       ↓
[Security Checks: 5 layers]
├─ Layer 1: Is superadmin authenticated? YES/NO
├─ Layer 2: Is IP allowlisted? YES/NO
├─ Layer 3: Is session TTL valid? YES/NO (expires at 15min mark)
├─ Layer 4: Is MFA verified for THIS operation? YES/NO
└─ Layer 5: Is operation type allowed? YES/NO
       ↓
[Dry-Run]
├─ Query: SELECT * FROM [table] WHERE [condition]
├─ Count: "Operation will affect 45 rows"
├─ Show: Full list of affected records
└─ Wait: Human confirmation
       ↓
[await] Human reviews dry-run result
       ├─ "Looks correct, proceed"
       └─ OR
       ├─ "Cancel, not what I expected"
       ↓
[If approved]
├─ BEGIN TRANSACTION
├─ Execute: DELETE FROM [table] WHERE [condition]
├─ Record: INSERT into superadmin_operations
├─ COMMIT
├─ Response: "Done, deleted 45 rows"
└─ Return: Immutable operation_id for audit
       ↓
[Log created]
├─ superadmin_operations record (immutable)
├─ Checksum verified
├─ Timestamp locked
└─ Cannot be modified ever
```

---

## 🎯 SUCCESS CRITERIA (8)

1. ✅ **API-Only Operations** - No CLI/script access, only REST API
2. ✅ **Dry-Run Always** - All DELETE/UPDATE operations preview before execution
3. ✅ **Short Sessions** - Superadmin sessions 15 minutes maximum, no refresh
4. ✅ **MFA Per-Operation** - Every operation requires fresh MFA verification
5. ✅ **IP Allowlisting** - Only allowlisted IPs can access superadmin API
6. ✅ **IP Violations Logged** - Violations recorded immutably, on-call alerted
7. ✅ **Immutable Operation Log** - superadmin_operations table cannot be modified
8. ✅ **Checksum Verification** - All operations checksummed, tamper-detection possible

---

## 📋 IMPLEMENTATION CHECKLIST

### Code Delivery
- [ ] Migration: 020_superadmin_operational_safety.sql (400 lines)
- [ ] Service: superadminSafetyService.ts (400 lines)
  - enforceOperationalSafety()
  - verifySuperadminIP()
  - validateSessionTTL()
  - recordOperation()
  - checksumOperation()
- [ ] Service: superadminDryRunService.ts (300 lines)
  - generateDryRun()
  - validateDryRunParams()
  - previewAffectedRows()
- [ ] Service: superadminSessionManagementService.ts (250 lines)
  - createSuperadminSession()
  - verifySuperadminSessionTTL()
  - requireMFAForOperation()
  - markMFAVerified()
- [ ] Routes: superadminOperationalRoutes.ts (500 lines)
  - POST /api/admin/operations/dry-run
  - POST /api/admin/operations/execute
  - GET /api/admin/ip-allowlist
  - POST /api/admin/ip-allowlist
  - DELETE /api/admin/ip-allowlist/:id
  - GET /api/admin/violations
  - POST /api/admin/operations/review
- [ ] Tests: superadminOperationalSafety.test.ts (600 lines)
  - Session TTL enforcement (5 tests)
  - IP allowlisting (5 tests)
  - Dry-run generation (5 tests)
  - MFA verification (5 tests)
  - Immutability verification (3 tests)
  - Operation logging (3 tests)
  - Integration tests (4 tests)

---

## 🚀 DEPLOYMENT SEQUENCE

1. Create migration 020
2. Deploy migration to database
3. Deploy superadminSafetyService
4. Deploy superadminDryRunService
5. Deploy superadminSessionManagementService
6. Mount superadmin session middleware
7. Deploy superadminOperationalRoutes
8. Run test suite (complete coverage)
9. Staging validation (2-3 days)
10. Production rollout

---

## 🎓 DESIGN PRINCIPLES

1. **Slowness as Safety** - Every operation delayed by human reviews
2. **Checkpoints** - Multiple verification layers
3. **Preview Before Execute** - Dry-run mandatory for all destructive actions
4. **Time-Bounded Access** - Sessions expire quickly
5. **Geographic Restriction** - IP allowlist prevents remote attacks
6. **Immutable Records** - Impossible to hide actions
7. **Checksum Verification** - Tamper-detection possible
8. **Human-in-Loop** - Dry-run requires explicit confirmation

---

**STATUS**: Ready for implementation

