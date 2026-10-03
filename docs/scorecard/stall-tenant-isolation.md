# Stall: tenant isolation (dimension 1)

The loop's rule: if a dimension fails to improve over two consecutive phases,
stop adding features, find out why, and fix the cause. Tenant isolation
fell in Phase 2 and again in Phase 3.

| Phase | Implementer | Independent audit (stands) | What the audit found |
|---|---|---|---|
| 1 | 8.5 | **8.3** | A superadmin could read a tenant without break-glass. 87 tenant-to-tenant foreign keys had no same-tenant guard. The fuzz covered too little. |
| 2 | 8.5 | **7.8** | A tenant could make any account its member, then read it (self-authorised visibility). The runtime role could still write sessions. |
| 3 | 8.5 | **7.3** | One tenant's administrator could change a shared account's role and status in every tenant. |

## What did not cause it

The tenant-scoped data. In every audit the controls built for it held:

- forced row-level security on every table with `tenant_id`;
- the API running as a role that cannot bypass it;
- foreign-key guards;
- the fuzz (58,410 checks, 0 failures);
- the no-context, blind-write and identity suites.

No audit found one tenant reading or writing another's tenant rows.

## What did

Every finding that lowered the score is in the **shared layer**: rows that
belong to no single tenant, or to several at once. That means accounts,
memberships and sessions, the control plane, and the platform's own tables.
Each phase hardened the part of that layer the phase was about. Nothing ever
enumerated the layer as a whole and decided each part, as Phase 1 did for
tenant tables. So each audit found the next undecided part.

There were three ways in, all of the same kind:

1. **Writes through shared rows.** The fuzz asks whether A can reach B's
   rows. It never asked whether A can change a row that B also sees: an
   account (Phase 3, F1), a membership that grants visibility (Phase 2, F1),
   a session (Phase 2, F2).
2. **Checks that row-level security made blind.** Code in A's context that
   asks a cross-tenant question ("does this person belong anywhere else?")
   gets "no" from RLS and passes silently. Three such checks had existed
   since before Phase 1.
3. **Shared tables with no decision at all.** Found while diagnosing this
   stall: the runtime role could INSERT, UPDATE and DELETE fifteen
   platform-wide tables under no policy. These include `tenants`, `roles`,
   `platforms` and the role permission matrix. SQL injected in any tenant's
   request could rename another school, or change what a role may do in
   every tenant. No audit had reported it yet. It would have been the next
   finding.

## The fix: decide the shared layer, and keep it decided

- **Platform tables (migration 086).** The runtime role's writes on the
  fifteen tables are revoked; the application writes them only on the system
  pool. `tenants` stays writable because the school and corporate entity
  triggers sync into it as the caller. It is now under a policy: anyone
  reads, a tenant writes only its own row, and only the control plane creates
  or deletes one.
- **A coverage check that makes the next one a decision, not a find.**
  `identityIsolation` now fails if the runtime role can write any table that
  is not under forced row-level security with a policy, unless the table is
  listed with its reason. The list is empty today. It was shown failing with
  one write granted back. It works like the Phase 2 check for tables that
  name an account.
- **Shared accounts (Phase 3, migrations 083 to 085).** An account with a
  live membership in another tenant keeps its role, status and details,
  whatever one tenant does, enforced by the database.
- **Blind checks.** The three found are fixed (`memberElsewhere`, on the
  system pool). Searched for more: every query on `user_tenant_memberships`
  outside the system pool. The rest ask about the caller's own tenant, where
  RLS gives the right answer.

## What would still lower the score, as far as I can see

- Handler rules (56 routes) that are written down but only partly tested.
- Shared rows written through the API rather than SQL. The coverage check
  decides the tables, but the fuzz still has no "shared account" case: an
  account in A and B, every A route called with its id, its row compared
  afterwards. That is the next step for this dimension.
- The pentest cap (8.5, owner action OA-4), which no change here can lift.

The next audit should find the shared layer decided. If it still finds
cross-tenant effects, they will come from the API case above.
