# Change notes

The engineering decisions made while carrying out the JjeloTech Systems project
brief, with the reasoning behind each, so they can be reviewed. Newest phase first.

---

## Foundation round, step 4: two-factor sign-in (2026-09-26)

### Why

Administrators and superadmins could sign in with a password alone. A single
phished or reused password was the whole of the defence around every school's
records and every company's payroll. The security doc listed this as the
first thing not done yet.

### What changed

- **Authenticator-app codes (TOTP, RFC 6238)**, which every authenticator
  supports.
  - Written against Node's `crypto` rather than a package: about thirty lines,
    checked against the RFC's own test vectors. The code that decides who signs
    in is the last place to add a dependency.
  - Setup is on a new **Account security** page: scan a QR code, confirm one
    code, save ten recovery codes.
  - Signing in then asks for a code after the password.
- **Enforced for admins and superadmins in production** (`MFA_REQUIRED_ROLES`),
  off elsewhere so development and tests are not blocked.
  - Such a person signs in with a password and can reach nothing but the setup
    page until two-factor is on.
  - The rule is carried in the access token, so it costs no query per request.
    A token refresh re-reads it.
- **Decisions and their reasons:**
  - Wrong codes count towards the existing password lockout. A per-challenge
    limit alone would let someone with a stolen password guess without end, one
    fresh challenge at a time.
  - Each accepted code's time step is recorded and never accepted again, so a
    code seen over a shoulder cannot be replayed within its 90-second window.
  - Turning it on ends the account's other sessions. They were signed in by
    password alone, which is exactly what two-factor is meant to stop.
  - Secrets are encrypted at rest (AES-256-GCM) and bound to their account. The
    key is `MFA_ENCRYPTION_KEY`, with a fallback derived from `JWT_SECRET` so an
    existing install keeps working; production warns about the fallback.
  - A required role cannot turn it off. Replacing a phone is a reset.
- **Lost phone:**
  - First, recovery codes.
  - Then the existing **reset access**, which now also removes two-factor.
  - For administrators, a new superadmin **Reset two-factor**, which asks how the
    requester's identity was confirmed and records the answer in the audit trail.
- **Found in passing:** migration 006 had created a `mfa_challenges` table for
  an earlier design that was never built, and whose middleware accepted any
  code. The new table is `mfa_login_challenges`; the old one is untouched and
  documented as unused.
- Setup scripts, `.env.example` and the compose file now carry
  `MFA_ENCRYPTION_KEY`.

### Verified

- 10 unit tests, including the RFC 6238 vectors.
- A new e2e suite, `mfaApi` (41 checks), is part of `run-all-e2e.sh`. The full
  run is 1,930 of 1,931, the one failure being the known Windows antivirus case.
  - The first full run found that two-factor management shared the anonymous
    reset/activation rate limit, which earlier suites had used up. It now has its
    own (`RATE_LIMIT_MFA_PER_15MIN`, 60).
- Enforcement was checked against a second API started with
  `MFA_REQUIRED_ROLES=admin`:
  - admin pages answer `403 MFA_SETUP_REQUIRED` before setup, and still do after
    a token refresh;
  - they open after setup;
  - the admin cannot turn it off;
  - a lecturer is unaffected.
- In the browser: setup with the QR code, the recovery-code screen, and sign-in
  with a wrong code and then the right one.

---

## Foundation round, step 3: performance baseline (2026-09-26)

### How it was measured

`apps/backend/scripts/load-test.mjs` signs in as the seeded test accounts and
fires each of the busiest screens' API calls 200 times, 20 at a time, reporting
p50 / p95 / max. The data set was sized like a mid-sized school: 3,000
students and 120,000 attendance records in one tenant. It was removed
afterwards; the e2e fixtures reseed.

### What changed, and what it bought (p50, 20 concurrent users)

| Call | Before | After | Why |
|---|---|---|---|
| Students page | 1,812 ms | 227 ms | Paginated on the server (`?page`, `?pageSize` ≤ 200, `?search`), 50 a page; it sent all 3,000 every time |
| Lecturer's students | 4,909 ms | 1,513 ms | One grouped count per student and class, not a correlated subquery per row |
| Attendance overview | 1,056 ms | 669 ms | One grouped pass instead of one per class |
| Attendance report | 937 ms | 573 ms | Named columns; new index on (tenant, date, time marked) |
| School dashboard | 427 ms | 246 ms | A covering index for per-class totals (migration 065) |
| Lecturer dashboard | 817 ms | 603 ms | Its six independent queries run together |

