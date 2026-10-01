# Independent audit: Phase 0

Date: 2026-10-01. Branch `feat/hardening`, HEAD `f09ae4a`, commits `294197b..HEAD`.
Auditor: independent sub-agent. Instruction followed: assume the implementer
is overstating; use only the repository; run the gates; attack; rate; list
what could not be verified.

Scores are in [audit-phase-0.json](audit-phase-0.json). Under rule 5 of
`rubric.yml`, the runner now uses the lower of its own score and this one.

## Method

1. Read `scripts/scorecard/rubric.yml` (164 gates), `run.mjs`, `checks.mjs`
   and the two scripts under `scripts/checks/`. Parsed the rubric with the
   runner's own `yaml` library to look for parse damage.
2. Ran, from a clean tree:
   - `node scripts/scorecard/run.mjs --phase phase-0 --no-write` with
     `DATABASE_URL` pointing at the PGlite instance on 127.0.0.1:5499.
   - `cd apps/backend && npx tsc --noEmit -p tsconfig.json`
   - `npm run lint`, `npm run check:repo`
   - `npx vitest run` in `apps/backend` without a database (after PGlite went down)
   - `npm audit --omit=dev --audit-level=high` in the three workspaces
3. Rebuilt the old run order from `git ls-tree 294197b`, using the old
   migrator's rule (`*.sql`, not `*_OLD.sql`, JS default sort). Mapped it
   through `RENAMED` and compared it with today's `migrationFiles()` order.
   Used `git diff -M` to compare blob contents.
4. Read `migrationLedger.ts`, `migrate.ts`, `migrationStatus.ts`,
   `checkLedgerUpgrade.ts` and the pre-change `migrationStatus.ts`.
5. Grepped the tree (excluding `docs/archive`) for every deleted file's
   basename. Compared the old and new `package.json` scripts.
6. Read `.github/workflows/ci.yml`, `.gitleaks.toml`,
   `.pre-commit-config.yaml` and `dependabot.yml`, and parsed the workflow.
7. Attacked the tenant-context middleware and grepped for client-supplied
   tenant ids.

No `.env*` file and no credential file was opened.
`SECURITY_CREDENTIAL_ROTATION.md` was not read.

Environment limits: no Docker, no running API, no e2e results file. PGlite
was reachable at the start of the scorecard run. **It stopped accepting
connections during the run**, most likely during the backend unit-test gate,
which the implementer's own `baseline.json` says produces PGlite protocol
errors. Gates after that point that needed the database could not be
re-checked. I did not restart PGlite: it is not part of the repository.

## Scorecard as I ran it

My run reported composite **2.3**. The implementer's `LATEST.md` reports 2.4.
The only difference is `sql-validator` (engineering, w10). It passed for them
and failed for me with `ECONNREFUSED`, because the database had died by then.
Every other gate result matched theirs exactly.

The implementer's published scorecard does **not** overstate. It sits well
below the assessed baseline, because almost all foundation weight is in e2e
gates, and those are NOT RUN locally. The overstatement risk is in the
rubric, not in today's numbers. Most of it is in gates that a stub file would
pass (see "Weak or mis-specified gates").

## Ratings

The "rubric" column is the mechanical result of my run. The "audited" column
also withholds credit from gates that passed by grep or file-exists when the
gate's title claims a behaviour I could not check, mainly CI steps that have
never run. `feat/hardening` has no upstream and was never pushed, so no CI
run exists for any Phase 0 commit.

