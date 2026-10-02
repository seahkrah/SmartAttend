# Independent audit: Phase 1 (tenant isolation by construction)

Date: 2026-10-02. Branch `feat/hardening`, HEAD `1cdb603`, commits `phase-0..HEAD` (11 commits).
Auditor: independent sub-agent. The instruction I followed: assume the implementer is
overstating, use only the repository, run the gates, attack the system, rate each
dimension, and list every claim I could not verify.

Scores are in [audit-phase-1.json](audit-phase-1.json). Under rule 5 of `rubric.yml`, the
runner uses the lower of its own score and this one.

## Method

1. Read `rubric.yml`, `checks.mjs` (`rlsCoverage`, `runtimeRole`) and
   `scripts/checks/no-raw-query.mjs`. Also read `db/connection.ts`, `db/dbContext.ts`,
   `auth/tenantContextMiddleware.ts`, migrations 069 to 072, `routes/superadmin.ts`
   (gate, users, audit, tenant-admins, break-glass), `crossTenantFuzz.manual.ts`,
   `routeInventory.ts`, `rlsNoContext.manual.ts` and `blindWrite.manual.ts`.
2. Ran the full e2e runner (`scripts/run-all-e2e.sh`) at `1cdb603` with a clean tracked
   tree. All 34 suites passed, including `rlsNoContext` (33/33), `blindWrite` (7/7),
   `breakGlass` (23/23) and `crossTenantFuzz` (19,888/19,888).
3. Ran `node scripts/scorecard/run.mjs --phase phase-1 --no-write` against those results.
   I got composite **5.7**, and every dimension score matched `LATEST.md` exactly.
4. Ran `node scripts/checks/no-raw-query.mjs` (ok, 147 files, 7 allow-listed) and
   `routeInventory.ts --check` (current, 538 routes).
5. Inspected the live catalog as the owner and as the runtime role (`jjelotech_api`).
   I also checked `pg_stat_activity` to see which role the running API connects as.
6. Attacked the system against the throwaway database (details below). I did not open any
   `.env*` file. I did not read `SECURITY_CREDENTIAL_ROTATION.md`.

One planned experiment was not completed: an extended HTTP fuzz with non-admin callers,
ids in query strings and bodies, and ids from tables without `tenant_id`. Those blind
spots are argued below from reading the fuzzer's code. They are not demonstrated with
traffic, and the claims that depend on them are listed as unverified.

## Ratings

The "rubric" column is the mechanical result of my run. The "audited" column also
withholds credit from any gate whose title claims more than its check proves, or that a
verified defect contradicts.

| # | Dimension | Rubric (my run) | Audited | Reasoning |
|---|---|---|---|---|
| 1 | tenant-isolation | 8.5 (raw 10, pentest cap) | **8.3** | Every gate passes, and the core claims hold: forced RLS with one uniform policy on all 98 tenant tables, the API on a NOBYPASSRLS non-member role, and context set on checkout. Withheld: `break-glass` (2), because a superadmin can read tenant data without a grant (D1). `route-fuzzer` (5): the title says "over the route inventory", but it covers only the 226 routes with path parameters, with `{}` bodies and admin callers, and 98.5% of its answers are 4xx (G2). `cross-tenant-triggers` (10): the title says the database refuses cross-tenant references, but 87 single-column tenant-to-tenant foreign keys have no guard (D3). Result 83/100, so held below 9 and capped at 8.5: **8.3**. |
| 2 | authn | 6.5 | **6.5** | The foundation e2e suites (`authFlow`, `mfaApi`, `accountSecurity`) passed in my run, as did `src/auth` vitest. Every target gate fails. |
| 3 | authz-audit | 7.5 | **7.5** | The foundation gates pass in my run. I note that tenant-admin appointment by a superadmin never reaches the tenant's `audit_logs` (D1). No gate claims that, so no credit is withheld. |
| 4 | data-protection | 6.5 | **6.5** | Verified: AEAD tests, `databaseSsl()` (read the code), the consent table and the `filesApi` e2e. `envelope-encryption` fails because the suite is absent, even though per-tenant DEKs exist. The DEK path silently falls back to the env key when no KMS is configured (D7). |
| 5 | face-attendance | 6.0 | **6.0** | The foundation e2e suites pass. Target gates are absent. |
| 6 | sms-breadth | 5.0 | **5.0** | The foundation e2e suites pass. |
| 7 | ems-breadth | 4.5 | **4.5** | The foundation e2e suites pass. |
| 8 | offline-mobile | 1.5 | **1.5** | Only the viewport meta gate passes. |
| 9 | reliability | 4.0 | **3.0** | Withheld: `image-boot-ci` (10). It greps for a CI step name, and no CI run exists for this branch, the same reason as in the Phase 0 audit. |
| 10 | engineering | 7.4 | **6.9** | Ran and passed: both typechecks, `sql-validator`, unit tests, coverage, eslint, migration-lint and repo-hygiene. Withheld: `image-build` (5), a grep for `docker build` in a workflow that has never run. |
| 11 | ux-a11y-i18n | 4.5 | **4.5** | Count and nav gates pass as specified. They are volume counts, not accessibility evidence. |
| 12 | integrations | 3.0 | **3.0** | CSV, notifications and storage-backend gates pass. |
| 13 | compliance | 4.0 | **3.0** | Withheld: `credential-doc` (10). I was instructed not to read the file, so I could not verify that its content matches its title. |

