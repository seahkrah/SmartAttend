# Security and engineering findings

A running register, most severe first. Each entry says what was found, how,
and its state. Fixed entries stay, so the history is visible.

| # | Severity | Finding | Found by | State |
|---|---|---|---|---|
| 1 | Critical | Plaintext credentials (superadmin and other account passwords, the PostgreSQL superuser password) are in git history. Deleting the files did not remove them. | `SECURITY_CREDENTIAL_ROTATION.md` | **Open, owner action.** Rotate first, then purge: `docs/security/history-purge-plan.md`. |
| 2 | Medium | `.env.development`, `.env.production` and `.env.staging` are tracked at the root (and `.env.development` under `apps/backend` and `apps/frontend`). Their contents were not reviewed in Phase 0. | `git ls-files` | **Open, owner action**: confirm they hold placeholders only. gitleaks in CI scans them on every push. |
| 3 | Critical (dev only) | `vitest` / `@vitest/ui` 4.0.18 inside a critical advisory range. Exposure is limited to developer machines running the test UI. | `npm audit` | Fixed: 4.1.11. |
| 4 | High (dev only) | `vite` ≤ 6.4.2 dev-server advisory. The production bundle is not affected. | `npm audit` | Fixed: vite 7. |
| 5 | Moderate | `react-router-dom` 6: open redirect through a backslash in `<Link>`/`useNavigate`; an SSR hydration issue that does not apply (client-only app). | `npm audit` | **Open.** Fix is react-router 7 (major). Interim: no route builds a navigation target from user input; to verify in Phase 2. |
| 6 | Medium | 1,043 files of `node_modules/` (root and `packages/types`) and the types package's `dist/` were committed before `.gitignore` covered them. | Phase 0 hygiene | Fixed: untracked; `scripts/checks/repo-hygiene.mjs` refuses them. |
| 7 | Medium | `scripts/cleanup-migrations.{ps1,sql}` deleted ledger rows so `001_init_schema.sql` would re-run over a live schema. | Phase 0 review | Fixed: removed. |
| 8 | Medium | Duplicate migration prefixes (006, 007, 008, 012, 017) let filenames decide schema order; four `_OLD.sql` files sat beside their replacements. | Phase 0 review | Fixed: renumbered with a ledger rename step. Proved locally on an empty database and on one built by the previous migrator; CI repeats the upgrade by rewriting a migrated ledger to the old names. The lint refuses a repeated number, a bare number beside a lettered group, new letters, and the three pre-freeze gaps. Rolling back to an older image needs the reverse rename in `docs/operations/deployment.md`. |
| 9 | Low | The pool's idle-client error handler calls `process.exit(-1)`, so a database blip takes the whole API down. It relies on the orchestrator to restart it. | Local test run | **Open.** Phase 5 (graceful degradation). |
| 10 | Low | Backend TypeScript was non-strict (`strict`, `noImplicitAny`, `strictNullChecks` off). Turning strict on found 9 unguarded nullables, mostly `rowCount`. | `tsc --strict` | Fixed: strict on, 9 sites guarded with no behaviour change. |
| 11 | Info | 45 backend and 59 frontend lint warnings (unused variables; hook dependency arrays). | ESLint | Ratcheted: `--max-warnings` fails CI if the count rises. |
| 12 | Medium | A superadmin's `X-Tenant-Id` went into the request context unchecked, although the code comment said the tenant must exist: a malformed value produced a 500 from SQL, and a made-up UUID returned 200 with empty data. Nor was the switch recorded anywhere. | Independent audit, Phase 0 | Partly fixed: the value must be a UUID naming an existing tenant, or the request is 404 (regression checks in `crossTenantAudit`, shown failing on the old code). **Open:** recording the switch in a tenant-visible audit trail, which is the break-glass gate in Phase 1. |
