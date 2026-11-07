# Threat model: facial and manual attendance (Phase 4)

Scope: how attendance is captured on both platforms (a class register for
schools, check-in and check-out for employers), by face or by hand. It covers
the face engine, enrolment and consent, and the records attendance feeds:
timesheets, payroll, guardian alerts and term reports. Brief section 5;
dimension 5 of the scorecard.

## Assets

- Attendance records: who was present, when, how it was established.
  Payroll and timesheets, guardian alerts and reports are built on them.
- Face templates (sealed per tenant), consent records, match events.
- The face engine's capacity: one analysis holds a few hundred MB.

## Before this phase

- Server-side matching: the client sends images, never descriptors. Match
  events are single-use and expire after five minutes. Repeated failures
  pause face matching for that person. A random head-pose challenge.
- Five places wrote attendance. School marks were in `faculty.ts`,
  `facultyWorkflow.ts` and `attendanceService.ts`; employee check-ins in
  `workforceService.ts`. Each wrote the current-state tables
  (`school_attendance`, `corporate_checkins`) directly, so there was no
  record of each capture, and corrections went through a separate history.
- A manual mark was not distinguished from a face mark in any way an
  administrator could act on. It carried no reason, needed no approval, and
  nothing watched how often it happened.
- The engine runs inside the API process: a crash or overload there is an
  API outage.

## Threats

| Threat | Example | Phase 4 control | Residual |
|---|---|---|---|
| **Repudiation / tampering**: attendance changed with no trace | A mark is overwritten; a check-in time is edited. | Every capture is an append-only `attendance_events` row, written only by `src/attendance/core.ts`. It records method, device, server and client time and drift, the match event or the reason, the actor, the approval state and an idempotency key. A correction is a new event naming the one it supersedes. The current-state tables are projections the core writes. `attendance-core-only` fails on any write elsewhere. | The current-state tables can still be written by the owner role outside the API. |
| **Spoofing by fallback**: manual entry used to avoid the face check | Buddy-punching by "the camera is broken". | Where the tenant uses face matching, every manual entry needs a reason code (camera failure, consent withheld, enrolment pending, face not recognised, network outage, other with text). Employee manual check-ins above a tenant threshold wait for a manager's approval. Alerts fire on many manual entries from one device, manual check-ins outside shift hours, and repeated "face not recognised" for one person. Manual entries are marked in every report and export. | A manager can approve their own team's false entries (only their team's since #41). Approval is recorded and audited, not prevented. |
| **Spoofing the face**: a photo, a screen, a replayed capture | A printed photo or a video held up to the camera; a captured request re-sent. | A server-issued challenge bound to a nonce and expiry; frame-sequence timing checks; layered presentation-attack signals combined into a score with a clamped, tenant-tunable policy; rejection reasons logged. Capture sessions are single-use, so media cannot be re-submitted. | No passive liveness model of lab grade is claimed. ISO/IEC 30107-3 testing is an owner action (OA-5), and the dimension stays capped at 8.5 until it is done. |
| **Denial of service** through the engine | Many large images at once exhaust the API's memory. | The engine runs in a separate worker with no database credentials, and inside it in child processes (`FACE_ENGINE_PROCESSES`, default 2), so the worker's HTTP loop answers while they work. Several workers can be listed in `FACE_WORKER_URL`. When they are down or full, face routes answer "use manual" and the API stays healthy. | Face throughput is bounded by the workers' CPU: see docs/operations/capacity.md. |
| **Information disclosure across tenants** | A's lecturer identifies against B's templates, or reads B's match events. | Templates, consent and events carry the tenant and are under RLS. The worker sees images and descriptors, never tenant identifiers or keys. A cross-tenant biometric suite covers enrolment, matching, templates, events and a direct RLS bypass. | — |
| **Elevation**: a lecturer marks a class they do not teach | — | Fixed in Phase 3 (#38); the core keeps the check. | — |
| **Elevation**: a manager acts outside their team | A manager approves leave, a held check-in or a timesheet for someone who does not report to them, or reads HR's organisation views. | HR sets reporting lines (`PUT /api/hr/employees/:id/manager`, loops refused, serialised, audited). `src/auth/reportingLines.ts`: a manager acts only for their direct and indirect reports, never themselves, in leave, held check-ins, alerts, rosters and timesheets; HR's analytics, members, campaigns, notifications and department exports are HR's. Leave decisions are atomic and audited. Suite `managerScope` (#41). | Reporting lines are only as right as HR keeps them. Someone who reports to nobody is HR's alone. |
| **Spoofing location or device**: checking in from somewhere else | A phone reports the office's coordinates from home; a colleague checks in for a friend on one phone. | Per-tenant controls, each off, flag (held for a manager, alerted) or enforce (refused): geofence allowing for the position's accuracy (an imprecise position places nobody), the request's network against each site's CIDRs, a device registered to the employee or as a shared kiosk, the rostered shift window. What each found is kept on the event with the address. Buddy punching (one unshared device, different people, within 120 s) and impossible travel (over 300 km/h) raise alerts. Suite `checkinControls`. | A reported position is the device's claim: a tampered phone can report any coordinates. The device id is a browser's random id, not hardware attestation. The network control depends on `TRUST_PROXY` being set right, and on proxy-addr (CVE-2026-90711, fixed by updating to 2.0.8). |
| **Spoofing a kiosk, or misusing one** | A stolen kiosk token used elsewhere; the attendant PIN guessed; a kiosk used to enumerate staff. | Kiosks pair once with a 15-minute code and hold a token (only hashes stored) that reaches the kiosk routes and nothing else; revoking ends it at once. A kiosk is bound to a site, and its check-ins pass the tenant's controls (its site, its network, its device registration, the employee's shift). Face challenges are bound to the kiosk's device. The attendant PIN (bcrypt) locks after five wrong. A kiosk sees one employee at a time by number, first name and initial only. Suite `kiosk`, browser test `e2e/kiosk.spec.ts`. | A token taken from a kiosk's browser storage works from anywhere until revoked, unless the network control is enforced. An employee number typed at a kiosk reveals whether it exists and a first name. |
| **Denial of service by capture flooding** | One device or one tenant starts face captures as fast as it can. | Limits per person (30 per 10 minutes), per device (200 per 10 minutes) and per tenant (600 a minute), each tenant-settable; a device failing to identify anyone and a person's lockout raise alerts. Suite `biometricLimits`. | Limits count challenges, not analyses already queued at the worker. |
| **Repudiation of face events** | A face match or refusal is deleted or altered after the fact. | Every biometric event is also written to the hash-chained audit log in the same transaction. | — |
| **Information disclosure in reports** | A spreadsheet runs a name as a formula from an exported CSV; one school sees another's attendance. | School reports are for the school's administrators only; CSV cells beginning `=`, `+`, `-`, `@` are written as text. Suite `schoolReports` includes another school's administrator and a lecturer, a student and an employer's administrator. | — |

## Owner actions

- OA-5: ISO/IEC 30107-3 presentation-attack lab testing.
- OA-10: a licensed, consented face dataset, without which the evaluation
  gate (FAR at or below 0.1%, FRR at or below 5%) cannot honestly pass.