- **Pickers** (fees, guardians, results, enrolment) ask for
  `?fields=summary`: id, name and number, not the whole record.
- **Lecturer reports** were rewritten in stages (roster, days, counts) and checked
  to give output identical to the old query.
- **Database pool**: node-postgres defaults to 10 connections, which became the
  queue at about 20 users, since each request makes a few queries before its real
  work. It is now 20, set by `DATABASE_POOL_MAX`. Size it to the database's
  `max_connections` divided by the number of API replicas.
- **Frontend code splitting**: every page loads on demand (`React.lazy`), so the
  entry bundle fell from 1,136 KB to 286 KB. A person downloads the screens they
  open, not all 76.

### Still heavy, recorded rather than hidden

- **Enrolments** (~2 s): one 1.5 MB response of every enrolment in the school. The
  fix is in the interface, which should load one class at a time; that is a
  page redesign, left for the school-platform work.
- **Lecturer reports** (~2.9 s) in the test's worst case: a single class of 3,000
  students. Realistic class sizes are well under the budget.

### Verified

Frontend build (both route gates), 96 unit tests, SQL schema check and the full
e2e suite: 1,889 of 1,890, the one failure being the known Windows antivirus
quarantine of the upload test's PHP sample.

---

## Foundation round, step 2: one design system (2026-09-26)

### The problem, measured

The theme follows the person's operating system: light or dark. But only
**11 of 80 pages** used the design system's tokens (`text-primary`, `bg-card`,
`border-subtle` …). **52 hardcoded a dark palette** (`text-slate-400`,
`bg-slate-900` …), 17 mixed the two, and several school-admin pages were written
light-only (`bg-white`). The results:

- On a computer set to **light**, the sign-in card turned white inside a dark page,
  and its labels were grey on white.
- The legacy pages were dark islands in a light app, and the light-only pages were
  white islands in a dark one.
- Status colours tuned for one background, like pale `text-amber-300`, were
  unreadable on the other.

### What changed

- **Dark by design, declared.** The theme system already intended sign-in, public
  pages, the superadmin console and attendance capture to be dark, but nothing
  enforced it. A new `DarkSurface` wrapper (`src/theme/DarkSurface.tsx`) now
  declares them in `App.tsx`. Everything else follows the person's theme.
- **Every page on the tokens.** A one-off codemod mapped about 2,860 legacy
  classes onto the theme tokens:
  - text becomes `text-primary`, `text-secondary` or `text-muted`;
  - surfaces become `bg-page`, `bg-card`, `bg-sunken` or `bg-raised`;
  - borders and dividers become `border-subtle`, `border-strong` or
    `divide-subtle` (a new utility).

  It also paired single-theme status colours with their opposite: for example
  `text-emerald-400` became `text-emerald-700 dark:text-emerald-400`, and
  `bg-blue-50` gained `dark:bg-blue-500/15`. White text stays white where it
  sits on a solid colour or gradient. The codemod was run until it made no
  further changes (idempotent). **79 of 80 pages** now use the design system. The
  one exception is deliberate: dark text on the roster's coloured shift chips.
- **Classes that never existed:** `danger-200/300/900` referred to shades the
  palette doesn't define. The dark "Reject" button on HR leave fell back to the
  light-mode red at 1.86:1. They now use real shades.
- **Low-contrast yellow** (`yellow-500/600` on white, 2.9:1) is darkened to 700.

### Found in passing: dates

Every `DATE` column reached the screen as a timestamp: leave requests read
"2027-04-12T00:00:00.000Z → …". node-postgres turns a date into a JavaScript
`Date` at local midnight. That also shifts it a day west of the server, and makes
`String(d).slice(0, 10)` a weekday name. Four modules had each written their own
`isoDay()` workaround, and one comment records a closed admissions intake that
kept accepting applications because of it. The driver now returns `DATE` as
`'YYYY-MM-DD'` (`db/connection.ts`). The existing workarounds accept strings and
keep working, and timestamps are unaffected. This also fixes the due date in
invoice emails, which used `String(due_date).slice(0, 10)`.

### Verification

- **A contrast crawler measured it.** For every menu page of all nine roles, in
  light and in dark, it computed the WCAG contrast ratio of every visible piece of
  text against its actual background and flagged anything under 3:1. Every role
  now passes in both themes (text on gradients is excluded, since it can't be
  measured). What it caught and got fixed: the yellow link, the dark-mode
  "Reject", the gradebook badge, the HR analytics page (its styles lived in
  `utils/visualHierarchy.ts`), and the superadmin incident links.
