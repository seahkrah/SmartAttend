# Backend scripts

| Script | What it does |
|---|---|
| `run-all-e2e.sh` | Reseeds both platforms, runs every API suite, writes per-suite results to `$E2E_RESULTS` (read by `scripts/scorecard`). |
| `validate-sql.mjs` | Hands every static SQL literal to PostgreSQL's parser against the live schema. Needs `DATABASE_URL`. |
| `load-test.mjs` | Latency baseline (p50/p95/max) for the busiest API calls. |
| `rotate-credentials.mjs` | Rotates application account passwords; see `SECURITY_CREDENTIAL_ROTATION.md`. |
| `tfjs-native.mjs` | Makes the native TensorFlow binding load, especially on Windows. |

Migrations are applied only by `npx tsx src/db/migrate.ts`. There is no
script that deletes rows from the `migrations` ledger: one used to exist
(`cleanup-migrations.*`), and re-running `001_init_schema.sql` over a live
schema is not a repair. If a migration fails, it rolls back on its own and can
be retried once fixed.

`npx tsx src/scripts/checkLedgerUpgrade.ts` (CI only, never production) proves
that a database migrated under the old duplicated migration names upgrades
without re-running anything; see `src/db/migrationLedger.ts`.
