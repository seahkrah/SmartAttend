# Change notes

The engineering decisions made while carrying out the JjeloTech Systems project
brief, with the reasoning behind each, so they can be reviewed. Newest phase first.

---

## Phase 1: Guardians and the parent portal (2026-09-26)

**Goal:** close the largest gap between the SMS and comparable products. The school
records guardians, links them to students with per-child access, tells them about
absences, fees and results, and gives them a read-only portal.
Feature documentation: [features/guardians.md](features/guardians.md).

### What changed

| Area | Change |
|---|---|
| Database | `062_guardians.sql`: `guardian` role (school platform); `guardians` and `guardian_students` tables with `NOT NULL tenant_id`; `guard_same_tenant()` triggers; one primary contact per student; a guardian must have an email or a phone. |
| API | `routes/guardians.ts` (`/api/guardians`, school admins): record, list/search, edit, remove, link/unlink, per-link access, portal invitation. `routes/guardianPortal.ts` (`/api/guardian`, guardians): children, overview, attendance, timetable, results, fees. |
| Shared logic | `services/studentRecordsService.ts`: transcript, fee statement and attendance summaries built once. The gradebook and fees routers now call it. Their responses are unchanged. |
| Notifications | `guardian.absence`, `guardian.invoice_issued`, `guardian.payment_received`, `guardian.results_published` templates and events. The absence notice is sent when a lecturer submits a register. |
| Frontend | `SchoolAdminGuardiansPage` (People → Guardians), `GuardianHomePage` and `GuardianChildPage` (the parent portal), `guardianService.ts`, routing, navigation and sign-in redirect for the `guardian` role. |
| Tests | `guardiansApi.e2e.py` (106 checks), added last to `scripts/run-all-e2e.sh`. The reseed (`seedTwoTenants.manual.ts`) now clears guardians. |
| Docs | README feature list; `docs/features/guardians.md`. |

### Decisions and why

- **Built on the Express codebase on this branch, not the Django rewrite on the
  local `feat/jjelotech-mvp` branch.** This codebase is the complete one (about 540
  endpoints, 25 e2e suites). Its Sprint 5a guardian design was used as a reference
  only. Branch reconciliation is out of scope under the brief.
- **Access is per link, not per guardian.** A sponsor and a parent need different
  access to the same child, and a parent may have different access to different
  children.
- **A guardian can exist without an account.** Schools record contacts at admission
  and send them SMS long before anyone signs in, so an account is optional.
- **One account per person across schools.** A second school's invitation adds that
  school to the existing guardian account instead of creating a duplicate login.
  An email that already signs in a non-guardian school account is refused: sign-in
  resolves by email and platform, so a shared address would lock one of the two out.
- **404 for anything not linked, 403 for an area not shared.** A 404 means ids can't
  be probed. A 403 is only given where the guardian already knows the child exists,
  so explaining the refusal leaks nothing.
- **Guardians don't see draft invoices.** A draft shown to the person paying reads as
  a bill. Students and staff still see drafts, marked as such, unchanged.
- **Absence notices are sent on register submission, not on each mark, and are
  deduplicated per student, course and day.** This avoids false alarms while a
  register is being taken and duplicate messages on re-submission.
- **Guardian notifications never cost the student theirs.** The guardian lookup logs
  and returns nothing on failure. The absence hook catches its own errors, because it
  runs after the register is saved.
- **The portal skips requests for areas the overview says aren't shared**, instead of
  requesting them and showing the refusal.
- **Behaviour change in the transcript route:** a malformed `academicYearId` now
  returns 404 instead of reaching SQL as a cast error (500).

### Verification

| What | How | Result |
|---|---|---|
| Baseline before any change | Full e2e run on the unchanged code | All suites pass, except 6 upload checks that can't run on this Windows host (below) |
| Database guards | Direct SQL in a rolled-back transaction | A cross-school link and a contactless guardian are both refused. A same-school link is accepted. |
| Guardian API end to end | `guardiansApi.e2e.py` against the running API | 106 / 106 |
| Regression | Full `run-all-e2e.sh`, `npm test`, `validate-sql.mjs` | See the phase report |
| Backend types | `npx tsc --noEmit -p .` | 0 errors |
| Frontend | `npm run build` (tsc, nav gate, API-contract gate, Vite build) | 0 problems: 87 menu entries vs 88 routes, 390 API calls vs 501 backend routes |
| Real UI | In-app browser: the admin creates a guardian, links a child, changes access, issues a setup link. The guardian activates, signs in and browses every tab. Checked at 375px width. | Works. Fixed on the way: badge wrapping, a spurious tab-bar scrollbar, a misleading "CGPA (unweighted)" with no results, and a redundant `/fees` request when fees aren't shared. |

### Test-harness notes (this Windows machine only; no repo change)

- `python3` here is the Microsoft Store placeholder, and there's no host `psql`.
  Three suites call `psql` directly. The runs used shims in the session scratchpad:
  a `python3` wrapper, and a `psql.exe` that forwards to `psql` inside the
  database container.
- Six upload checks in `admissionsApi` and `filesApi` send files through
  `/dev/stdin`, which Windows `curl` can't read. They pass on Linux CI. This is a
  harness limitation, not a product defect.

### Found in passing (for the stability phase)

- On startup the server replays only migrations 001–012 (`db/migrations.ts`).
  Everything after that is applied only by `npx tsx src/db/migrate.ts`, which the
  README and CI use. A database brought up by `npm run dev` alone would be
  incomplete, and `/api/health/ready` would report it. The `CLAUDE.md` on the local
  `feat/jjelotech-mvp` branch describes the opposite arrangement and is out of date.
- `CLAUDE.md` there also claims about 31 pre-existing type errors. There are none on
  this branch.
- `scripts/setup-local.ps1` can't install `@tensorflow/tfjs-node` on Windows with
  Node 22 (no prebuilt binary; npm's bundled node-gyp doesn't recognise Visual
  Studio 2026). This is covered by the TensorFlow phase.
- The frontend bundle is a single 1.46 MB chunk. Code-splitting per audience would
  cut first load for students, parents and employees.
