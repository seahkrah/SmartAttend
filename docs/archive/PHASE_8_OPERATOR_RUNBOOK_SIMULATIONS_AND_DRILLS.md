## PHASE 8 – FAILURE SIMULATION & DRILL RUNBOOK

**Audience**: Superadmin / SRE / reliability operators  
**Goal**: Safely run simulations and drills using `/api/simulations` and time authority admin endpoints **without** impacting tenants unexpectedly.  
**Golden rule**: **Simulations are practice, not experiments on production users.**

---

## 1. WHEN TO USE THIS RUNBOOK

- **Use this when**:
  - Running scheduled resilience drills (time drift, partial outage, duplicate storm, network instability).
  - Validating incident runbooks and alerting in staging/pre-production.
  - Practicing operator workflows for clock drift and fraud detection.
- **Do NOT use this when**:
  - You are diagnosing a live P0 in production (coordinate with incident commander first).
  - You need permanent configuration changes (that’s a code/config change, not a simulation).

---

## 2. ROLES, ENVIRONMENTS & SAFETY GUARDS

- **Required role**: authenticated user with access to `/api/simulations` and, for cross-tenant drift views, `superadmin` for `/api/admin/drift/*`.
- **Environment**:
  - Prefer **staging / test tenants** for all drills.
  - In production, run simulations **only** with:
    - Change record / ticket.
    - Signed-off blast radius and rollback plan.
- **Tenant scope**:
  - All `/api/simulations/*` calls are tenant-scoped using `req.tenantId`.
  - Do not attempt to override tenant via headers – it is ignored by design.

---

## 3. SIMULATION ENDPOINTS – QUICK REFERENCE

Base: `/api/simulations`

- `POST /time-drift` – simulate clock drift.
- `POST /partial-outage` – simulate partial service outage.
- `POST /duplicate-storm` – simulate rapid duplicate submissions.
- `POST /network-instability` – simulate failures, spikes, and timeouts.
- `POST /comprehensive` – run the full simulation suite.
- `POST /stress-test` – high-intensity load across all scenarios.
- `GET /status` – summarize recent metrics for the tenant.

---

## 4. STANDARD DRILL FLOW (STAGING TENANT)

Use this section as a baseline for non-production drills.

### 4.1 Pre-drill checklist

- [ ] Confirm **environment = staging** and selected tenant is the drill tenant.  
- [ ] Notify stakeholders (SRE, on-call, QA) of the drill window.  
- [ ] Ensure monitoring dashboards and alerts are available.

### 4.2 Time drift simulation

- **Action**: `POST /api/simulations/time-drift`
  - Query parameters:
    - `max_drift_ms` (default `5000`).
    - `iterations` (default `5`).
- **Use when**:
  - Testing how your system reacts to client/server clock mismatch and drift-related incidents.
- **Expected**:
  - `200 OK` with:
    - `simulation: 'time_drift'`
    - `tenant_id`
    - `result` object from `simulateTimeDrift`
    - `timestamp`

### 4.3 Partial outage simulation

- **Action**: `POST /api/simulations/partial-outage`
  - Query parameters:
    - `endpoint` (default `/api/school/attendance`).
    - `recovery_attempts` (default `10`).
- **Use when**:
  - Practicing response to intermittent failures on a critical endpoint.
- **Expected**:
  - `200 OK` with:
    - `simulation: 'partial_outage'`
    - `tenant_id`, `endpoint`
    - `result` summary (including failures/recovery attempts).

### 4.4 Duplicate storm simulation

- **Action**: `POST /api/simulations/duplicate-storm`
  - Query parameters:
    - `duplicates` (default `50`).
    - `batch_size` (default `10`).
    - `interval_ms` (default `100`).
- **Use when**:
  - Testing idempotency and deduplication under load.
- **Expected**:
  - `200 OK` with:
    - `simulation: 'duplicate_storm'`
    - `tenant_id`, `duplicate_count`
    - `result` metrics.

### 4.5 Network instability simulation

- **Action**: `POST /api/simulations/network-instability`
  - Query parameters:
    - `failure_rate` (0–100, default `10`).
    - `latency_spike_ms` (default `3000`).
    - `timeout_probability` (0–100, default `5`).
    - `iterations` (default `50`).
