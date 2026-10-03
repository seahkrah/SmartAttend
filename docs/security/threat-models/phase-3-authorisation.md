# Threat model: authorisation inside a tenant (Phase 3)

Scope: who, inside one tenant, may call which route and reach whose records.
Dimension 3 of the scorecard (its role, permission-map and escalation gates).
Tenant isolation is Phase 1's; sign-in and sessions are Phase 2's, except
that a single sign-on session's reach across tenants is decided here.

This model was written while the phase was implemented, not before it: the
survey of every route below is what found the defects listed at the end.

## Assets

- Per-person records: attendance, transcripts and programmes, invoices and
  statements, pay and payslips, timesheets, leave, files attached to a
  person, face-matching consent and templates.
- Tenant configuration and the people in it: roles, accounts, settings.
- The control plane (superadmin routes).

## Before this phase

- 563 routes. Guards were Express middleware (`requireRoles`, `requireRole`,
  `requirePlatform`, several local superadmin checks) or checks inside the
  handler, with nothing listing which route had which.
- The `permission-map` gate pointed at a script that did not exist, and the
  `escalation-idor` gate at a suite that did not exist (audit phase 2, F4).
- A survey with the new map: 300 routes behind a role guard, 23 public, and
  240 behind authentication alone. Most of those 240 checked in the handler.
  Some checked nothing.

## Threats

| Threat | Example | Phase 3 control | Residual |
|---|---|---|---|
| **Elevation**: a role reaches a route reserved to others | A student calls a bursar's route; an employee calls an HR route; a school identity calls an EMS route. | Every guard carries a tag (`src/auth/guards.ts`). The route inventory turns each route's chain into `docs/api/permission-map.json`, and `permission-coverage` fails on any route that declares nothing. `privilegeEscalation` calls every role-guarded route (433) as every one of eleven callers the map leaves out (4,012 calls), on both platforms; each must be refused. | 113 of those calls answer 404 because a `router.param` loader runs before the route's guard. The guard is not exercised there, only the refusal. `security_officer`, named in some guards, is not a role anyone can hold. |
| **Elevation**: an undeclared route | A new route is added without a guard, or with its guard after the handler. | The map is regenerated from the routers, `router.all` and RegExp routes included. A route with no declaration, or with a guard after its handler, fails the gate in CI. Shown failing both ways. | A handler rule (`checkedInHandler`) is a written claim. The map shows the rule, but only the IDOR cases below test it. |
| **Information disclosure** inside a tenant (IDOR) | A student reads a classmate's attendance by id; a lecturer opens any invoice; an employee reads a colleague's pay. | Rules are stated per route and tested case by case in `privilegeEscalation`: transcripts, attendance, programmes, invoices, statements, pay, leave balances and requests, timesheets, face-matching records, file attachments. Three defects found and fixed (below). | Lecturers read any student's attendance, transcript and programme in their school, not only students they teach. Any lecturer reads every attendance-evidence file in the school (findings #36). |
| **Tampering**: writing into another person's record | A student attaches a document to a classmate's record, where the classmate and staff then see it as theirs. | `mayAttach`: staff attach to anyone in the tenant, a lecturer attaches attendance evidence to a student, anyone else only to their own record (findings #34). | — |
| **Elevation**: raising one's own role | `PUT /api/auth/me` with a role id; an administrator creating a superadmin; a tenant administrator calling the control plane. | Profile updates ignore role fields; account creation accepts only the platform's assignable roles; the control plane checks the superadmin role. All three tested. | — |
| **Spoofing across tenants through SSO** | A member of schools A and B signs in through A's identity provider and switches to B with `X-Tenant-Id`. B never trusted A's provider (audit phase 2, F5). | A session started through SSO records the provider's tenant (`auth_sessions.bound_tenant_id`, migration 082), carried through a second-factor challenge. The tenant middleware offers that session no other membership. Tested in `sso` against a password session as the control, and shown failing with the binding removed. | A tenant's own provider can still sign in any of that tenant's members, and `trust_idp_mfa` lets its factor stand in. That is the trust a tenant chooses by configuring SSO. |
| **Repudiation** | Who changed what. | Unchanged: the audit hash chain (Phase 2). | — |

## Defects found by the survey

- **#32**: four attendance reads (a session, a course's sessions, a session's
  marks, a student's attendance in a course) had no role check. Any member of
  the school, students included, could read anyone's attendance. They now
  need the school admin or a lecturer.
- **#33**: the invoice loader let a caller with no student record (a
  lecturer, say) through, on the assumption that a role guard followed.
  `GET /api/fees/invoices/:invoiceId` had none, so any lecturer could read
  any student's invoice. Such a caller now gets "not found".
- **#34**: any member could attach a file to anyone in the tenant (above).

## After the independent audit

The audit ([audit-phase-3.md](../../scorecard/audit-phase-3.md)) found what
the survey had missed. Each is fixed and tested, except where marked:

- **Shared accounts (High, #37).** An account belongs to every tenant it is
  a member of, but one tenant could change its role and status for all of
  them. The routes' "belongs to another organisation" checks could not see
  other tenants under row-level security, so they never fired. The routes
  now ask on the system pool, and a trigger refuses the rest (migration 083).
- **Lecturers writing to classes they do not teach (#38).**
- **Raising one's own pay or hours (#39)**, through pay components, payroll
  inputs, one's own contract and one's own timesheet.
- **Managers and IT reading every file (#40).**
- **Managers' scope over leave and rosters (#41): open.**
- **A role taken from the token (#42).**
