## PHASE 8 – SUPERADMIN TENANT LIFECYCLE & LOCKING RUNBOOK

**Audience**: Trained Superadmin operators (non-developers)  
**Goal**: Safely manage tenant states (PROVISIONED → ACTIVE → SUSPENDED → LOCKED → DECOMMISSIONED) without guessing or issuing ad-hoc SQL.  
**Golden rule**: **If you cannot complete this runbook calmly, stop and escalate.**

---

## 1. WHEN TO USE THIS RUNBOOK

- **Use this when**:
  - Onboarding a new school/corporate tenant.
  - Temporarily blocking a tenant for abuse, non-payment, or security concern.
  - Returning a tenant to service after investigation.
  - Decommissioning a tenant that is permanently leaving the platform.
- **Do NOT use this when**:
  - You are debugging code or migrations (that’s an engineering task).
  - You want to change data “inside” a tenant (use product flows, not lifecycle).

If you are unsure whether lifecycle is appropriate, stop and escalate to engineering.

---

## 2. ROLES, ACCESS & PREREQUISITES

- **Required role**: `superadmin` (verified by backend in `superadmin` routes).
- **Authentication**:
  - You must be logged in as a superadmin account with MFA and IP allowlist configured.
  - All actions are logged to `superadmin_action_logs` and `audit_logs`.
- **Environment**:
  - Confirm you are in the **intended environment** (staging vs production).
  - Never run destructive transitions (LOCKED / DECOMMISSIONED) in production without a ticket ID and dual approval.

---

## 3. STANDARD TENANT INSPECTION FLOW

### 3.1 List all tenants

- **Action**: Call `GET /api/superadmin/tenants`
- **Expected response**:
  - `200 OK` with:
    - `schools[]` and `corporates[]`
    - `id`, `name`, `email`, `phone`, `entity_type`, `created_at`
    - `user_count`, `active_users`
- **Allowed**:
  - Use this to **locate the correct tenant ID**.
- **Forbidden**:
  - Do NOT copy IDs into external tools or personal notes without encryption.

### 3.2 Inspect a specific tenant

- **Action**: Call `GET /api/superadmin/tenants/:tenantId`
- **Expected response**:
  - `200 OK` with:
    - Tenant core fields (`id`, `name`, `email`, `phone`, `type`)
    - `stats` (`total_users`, `active_users`)
    - Recent `lockEvents[]` (if any)
- **If you see** `404 Tenant not found`:
  - **Stop** – re-check tenant ID and environment before retrying.

---

## 4. EMERGENCY LOCKING A TENANT

Use **LOCK** when an incident makes it unsafe for a tenant to continue operating (e.g. mass abuse, data exfiltration, regulatory hold).

### 4.1 Preconditions

- You have:
  - A clear reason (incident ticket ID, legal hold, abuse report).
  - Approval from the on-call incident commander or equivalent.

### 4.2 Lock procedure

1. **Confirm tenant identity**
   - `GET /api/superadmin/tenants/:tenantId`
   - Verify `name`, `email`, and `type` match the intended tenant.
2. **Lock the tenant**
   - **Action**: `POST /api/superadmin/tenants/lock`
   - **Body**:
     - `tenantId` – the UUID from step 1.
     - `reason` – short, structured reason (e.g. `"INC-2026-0205 P0 data exfiltration suspicion"`).
3. **Verify lock recorded**
   - Expected `201 Created` with `id` and `locked_at`.
   - Re-run `GET /api/superadmin/tenants/:tenantId` and check:
     - A new `lockEvents` entry with action `LOCKED`.

### 4.3 Allowed vs forbidden during lock

- **Allowed**:
  - Notifying tenant contacts using pre-approved communication templates.
  - Coordinating with incident responders to gather context.
- **Forbidden**:
  - Editing tenant data directly in the database.
  - Manually clearing sessions without going through the session invalidation endpoint (see below).

---

## 5. UNLOCKING A TENANT

Use **UNLOCK** only when investigation is complete and the tenant is cleared to operate.

### 5.1 Preconditions

- Incident has a **documented resolution**.
- Follow-up actions (e.g., password resets, configuration fixes) are in place.

### 5.2 Unlock procedure

1. **Locate the lock event**
   - From `GET /api/superadmin/tenants/:tenantId`, identify the most recent `LOCKED` event ID.
2. **Unlock**
   - **Action**: `POST /api/superadmin/tenants/unlock`
   - **Body**:
     - `lockEventId` – ID from step 1.
     - `reason` – e.g. `"Resolved per INC-2026-0205; controls applied"`.
3. **Verify unlock**
   - Expect `200 OK` with `id`, `tenant_id`, `unlocked_at`.
   - Re-run `GET /api/superadmin/tenants/:tenantId` and confirm latest action is `UNLOCKED`.

