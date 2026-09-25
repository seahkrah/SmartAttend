## PHASE 8 – INCIDENT INVESTIGATION & RESOLUTION RUNBOOK

**Audience**: Superadmin / on-call incident operators  
**Goal**: Work incidents from creation → ACK → root cause → resolution **without guessing or bypassing the enforced workflow**.  
**Golden rule**: **If you can’t follow this calmly, escalate to the incident commander.**

---

## 1. WHEN TO USE THIS RUNBOOK

- **Use this when**:
  - You receive an alert about a new P0/P1 incident.
  - You need to see which incidents are currently open or overdue.
  - You must acknowledge, investigate, and close an incident.
- **Do NOT use this when**:
  - You are debugging application code (hand off to engineering).
  - You want to adjust tenant lifecycle (use the tenant lifecycle runbook).

---

## 2. ROLES, ACCESS & GUARANTEES

- **Required role**: `superadmin` – enforced by `incidentAdminRoutes`.
- **Location**: `/api/admin/incidents` (all routes below assume this base path).
- **Workflow guarantees** (enforced by services):
  - You **cannot record root cause** until the incident is **ACKNOWLEDGED**.
  - You **cannot resolve** until a root cause is recorded.
  - All actions are logged immutably for audit.

---

## 3. QUICK STATUS OVERVIEW

### 3.1 List current open incidents

- **Action**: `GET /api/admin/incidents?status=REPORTED` (or omit `status` to see all open)
- **Use when**: Starting a shift or responding to a new alert.
- **Expected**:
  - `200 OK` with:
    - `data[]`: array of incidents from `open_incidents` view.
    - `pagination`: `limit`, `offset`, `total`.
- **Checklist**:
  - [ ] Confirm at least one incident matches the alert ID or summary.
  - [ ] Note IDs of any **REPORTED** incidents older than your SLA.

### 3.2 Dashboard statistics

- **Action**: `GET /api/admin/incidents/stats`
- **Use when**: You need a quick sense of system health.
- **Expected**:
  - `totalOpen`
  - `byStatus`: `reported`, `acknowledged`, `investigating`
  - `bySeverity`: `critical`, `high`, `medium`
  - `overdue`: count of REPORTED incidents older than 1 hour.

---

## 4. HANDLING A SINGLE INCIDENT END-TO-END

Assume an incident ID `INC_ID`.

### 4.1 Step 1 – Retrieve full details

- **Action**: `GET /api/admin/incidents/INC_ID`
- **Expected**:
  - `200 OK` with full incident details (status, severity, history).
  - `404 NOT_FOUND` if ID is invalid (re-check alert or environment).
- **Operator actions**:
  - [ ] Confirm the incident refers to the correct environment and tenant context.
  - [ ] Read current `current_status` and `severity` carefully.

### 4.2 Step 2 – Acknowledge the incident

- **Action**: `POST /api/admin/incidents/INC_ID/acknowledge`
  - Body:
    - `notes`: short ACK message (e.g., `"On-call acknowledged at 2026-02-06T12:34Z – starting investigation, see TICKET-123"`).
- **Expected**:
  - `200 OK` with `success: true, message: 'Incident acknowledged'`.
  - `400 ALREADY_ACKNOWLEDGED` if someone already ACKed.
- **Do / Don’t**:
  - **Do** include ticket IDs and your name/role in `notes`.
  - **Do NOT** ACK if you are not actually taking responsibility; hand off instead.

### 4.3 Step 3 – Record root cause

Once investigation is complete and you have a clear explanation:

- **Action**: `POST /api/admin/incidents/INC_ID/root-cause`
  - Body:
    - `summary`: brief root cause description.
    - `category`: one of the configured categories (e.g., `SYSTEM_DEFECT`, `USER_ERROR`, etc.).
    - `remediationSteps`: bullet-style text of what was, or will be, done.
- **Expected**:
  - `200 OK` with `rootCauseId`.
  - `400 NOT_ACKNOWLEDGED` if you skipped ACK.
  - `400 ALREADY_RECORDED` if a root cause already exists.
- **Good examples**:
  - `summary`: `"DB connection pool exhausted due to missing max_connections setting."`
  - `remediationSteps`: `"Deployed config v1.2.3; added monitoring; set alert at 80% utilization."`

### 4.4 Step 4 – Resolve and close

- **Action**: `POST /api/admin/incidents/INC_ID/resolve`
  - Body:
    - `resolutionSummary` (required): top-level description of what fixed it.
    - `resolutionNotes` (optional): extra context, links to postmortem docs.
    - `impactAssessment` (optional): who/what was affected.
    - `lessonsLearned` (optional but recommended): what you’d change.
    - `followUpActions` (optional): list of future tasks or tickets.
- **Expected**:
  - `200 OK` with `success: true, message: 'Incident resolved and closed'`.
  - `400 NOT_ACKNOWLEDGED` if ACK was skipped.
  - `400 NO_ROOT_CAUSE` if root cause was not recorded.
- **Forbidden**:
  - Do NOT resolve an incident if you cannot honestly say the immediate cause and fix are known.

---

## 5. ESCALATION INSIGHT

### 5.1 View escalation statistics (last 24h)

- **Action**: `GET /api/admin/incidents/stats/escalations`
- **Expected**:
  - `200 OK` with:
    - `escalations[]`: `escalation_reason`, `count`.
- **Use when**:
  - Reviewing how many incidents missed their ACK or RC timelines.
  - Preparing for weekly incident review.

---

## 6. ALLOWED VS FORBIDDEN ACTIONS

- **Allowed**:
  - ACK incidents you are actively handling.
  - Record root cause once the main contributing factors are clear.
  - Resolve incidents only after both ACK and RC are in place and the fix is applied.
  - Use `stats` and `stats/escalations` to guide staffing and follow-up.
- **Forbidden**:
  - Editing incident rows directly in the database (this breaks immutability guarantees).
  - Deleting incidents.
  - Resolving incidents as a shortcut to clear dashboards.

---

## 7. OPERATOR CHECKLIST (PER INCIDENT)

Before you consider an incident **done**, ensure:

- [ ] `GET /api/admin/incidents/INC_ID` shows the status as `CLOSED` (or equivalent final state).  
- [ ] There is a clear ACK entry (who, when, and why).  
- [ ] Root cause is documented with a meaningful summary and remediation steps.  
- [ ] Resolution notes capture impact and lessons learned, or there is a linked postmortem.  
- [ ] Any follow-up tickets mentioned in remediation or lessons are actually created.

If any box is unchecked, the incident is **not fully resolved** from an operator-readiness perspective.