| # | Dimension | Rubric (my run) | Audited | Reasoning |
|---|---|---|---|---|
| 1 | tenant-isolation | 2.0 | **2.0** | `tenant-from-identity` (15) passes. I read `tenantContextMiddleware.ts:106-120`, and the header really does only select among the user's own memberships. `scoped-helpers` (5): a real 321-line helper. Nothing else verifiable: RLS is on 0 of 95 tenant tables (checked live), and there is no runtime role. |
| 2 | authn | 0.5 | **0.5** | Only `auth-unit` (5) runs here, and it passes. Every foundation gate is e2e. The 59 localStorage token uses are confirmed. |
| 3 | authz-audit | 3.5 | **3.5** | `audit-immutability-unit` (25) passed against PGlite before it died. These are real trigger tests, not skipped. `audit-checksum` (10): the migration exists, 50 lines. |
| 4 | data-protection | 6.0 | **5.5** | Verified: AES-GCM template tests (25); the doc states images are held in memory, and I found no file writes in `src/biometrics` (10); a `biometric_consents` table exists (10); `databaseSsl()` defaults to `verify` in production (10). Withheld: `secret-scan-ci` (5). The gitleaks step has never run, and I could not confirm the working-tree scan passes, given the tracked `.env.*` files (findings #2). |
| 5 | face-attendance | 1.0 | **1.0** | `pose-challenge` (10): `pose.ts` is used with `crypto.randomInt` (`service.ts:372`). Everything else is e2e or missing. |
| 6 | sms-breadth | 0.0 | **0.0** | Entirely e2e. Nothing runnable. |
| 7 | ems-breadth | 0.0 | **0.0** | Entirely e2e. Nothing runnable. |
| 8 | offline-mobile | 1.5 | **1.5** | A single viewport meta tag earns 15 of 100. The rubric awards it, so I do too, but it shows nothing about mobile capability. |
| 9 | reliability | 4.0 | **3.0** | Verified: the backup and verify-restore scripts are real (37 and 58 lines) (15); `/api/health/ready` exists (10); the metrics migration exists (5). Withheld: `image-boot-ci` (10). It greps for a CI step name, and that step has never run on this branch. |
| 10 | engineering | 5.6 | **4.2** | Verified: CI file present (10); both typechecks pass (5+5); ESLint 0 errors (5); strict is on and `tsc` passes (5); dependabot (3); `npm audit` prod passes when I ran it (2); gitleaks config files (3); migration-lint (2); repo-hygiene (2). Failed: backend unit tests (10), both locally and in the implementer's run. Withheld: `sql-validator` (10, could not re-run), `image-build` (5), `sast` (4), `container-scan` (3), `sbom` (2). Those are grep hits on CI steps that have never executed. |
| 11 | ux-a11y-i18n | 4.5 | **4.5** | `aria-` count, responsive-class count and `check-nav.mjs` all pass as specified. The first two are volume counts, not accessibility evidence. |
| 12 | integrations | 0.5 | **0.5** | `storage/backend.ts` is a real 185-line abstraction (5). The rest is e2e or missing. |
| 13 | compliance | 4.0 | **3.0** | Verified: README "Not done yet" exists and is candid (10); `docs/security/authentication.md` is 285 lines (10); the immutable-audit migration exists (10). Withheld: `credential-doc` (10). By instruction I did not open it, so I cannot confirm it documents rotation steps. |

The weighted composite of the audited scores is **2.1**. The assessed
baseline is 5.3, and the gap is almost entirely unrun e2e foundation gates.

## Weak or mis-specified gates (with fixes)

Gates that a stub or an unrelated string would pass:

| Gate | Problem | Fix |
|---|---|---|
| `tenant-from-identity` (w15, foundation) | It greps for `req.header('x-tenant-id')`, the risky operation itself. Code that trusts the header outright (`ctx.tenantId = req.header('x-tenant-id')`) would pass. | Replace with an e2e or unit test: a member of A sending `X-Tenant-Id: B` gets 403, and a superadmin's choice is checked and audited. |
| `strict-ts-backend` (w5) | It greps `"strict": true`. That passes with 519 `: any`/`as any` sites (my count; the ESLint config says 631) and with `src/tests` excluded from `tsconfig`. | Run `tsc` and also ratchet the `any` count (e.g. `@typescript-eslint/no-explicit-any` at warn with `--max-warnings`). |
| `secret-scan-ci`, `sast`, `npm-audit`, `container-scan`, `sbom`, `playwright`, `lighthouse`, `restore-schedule`, `image-boot-ci`, `image-build` | Words grepped in `.github/workflows`. A comment saying "trivy" or "semgrep" passes them. None has executed. | Score them from CI artefacts: the job conclusion for the step via the GitHub API, the SBOM file in the uploaded artefact, the SARIF output. When the CI run is not available, report NOT RUN. |
| `coverage-floor` (w2) | It greps `--coverage`. `apps/backend/vitest.config.ts:19-22` sets `lines/functions/branches/statements` directly under `coverage`. In Vitest ≥1 those belong under `coverage.thresholds`, so adding `--coverage` would pass the gate with no floor enforced. Inferred from the Vitest config schema; not executed. | Move the keys to `coverage.thresholds` and make the gate run `vitest run --coverage` and require a non-zero exit when below the floor. |
| `axe-ci` (w15) | Pattern `axe` has no word boundary. "relaxed", "maxed" or "taxes" under `apps/frontend/e2e` would pass it. | Use `@axe-core/playwright` as the pattern, or better, run the spec. |
| `printable` (w5) | `print:` matches `fingerprint:` and `blueprint:`. | `@media print|\bprint:` |
| `service-worker` (w15), `i18n` (w10), `otel`, `prometheus`, `breached-password`, `shared-rate-limit-store` | An import or one identifier passes. A no-op service worker earns 15 of offline-mobile. | Behavioural tests: the SW serves an offline shell; `/metrics` returns exposition format; a known-breached password is refused. |
| Every `type: files` gate | `fs.existsSync`, so an empty file, or even a directory, passes. Static weight that stubs can reach: reliability 88, compliance 85, ux 65, offline 50, engineering 44, data-protection 40. | Require a minimum size and required headings, or a validator per document type. At least require that the file is tracked (`git ls-files`). |
| Attestation cap | `globExists` accepts any file whose stem matches, so an empty `pentest-report.txt` lifts the 8.5 cap. | Require a signed or hashed manifest (issuer, date, scope), and a human sign-off recorded outside the implementer's control. |
| Independent-audit ceiling | Any `audit-<phase>.json` lifts the 8.5 ceiling for the dimensions it names. The implementer can write one. | Require the audit file to be committed by a different author or signed, and record its commit in the result. |
| `cross-tenant-triggers` (w10, foundation) | Counts **files**, not triggers. There are 23 `guard_same_tenant` uses in 3 files, so the gate fails even though the capability exists. It deflates the score, but it is still mis-specified. | Count occurrences (`count: occurrences`) or query `pg_trigger` live. |
| `face-doc-honest` (w10, foundation) | The doc does say what is not defended ("There is no certified presentation-attack detection", line 37), but the regex wants "does not defend/stop/protect". It deflates the score. | Widen the pattern, or check for a named "Limits" section. |
| `mobile-viewport` (w15) | One meta tag is the whole offline-mobile foundation. | Fold it into a Playwright phone-width test. |
| `e2e` gates in general | `results.tsv` is trusted with no commit, timestamp or run id. A stale or hand-written file at the default `apps/backend/.e2e-fixtures/results.tsv` (gitignored) passes every e2e gate. A partial run, where the script is killed mid-way, passes `e2e-all` (`suites: ['*']`), because only failures are checked. | Have `run-all-e2e.sh` write the commit SHA and the expected suite list. The runner should refuse a file whose SHA is not HEAD, and fail `e2e-all` when any listed suite is missing. |
| Runner, `requires` | Database availability is checked once at start-up. When the database died mid-run, `sql-validator` was reported FAIL rather than NOT RUN. | Re-probe before each `requires: [db]` gate. |
| Runner, provenance | `commit` records HEAD with no dirty flag, and grep gates read untracked files, so uncommitted stubs are credited to a commit that lacks them. The published `phase-0-2026-10-01.json` says `b70660d`, but the rubric and runner it used were only committed in `8a7a62c`. | Record `git status --porcelain` and refuse `--phase` writes from a dirty tree. Make grep and files gates consistent (tracked only). |
| Calibration claim | Commit `8a7a62c` says "a score cannot be moved by quietly editing a weight". The check only enforces total = 100 and foundation sum = baseline × 10. Weight can be moved between gates of the same kind, a gate's `kind` can be flipped, and the rubric's `baseline` is not tied to `baseline.json`. | Pin a hash of the weights per phase in the result file, and diff it against the previous phase. Assert that rubric baselines equal `baseline.json`. |
| Rubric parse damage | 20 gate titles are split at commas inside YAML flow mappings, for example `title: Students, lecturers, courses, ...` → title "Students" plus stray null keys `lecturers`, `courses`... (lines 485, 495, 522, 699, 1157, 1258 and others). The reports show truncated titles ("Signed", "CSV exports (adminApi", "Control mapping (SOC 2"). | Quote these titles, and make `run.mjs` reject unknown gate keys. |

## Phase 0 claims verified

- **Migration order is preserved exactly.** All 74 files run in the same
  order. The 14 renames are pure renames (`git diff -M`: R100, 0 lines
  changed). No other migration's committed content changed. The working-tree
  byte differences I saw are only checkout line endings.
- **Ledger rename is correct and safe for an already-migrated database.**
  `reconcileLedger` runs in one transaction. Its `UPDATE ... WHERE NOT EXISTS`
  plus `DELETE` is idempotent, and it handles a both-names-present ledger.
  Two concurrent migrators serialise on the row lock without double-renaming.
  `migrate.ts` reconciles before comparing. `migrationStatus.ts` maps old
  names for readiness.
- **The deleted files were unreferenced.** The only references outside
  `docs/archive` are `SECURITY_CREDENTIAL_ROTATION.md` and
  `history-purge-plan.md` naming `test_login.mjs` and
  `reset_superadmin_password.mjs` as leak locations, which is intended.
  `setup-superadmin.ts` is kept, and no `package.json` script was lost.
- **Strict TypeScript is on and passes.** `"strict": true` replaced three
  `false` flags. `tsc --noEmit` exits 0. No `@ts-ignore` or `@ts-nocheck` was
  added (there are none in `src`). The code changes are the claimed
  `rowCount ?? 0` guards and one `day !== null`.
- **Lint passes:** 0 errors; 45 and 59 warnings exactly at `--max-warnings`.
- **`npm run check:repo` passes:** 659 files, 74 migrations.
- **DB-free unit tests:** 56 passed, 29 failed (`ECONNREFUSED`), 32 skipped,
  117 total, matching `baseline.json`.
- **Versions:** vitest 4.1.11, vite 7.3.6. `npm audit --omit=dev
  --audit-level=high` exits 0 in all three workspaces. The frontend has 2
  moderate findings, matching findings #5.
- **Rubric totals:** 164 gates, matching the correction in `f09ae4a`. Weights
  sum to 100 and foundation sums equal the rubric baselines, which equal
  `baseline.json` "assessed".
- **CI workflow parses**, with five jobs. The new steps' syntax fits the
  pinned tools as I understand them: gitleaks v8.21.2 has the `dir` and `git`
  subcommands (added in 8.19) and `--log-opts`, `--redact`, `--no-banner`;
  Trivy 0.57.1 has `image --scanners vuln --ignore-unfixed --exit-code` and
  `--format cyclonedx`; the Semgrep `scan --config p/... --severity ERROR
  --error` form is valid. This is plausibility only; none of it was executed.
- **README "Not done yet"** is candid: no RLS, owner role, localStorage
  tokens, no web tests.

## Claims I could NOT verify

1. That any CI job passes. The branch was never pushed, there is no run, and
   there is no Docker here. This covers the supply-chain job, Trivy, SBOM,
   image boot, gitleaks and Semgrep. Whether image tags
   `zricethezav/gitleaks:v8.21.2`, `semgrep/semgrep:1.178.0` and
   `aquasec/trivy:0.57.1` exist was not checked.
2. That the gitleaks working-tree scan would pass. Tracked `.env.development`,
   `.env.production`, `.env.staging` and `SECURITY_CREDENTIAL_ROTATION.md`
   were deliberately not read, and any real secret in them fails that step.
3. That Semgrep reports no ERROR-severity findings.
4. `validate-sql`: 0 mismatches, 1171 checked. It passed in the implementer's
   run; in mine the database was gone.
5. "117 of 117 unit tests pass with PGlite": vitest exits non-zero in both
   runs, and the gate fails.
6. "Proved against a database built by the previous migrator." In CI,
   `checkLedgerUpgrade.ts` simulates this by renaming rows on a database the
   *new* migrator built. No real old-migrator database was available to me.
7. Partial e2e results in `baseline.json` (adminApi 32/0, etc.). There is no
   API here.
8. That `SECURITY_CREDENTIAL_ROTATION.md` contains rotation steps (not
   opened).
9. The provenance of the assessed baseline ("A4 of the brief"). The brief is
   not in the repository.
10. That `react-router` open redirect findings #5 is unexploitable ("no route
    builds a navigation target from user input"). I did not audit the
    frontend.

## Defects found

1. **Rubric titles corrupted by YAML flow mappings.** See
   `scripts/scorecard/rubric.yml:485, 495, 522, 699, 1157, 1258` and 14 more
   stray keys. Reports print truncated titles, and `run.mjs` does not reject
   unknown keys.
2. **The migration lint does not enforce "every prefix used once" in the
   numeric sense.** `scripts/checks/migration-lint.mjs:20,25` keys on
   `NNN[a-z]?`, so a new `008_fix.sql` beside `008a…008d` passes the lint and
   sorts *before* `008a` (`_` < `a`). That is exactly the reordering
   `migrationLedger.ts:6` says the change prevents. Fix: key on the three
   digits, allow letters only when every file in the group has one, and
   require new files to sort after the last existing one.
3. **Rollback across this change is unsafe and undocumented.** Once
   `reconcileLedger` has run, the previous image's `migrationStatus.ts` (at
   `294197b`) compares raw ledger names. It would report all 14 renamed
   migrations as pending, so `/api/health/ready` answers 503. Its
   `migrate.ts` would try to re-run them, and several contain non-idempotent
   `CREATE TRIGGER` / `CREATE TABLE` statements. There is no runbook entry.
   Fix: document a reverse-rename SQL snippet for rollback, or ship a
   forward-compatible readiness check before the rename.