### 5.3 Forbidden patterns

- Do **not**:
  - Unlock without a ticket ID and documented resolution.
  - Unlock and immediately lock again to “test things” in production.

---

## 6. TENANT LIFECYCLE TRANSITIONS (CONTROLLED)

Endpoint: `POST /api/superadmin/tenants/:tenantId/lifecycle`  
States: `PROVISIONED`, `ACTIVE`, `SUSPENDED`, `LOCKED`, `DECOMMISSIONED`

### 6.1 Safe transitions

- **PROVISIONED → ACTIVE**:
  - Use when onboarding is complete and tenant is ready for live use.
- **ACTIVE → SUSPENDED**:
  - Use for non-payment, temporary administrative hold.
- **SUSPENDED → ACTIVE**:
  - Use when billing or compliance issues are resolved.
- **ACTIVE/SUSPENDED → LOCKED**:
  - Use for **security-critical** situations (see Section 4).

Each transition:

1. **Action**:
   - `POST /api/superadmin/tenants/:tenantId/lifecycle`
   - Body:
     - `newState`: target state.
     - `justification`: short, structured explanation referencing ticket IDs.
     - Optional: `dryRun`: `true` if you are only simulating (see below).
2. **Verification**:
   - Expect `200 OK` with `previousState` and `newState`.
   - State change recorded in `tenant_lifecycle_audit`.

### 6.2 Dry-run transitions (recommended first)

- **Action**:
  - Same as above, but set `dryRun: true`.
- **Behavior**:
  - No actual state change; an audit entry is created with `DRY_RUN_TRANSITION`.
- **Use this to**:
  - Confirm that the transition is valid (e.g., from current to requested state).
  - Document the intent before the real change.

---

## 7. DESTRUCTIVE TRANSITIONS (DECOMMISSIONED)

State: `DECOMMISSIONED` – permanent removal of tenant access.  
This carries **irreversible consequences** and requires a confirmation token.

### 7.1 Preconditions

- Signed-off decommission plan with:
  - Legal, security, and customer confirmation.
  - Clear data retention / deletion policies.
- A **valid confirmation token** created specifically for this operation.

### 7.2 Create confirmation token

1. **Action**: `POST /api/superadmin/confirmation-tokens`
   - Body:
     - `operationType`: `"TENANT_LIFECYCLE"`.
     - `operationContext`: `{ "tenantId": "<tenant-uuid>", "targetState": "DECOMMISSIONED", "ticket": "<TICKET-ID>" }`.
     - `ttlSeconds`: e.g. `900` (15 minutes).
2. **Expected**:
   - `201 Created` with:
     - `token` (one-time secret – store securely in password manager or secure note).
     - `id`, `expiresAt`.

### 7.3 Execute decommission

1. **Action**: `POST /api/superadmin/tenants/:tenantId/lifecycle`
   - Body:
     - `newState`: `"DECOMMISSIONED"`.
     - `justification`: includes ticket IDs and approval notes.
     - `confirmationToken`: the token from 7.2.
2. **Expected**:
   - `200 OK` with `previousState` and `newState`.
   - Lifecycle audit entry and (for DECOMMISSIONED) a session invalidation log entry.

### 7.4 Forbidden actions

- Never:
  - Re-use a confirmation token (the backend enforces single-use, but treat it as one-shot).
  - Decommission the wrong tenant – always double-check by `name`, `type`, and `email`.
  - Store confirmation tokens in unencrypted channels (chat, email).

---

## 8. SESSION INVALIDATION FOR A TENANT

Endpoint: `POST /api/superadmin/sessions/invalidate`

- **Use when**:
  - You suspect compromised sessions for a tenant (post-incident).
- **Action**:
  - Body:
    - `tenantId`
    - `reason` (e.g. `"INC-2026-0205 – reset sessions after credential compromise"`).
- **Expected**:
  - `201 Created` with log record in `session_invalidation_log`.
- **Note**:
  - This endpoint records intent and invalidation count; the actual revocation may be handled by downstream processes.

---

## 9. OPERATOR CHECKLIST

Before closing your task, confirm:

- [ ] You operated only within `superadmin` endpoints – no manual SQL was used.  
- [ ] Every lifecycle or lock/unlock action has a linked ticket ID in `reason` / `justification`.  
- [ ] For `LOCKED` and `DECOMMISSIONED`, you verified the change via read endpoints.  
- [ ] Any destructive operation (`DECOMMISSIONED`, mass session invalidation) used a confirmation token where required.  
- [ ] All relevant stakeholders (tenant, support, incident commander) have been informed using approved templates.

If any of these are unchecked, the system is **not** being operated as designed. Stop, document, and escalate.