## Attacks tried

| # | Attack | Result |
|---|---|---|
| A1 | Superadmin acts in tenant A without break-glass, via `POST /api/superadmin/tenant-admins` with `handover: true`, then activate, log in and read data | **Succeeded** (D1) |
| A2 | Superadmin sends `X-Tenant-Id: A` with no grant | Refused, 403 |
| A3 | Runtime role in A's context forges a break-glass grant, and deletes its own grants and access log | **Succeeded at the DB level** (D2). No API route found that does this. |
| A4 | Runtime role in A's context sets `app.tenant_id` to B with SQL | **Succeeded**: it then sees B's students. Any SQL injection is therefore a full cross-tenant read (D4). No injectable SQL found in a sample of interpolated queries. |
| A5 | Runtime role reads or updates tables without `tenant_id` (`users`, `school_user_associations`, `auth_sessions`, `drift_audit_log`) | **Allowed**: 134 users readable, 5 of tenant B's users updatable from A's context (D5) |
| A6 | Cross-tenant FK references, enumerated from the catalog | 87 single-column tenant-to-tenant FKs have no `guard_same_tenant` trigger (D3). After a full e2e run plus the fuzzer, the data held 0 cross-tenant references (all 115 FKs checked). Routes I sampled (invoices, roster, bulk roster) check the tenant in application code. |
| A7 | Lost async context after `multer` (64 B, 200 KB and 3 MB uploads) | Held: multer 2.x binds an `AsyncResource`. All three files were stored under tenant A. |
| A8 | Lost context in `res.send` latency hook, stream callbacks, notification dispatcher and metrics retention | Held, by code reading. The dispatcher and retention run inside `runAsSystem`, and their queries name `tenant_id`. |
| A9 | Stale pool context: set_config error, release inside a transaction, `RESET`/`DISCARD` | The error path destroys the client. A client released inside a transaction is detected through ReadyForQuery status and discarded. No `RESET ALL`, `DISCARD`, `SET ROLE` or other `app.*` writes exist outside `connection.ts`. LISTEN/NOTIFY and pg cursors are not used. |
| A10 | Views, materialized views, SECURITY DEFINER functions | 26 views, all `security_invoker`. No materialized views. No SECURITY DEFINER functions in `public`. |
| A11 | Runtime role membership in `jjelotech_system` | Not a member. The API connects as `jjelotech_api` (`pg_stat_activity`). |

## Defects

**D1 (High): break-glass bypass through the control plane.**
`apps/backend/src/routes/superadmin.ts:809-903`. With no grant, a superadmin calls
`POST /api/superadmin/tenant-admins` with `{tenantId: A, email: <own>, handover: true}` and
receives the setup link in the response. They activate the account
(`POST /api/auth/activate`), log in, and read `GET /api/school/students` with a 200.
Verified run: `break_glass_access_log` rows for A went from 0 to 0. Tenant A's
`audit_logs` went from 0 to 0. There was no open grant. Only the superadmin's own audit
log records it.

