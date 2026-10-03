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
| **Spoofing by fallback**: manual entry used to avoid the face check | Buddy-punching by "the camera is broken". | Where the tenant uses face matching, every manual entry needs a reason code (camera failure, consent withheld, enrolment pending, face not recognised, network outage, other with text). Employee manual check-ins above a tenant threshold wait for a manager's approval. Alerts fire on many manual entries from one device, manual check-ins outside shift hours, and repeated "face not recognised" for one person. Manual entries are marked in every report and export. | A manager can approve their own team's false entries. Approval is recorded, not prevented. |
| **Spoofing the face**: a photo, a screen, a replayed capture | A printed photo or a video held up to the camera; a captured request re-sent. | A server-issued challenge bound to a nonce and expiry; frame-sequence timing checks; layered presentation-attack signals combined into a score with a clamped, tenant-tunable policy; rejection reasons logged. Capture sessions are single-use, so media cannot be re-submitted. | No passive liveness model of lab grade is claimed. ISO/IEC 30107-3 testing is an owner action (OA-5), and the dimension stays capped at 8.5 until it is done. |
| **Denial of service** through the engine | Many large images at once exhaust the API's memory. | The engine moves to an isolated worker, with no database credentials, concurrency-limited and health-checked. When it is down or slow, face routes answer "use manual" and the API stays healthy. | One worker is one point of failure until it is scaled out. |
| **Information disclosure across tenants** | A's lecturer identifies against B's templates, or reads B's match events. | Templates, consent and events carry the tenant and are under RLS. The worker sees images and descriptors, never tenant identifiers or keys. A cross-tenant biometric suite covers enrolment, matching, templates, events and a direct RLS bypass. | — |
| **Elevation**: a lecturer marks a class they do not teach | — | Fixed in Phase 3 (#38); the core keeps the check. | — |

## Owner actions

- OA-5: ISO/IEC 30107-3 presentation-attack lab testing.
- OA-10: a licensed, consented face dataset, without which the evaluation
  gate (FAR at or below 0.1%, FRR at or below 5%) cannot honestly pass.
