# Response to the Phase 1 independent audit

The audit is [audit-phase-1.md](audit-phase-1.md), by an agent that had not
seen the implementer's reasoning. It reproduced the implementer's scorecard
exactly (composite 5.7), confirmed the RLS claims live, and then found a way
around break-glass. Its scores were lower on four dimensions: tenant
isolation (8.3 against 8.5), reliability (3.0 against 4.0), engineering (6.9
against 7.4) and compliance (3.0 against 4.0). By rule 3.4 those lower
scores stand for Phase 1. The causes were fixed before the phase closed, as
follows.

## Defects

| # | Audit finding | Action |
|---|---|---|
| 1 | **High: break-glass bypass.** With no grant, a superadmin appoints a tenant administrator with `handover: true`, takes the setup link, signs in and reads the tenant. Changing a tenant user's email and then resetting the password is a second route. | Fixed (findings #19). For a tenant in use (any active member), a handed-over link on appointment or re-issue needs an open grant. So does an email change on any tenant account. Each is logged under the grant and written, as a required write, to the tenant's trail. Onboarding a new, empty tenant still hands its first link over without a grant, and the new tenant's trail records it. `breakGlass.e2e.py` tests both routes with and without a grant (32 checks); `accountSecurity` was updated, since its deputy-head appointment into populated school A was exactly the bypass. |
| 2 | Runtime role can forge or delete break-glass grants and access-log rows. | Fixed (migration 073, findings #20): grants are read-only to the runtime role, the log is insert-only, and data keys cannot be deleted by it. Asserted in `rlsNoContext`. |
| 3 | 87 foreign keys between tenant tables without a same-tenant guard. | Fixed (migration 073, findings #21): `app_apply_same_tenant_guards()` generates guards from the catalog; 115 of 115 are covered. Gate `cross-tenant-triggers` is now this coverage check, and was shown to fail with one guard dropped. |
| 4 | SQL injection could set `app.tenant_id`; the lint missed `set_config($1, …)` and `SET SESSION`. | The lint now refuses any `set_config(`, `SET/RESET [SESSION|LOCAL] app.*`, and `withTenant` outside the tenant middleware (canary checked). The limit itself is stated in the ADR: RLS backs up correct code, it is not an injection defence (findings #22). |
| 5 | Tables without `tenant_id`, including `users` with password hashes, have no tenant boundary for the runtime role. | Agreed and re-rated **High** (findings #17). Not fixed in Phase 1: it is identity-layer work and is the first item of Phase 2. README "Not done yet" says so. |
| 6 | Low: superadmin router on the system pool lists every tenant's users; KMS falls back silently; the tenant-visible break-glass record was best-effort. | The router stays platform-wide by design (findings #23). The API now warns at start when templates use the global key. Writes to the tenant's trail for break-glass are required: a grant whose opening cannot be recorded is closed and refused. |

## Weak gates

| Gate | Audit said | Now |
|---|---|---|
| `runtime-role` | Checked the scorecard's `APP_DATABASE_URL`, not the API's role, and ignored `jjelotech_system` membership. | The API's pools connect with `application_name` `jjelotech-api` / `jjelotech-api-system`. The gate reads `pg_stat_activity` for the API's real role and fails on superuser, BYPASSRLS, ownership or `jjelotech_system` membership (shown failing with the API run as the owner). CI starts an API in the scorecard job for it. |
| `route-fuzzer` | Path parameters only, `{}` bodies, two admin callers, no ids from tables without `tenant_id`. | Every route (538), B's ids also in query strings and JSON bodies under 48 id names, five callers (two admins, a lecturer, HR, an employee), and B's user ids. A difference from the nonexistent-id answer must persist on a repeat to count, which separates volatile and stateful answers from oracles. |
| `cross-tenant-triggers` | Counted function-name occurrences. | Coverage of every reference by a guard (above). |
| `rls-forced` | Would pass `USING (true)`. | Also requires every policy on a tenant table to be the tenant policy. |
| `raw-query-lint` | Title claimed what it does not check. | Title says what it checks; checks extended (above). |
| `break-glass` | Tested only the `X-Tenant-Id` path. | Tests the hand-over and email-change paths. |
| `no-context-no-rows` | Sampled six tables. | Every tenant table holding A's rows. |
| `image-boot-ci`, `image-build` | Grepped a CI step. | `ci-job` gates on the `images` job's result in the same run. |

## A finding the wider fuzzer produced, and its cause

Injecting B's ids into query strings showed tenant A's `/api/metrics/*`
answers containing B's ids. It was not B's data: the latency middleware
recorded each request's raw path, so A's own metrics held every id A had
typed, including B's ones it was refused. Metrics now record the matched
route pattern (`/api/school/students/:studentId`), which also stops one
series per row id.

## Not verified by the audit, still open

- **CI-only gates.** Now run on every push. The scorecard job credits them
  from each job's result.
- **Face templates sealed under per-tenant keys in a live flow.** The e2e
  run creates the tenants' data keys through enrolment; the suite then
  withdraws consent, which removes the templates.
- **Absence of SQL injection.** The defence is parameterised SQL, checked
  by validate-sql and Semgrep; no claim beyond that is made.
