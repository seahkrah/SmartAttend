# Threat model: CI, supply chain and migration ordering (Phase 0)

Scope: `.github/workflows/ci.yml`, dependency manifests, the migration
ledger rename (`apps/backend/src/db/migrationLedger.ts`), and the scorecard.

| STRIDE | Threat | Mitigation in Phase 0 | Residual |
|---|---|---|---|
| Spoofing | A pull request runs workflow steps with repository secrets. | The workflow holds no secrets: the biometric key is generated per run, the JWT secret is a labelled CI value, and the database is a throwaway service container. | None while CI stays secret-free. Keep it that way: deploy credentials belong in a separate, protected workflow. |
| Tampering | A malicious or compromised dependency. | Lockfiles with `npm ci`; `npm audit` fails on high/critical; Dependabot; Trivy scans the built images; SBOM published per build. | Images are not signed (no registry yet). Third-party actions are pinned by major tag, not by SHA. |
| Tampering | A renumbered migration re-runs on an existing database and rewrites schema or data. | `reconcileLedger()` renames ledger rows in one transaction before comparison; `checkLedgerUpgrade.ts` proves it in CI; the lint refuses repeated prefixes. | An operator who deploys files without running `migrate.ts` sees pending migrations. The readiness check maps old names, so it does not fail spuriously. |
| Repudiation | A change to scoring weights quietly raises a score. | `run.mjs` refuses a rubric whose weights do not total 100 or whose foundation weights differ from the baseline; scorecards are committed, so their history is in git. | The independent audit pass is the check on gate *meaning*. |
| Information disclosure | A secret is committed again. | gitleaks on the working tree and on each push's commits in CI, plus a pre-commit hook. | Full-history scanning waits for the purge (OA-1), because history already holds known secrets. |
| Denial of service | A lint or scan step that fails on noise blocks every merge. | Lint errors only on bug-finding rules, warnings ratcheted; audit fails on high/critical only; Trivy ignores unfixed vulnerabilities. | Semgrep's first CI run may surface ERROR findings that need triage. |
| Elevation of privilege | `checkLedgerUpgrade.ts` pointed at production rewrites the ledger. | It refuses `NODE_ENV=production` and only restores the names it changes. | Never run it outside CI. |