A likely second path, which I did not exercise: `PATCH /api/superadmin/users/:userId`
(`superadmin.ts:1043`) can rewrite any tenant user's email, after which a password reset
takes the account over.

Fix: require an open grant for the target tenant (or a tenant-visible `audit_logs` entry
plus a notification to the existing admins) on tenant-admin creation, invitation re-issue
and user email change. Never return `handover` links for a tenant that already has an
active administrator.

**D2 (Medium): break-glass records are writable by the tenant's runtime role.**
`migrations/071_break_glass.sql`. The table is under tenant RLS, and `GRANT ... DELETE ON
ALL TABLES` applies to it. In A's context, as `jjelotech_api`, I could INSERT a grant
naming any user as `superadmin_id` and DELETE every grant and access-log row. The
"append-only" trigger covers only UPDATE.

Fix: `REVOKE INSERT, UPDATE, DELETE ON break_glass_grants, break_glass_access_log FROM
jjelotech_app`, and write them only from the system pool. Allow DELETE only through
tenant deletion.

**D3 (Medium): most cross-tenant foreign keys are unguarded at the database.**
There are 22 `guard_same_tenant` triggers against 87 unguarded single-column FKs between
tenant tables. Examples: `invoices.student_id`, `payments.invoice_id`,
`leave_requests.employee_id`, `timesheets.employee_id` and `face_templates.consent_id`.
PostgreSQL makes FK checks without RLS, so the database accepts an A row that points at
B's row. Isolation of these references rests on application checks only. Cascades and
RESTRICTs then act across tenants.

Fix: composite FKs `(tenant_id, x_id) REFERENCES parent(tenant_id, id)`, or the guard on
every such FK, plus a catalog check that fails when a tenant-to-tenant FK lacks either.

**D4 (Medium, by design): the runtime role can set its own tenant.**
`SELECT set_config('app.tenant_id', <B>, false)` works for `jjelotech_api`, so RLS only
holds while no SQL injection exists. The lint (`no-raw-query.mjs:69`) searches source for
literal `set_config('app.` and `SET app.`. It misses `set_config($1, ...)` and
`SET SESSION app.tenant_id`.

Fix: sign the context, for example an HMAC-checked value verified in
`app_current_tenant()` with a key the runtime role cannot read, or set it through a
SECURITY DEFINER setter owned by a role that checks a token. Widen the lint regex.

**D5 (Medium, partly disclosed): identity tables have no tenant boundary for the runtime
role.**
`users` (including `password_hash`), `school_user_associations`, `auth_sessions`,
`drift_audit_log`, `attendance_state_history` and `attendance_transition_attempts` carry
no `tenant_id`. From A's context the role read 134 users and could UPDATE 5 of B's. The
README admits that "tables with no tenant_id" are outside RLS, but it names only
incidents. The attendance history tables hold tenant data, keyed by
`attendance_record_id`.

**D6 (Low): the superadmin router runs entirely on the system pool.**
`superadmin.ts:79`. `GET /api/superadmin/users` returns names, emails and phones of every
tenant's users without a grant. That is defensible as control-plane data, but it is
broader than "administers tenants as a whole".

**D7 (Low): per-tenant keys fail open on configuration.**
`biometrics/templateCrypto.ts:103`. Without a KMS, templates are sealed with the env key,
with `dek_version` NULL, and nothing reports it. The live database held 0 face templates
after the e2e run, so DEK use on the live path is shown only by unit tests.

**D8 (Low): tenant-visible trail is best-effort.**
`superadmin.ts:1668-1685`. `tenantTrail` swallows write failures, so a grant can be open
with no tenant-visible record.

## Weak or mis-specified gates

- **G1 `runtime-role`** (`checks.mjs:39`) inspects whatever `APP_DATABASE_URL` the
  *scorecard* is given, not the role the running API uses. It also does not check
  membership in `jjelotech_system`, and membership alone makes `app_is_system()` true,
  which bypasses every policy.
  Fix: read `usename` from `pg_stat_activity` for the API's `application_name`, or expose
  `current_user` on `/api/health/ready`, and add
  `NOT pg_has_role(current_user,'jjelotech_system','MEMBER')`.
