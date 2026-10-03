# Independent audit: Phase 2 (identity and session hardening)

Date: 2026-10-02. Branch `feat/hardening`, HEAD `7933aca`, Phase 2 commits
`b041b98..7933aca` (10 commits). Auditor: independent sub-agent. Instruction
followed verbatim: "Assume the implementer is overstating. Using only the
repository, run the gates, attack the system, and rate each dimension. List
every claim you could not verify."

Scores are in [audit-phase-2.json](audit-phase-2.json). Under rule 5 of
`rubric.yml` the runner uses the lower of its own score and this one. My
weight-averaged composite is about **5.5** (the implementer's is 5.8).

## Method

1. Read the Phase 2 migrations (074–080), `auth/cookies.ts`, `auth/middleware.ts`,
   `auth/stepUp.ts`, `auth/passkeys.ts`, `auth/mfa.ts`, `auth/sso/{oidc,saml,service}.ts`,
   `routes/{auth,mfa,passkeys,sso,superadmin,adminTenant,schoolAdmin,guardians,audit}.ts`,
   `services/{auditChain,auditStream}.ts`, `scripts/verifyAuditChain.ts`,
   `security/{outbound,rateLimitStore,httpSecurity}.ts`, `auth/breachedPassword.ts`,
   `auth/tenantContextMiddleware.ts`, `auth/sessions.ts`, the frontend HTTP layer,
   the Phase 2 threat model, `findings.md`, `deployment.md`, and `rubric.yml`.
2. Started the API against the throwaway database (`stack.sh up`) and ran the full
   e2e runner (`scripts/run-all-e2e.sh`) at `7933aca`. **All 42 suites pass** —
   `csrf` (34), `refreshReuse` (16), `webauthn` (34), `sso` (49),
   `sessionManagement` (26), `auditChain` (21), `auditExport` (23),
   `identityIsolation` (31), `rlsNoContext` (234), `crossTenantFuzz` (58,410),
   `breakGlass` (32), `accountSecurity` (106), and the rest. The one red line in a
   combined run was `accessRequestsApi` (1 of 24: a public bot-trap expecting 200
   got 429), which reproduced as a pass in isolation — it is a shared-rate-limit
   artifact of my own earlier probing, not a Phase 2 regression.
3. Ran the check/cmd gates directly: `rlsCoverage` (pass), `runtimeRole` (pass),
   `sameTenantGuards`/cross-tenant-triggers (pass, 115 references), `no-raw-query.mjs`
   (ok, 167 files), and `node scripts/checks/permission-coverage.mjs` (**error:
   the script does not exist**).
4. Attacked the system as the runtime role (`APP_DATABASE_URL`,
   `set_config('app.tenant_id',…)`) and over HTTP, and tested the SSRF filter in
   isolation. Details below. I did not open any `.env*` file.

The single `run.mjs --phase phase-2` invocation reported every e2e-backed gate as
NOT-RUN, because the working tree carries the uncommitted `docs/scorecard/LATEST.md`
edit, so the results file is stamped `dirty=true` and the runner ignores it. I
therefore confirmed each e2e suite directly (step 2) and each check/cmd gate
individually (step 3). With a clean tree the committed `phase-2-2026-10-02.json`
gate statuses match what I observed, so composite 5.8 is reproducible mechanically.

## Ratings

| # | Dimension | Implementer | Audited | Reasoning |
|---|---|---|---|---|
| 1 | tenant-isolation | 8.5 | **7.8** | Forced RLS now covers identity/credential tables; `password_hash` is column-revoked (a real hard boundary, holds against raw SQL), `auth_failed_logins` revoked, `audit_chain_heads` DELETE revoked, system-only tables correct, 115 FK guards, fuzzer 58,410/58,410. Withheld: the `users`/credential RLS predicate is self-authorizable by the runtime role (F1), and the runtime role retains `auth_sessions` writes despite the threat model saying otherwise (F2). Pentest-capped at 8.5; held at 7.8. |
| 2 | authn | 8.5 | **7.5** | Every target gate passes with substantive suites (cookies httpOnly/SameSite=Strict + HMAC CSRF + Origin; refresh rotation with reuse-detection and family revoke; passkeys UV-required, clone/replay/cross-user blocked; step-up on sensitive routes; MFA forced for privileged roles outside local; k-anonymity breach check). Withheld for a reachable SSRF-filter bypass exercised through the SSO and audit-stream code (F3). Pentest-capped; held at 7.5. |
| 3 | authz-audit | 8.5 | **7.8** | The audit hash chain is genuinely strong and independently verified (gap/link/content/head/checkpoint detection, the verifier CLI's exit codes, export that checks out without the DB, signed at-least-once streaming). Withheld: `permission-map` is a broken gate pointing at a missing script, so "every route declares a permission" is neither enforced nor verified (F4); `escalation-idor` names an absent suite. No-independent-audit cap 8.5; held at 7.8. |
| 4 | data-protection | 6.5 | **6.5** | Phase 2 seals SSO client secrets and audit-stream secrets under per-tenant DEKs (verified pass). `envelope-encryption`, `retention`, `dsr`, `dpia`, `residency` still fail/absent. SSRF (F3) touches outbound data paths. Unchanged from Phase 1. |
| 5 | face-attendance | 6.0 | **6.0** | No Phase 2 change; foundation e2e pass. |
| 6 | sms-breadth | 5.0 | **5.0** | No Phase 2 change. |
| 7 | ems-breadth | 4.5 | **4.5** | No Phase 2 change. |
| 8 | offline-mobile | 1.5 | **1.5** | No Phase 2 change. |
| 9 | reliability | 3.0 | **3.0** | `verifyAuditChain` is not scheduled (`deployment.md` admits it); CI-dependent gates not runnable here. Same as Phase 1. |
| 10 | engineering | 6.9 | **6.9** | Typechecks/unit tests/lint pass; `prettier`, `frontend-tests`, `playwright` still fail/not-run; a referenced check script is missing (F4). Unchanged. |
| 11 | ux-a11y-i18n | 4.5 | **4.5** | No Phase 2 change. |
| 12 | integrations | 3.0 | **3.0** | No new integration gates; SSRF (F3) is an outbound-integration concern. |
| 13 | compliance | 4.0 | **3.0** | A Phase 2 threat model and `findings.md` exist, but no independent attestation (SOC 2 / ISO, PAD) is committed, and the threat model contains a factual control error (F2). Held at the Phase 1 audited value. |

## Attacks tried

| # | Attack | Result |
|---|---|---|
| A1 | Runtime role in tenant B reads another tenant's `users` / `password_hash` / `auth_sessions` / `user_mfa` / `webauthn_credentials` / `tenant_sso_providers` with no membership | Refused by RLS (0 rows); `password_hash` SELECT and `auth_failed_logins` denied by column/table privilege |
| A2 | Runtime role in B **plants** a `school_user_approvals`/`school_user_associations` row for its own tenant, then reads an A-only admin | **Succeeded** (F1): the planted row satisfies the RLS predicate, A's admin row (minus `password_hash`) and its 8 sessions become readable; `password_hash` still unreadable |
| A3 | Runtime role in B updates/deletes another visible user's `auth_sessions` | **Succeeded at the DB level** (F2): deleted A's admin's sessions (rowCount 2); `UPDATE`/`DELETE`/`INSERT` on `auth_sessions` are all granted, contradicting the threat model |
| A4 | SSRF: outbound filter against IPv6-mapped / NAT64 / 6to4 literals | **Bypassed** (F3): `https://[::ffff:127.0.0.1]:5000` reached the loopback API; `::ffff:169.254.169.254`, `::ffff:10.x`, `64:ff9b::/96`, `2002::/16` all pass `checkOutboundUrl` with `OUTBOUND_ALLOW_PRIVATE` unset |
| A5 | SSO cross-tenant sign-in: a provider of B signs anyone into A | Refused: `matchAccount` binds the lookup to the provider's own `tenant_id` (service.ts:148-163). No cross-tenant sign-in |
| A6 | SSO forged/unsigned/rogue-key/other-issuer/other-audience/expired/stale-nonce ID tokens and SAML assertions | Refused (verified by the `sso` suite's 49 checks and by reading oidc.ts/saml.ts: JWKS pin, RS256/ES256 only, issuer/audience/nonce checks; SAML asserts issuer in code because the library does not on that path) |
| A7 | Open redirect via SSO routes | None found: redirects go only to `appUrl()` or to provider URLs validated at provider creation |
| A8 | CSRF on cookie sessions: missing/wrong token, other origin, another session's token, refresh/logout | Refused (403 CSRF) across the board (`csrf` suite, cookies.ts:128-134) |
| A9 | Refresh-token reuse / race | Correct: single-statement rotation, 30 s race grace (409), reuse outside grace revokes the session family (sessions.ts:86-121) |
| A10 | Passkey replay / clone / cross-user | Refused: challenge spent before verification, counter must increase, assertion must belong to the stepping-up user (passkeys.ts) |
| A11 | Step-up bypass on sensitive routes | Covered: `requireRecentAuth` on passkey delete/register, SSO add/delete, audit-stream add/delete, break-glass, tenant-admin create/invite, user email change, access resets |
| A12 | Audit-chain tamper the verifier misses | None found: edit→`content`, delete→`gap`+`link`, end-truncation+head-rewind caught by the checkpoint; `audit_chain_heads` DELETE revoked |

## Defects

**F1 (Medium): the identity/credential RLS predicate is self-authorizable by the
runtime role.** `migrations/074_identity_under_rls.sql` makes a `users` row visible
when `app_user_visible(id)` holds, which is satisfied by a membership or approval
row for the tenant in force. The same migration grants the runtime role
`INSERT` on `school_user_associations`, `corporate_user_associations`,
`school_user_approvals` and `corporate_user_approvals`, whose RLS `WITH CHECK`
only requires the tenant column to equal the tenant in force. So a party running
SQL as the runtime role in tenant B can `INSERT` an approval row naming any
account, after which that account's `users` row (minus `password_hash`),
`auth_sessions`, `user_mfa` and `webauthn_credentials` become readable. Verified:
A's admin was invisible before (0 rows) and fully visible after the planted row,
with 8 sessions readable. This is reachable only by someone who can run arbitrary
SQL as the runtime role (SQL injection, or the DB credentials), which the Phase 2
ADR frames as a backstop rather than an injection defence — but the threat model's
prose ("visible … only for … a member of the tenant in force") understates it,
because the runtime role can *make* any account a member. `password_hash` remains
a genuine hard boundary (column privilege, holds here). Fix: write membership and
approval rows only from the system pool, or make `app_user_visible` consult a
signed/attested membership the runtime role cannot forge.

**F2 (Medium): the threat model's "No privilege on `auth_sessions`" is false.**
`docs/security/threat-models/phase-2-identity-and-sessions.md:51` lists, as the
mitigation for "Tampering with sessions by the runtime role", "No privilege on
`auth_sessions` for the runtime role." In fact `jjelotech_api` holds
`INSERT`/`UPDATE`/`DELETE` on `auth_sessions` (confirmed by
`has_table_privilege`), and I deleted tenant A's admin's sessions from tenant B's
context (rowCount 2). Migration 074 revoked `password_hash`, `auth_failed_logins`
and `audit_chain_heads` DELETE, but not `auth_sessions` writes. A runtime-role
attacker who makes an account visible (F1) can therefore revoke or forge that
account's sessions. Fix: `REVOKE INSERT, UPDATE, DELETE ON auth_sessions FROM
jjelotech_app` (all writers already use the system pool via `sessions.ts`/`stepUp.ts`),
or correct the threat model to state the residual.

**F3 (Medium): SSRF outbound filter is bypassable with IPv6-mapped / NAT64 /
6to4 literals.** `security/outbound.ts:20-29` `isPrivateAddress` only detects an
IPv4-mapped address when it is in dotted form (`::ffff:127.0.0.1`); Node
normalises the URL host to hex (`::ffff:7f00:1`), and `slice(7)` then yields
`7f00:1`, which matches none of the private checks. NAT64 (`64:ff9b::/96`) and
6to4 (`2002::/16`) embeddings of private IPv4 are likewise not classified. With
`OUTBOUND_ALLOW_PRIVATE` unset (production-like), `checkOutboundUrl` accepted
`https://[::ffff:127.0.0.1]:5000`, `https://[::ffff:169.254.169.254]/…` and
`https://[::ffff:10.0.0.1]/`, and a `fetch` to the first reached the loopback
`/api/health`. Reachable server-side through audit-stream delivery
(`services/auditStream.ts:97-106`, a repeated POST to a tenant-supplied URL) and
OIDC discovery/JWKS/token fetches (`auth/sso/oidc.ts:31,105`). The threat model
(phase-2…md:47) lists only DNS-rebinding as the residual; this bypass is
undisclosed. Fix: after resolving, re-parse each address and normalise
IPv4-mapped/NAT64/6to4 to the embedded IPv4 before the private-range test, and
reject non-global IPv6 scopes generally.

**F4 (Low): a broken authz gate and an absent IDOR suite.** The rubric's
`permission-map` gate runs `node scripts/checks/permission-coverage.mjs`, but that
script does not exist in the repository, so the gate errors on every run and can
never pass; its title "Every route declares a permission" describes an
enforcement that is not present. `escalation-idor` names a `privilegeEscalation`
suite that is not in `run-all-e2e.sh` and does not exist. Both are correctly shown
failing on the implementer's own scorecard, but they mean dimension 3 has no
route-level permission-coverage check and no privilege-escalation/IDOR suite.

**F5 (Low, by design): SSO lets a tenant impersonate its own members, and MFA may
be delegated.** `auth/sso/service.ts:148-163` accepts any email the tenant's own
IdP asserts as verified (subject to an optional domain allow-list), so a tenant
administrator who configures SSO can sign in as any active member of that tenant
without the member's credential. `matchAccount` binds to the provider's tenant, so
this is not cross-tenant — but a member who belongs to several tenants can then be
driven into the others via `X-Tenant-Id`. `trust_idp_mfa` (service.ts:192)
additionally lets the IdP's own factor stand in for the account's TOTP. Both are
defensible SSO trust choices; noted so the trust boundary is explicit.

## Weak or mis-specified gates

- **`permission-map`** (dim 3): points at a non-existent script (F4); tests
  nothing and cannot pass. Fix: ship the script, or replace with a real
  route-inventory-vs-permission-map check.
- **`escalation-idor`** (dim 3): references an absent suite; always fails (F4).
- **`rls-forced` / `rlsCoverage`**: verifies RLS is enabled, forced and policied,
  which is true — but it does not test that the identity policies actually confine
  the runtime role, which they do not (F1). The title implies more than the check
  proves for the new identity tables.
- **`breached-password`** and **`shared-rate-limit-store`** (dim 2): grep gates
  satisfied by the presence of `breachedPassword`/`PostgresRateLimitStore` in
  source. They do not prove the breach check is wired into every password-setting
  path (it is, at `routes/auth.ts:87,392,564`), nor that it runs outside
  production (it is off unless `PASSWORD_BREACH_CHECK=range`).
- **`route-fuzzer`** (dim 1): now runs `crossTenantFuzz` (58,410 checks, strong),
  but candidates are still drawn from tables with a tenant column, so it does not
  probe routes with a *planted*-visible identity id (the F1 class).

## Claims verified

- Cookie sessions: httpOnly, `SameSite=Strict`, access cookie scoped to `/api`,
  refresh to `/api/auth`; HMAC-of-session-id CSRF token, Origin check, Bearer
  clients exempt; no access/refresh token in frontend `localStorage` (only a
  theme key and a `signed_in` hint).
- Refresh rotation with reuse detection revoking the family; device/session list
  and per-device + global remote sign-out; step-up on the sensitive routes listed
  above.
- WebAuthn passkeys: UV required, single-use challenges, counter clone-detection,
  cross-user assertions refused, suspended accounts refused.
- Two-factor required for privileged roles outside local (`mfa.ts` `requiredRoles`,
  enforced via the access-token `mfa:'setup'` claim and `allowedDuringSetup`).
- Per-tenant hash-chained audit log, verifier CLI, export, and signed at-least-once
  streaming; SSO via OIDC (PKCE, JWKS pin, RS256/ES256, issuer/audience/nonce) and
  SAML (signed assertions, issuer checked in code, InResponseTo, single-use state).
- `password_hash`, `auth_failed_logins`, and `audit_chain_heads` DELETE are
  genuinely out of the runtime role's reach.
- All 42 e2e suites pass at `7933aca`.

## Claims I could not verify

- No independent penetration test exists; dimensions 1, 2 and 4 are pentest-capped
  at 8.5 regardless of score.
- CI-dependent gates (`image-build`, `image-boot-ci`, `playwright`,
  `frontend-tests`, `prettier`): no CI run was readable in this environment, same
  as Phase 0/1.
- The scorecard composite via a single `run.mjs` call: e2e gates read NOT-RUN
  because the tree carries the uncommitted `LATEST.md` edit. I verified every e2e
  suite and check/cmd gate directly instead; composite 5.8 is reproducible on a
  clean tree.
- That no SQL injection exists anywhere. I sampled interpolated queries. Given F1
  and F2, any injection as the runtime role yields cross-tenant reads of identity
  rows and session tampering, so the identity-RLS and session boundaries rest on
  injection-free code, not on the database.
- SAML beyond the suite's self-run IdP: XML-signature-wrapping and comment-splitting
  attacks were not independently fuzzed (the suite tests unsigned, edited,
  rogue-key, other-issuer, other-audience and expired assertions).
- The DNS-rebinding residual the threat model discloses was not exercised.
- `.env*` contents, not read by instruction.
