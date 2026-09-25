# JjeloTech API

Express + TypeScript + PostgreSQL 16. Setup, checks and scope are in the
[repository README](../../README.md). Configuration is documented variable by
variable in [.env.example](.env.example).

- `src/routes/`: HTTP routes. Each tenant-owned router resolves the tenant
  from the session (`auth/tenantContextMiddleware.ts`).
- `src/db/migrations/`: numbered SQL migrations, applied in order by
  `src/db/migrate.ts`.
- `src/tests/`:
  - `*.e2e.py`: API suites, run by `scripts/run-all-e2e.sh`
  - `*.manual.ts`: fixtures
  - `*.test.ts`: unit tests
