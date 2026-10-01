# Owner actions

Things only the repository owner can do. Each one either blocks work or caps a
scorecard dimension (see the ceiling rule in `scripts/scorecard/rubric.yml`).
Mark an item done by changing its state and adding the date; add evidence
files under `docs/scorecard/evidence/` where one is named.

| ID | Action | Blocks / caps | State |
|---|---|---|---|
| OA-1 | **Rotate every credential** in `SECURITY_CREDENTIAL_ROTATION.md` (application accounts, both PostgreSQL passwords, anything that reused them). Then run the purge in `docs/security/history-purge-plan.md` and authorise the force-push. | Full-history secret scanning in CI; finding 1 | Open |
| OA-2 | Confirm the tracked `.env.development`, `.env.production`, `.env.staging` (root) and `apps/backend/.env.development` hold placeholders only. If any holds a real secret, rotate it and add it to OA-1's purge list. | Finding 2 | Open |
| OA-3 | Start Docker Desktop on the development machine, or provide another PostgreSQL 16 for local runs. Phase 0 could not run the e2e suites locally; CI is the record until then. | Local e2e verification | Open |
| OA-4 | Independent penetration test; save the report as `docs/scorecard/evidence/pentest-report.pdf` (or `.md`). | Caps dimensions 1, 2, 4 at 8.5 | Open |
| OA-5 | ISO/IEC 30107-3 presentation-attack-detection lab test of face matching; report as `docs/scorecard/evidence/iso30107-3-pad-report.*`. | Caps dimension 5 at 8.5 | Open |
| OA-6 | SOC 2 / ISO 27001 report, or a formal gap assessment; `docs/scorecard/evidence/soc2-or-iso27001-assessment.*`. | Caps dimension 13 at 8.5 | Open |
| OA-7 | 30 days of production SLO data; `docs/scorecard/evidence/production-slo-30d.*`. | Caps dimension 9 at 8.5 | Open |
| OA-8 | Third-party accounts and keys when their phase arrives: SMS provider, mobile-money merchant, KMS, SSO test tenants, push, error tracking, hosting. | Phases 2, 4, 5, 7, 9 | Open |
| OA-9 | Written statutory schedules: Liberia PAYE bands, NASSCORP rates, MoE census and WAEC export formats, data-protection law specifics. Nothing is invented; live use stays blocked behind the assumption ledger. | Phase 7 payroll and exports | Open |
| OA-10 | A licensed, consented face dataset for the evaluation harness (`scripts/face-eval/`), with provenance. | Dimension 5 face-eval gate | Open |
| OA-11 | Decide whether to run the app-wide Prettier reformat once `feat/grade-school-classes` merges (see `docs/decisions/2026-10-01-phase-0-tooling-dependencies.md`). | Dimension 10 prettier gate | Open |