- **Visually:** converted legacy pages checked by screenshot in light mode.
  Sign-in, forced dark on a light-mode computer, has 0 contrast failures.
- **Gates:** frontend build (0 nav and 0 API-contract problems), 96/96 unit tests,
  0 SQL mismatches, and e2e 1,889/1,890. The one failure is the known antivirus
  quarantine on this machine.
- CI on GitHub passed for the previous push: types and build, migrations + SQL +
  API e2e on Linux, and container images.

---

## Follow-up: brand cleanup and the "Request access" form (2026-09-26)

### Cleanup (as requested)

- The landing footer reads "Powered by JjeloTech".
- Deleted:
  - the SmartCode logos (`public/logos/brand-logo.png`, `alt-brand-logo.png`,
    `logo/brand-logo1.png`, and `logo/alt-brand-logo.png`, an identical copy of the
    public alt logo);
  - the earlier SmartAttend logos (`logo/platform-logo1.png`,
    `logo/alt-platform-logo.png`);
  - the obsolete `run-hr-e2e.sh` and `run-admin-e2e.sh`;
  - old log files (`server-output.txt` ×2, `build_errors.txt`, `test-results.txt`).
- `SECURITY_CREDENTIAL_ROTATION.md` example database name changed to `jjelotech`.
- Left as they are on purpose:
  - the password policy's "smartattend" rule, which blocks guessable passwords;
  - migration 024 and `rotate-credentials.mjs`, which must match the old account
    addresses;
  - the leaked file's name in the rotation guide, used by the history cleanup.

### "Request access" replaces self-registration

**What was wrong:** `/register` asked a would-be student or employee to choose a
password and type their institution's internal UUID (`entityId`), a value nobody
outside the database knows. It could only ever be completed by someone who already
had access to the data. People now get accounts from their own administrator, by
invitation.

**What it is now:** an enquiry form for a school or employer that wants to use the
platform. The operator gets back to them to discuss terms. It follows common
international practice for contact forms:

| Principle | How it's applied |
|---|---|
| Data minimisation (GDPR Art. 5(1)(c); Liberia, Ghana and Nigeria data laws follow the same principle) | Only what's needed to reply: organisation, type (SMS/EMS/both), country, optional size band, contact name, optional job title, work email, optional phone, preferred contact method, optional message. No password, address, date of birth or ID numbers. Any other fields a client sends are ignored, and a test proves they aren't stored. |
| International formats | Country is an ISO 3166-1 alpha-2 code, with names from the browser's `Intl.DisplayNames` so they're spelled and localised correctly. Phone numbers are normalised and stored in **E.164** (`+231771234567`); spaces, brackets and a leading `00` are accepted. |
| Consent | An unticked checkbox stating the purpose ("to contact me about this request … not shared"), recorded with its date and a wording version (`2026-09`). |
| Reachability | Choosing phone or WhatsApp requires a number (enforced in the API and the database). |
| Accessibility (WCAG 2.1 AA) | Every field labelled, required fields marked, optional ones say so, errors announced (`role="alert"`), correct `autocomplete` tokens. |
| Abuse | A hidden honeypot field (a bot gets "received" but nothing is stored), and a limit of 20 requests per hour per address (`RATE_LIMIT_ENQUIRY_PER_HOUR`). |

**Pieces:**
- Migration `063_access_requests.sql` (belongs to no tenant).
- `POST /api/access-requests` (public), and `GET` and `PATCH` for superadmins only.
- A new superadmin page, **Access requests**. It lists enquiries with New,
  Contacted and Closed filters, shows one-click email, phone and WhatsApp links,
  and has internal notes. Each change is audited.
- The sign-in page now says "No account? Your school or employer sends you an
  invitation. New organisation? Request access".

**Found in passing and fixed:** a stale token in the browser showed a "Session
Expired – please log in" toast on public pages (home, request access). It now only
appears on signed-in pages.

**Left in place:** the old `POST /api/auth/register-with-role` endpoint. The UI no
longer uses it, but the Approvals pages still process anything it created. Removing
it is a product decision.

**Verification:**
- New `accessRequestsApi.e2e.py`: 24/24. It covers required fields, ISO and E.164
  validation, consent, the honeypot, that no extra data is stored, that only a
  superadmin can read or change requests, and status handling.
- In the browser: the form filled in by typing and submitted, the record checked in
  the database, the superadmin page viewed, no overflow at 375 px.
