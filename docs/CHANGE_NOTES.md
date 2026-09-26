# Change notes

The engineering decisions made while carrying out the JjeloTech Systems project
brief, with the reasoning behind each, so they can be reviewed. Newest phase first.

---

## Phase 3: Stability and security pass (2026-09-26)

### How it was checked

- **Every page, for every role.** An in-browser crawler signed in as each of the nine
  audiences (school admin, lecturer, student, guardian, corporate admin, HR, manager,
  employee, superadmin) and walked every menu route through the app's own router:
  82 page views, plus each guardian child tab. For each one it recorded failed API
  calls, console errors, uncaught exceptions, error or "undefined"/"NaN" text on
  screen, unexpected redirects and blank content. A deliberately bad route was
  included as a canary, to prove the crawler can see a broken page.
- **Every API route without credentials.** All 501 mounted routes were called with no
  token.
- **Dependencies:** `npm audit` for both apps.
- **Secrets:** a scan of tracked files and helper scripts.

### Broken screens found and fixed

| Page | Problem | Fix |
|---|---|---|
| Superadmin → Dashboard | Read field names `/superadmin/stats` never returns, so it showed **0 tenants and "undefined" users**. Every card carried a **hardcoded "+12% / +8% / +15% / −5% this month"** with no data behind it. | Rewritten against the real contract, and only measured figures shown: tenants by platform and status, users active and deactivated, students, employees, open incidents. No trends until the platform records them. |
| School admin → Dashboard | Hardcoded "+12%" and "+5%" trend badges | Removed |
| Lecturer → Students | The course filter read `course_id/code/name`, but `/faculty/courses` returns `id/code/name`. The dropdown offered one blank option and filtering by course couldn't work. It also caused a React key warning. | Map the API's fields. Verified the dropdown lists the lecturer's courses and filters. |
| Corporate → Attendance | Every employee without a check-in rendered with the same React key (`null`), which can drop or duplicate rows on update | Keyed by employee and check-in |
| Every workspace | An unknown address inside a workspace (e.g. `/faculty/anything`) rendered the shell around a **blank page** | A "Page not found" page with a link home, as the catch-all in all eight workspaces |
| File uploads | The upload staging directory was created once at start-up. If the OS temp cleaner (Storage Sense, systemd-tmpfiles) removed it while the server ran, **every upload failed with a 500** until a restart. It surfaced on this machine. | Ensured on each upload |

### Stability fixes to the platform itself

- **Start-up no longer applies a partial set of migrations.** The server replayed a
  hardcoded list (001–012) in its own order. On a fresh database that ran migrations
  out of sequence and produced a half-built schema that looked like a working one.
  Migrations are now only the deliberate `npx tsx src/db/migrate.ts` step (setup, CI
  and the deploy docs already do this). Start-up logs `[DB] ✓ Schema is current`, or a
  warning naming what's pending. `/api/health/ready` already refuses traffic until
  then. The legacy runner `src/db/migrations.ts` is removed.
- **`npm test` reports the truth.** `vitest.config.ts` used Jest's `testMatch`, which
  Vitest ignores, so it also ran stale compiled tests in `dist/` and reported 39
  failures in code that no longer exists. It now uses `include`/`exclude`: 96/96.
- **Test reliability:**
  - `leaveApi` "short notice is refused" failed every weekend: "today" alone has no
    working days on a Saturday. It now uses a three-day range starting today.
  - `admissionsApi` uploaded through `/dev/stdin`, which Windows curl can't read. It
    now uses a temp file.

### Security

| Area | Finding | Action |
|---|---|---|
| Unauthenticated surface | 490 of 501 routes refuse without a token. The 11 that don't are sign-in, registration, password reset, activation, token refresh and clock sync, all by design. `register-superadmin` needs a ≥32-character bootstrap token, compared in constant time, once any superadmin exists and always in production. Self-registration can't choose `admin` or `guardian`. The failure-simulation routes are superadmin-only. | No change needed |
| Transport and headers | CSP `default-src 'none'`, HSTS, `nosniff` and frame protection are present. A foreign origin gets no CORS grant. `JWT_SECRET` is required to be ≥32 characters and signing is pinned to HS256. | No change needed |
| Backend dependencies | 14 production advisories (1 critical, 8 high): axios, express, body-parser, path-to-regexp, qs, express-rate-limit, form-data, follow-redirects, uuid, and `tar`/`adm-zip`/`@mapbox/node-pre-gyp` pulled in by tfjs-node's installer | Semver-compatible fixes applied. The tfjs-node installer chain is forced to patched versions via `overrides` (`tar` 7.5.22, `adm-zip` 0.6.1, `@mapbox/node-pre-gyp` 2.0.3). **0 advisories remain.** The installer's API use (`tar.x`, `new AdmZip`, the `node-pre-gyp install` CLI) is unchanged in those versions. Proven by a from-scratch Windows rebuild and by building the Linux production image, where the binding loads natively (TF 2.9.1). |
| Frontend dependencies | axios, form-data and follow-redirects (high/moderate) | Fixed (semver-compatible) |
| Frontend: react-router open redirect (moderate) | Only exploitable when a user-controlled path reaches `<Link>`/`navigate()`. Every navigation target in the app is a constant or a server-issued id. | **Deferred**: the fix is react-router 7, a major upgrade. Not exploitable here. Recommended as its own change. |
| Frontend: Vite / esbuild (dev server only) | Affects `vite dev`, not production builds | **Deferred**: needs Vite 8 (major) |
| Secrets in the repo | The four helper scripts named in `SECURITY_CREDENTIAL_ROTATION.md` now read credentials from the environment. The root `.env.production`/`.env.staging` hold placeholders. The root `.env.development` value is the placeholder `dev-secret-key-unsafe-do-not-use-in-production` (a first-pass heuristic flagged it; on inspection it isn't a secret). Nothing loads the root `.env.*` files; the API reads `apps/backend/.env`. | No change. The rotation in `SECURITY_CREDENTIAL_ROTATION.md` still applies to the credentials already in git history. |

### Not a defect

`filesApi` "a PHP script declared as text is refused" can't run on this machine:
Windows Defender quarantines the test's deliberately malicious fixture (`shell.txt`,
detected as `Trojan:PHP/Chopper.A`) before curl can upload it. It passes on Linux CI.

