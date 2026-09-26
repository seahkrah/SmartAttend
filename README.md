<p align="center"><img src="apps/frontend/public/logos/favicon.svg" alt="" width="96" /></p>

# JJELOTECH SYSTEMS

*Engineering the Dawn of Enterprise Systems.*

A School Management System (SMS) and an Employee Management System (EMS) on
one multi-tenant platform: a React front end, an Express/TypeScript API and
PostgreSQL 16.

Every school and every company is a **tenant**. Tenant isolation is enforced
in two places:

- **The API** derives the tenant from the signed-in identity, never from the
  client. An id from another tenant answers 404.
- **The database** requires `tenant_id` on tenant-owned tables and uses
  triggers to refuse references that cross tenants.

## What is in it

**School (SMS)**
- students, lecturers, departments and courses
- academic years, terms, programmes and schedules
- attendance by session and by lecturer register
- gradebook: assessments, marks, published results, transcripts with CGPA
- admissions: intakes, applications, decisions, enrolment
- fees: structures, invoices, payments, statements, clearance
- guardians: parents, carers and sponsors linked per child with per-area
  access, absence and fee alerts, and a read-only parent portal
  ([docs/features/guardians.md](docs/features/guardians.md))

**Employer (EMS)**
- employees and departments
- self-service check-in and check-out
- today's attendance for HR
- leave
- rosters, shift patterns and timesheets
- payroll: components, tax bands, runs, payslips

**Both**
- notifications with a real outbox (email, SMS, push and in-app), templates
  and delivery log
- document storage
- immutable audit trail
- incidents with a lifecycle
- operational metrics
- an optional face-matching check
- a superadmin control plane: tenant lifecycle, administrators, incidents,
  diagnostics

**Accounts**
- server-side sessions that logout and deactivation end immediately
- sign-in lockout
- invitations and password resets by single-use link; nobody chooses or sees
  another person's password

See [docs/security/authentication.md](docs/security/authentication.md).

**Face matching** runs server-side dlib ResNet embeddings with a liveness
challenge. It requires consent, and templates are encrypted at rest. See
[docs/features/face-matching.md](docs/features/face-matching.md) for what it
proves and what it does not.

## Running it locally

The quick way, from a fresh checkout (it installs everything, writes the config
with generated secrets, sets up the database, loads demo data and starts the
app; it starts PostgreSQL in Docker if you have no database):

```bash
scripts/setup-local.sh                                          # macOS / Linux
powershell -ExecutionPolicy Bypass -File scripts\setup-local.ps1  # Windows
```

Afterwards, `scripts/start-local.sh` (or `scripts\start-local.ps1`) starts it
again.

Face matching runs on native TensorFlow. Linux and macOS download it prebuilt.
On Windows it's compiled during setup, which needs Visual Studio 2019 or later
with the "Desktop development with C++" workload, plus Python 3. Without them,
setup still completes and everything except face matching works; face checks
answer 503 until you install the tools and run `npm run tfjs-native` in
`apps/backend`. To check the engine on any machine, run
`npm run verify-face-engine`. The steps it performs, by hand:

Needs Node 20 and PostgreSQL 16.

```bash
# Shared types
cd packages/types && npm install && npm run build

# API
cd apps/backend && npm install
cp .env.example .env            # set DATABASE_URL and JWT_SECRET at least
npx tsx src/db/migrate.ts       # applies every migration, in order; safe to re-run
SUPERADMIN_EMAIL=you@example.org SUPERADMIN_NAME="Your Name" npm run setup-superadmin
npm run dev                     # http://localhost:5000

# Web app
cd apps/frontend && npm install
VITE_API_BASE_URL=http://localhost:5000/api npm run dev   # http://localhost:5173
```

As superadmin, create a tenant and appoint its administrator. The
administrator gets an invitation link (or you hand it to them). From there
they add their own people.

## Checks

Run these before pushing; CI runs the same.

| Check | Command |
|---|---|
| API types | `cd apps/backend && npx tsc --noEmit -p .` |
| Every literal SQL statement parsed against the live schema | `node scripts/validate-sql.mjs` (needs `DATABASE_URL`) |
| Unit tests (includes the real face models on fixtures) | `npm test` |
| End-to-end API suites against a running API: seeds two schools and two companies, then runs 25 suites | `bash scripts/run-all-e2e.sh` |
| Web app: types, every menu link routed, every API call matched to a server route, build | `cd apps/frontend && npm run build` |
| Container images build, migrate an empty database and report ready (CI job `images`) | see `.github/workflows/ci.yml` |

## Not done yet

- No second factor (TOTP or WebAuthn) and no single sign-on.
- Tokens are held in `localStorage`, not `httpOnly` cookies.
- Email and SMS delivery depend on each tenant configuring a provider. Until
  then messages are recorded as *simulated*, never as sent.
- Not built:
  - timetabling
  - assignments
  - online payment providers
  - recruitment
  - performance reviews
  - expenses
  - country payroll rules (payroll computes from configured components and
    tax bands; it ships no country's statutory rules)
- Deployment is a single-machine Docker Compose stack with scripted, verified
  backups ([docs/operations/deployment.md](docs/operations/deployment.md)).
  There is no metrics exporter or alerting, no staging environment and no load
  test yet, and running several API replicas needs a shared rate-limit store.
- `docs/archive/` holds earlier phase reports. They are history, not
  documentation, and several describe features that were not real.

**Security notice:** credentials were once committed to this repository. See
[SECURITY_CREDENTIAL_ROTATION.md](SECURITY_CREDENTIAL_ROTATION.md).
