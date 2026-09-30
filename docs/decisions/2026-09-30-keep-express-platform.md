# 2026-09-30 · Keep the Express platform; retire the Django rebuild

Status: **accepted** · decided by the product owner · supersedes
`2026-09-04-stack-and-greenfield.md` (on branch `feat/jjelotech-mvp`)

## Decision

The Express/TypeScript platform under `apps/` is the product. The Django
rebuild on `feat/jjelotech-mvp` is retired: it stays on its branch as
reference and is not extended.

## Why

On 2026-09-04 a greenfield Django + Postgres-RLS rebuild was chosen, with the
Express build demoted to a prototype. In practice the work went the other way:

| | Express (`apps/`) | Django (`feat/jjelotech-mvp`) |
|---|---|---|
| Commits since the decision | 59 (5–26 Sep) | 0 after 5 Sep |
| Tests | ~1,930 e2e checks, ~100 unit tests, SQL-vs-schema gate, route gates | 37 |
| Done | SMS and EMS core, fees, gradebook, guardians, payroll, 2FA, deploy stack with verified backups | Tenancy, auth, sync contract, academic structure, students (Sprint 5a of the plan) |

The rebuild's advantages were real but portable. Porting them into a
working, tested platform is weeks of work; finishing the rebuild is months.

## What the rebuild got right, and must be carried over

These were the reasons for the rebuild. They are now requirements on the
Express platform, scheduled in [../roadmap.md](../roadmap.md):

1. **K–12 structure.** Grade levels, classes/streams, class teachers. The
   Express model is tertiary-shaped (programmes, study years, lecturers,
   CGPA); a private school in Monrovia is not.
2. **Two currencies.** LRD and USD side by side, per invoice and per payment,
   with a recorded exchange rate where they meet. Today every amount defaults
   to USD.
3. **A money trail that balances.** The fees module already treats payments
   as immutable facts corrected by reversal (migration 044). What is missing
   is a double-entry ledger that proves each tenant's books balance.
4. **Works on a bad connection.** Attendance must be capturable offline and
   synced later. The web app has no offline mode today.
5. **Mobile money without an API.** Manual capture plus CSV import of wallet
   statements, matched to invoices.
6. **Paper.** Receipts, class lists and arrears statements that print and
   export as PDF.
7. **The assumption ledger.** Unverified statutory values (PAYE bands,
   NASSCORP rates, MoE census and WAEC formats, Data Protection Act detail)
   are listed with what they block, and nothing they block can go live.
   See `jjelotech/docs/assumptions.yml` on the retired branch.

## What is not carried over

- Postgres row-level security as the tenancy mechanism. The Express platform
  enforces tenancy in the API and with database triggers, verified by a
  route-by-route audit and e2e cross-tenant suites. RLS may be added later as
  defence in depth; it is not a prerequisite for the pilot.
- The Django codebase itself, Celery and the Django admin.

## Housekeeping

- The on-disk `jjelotech/` folder holds only leftovers of that branch (caches,
  a virtualenv, a build and a `.env`); it is git-ignored.
- `feat/sms-reorg-phases-0-1` (21 commits, to 4 Sep) predates this line of
  work and is to be reviewed for anything not superseded, then archived.