4. **E2E results lack provenance** (`run.mjs:78-86, 185-198`). There is no
   SHA or timestamp check, and a partial run passes `e2e-all`.
5. **Scorecard provenance.** `run.mjs:100, 282` credits untracked work to
   HEAD with no dirty flag. The published phase-0 JSON names `b70660d`,
   which does not contain the rubric that produced it.
6. **Coverage thresholds are misplaced** in `apps/backend/vitest.config.ts:19-22`,
   so they are silently not enforced (see weak gates).
7. **Pre-existing, found by attacking tenant isolation.**
   `apps/backend/src/auth/tenantContextMiddleware.ts:154-167`: for a
   superadmin, `requireTenant` copies any `X-Tenant-Id` string into
   `req.ctx.tenantId`. It has no existence check (despite the comment "it
   must exist"), no UUID validation and no audit entry. It is the break-glass
   gap the rubric lists, but it is not mentioned in README "Not done yet".
8. **Repo hygiene gaps.** `scripts/checks/repo-hygiene.mjs:55-73` does not
   flag tracked `.env.production` or `.env.staging`, nor root `PHASE_*.md`
   specs. The gate title says "No ... phase spec files".
9. **Stale README claim.** `README.md:127` says `run-all-e2e.sh` "runs 25
   suites", but the runner lists 29 Python suites plus `tenantIsolation`.
10. **CI readability.** `.github/workflows/ci.yml:253, 258, 264, 297, 304`:
    multi-line `docker run` commands were collapsed into single lines with
    runs of spaces. They are valid shell, but hard to review.
