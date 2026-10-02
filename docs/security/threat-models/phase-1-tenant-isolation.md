# Threat model: tenant isolation by construction (Phase 1)

Scope: every path from an HTTP request, a background job or a script to a
tenant's rows; the database roles; and the PostgreSQL row-level security
(RLS) that backs the application's own checks.

## Assets

The rows of 95 tables that carry `tenant_id` (students, employees, grades,
fees, payroll, biometric templates, documents, audit trails), plus the views
and functions that read them.

## Today's controls (before Phase 1)

- The tenant is resolved from identity and membership, never from the client;
  `X-Tenant-Id` only selects among the caller's own memberships.
- Every one of about 1,300 query call sites adds `tenant_id = $n` by hand.
- Triggers (`guard_same_tenant`, 23 uses) refuse cross-tenant foreign keys.
- About 2,000 e2e checks include cross-tenant cases.

A single forgotten `WHERE tenant_id` breaks isolation, and nothing below the
application would notice.

## STRIDE

| Threat | Example | Phase 1 control | Residual |
|---|---|---|---|
| **Information disclosure** through a missing tenant filter | A new report query omits `tenant_id`, so school A reads school B's fees. | RLS `USING (tenant_id = app_current_tenant())` on every tenant table, `FORCE`d so the owner is subject too. The API's runtime role is not the owner, not a superuser, and `NOBYPASSRLS`. | Code running as the system role (identity, control plane, cross-tenant jobs) is not filtered. That role is used only through `runAsSystem(reason, …)` in allow-listed files, enforced by `scripts/checks/no-raw-query.mjs`. |
| Disclosure **through a view** | A view owned by the table owner reads around RLS. | Every view gets `security_invoker = true`; the RLS gate checks that none lacks it. | A view added later without it: the gate fails CI. |
| Disclosure **through a SECURITY DEFINER function** | `get_api_latency_percentiles(p_tenant_id)` runs as owner and trusts its argument. | Made `SECURITY INVOKER`; the gate refuses `SECURITY DEFINER` in `public`. | None known. |
| **Tampering**: a write into another tenant | `UPDATE … WHERE id = $1` with another tenant's id; `INSERT` with a forged `tenant_id`. | `WITH CHECK (tenant_id = app_current_tenant())`; `USING` hides the target row, so UPDATE and DELETE affect 0 rows. | — |
| **Context confusion** in the pool | A pooled connection keeps tenant A's `app.tenant_id` and serves tenant B. | The context is set on every checkout, from the request's async context, whenever it differs from what the connection holds. A connection released inside a transaction (where a rollback could undo the setting) is destroyed, not reused. | Code that issues `SET`/`RESET app.*` itself: refused by the lint. |
| **No context** | A background job or early middleware queries a tenant table before any tenant is known. | `app.tenant_id` is empty, so `app_current_tenant()` is NULL and tenant tables return no rows ("no context, no rows", tested). | A job that should be cross-tenant must say so with `runAsSystem`. |
| **Spoofing** the tenant via SQL injection | An injected `set_config('app.tenant_id', …)`. | Every statement is parameterised (validate-sql, Semgrep). RLS here backs up correct application code against omissions; it is not an injection defence. | Stated plainly in the ADR. |
| **Elevation**: the system role used casually | A route reaches for `runAsSystem` to make a query "work". | An allow-list of files in the lint, a reason string on every call, and review. | Allow-listed files can still have bugs; the audit pass reviews them. |
| **Repudiation**: superadmin cross-tenant access | A superadmin reads a school's data with no trace. | The tenant must exist (Phase 0 fix). Break-glass with reason, time limit, audit and tenant visibility comes later in Phase 1. | Until that lands, finding 12 stays open. |
| **Denial of service** | The extra `set_config` round trip on every query. | Set only when the connection's current context differs (cached per connection). | Measured in the e2e run time; `docs/operations/capacity.md` later. |