- **Use when**:
  - Practicing under latency spikes, errors, and timeouts.
- **Expected**:
  - `200 OK` with:
    - `simulation: 'network_instability'`
    - `tenant_id`
    - `parameters` echo
    - `result` metrics and issues.

### 4.6 Comprehensive run

- **Action**: `POST /api/simulations/comprehensive`
- **Use when**:
  - Running a full failure suite for a tenant after major changes.
- **Expected**:
  - `200 OK` with:
    - `simulation: 'comprehensive'`
    - `tenant_id`
    - `suite` details
    - `report` from `generateSimulationReport`.

### 4.7 Stress test (careful)

- **Action**: `POST /api/simulations/stress-test`
- **Use when**:
  - Doing planned capacity / degradation testing with agreed limits.
- **Expected**:
  - `200 OK` with:
    - `simulation: 'stress_test'`
    - Aggregate `report` including `total_tests`, `total_passed`, `total_failed`, `metrics_collected`, and `issues_found`.
- **Forbidden**:
  - Do NOT run this unscheduled in production during business hours.

### 4.8 Check metrics health

- **Action**: `GET /api/simulations/status`
- **Use when**:
  - Verifying that metrics collection and performance instrumentation stayed healthy during/after drills.
- **Expected**:
  - `200 OK` with:
    - `tenant_id`
    - `metrics_summary` (`total_metrics`, failures/successes, `avg_latency_ms`).

---

## 5. CLOCK DRIFT & FRAUD DRILLS (TIME AUTHORITY ADMIN)

Base: `/api/admin/drift/*` (superadmin only)

Use these in **staging** or with strict guardrails in production.

- `GET /api/admin/drift/summary` – overall drift for a tenant.
- `GET /api/admin/drift/user/:userId` – per-user drift behavior.
- `GET /api/admin/drift/device/:deviceId` – per-device drift behavior.
- `GET /api/admin/drift/incidents` – drift-related incidents.
- `GET /api/admin/drift/anomalies` – suspicious user/device combinations.
- `POST /api/admin/drift/incidents/:incidentId/resolve` – resolve drift incidents.
- `GET /api/admin/drift/access-log` – who accessed drift data.

### 5.1 Drift monitoring drill

1. **Run a time-drift simulation** on a staging tenant.  
2. **Action**: `GET /api/admin/drift/summary`
   - Confirm that `total_events` and drift distribution make sense.  
3. **Action**: `GET /api/admin/drift/incidents?status=OPEN`
   - Verify simulated drift produced appropriate incidents.  
4. **Action**: `GET /api/admin/drift/anomalies`
   - Check that high-drift or blocked events are surfaced.

### 5.2 Drift incident resolution drill

1. Identify a **test** drift incident ID from `GET /api/admin/drift/incidents`.  
2. **Action**: `POST /api/admin/drift/incidents/:incidentId/resolve`
   - Body:
     - `resolution`: one of `LEGITIMATE`, `FRAUD`, `DEVICE_ISSUE`, `FALSE_ALARM`.
     - `notes`: explanation and, for `FRAUD` or `DEVICE_ISSUE`, what follow-up will occur.  
3. Confirm via `GET /api/admin/drift/incidents` that the incident status updated accordingly.

---

## 6. ALLOWED VS FORBIDDEN USAGE

- **Allowed**:
  - Running simulations in **staging** regularly as part of game days.
  - Running limited, planned simulations in production with tickets and approvals.
  - Using time authority endpoints to **observe** drift and anomalies and to resolve test incidents.
- **Forbidden**:
  - Using simulations to intentionally degrade live customer experience without explicit approval.
  - Treating simulation results as real incidents in production dashboards without marking them as drills.
  - Editing drift or incident tables directly in SQL to “clean up” after a drill.

---

## 7. OPERATOR DRILL CHECKLIST

For each scheduled drill, ensure:

- [ ] There is a ticket/change record describing the drill scope and environment.  
- [ ] Stakeholders were notified before starting, and informed when completed.  
- [ ] You captured key metrics before, during, and after the drill (via `/status` and `/api/admin/drift/*`).  
- [ ] Any issues or surprises from the drill were documented and converted into follow-up tasks.  
- [ ] No production tenant experienced unplanned or unexplained disruption.

If any of these are not met, the drill is incomplete; document and escalate.

