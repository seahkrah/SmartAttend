# Response to the Phase 0 independent audit

The audit is [audit-phase-0.md](audit-phase-0.md), written by a separate
agent that had not seen the implementer's reasoning. Its scores
([audit-phase-0.json](audit-phase-0.json)) were lower than the implementer's
by 0.3 or more on four dimensions: reliability (3.0 against 4.0), engineering
(4.2 against 6.6), compliance (3.0 against 4.0) and data protection (5.5
against 6.0). By rule 3.4 those lower scores stand: `run.mjs` takes the
minimum whenever the audit file exists. The causes were fixed before Phase 0
closed.

| # | Audit finding | Action |
|---|---|---|
| 1 | 20 rubric titles split at commas inside YAML flow mappings, becoming stray keys. | Fixed. The rubric is block-style YAML with every title intact, and `run.mjs` now rejects any key it does not know, so this cannot recur silently. |
| 2 | Migration lint keyed on number+letter: `008_x.sql` would pass and sort before `008a`. | Fixed and tested against `008_x`, `069a_x`, `068_x` (a duplicate) and a missing `017b`. Letters belong only to the frozen legacy groups, which must be exactly as renumbered. The three pre-freeze gaps (014, 015, 019) are refused too: a file there would run in sequence on a fresh database but last on an existing one. |
| 3 | Rolling back to a pre-renumbering image is unsafe and undocumented. | Documented in `docs/operations/deployment.md`, with the reverse-rename SQL generated from `RENAMED`. |
| 4 | E2E results trusted without provenance; partial runs pass `e2e-all`; HEAD recorded without a dirty flag; untracked files counted; phase-0 JSON names a commit without the rubric. | Fixed. The runner stamps results with commit and dirty flag. The scorecard ignores results from another commit, a dirty tree or a partial run, where "partial" means missing any suite in the runner's own list. Only committed files count. A phase scorecard refuses to write from a dirty tree. The phase-0 JSON is regenerated at a commit that contains its rubric. |
| 5 | Gates a stub would pass. | Changed: `tenant-from-identity` is now an e2e gate on suites that try a foreign `X-Tenant-Id`. CI-tool gates are the new `ci-job` type, credited only when that job succeeded in the same workflow run. Code-file gates became test commands (`per-tenant-dek`, `face-worker`, `payments`, `openapi`). `files` gates need committed, non-trivial, non-placeholder files. `axe` and `print` patterns are tightened. The coverage gate runs coverage. Attestations need a committed file of at least 1 KB that no Claude-co-authored commit added. An audit counts only with its written report beside it. **Residual**, stated in the rubric header: weight can still move between gates of one kind, and some grep and files gates remain stub-passable. The audit pass is the check on that. |
| 5a | Coverage thresholds unenforced. | Confirmed and fixed. No coverage provider was installed, and the "80%" thresholds sat outside Vitest's `thresholds` key. `@vitest/coverage-v8` is installed and the floor is the measured 4% (unit tests only). CI runs the unit tests with coverage. A deliberately high threshold was shown to fail. |
| 6 | Two foundation gates under-credited real capability. | Fixed: `cross-tenant-triggers` counts occurrences (min 20), and `face-doc-honest` matches the doc's actual wording. |
| 7 | Superadmin `X-Tenant-Id` unchecked, despite the comment saying otherwise. | Fixed in part: it must be a UUID naming an existing tenant, or 404. Regression checks in `crossTenantAudit` fail on the old code and pass on the new. The audit trail for the switch is Phase 1 break-glass (finding 12). |
| 8a | Hygiene ignores tracked `.env.*` files. | Fixed: any `.env*` other than `.env.example` fails, except an explicit, commented allow-list of the five pre-existing files under review (OA-2). This surfaced a fifth one, `apps/frontend/.env.development`. |
| 8b | Root phase-spec `.md` files. | Not found: the only root Markdown files are `README.md` and `SECURITY_CREDENTIAL_ROTATION.md`. |
| 8c | README says 25 e2e suites; the runner has 30. | Fixed. |
| 8d | Multi-line `docker run` commands collapsed onto one line. | Fixed while splitting supply chain into `deps-audit`, `secret-scan` and `sast` jobs, plus a final `scorecard` job that reads every job's result. |
| 9 | "Weights cannot be quietly edited" overstated. | Agreed. `run.mjs` now also checks baselines against `baseline.json`. The remaining gaps are written into the rubric header instead of claimed away. |
| — | Could not verify any CI job passes. | True: the branch has not been pushed, so there is no CI run. Every CI-dependent gate is NOT RUN locally and earns nothing. |
| — | "117 of 117 with PGlite" unverifiable as a gate. | Correct: the tests pass, but vitest exits non-zero on PGlite's protocol errors, so the gate fails locally and is scored as failing. |
| — | "A4 of the brief" not in the repository. | The rubric now cites `docs/scorecard/baseline.json` ("assessed"), and `run.mjs` checks the rubric against it. |