### Verification

See the phase report: crawl re-run on the fixed pages, full `run-all-e2e.sh`,
`npm test`, `validate-sql.mjs`, frontend build gates, and backend typecheck.

---

## Phase 2: TensorFlow verification (2026-09-26)

**Goal:** prove that TensorFlow isn't just installed but is loaded natively and
drives correct results in the feature it exists for (face matching), and fix any
version, configuration or silent-failure problems.

### Where TensorFlow is used

Only in `apps/backend/src/biometrics/engine.ts`. `@tensorflow/tfjs-node` 4.22.0 runs
three networks shipped with `@vladmandic/face-api` 1.7.15: the SSD MobileNet face
detector, the 68-point landmark model and the dlib ResNet-34 face-recognition model
(128-number descriptors). They serve face enrolment, verification, identification in
class, and the head-turn liveness check.

### What I found

| Finding | Severity | Resolution |
|---|---|---|
| No prebuilt Windows binding exists for tfjs-node 4.22.0 (every napi and version combination probed returns 404), so Windows always compiles it. npm 10's bundled node-gyp 11.2 doesn't recognise Visual Studio 2026, and npm forces its own node-gyp onto install scripts. `setup-local.ps1` therefore failed at `npm ci` on Windows. | Blocker (Windows setup) | `apps/backend/scripts/tfjs-native.mjs` runs the package's own installer directly, with node-gyp 12.4 (cached outside the project), inside the Visual Studio environment found through `vswhere`. `setup-local.ps1` installs with `--ignore-scripts`, re-runs every other package's install scripts, then calls it. |
| After a successful build, tfjs-node copies `tensorflow.dll` into `lib/napi-v10` (Node 22's N-API version) but builds the binding into `lib/napi-v8`, so it fails to load with "The specified module could not be found". | Blocker (Windows) | The script stages the DLL beside every built binding. A `postinstall` hook does the same after any plain `npm install`. It's written to be a no-op where the script isn't present (the Docker build installs before copying `scripts/`) and on Linux and macOS. |
| **Silent failure:** the engine loaded lazily and `warmUp()` was never called. A server whose native library couldn't load started cleanly, looked healthy, and answered the first face check with an anonymous 500. | High | The engine is warmed up at start-up (turn off with `FACE_ENGINE_WARMUP=off`) and logs `[FACE] engine ready: backend=…` or the exact failure. `/api/health/ready` reports `components.faceEngine` (state, backend, error). A load failure becomes `EngineUnavailable`, answered as **503 `engine_unavailable`** with a plain message. A failed load is retried on the next request, so a repaired install heals without a restart. |
| A silent fallback to the pure-JavaScript CPU backend would give correct but much slower answers, and every existing test would still pass. | Medium | `engineInfo()` exposes the backend. The start-up log warns if it isn't `tensorflow`. A unit test and the verify script both fail on anything else. |
| Versions | — | One `@tensorflow/tfjs-core` (4.22.0, deduplicated). face-api 1.7.15 is built against `^4.22.0`. face-api runs its kernels on the server's own engine (checked by engine identity). Native TensorFlow C library 2.9.1. CPU only; the build has no GPU support and needs none (about 300 ms per frame). No mismatch. |

### Decisions and why

- **Warn, don't fail, when the binding can't be built** (use `--strict` to fail).
  Face matching is optional (README). A school without a C++ toolchain should still
  get a working system, and now it's told clearly why face checks are off.
- **Readiness stays 200 when only the face engine is down.** Taking the whole API out
  of a load balancer because an optional feature is degraded would be worse than the
  fault. The degradation is reported in the body instead.
- **No change to the Dockerfile or CI.** Linux uses the prebuilt binding, and CI is
  out of scope under the brief.

### Verification

| What | How | Result |
|---|---|---|
| Real inference | `npm run verify-face-engine` (new): real networks on the committed fixtures | Native `tensorflow` backend, C library 2.9.1. 1 / 0 / 2 faces found where expected. Same person 0.22 and 0.42, different people 0.84 (threshold 0.5). Head-turn directions correct. Median 297–366 ms per frame. |
| Windows setup from scratch | `scripts\setup-local.ps1 -NoStart -NoDemo`: fresh `npm ci` of every package on Windows 11, Node 22.20, VS 2026 | Previously failed at the API install. Now builds the binding, stages the DLL, verifies it loads, and completes. |
| Failure mode | Removed the staged DLL, started the API | Start-up log and `/health/ready` name the fault. All face operations answer `503 engine_unavailable`. Consent records still work. |
| Repair and self-healing | `npm run tfjs-native` with the API still running | DLL restaged. `faceMatchingApi` 65/65 with no restart. Readiness shows `ready` on `tensorflow`. |
| Unit tests | `vitest` on sources | 96/96, including the new native-backend assertion |
| Regression | Full `run-all-e2e.sh` | See the phase report |

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