- Full regression: see the report.

---

## Phase 4: Rebrand to JJELOTECH SYSTEMS (2026-09-26)

### Brand source

The final artwork was supplied during this phase in `logo/`: the "JjeloTech" sun
and chevron logo with the tagline *Engineering the Dawn of Enterprise Systems*,
as a 1254-pixel PNG and as a vector trace (`logo/favicon.svg`). The vector is the
master. `apps/frontend/scripts/brand-assets.mjs` derives every asset from it, so
changing the artwork means replacing one file and running one command.

| Asset | How it's made |
|---|---|
| In-app mark (`BrandLogo.tsx` via `brandMarkPaths.ts`) | The sun and chevron paths only, on a transparent ground, drawn inline. It scales cleanly and works on light and dark themes. |
| `favicon.svg` | The mark on a dark rounded tile, so the thin rays survive a 16-pixel tab on any browser theme |
| `favicon-32.png`, `apple-touch-icon.png` | Rasterised from `favicon.svg` in the browser |
| `jjelotech-logo.svg`, `jjelotech-logo-wordmark.svg` | The full lockup, with and without the tagline, transparent. The trace cuts letter holes with black shapes, so those are applied as an SVG **mask**: the holes are truly transparent rather than black blobs or filled in. |

### What changed

- **Name:** "JJELOTECH SYSTEMS" as the product name, in the browser title, meta
  description, Open Graph tags, app name and README. Every signed-in page now
  names itself in its tab ("Guardians · JJELOTECH SYSTEMS"); every tab used to
  read the same.
- **Wordmark:** "JJELOTECH / SYSTEMS", set as type so it takes the theme's colours,
  beside the new mark, in the sidebar and on every sign-in page. The sign-in pages
  also show the tagline.
- **Positioning:** "Attendance Made Smart", "Attendance Platform" and "your
  attendance hub" are replaced. The product is two platforms (SMS and EMS), not an
  attendance app.
- **Landing page rewritten:**
  - It lists only what is built: the SMS and EMS modules, plus the shared
    foundations.
  - Removed: developer statistics ("31+ API endpoints", "24 database tables",
    "100% TypeScript"), the unbacked "thousands of organizations" claim, a "View
    Demo" button that did nothing, and six footer links to `#`.
  - The footer credit now reads "Powered by JjeloTech".
- **Old assets:** the earlier favicon and logos are removed from `public/` (still
  in Git history), and so are the SmartCode logos, in `public/logos/` and in the
  `logo/` artwork folder.

### UI/UX pass

- **Consistent platform naming:** sign-in said "School / Corporate", the app
  switcher said "School / Employees", and the product says SMS/EMS. All now read
  **School (SMS) / Employer (EMS)**: sign-in, registration, forgot password,
  platform-mismatch messages and the switcher.
- **Scrollbars:** thin scrollbars in the theme's colours everywhere. The platform
  default (a wide light-grey bar with arrow buttons) sat on every dark sidebar.
- **Logo centring:** the sign-in, registration, superadmin and change-password
  screens centred the logo with `text-center`, which doesn't centre a flex row.
  They're now properly centred.
- **Phone width (375 px):**
  - None of the 21 school-admin pages, the landing page or sign-in scroll sideways.
  - The landing header wrapped "Sign in" and "Request access" onto two lines each.
    At phone width the header now shows "Sign in" only, and "Request access" moves
    to a link under the hero.
  - The SMS/EMS hints on sign-in now line up in both options.
- **Kept deliberately:** the brand palette. The existing accent (`#f7941d`) and brand
  blue already match the new logo's orange (`#FE9401`) and blues, so recolouring
  every component wasn't justified.
- **White-label emails:** account and notification emails are written in each
  school's or employer's own name, not the platform's. That's deliberate: the
  people receiving them know their school, not us.

### Verification

- Frontend build: TypeScript, nav gate (87 entries vs 88 routes, 0 problems),
  API-contract gate (390 calls vs 501 routes, 0 problems), production build.
- In the browser: landing, sign-in, the sidebar and not-found checked at desktop
  and phone width. Favicon and lockup rendered and inspected.
- A post-rebrand crawl of the school-admin workspace: 21 pages plus a bad address,
  0 issues.
- A sweep for old brand strings in the frontend and user-facing backend text: none
  left. The password policy still refuses passwords built from "smartattend" or
  "jjelo", on purpose.
- Dead code noted, not changed: `src/components/Navigation.tsx` isn't imported
  anywhere.

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