- **G2 `route-fuzzer`**: the title says "over the route inventory". The fuzzer
  (`crossTenantFuzz.manual.ts:85`) filters to routes with path parameters (226 of 538).
  It sends `{}` as every body, never puts ids in query strings or bodies, and uses only
  two admin callers, so role-gated routes answer 403 for both B's id and the
  nowhere-id. It draws candidates only from tables with `tenant_id`, so B's user and
  session ids are never tried against `/admin/users/:userId` or `/auth/sessions/:id`. Its
  leak check looks only for B's tenant ids, one sampled id per table and tenant names.
  Fix: add non-param routes with query-string ids, body templates per route, callers for
  every role, candidates from identity tables, and a check that refuses a run where more
  than X% of a route's answers are 401/403. Also detect B's PII (emails, names).
- **G3 `cross-tenant-triggers`**: a count of ≥20 occurrences of a function name does not
  show that the database refuses cross-tenant references (see D3).
  Fix: a `check` that lists tenant-to-tenant FKs without a composite key or a guard
  trigger and fails on any.
- **G4 `rls-forced`**: passes on any policy, including `USING (true)`.
  Fix: also require the policy's `pg_get_expr(polqual)` to equal the canonical
  expression, and require no additional permissive policy.
- **G5 `raw-query-lint`**: the title says "Raw pool.query forbidden". The script forbids
  constructing a Pool and literal `set_config`. It allows `pool.query` everywhere, which
  is fine only because the exported pool is bound. Aliased `runAsSystem` and `withTenant`
  with an arbitrary id are not restricted.
  Fix: retitle the gate, restrict `withTenant` to the middleware, and match imports
  rather than call text.
- **G6 `break-glass`**: the e2e covers only the `X-Tenant-Id` path, so the gate passes
  despite D1.
  Fix: add cases for tenant-admin creation, invitation re-issue and email change by a
  superadmin with no grant.
- **G7 `no-context-no-rows`**: the suite samples 6 tables, not all of them. That is
  acceptable given the uniform policy, but the title implies all.

## Claims verified

- RLS is enabled, forced and has a policy on all 98 tables with `tenant_id`, including
  071 and 072 tables. The qualifier is one uniform expression across all policies.
- The API connects as `jjelotech_api`: not superuser, NOBYPASSRLS, not a member of
  `jjelotech_system`.
- The pool sets `app.tenant_id` and `app.user_id` on checkout from AsyncLocalStorage. It
  discards clients released mid-transaction and destroys a client whose set_config
  fails.
- `runAsSystem` is used in exactly the 7 allow-listed files, plus scripts and tests. The
  lint passes.
- Fix 070: a reference to a row the caller cannot see is refused (`blindWrite` passed).
- Break-glass via `X-Tenant-Id`: refused without a grant, and logged per request when a
  grant is open (`breakGlass` e2e). It is **not** the only route into a tenant (D1).
- Per-tenant DEK tables exist under forced RLS. KMS vitest passed.
- All 34 e2e suites pass. Scorecard composite 5.7, reproduced.

## Claims I could not verify

- That no tenant route leaks through query-string or body ids, or for non-admin roles.
  The shipped fuzzer does not test this, and my extended run was not completed.
- That routes taking a user id (`/api/admin/users/:userId`,
  `/api/auth/admin/school/users/:userId`, `/api/auth/sessions/:sessionId`) refuse
  another tenant's user. Those ids are never fuzzed.
- That face templates are actually sealed under per-tenant DEKs in a live flow. 0
  templates were present, and only unit tests show it.
- Tenant-checked storage keys beyond the unit tests (`tenantKeys.test.ts`).
- That no SQL injection exists anywhere. I sampled interpolated queries only, and given
  D4 this matters.
- The account-takeover path through `PATCH /api/superadmin/users/:userId` (D1, second
  path).
- The docs (`2026-10-02-adopt-rls.md`, threat model, `findings.md`): I read them only for
  the claims listed above, not checked line by line.
- Any CI-dependent gate, because no CI run exists.
- `SECURITY_CREDENTIAL_ROTATION.md` content, not read by instruction.
