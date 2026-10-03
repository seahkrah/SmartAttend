# Response to the Phase 2 independent audit

The audit is [audit-phase-2.md](audit-phase-2.md), by an agent that had not
seen the implementer's reasoning. It reproduced the implementer's scorecard
(composite 5.8) and verified the cookie, CSRF, refresh-rotation, passkey,
step-up and audit-chain claims live. It then found three ways around the
phase's own controls. Its scores were lower on four dimensions: tenant
isolation (7.8 against 8.5), authentication (7.5 against 8.5), authorisation
and audit (7.8 against 8.5), and compliance (3.0 against 4.0). By rule 5 of
`rubric.yml` those lower scores stand for Phase 2. The causes were fixed
before the phase closed, as follows.

## Defects

| # | Audit finding | Action |
|---|---|---|
| F1 | **Medium: the identity predicate is self-authorizable.** Who a tenant can see follows its memberships, approvals and entity administrator, which the runtime role may write for its own tenant. SQL running in B inserted an approval for one of A's administrators and then read that account and its eight sessions (never the password hash). | Fixed (migration 081, findings #28). A trigger on memberships, approvals and entity administrators refuses any account the tenant cannot already see. Linking another school's existing guardian now runs on the system pool (`authService.linkExistingAccountToSchool`), with platform-wide email checks in `emailTakenOnPlatform` and `accountsByEmail`. `identityIsolation` checks the four ways in (member, applicant, administrator, moving an existing membership). It also checks that the account stays invisible, and that a tenant can still add an account it can see. The first version of the trigger broke account creation on the plain membership tables. `adminApi`, `schoolAdminApi`, `guardiansApi`, `accountSecurity` and `admissionsApi` caught it, and it was fixed before commit. |
| F2 | **Medium: the threat model's "no privilege on `auth_sessions`" was false.** The runtime role kept INSERT, UPDATE and DELETE; the audit deleted an A administrator's sessions from B after F1. | Fixed (migration 081, findings #29). Writes are revoked. The device list and ending one's own session moved to `sessions.ts` on the system pool. The threat-model row is corrected and says it was wrong. `identityIsolation` asserts that every write is refused, in the tenant's own context too. |
| F3 | **Medium: SSRF filter bypass.** `https://[::ffff:127.0.0.1]:5000` reached the API; hex-mapped, NAT64 and 6to4 forms of private IPv4 addresses passed `checkOutboundUrl`. | Fixed (findings #30). `isPrivateAddress` parses any IPv6 literal to its bytes and judges the IPv4 address it carries: mapped (dotted or hex), compatible, NAT64 `64:ff9b::/96`, and 6to4 `2002::/16`. NAT64 local-use `64:ff9b:1::/48` and Teredo are refused outright, as is anything that does not parse. The audit's literals are unit cases in `outbound.test.ts`, with public counterparts that must still pass. DNS rebinding remains open (#26). |
| F4 | Low: `permission-map` runs a script that does not exist, and `escalation-idor` names an absent suite. | Agreed; **not fixed in Phase 2** (findings #31). Both gates keep failing honestly rather than being removed. They belong to the authorisation work, which the next-phase choice will weigh. |
| F5 | Low, by design: a tenant's own identity provider can sign in as any of that tenant's members, and `trust_idp_mfa` lets its factor stand in for the account's. | Accepted as the SSO trust boundary: a tenant that configures SSO is trusted to say who its members are. It is per tenant (`matchAccount` is bound to the provider's tenant) and off until the tenant administrator configures it. The reach the audit names is real and **not mitigated**: a member of several tenants signed in through one tenant's IdP can use their other memberships too. Restricting an SSO session to the provider's tenant would close it; that is noted for the authorisation work. Stated in the threat model's SSO row. |

## Weak gates

| Gate | Audit said | Now |
|---|---|---|
| `rls-forced` / `rlsCoverage` | Proves RLS is on, forced and policied, not that the identity policies confine the runtime role. | Unchanged as a coverage check. Confinement is now measured: `identityIsolation`, which carries the F1 and F2 regressions, is added to the `isolation-e2e` gate's suites, so a regression fails dimension 1. |
| `breached-password`, `shared-rate-limit-store` | Grep gates satisfied by a name in source. | Retitled to say that is all they check ("present in the code (grep)"). The behaviour is tested elsewhere (`breachedPassword.test.ts`, the `accountSecurity` suite), but those gates do not prove it. Replacing them with behavioural gates is left open. |
| `route-fuzzer` | Draws candidate ids only from tables with a tenant column, so it would not probe a planted-visible identity id. | Not changed. The F1 class is now closed at the database (above) and asserted in `identityIsolation`, rather than left to the fuzzer. |
| `permission-map`, `escalation-idor` | Broken / absent (F4). | Still failing; see F4. |

## Scores

The audit's lower scores stand for this phase: tenant isolation 7.8,
authentication 7.5, authorisation and audit 7.8, compliance 3.0. The
regenerated scorecard applies them. The fixes above are what the next audit
should find in place.
