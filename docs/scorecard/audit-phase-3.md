# Independent audit: Phase 3 (authorisation inside a tenant)

Date: 2026-10-03. Branch `feat/hardening`, HEAD `6cd2f23`. The phase's work is
commit `7a402e1`, diffed against `8a66152` (tag `phase-2`). Auditor: independent
sub-agent. Instruction followed verbatim: "Assume the implementer is overstating.
Using only the repository, run the gates, attack the system, and rate each
dimension. List every claim you could not verify."

Scores are in [audit-phase-3.json](audit-phase-3.json). Under rule 5 of
`rubric.yml` the runner uses the lower of its own score and this one. My
weight-averaged composite is about **5.5** (the implementer's is 5.8).

## Method

1. Read `rubric.yml`, the whole Phase 3 diff, `auth/guards.ts`,
   `auth/middleware.ts`, `auth/tenantContextMiddleware.ts`, `auth/sessions.ts`,
   `auth/mfaService.ts`, `routes/{sso,mfa,auth,passkeys}.ts`, migration 082,
   `scripts/routeInventory.ts`, `scripts/checks/permission-coverage.mjs`,
   `tests/privilegeEscalation.manual.ts`, the Phase 3 threat model,
   `authorisation.md` and `findings.md`.
2. Read the handlers behind the declarations, concentrating on the 48
   `checkedInHandler` and 47 `selfService` routes: fees, files and
   `fileService.ts`, payroll, workforce, leave, gradebook, attendance and
   `attendanceService.ts`, biometrics `authorizeSubject`, student and
   attendance self-service, guardian portal, guardians, `adminTenant.ts`,
   `schoolAdmin.ts`, audit and incidents, time.
3. Wrote three scratch scripts (in the scratchpad, not the repository) that load
   the real Express app:
   - `chains.mts` dumps every route's full middleware chain, tagged or not, in order;
   - `dispatch.mts` / `dispatch2.mts` walk Express's own layer matching for a
     concrete URL of each mapped route, to find shadowed routes and middleware
     from sibling routers on the same mount;
   - `gatebypass.mts` registers probe routes and regenerates the map, to see
     what the gate can and cannot see.
4. Started the API on the throwaway database (`stack.sh up`) and ran the full
   runner `scripts/run-all-e2e.sh` at `6cd2f23` with a clean tree. **All 43
   suites pass** (results header `commit=6cd2f23… dirty=false`), including
   `privilegeEscalation` (36 checks), `sso`, `crossTenantFuzz` (58,410) and
   every rubric-named module suite. Ran `node scripts/checks/permission-coverage.mjs`
   (ok, 563 routes, counts as claimed), `routeInventory.ts --check` (current),
   and `npx vitest run` (14 files, 171 tests, pass).
5. I had planned live HTTP reproductions of F1–F3. That part of the work was
   interrupted and not completed, so F1–F3 below come from reading the code,
   with the request sequence that should show each one. They are **not
   reproduced live**, and are listed under claims I could not verify.

During the audit `scripts/checks/permission-coverage.mjs` was briefly shown as
modified in the working tree and then returned to its committed content (blob
`16657e9`, equal to `HEAD`). I audited and ran the committed version. I did not
change any source, test or configuration file.

## Ratings

| # | Dimension | Implementer | Audited | Reasoning |
|---|---|---|---|---|
| 1 | tenant-isolation | 8.5 | **7.3** | Every isolation suite passes again (fuzzer 58,410/58,410, blindWrite, rlsNoContext, identityIsolation). Lowered from the Phase 2 audit's 7.8 for F1: role and active flag live on the account that every tenant shares, and two admin routes change them from inside one tenant, so one school's admin can change what a person is in another school. Pentest cap also applies. |
| 2 | authn | 8.5 | **7.5** | SSO binding (#35) is real: `bound_tenant_id` is written at SSO completion and carried through the MFA challenge. Refresh rotates the same session row, so the binding survives refresh; step-up does not create a session. The `sso` suite checks bound against unbound. Nothing new raises or lowers authn. Kept at the Phase 2 audited 7.5, the lower value. |
| 3 | authz-audit | 8.5 | **7.5** | The permission map is generated from the running routers, the gate runs and is honest about what it checks, and the escalation suite passes. My dispatch walk found no shadowed route and no real guard placed after a handler. Withheld because: lecturers can write attendance in classes they do not teach (F2); payroll and timesheet self-approval paths exist (F3); the gate cannot see `router.all` or RegExp routes, and does not check guard order (W1, W2); 107 routes rest on written claims that nothing tests broadly (W3); the matrix accepts 404 and never uses a real object (W4). |
| 4 | data-protection | 6.5 | **6.5** | No change to the failing target gates. File access gives `it` and `manager` every file in the tenant (F4). Kept. |
| 5 | face-attendance | 6.0 | **6.0** | No new evidence. F2 touches manual attendance marking but not the face path, which still needs a server-made match. Kept. |
| 6 | sms-breadth | 5.0 | **5.0** | No new evidence; kept at Phase 2 audited value. |
| 7 | ems-breadth | 4.5 | **4.5** | No new evidence; kept. |
| 8 | offline-mobile | 1.5 | **1.5** | No new evidence; kept. |
| 9 | reliability | 3.0 | **3.0** | No new evidence; kept. |
| 10 | engineering | 6.9 | **6.9** | Unit tests pass; no new evidence on the other gates; kept. |
| 11 | ux-a11y-i18n | 4.5 | **4.5** | No new evidence; kept. |
| 12 | integrations | 3.0 | **3.0** | No new evidence; kept. |
| 13 | compliance | 4.0 | **3.0** | I did not examine what raised this dimension by 1.0 in Phase 3. Following the instruction, I kept the lower of the Phase 2 audited value (3.0) and the current scorecard (4.0). |

## Attacks tried and results

| Attack | Result |
|---|---|
| Make `permission-coverage` pass while a route is unguarded | **Partly possible.** `router.all(...)` and RegExp routes do not appear in the inventory or the map at all. The 8 real `router.all` routes (`users.ts:31,35`, `tenantAdmin.ts:63-68`) are missing from both, so "563 routes" undercounts what is served. They are authenticated 410 stubs today, so nothing leaks. A guard registered after the handler still counts as a guard. A `checkedInHandler` claim with nothing behind it passes. All of these were shown with probe routes in `gatebypass.mts`. `app.all` is visible, and the gate flags it. |
| Router-level `use` with paths, routes mounted twice, shadowing | Dispatch walk over all 563 entries: 0 cases where Express serves a different route than the one the map describes; no conflicting duplicate registrations (`/api/superadmin` and `/api/v1/superadmin` resolve identically). Sibling routers on the same mount run their middleware first (`/api/faculty`: facultyWorkflow's `requireRoles('faculty','admin')`; `/api/attendance`: self-service's auth chain). The map leaves these out. Today that only adds restrictions. |
| `router.param` ordering | Loaders in fees, payroll, workforce, files and guardian portal run before the route's role guard and answer 404. The suite counts these 404s as refusals, so for those routes the guard itself is never exercised (W4). |
| Guards placed after the handler (real routes) | None found: every real route's chain ends in an untagged handler. |
| `checkedInHandler` / `selfService` / `anyMember` claims vs handlers | Sampled ~45 routes. They match what the code does: fees, invoices loader (#33 fix confirmed), files `mayAttach`/`mayRead` (#34 fix confirmed), payroll compensation/payslip loaders, timesheet loader, leave `targetEmployee`, gradebook transcript, biometrics `authorizeSubject`, corporate admin, time status, audit predicate, profile updates (role, tenant and email fields ignored). Some claims are honest but grant a lot (F4, F5). |
| Mass assignment of role/tenant fields | `PUT /api/auth/me`, `PUT /api/attendance/profile` and `PUT /api/student/profile` ignore role, tenant and email fields. `POST/PUT /api/admin/users` refuse `admin`. But see F1: the role that can be set is global. |
| Same-tenant IDOR on writes | **Found** (F2): attendance session create/update and manual marking are not limited to the lecturer's own classes. Gradebook writes are correctly limited (`authorisedCourse`). |
| Self-approval / segregation of duties | **Found** (F3). Leave decisions and payroll run approval do block self-approval. |
| SSO binding bypass: refresh, step-up, second sign-in, superadmin, MFA challenge | Refresh keeps the session row (`rotateSession` UPDATE), so the binding is kept. The MFA challenge carries `bound_tenant_id` (`mfaService.ts`). Superadmins have no memberships and use break-glass, which the binding does not touch. A second password or passkey sign-in yields an unbound session: documented, and there is no "SSO-only" tenant setting. No handler reads a tenant from the header or from `ctx.memberships` outside the middleware. No bypass found. |
| Header-supplied tenant in handlers | `tenantIdExtractorMiddleware` still runs app-wide, but no handler reads `req.tenantId` (comments only). |

## Defects found

**F1 — High (tenant isolation / authorisation). One tenant's administrator can change a shared account's role and active state everywhere.**
`users.role_id` and `users.is_active` are per account, and `resolveTenantContext`
takes `roleName` from the account (`tenantContextMiddleware.ts` identity query),
not from the membership. Accounts belong to several tenants by design: a
guardian already at school B is linked into school A with
`linkExistingAccountToSchool` (`guardians.ts:648`, `authService.ts:179`), and the
`sso` suite itself gives one lecturer two schools.
- `adminTenant.ts:348-405` (`PUT /api/admin/users/:userId`) checks only that the
  account is a member of the caller's tenant. It then sets `role_id` to any
  non-admin role (`FACULTY`, `STUDENT`, `HR`, `EMPLOYEE`) and `is_active`. It does
  not check whether the account also belongs elsewhere, and does not refuse a
  change to another administrator.
- `schoolAdmin.ts:322-345` (`PATCH /api/auth/admin/school/users/:userId`,
  `action: disable|activate`) writes `users.is_active` directly. Only the
  name/phone branch has the "belongs to another organisation" check.
- Expected reproduction (not run live): as school B's admin, create a guardian
  with email E and send an invitation. As school A's admin, create a guardian
  with the same E and send an invitation, which links the same account into A.
  Then, as A's admin, call `PUT /api/admin/users/<account>` with
  `{"role":"FACULTY"}`. The account is now `faculty` in school B. There it passes
  `requireRoles('admin','faculty')` on attendance reads, transcripts, programmes
  and attendance-evidence files, and `requireRole('faculty')` on session
  creation. `{"is_active":false}` locks the parent out of B.
- Also unverified: whether the `elsewhere` checks in `schoolAdmin.ts:296,477`
  can see other tenants' memberships under RLS. If they cannot, those guards
  never fire. An owner-role query is needed to settle it.

**F2 — Medium (same-tenant IDOR, writes). A lecturer can create, alter and mark attendance in classes they do not teach.**
- `attendance.ts:93` `POST /api/attendance/sessions`: `createSession`
  (`attendanceService.ts:111-160`) checks that the course and the named
  `lecturerId` are in the tenant. It does not check that the caller is that
  lecturer or teaches the course, and the attendance window is taken from the
  request body.
- `attendance.ts:125` `PUT /api/attendance/sessions/:sessionId`: `updateSession`
  updates any session in the tenant (status, location, capacity).
- `attendance.ts:221` `POST /api/attendance/mark-with-face`:
  `markAttendanceWithFace` (`attendanceService.ts:264-330`) resolves the schedule
  from the session's own lecturer and never compares it with the caller's
  `facultyId`. Any non-`FACE_RECOGNITION` `verificationMethod` marks an enrolled
  student `present` in another lecturer's open session.
- Findings #36 records only that lecturers can *read* across the school. This is
  the write side, and it is not recorded. `privilegeEscalation` has no
  lecturer-versus-lecturer case. The seed has one lecturer per school, so it
  cannot have one.

**F3 — Medium (segregation of duties). Pay and hours can be raised for oneself.**
- `payroll.ts:711` `POST /periods/:periodId/inputs` and `payroll.ts:448`
  `POST /employees/:employeeId/components` accept the caller's own employee
  record. `POST /employees/:employeeId/compensation` refuses it
  ("You cannot set your own compensation"). So an `hr` user can add a bonus or
  an allowance to their own pay. Run approval checks only "not the calculator",
  not who entered the inputs.
- `workforce.ts:1105` `PATCH /timesheets/:id/days/:entryId` (schedulers,
  including `manager`) lets a scheduler change `approved_hours` on their own
  timesheet. `workforce.ts:1191-1215` (decision) refuses only the person who
  *submitted* the timesheet, not the person it is for. A manager can approve
  their own timesheet when HR submitted it.
- `workforce.ts:390` `PATCH /contracts/:id` (`hrOnly`) lets HR edit their own
  contract, including `weekly_hours`, which feeds the overtime rate on export.

**F4 — Low (least privilege). `it` and `manager` read and delete every file in the tenant.**
`fileService.ts:348` `STAFF_ROLES = admin, hr, hr_director, manager, it`, used
by `mayRead`, `mayAttach`, the list and the delete. A line manager or IT user
therefore gets every employee's leave medical documents, contracts and fee
receipts, and on a school tenant `it` gets admission documents. The declaration
says so honestly. The breadth itself is not in findings.md.

**F5 — Low (scope). Managers act tenant-wide in leave.**
`leave.ts:105-109` (`targetEmployee`), `:313` (`scope=all`), `:432` (decision)
and `:543` (calendar) let any `manager` read anyone's balances and requests and
decide anyone's leave, not just their reports'. It is the EMS twin of #36 and is
not recorded.

**F6 — Low. Legacy `requireRole` reads the role id from the access token.**
`middleware.ts:133-160` looks up `req.user.roleId`, which comes from the JWT,
while `requireRoles` uses the current account. A demoted lecturer keeps the 10
`requireRole('faculty')` routes (`attendance.ts:93,125,221`; `faculty.ts` ×7)
until their access token expires. It also behaves differently for superadmins.

## Weak or mis-specified gates

- **W1** `routeInventory.ts` drops `_all` methods and non-string paths, so
  `router.all` and RegExp routes are invisible to the map, the gate, the fuzzer
  and the matrix. The count of 563 leaves out 8 served routes.
- **W2** The gate does not check order. `own` in `routeInventory.ts` collects
  tags from every layer of the route's stack, including layers after the handler.
- **W3** `selfService`, `anyMember` and `checkedInHandler` do nothing at run
  time, and the gate accepts any text of 3 or more characters. 107 routes rest
  on such claims. `privilegeEscalation` tests about 25 of them with IDOR cases,
  and none for writes by lecturers or self-dealing by HR or managers.
- **W4** The role matrix fills every path parameter with a nonexistent UUID and
  sends empty bodies, and it treats 404 as a refusal on any route with a
  parameter (80 calls). For those routes it proves only that a nonexistent
  object is not found.
- **W5** The matrix has no `guardian` or `it` caller, though both roles exist in
  the database. `security_officer` appears in the incident guards but has no row
  in `roles`.
- **W6** The map does not show middleware that a sibling router on the same
  mount runs first. It is harmless today, but it means "the map reflects what
  runs" holds per router, not per request.
- The gate's title, "Every route declares a permission", is accurate for what it
  checks: a declaration exists. It is not evidence that declarations are true.
  `escalation-idor` is a real, passing suite with the limits above.

## Claims verified

- Every Express guard used for authorisation carries a tag; the map is generated
  from the routers and is current; the gate fails on stale maps and undeclared
  routes (reading the code, and running it: ok with the claimed counts 330/103/47/12/48/23).
- `privilegeEscalation` exists, is in the runner, and passes (36 checks). The
  433-route and 2,771-call figures follow from the map and the caller list; I
  saw the summary line pass but not the per-call breakdown.
- #32 fixed (`attendanceReaders` on the four reads); #33 fixed (invoice loader
  now returns 404 for a caller with no student record); #34 fixed (`mayAttach`);
  #35 fixed (migration 082, `liveSession`, the middleware filter, the MFA
  challenge carry, refresh keeps the row; `sso` suite passes).
- #36 is open and correctly described, for reads.
- All 43 e2e suites pass at `6cd2f23`; unit tests pass.
- The threat model, `authorisation.md` and `findings.md` describe the mechanism
  accurately and admit the matrix's missing roles and the 404 limitation.

## Claims I could not verify

- F1, F2 and F3 were not reproduced over HTTP; they rest on reading the code.
  The live attack step was interrupted and not completed.
- Whether the `user_tenant_memberships` "elsewhere" checks in `schoolAdmin.ts`
  can see other tenants under RLS.
- "2,771 calls … all refused" and "80 answered 404": the runner's condensed
  output shows only the pass totals; I did not rerun the suite verbosely.
- "Shown failing with one declaration removed" (#31), "fails with the guard
  removed" (#32), and "shown failing with the binding removed" (#35): I did not
  modify source to repeat these.
- The CI wiring of `permission-map` (`.github/workflows/ci.yml` change): no CI
  run was available.
- What raised `compliance` by 1.0 in the pre-audit scorecard.
- Every one of the 48 handler rules and 47 own-records routes: I sampled about
  45 of the 107 claim routes, not all of them.
