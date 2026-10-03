# Authorisation: who may call each route

Every route says who may call it, in a form the build can read.

## Declaring it

Guards are Express middleware that carry a tag (`apps/backend/src/auth/guards.ts`):

| Guard | Tag | Meaning |
|---|---|---|
| `authenticateToken` | `authenticated` | A live session. |
| `requireTenant` | `tenant` | A resolved tenant (a superadmin needs break-glass). |
| `requirePlatform('school')` | `platform` | That platform only. |
| `requireRoles('admin', …)` / `requireRole` | `roles` | Those roles. A superadmin passes. |
| `requireSuperadmin`, and the routers' own superadmin checks | `superadmin` | Superadmins only. |
| `publicRoute('why')` | `public` | Anyone. Does nothing at run time. |
| `selfService('what')` | `self` | Only the caller's own records; nothing in the request selects another person. Does nothing at run time. |
| `anyMember('what')` | `member` | Any member of the tenant (reference data). Does nothing at run time. |
| `checkedInHandler('rule')` | `inHandler` | The handler decides, by the rule written here (for example "the student themselves, or the school's admin or lecturers"). Does nothing at run time. |

Prefer a real guard (`requireRoles`) whenever the rule is a list of roles. Use
`checkedInHandler` only when the rule depends on the record: whose invoice,
whether a lecturer teaches this student. Then write the rule so a reviewer can
check the handler against it.

## The map and the gate

```bash
cd apps/backend && npx tsx src/scripts/routeInventory.ts --permissions --write
```

That writes `docs/api/permission-map.json`: each route with the tags of every
middleware that runs before its handler. `router.all` routes are listed as
`ALL`, and RegExp routes under their pattern. A tag on the last function of a
route is after the handler, so it does not count and the route is flagged.
Commit the map with the route change.

```bash
node scripts/checks/permission-coverage.mjs
```

Run in CI, this fails when the map is stale, or when a route is neither public
nor behind authentication. It also fails when an authenticated route declares
no role guard, superadmin guard or written rule, or has a guard after its
handler.

## The tests

`privilegeEscalation` (in `scripts/run-all-e2e.sh`) reads the map. It calls
every role-guarded route as every caller the map leaves out, and expects a
refusal. There are eleven callers: the seeded school admin, lecturer and
student; the corporate admin, HR, HR director, manager and employee; and a
guardian and two IT users the suite makes. Path parameters are filled with
real ids of the caller's tenant where the name says what they are. A route
whose loader runs before its guard can still answer 404, and the suite says
how many did. It then runs same-tenant IDOR cases: one person reaching
another's transcript, attendance, invoice, pay, timesheet, leave, files or
face-matching record. Finally it tries self-promotion. The handler rules are
tested only by those cases, so add one when you add a rule.

## Single sign-on sessions

A session started through a tenant's identity provider acts only in that
tenant (`auth_sessions.bound_tenant_id`). The person's other memberships stay
closed to it until they sign in another way.

## Shared accounts

An account (`users`) is shared by every tenant it belongs to. Its role, status
and details cannot be changed from one tenant while another has the person.
The routes refuse or change only the membership, and a database trigger
refuses the rest (migration 083). Ask `memberElsewhere`, which runs on the
system pool: under a tenant's row-level security, other tenants' memberships
are invisible.

## Nobody approves their own pay

Payroll and workforce routes refuse a change to the caller's own pay
components, payroll inputs, contract, timesheet hours or timesheet approval.

## Known limits

- Lecturers read any student's attendance, transcript and programme in their
  school, not only students they teach. Their writes are limited to courses
  they teach.
- Any lecturer can read every attendance-evidence file in the school.
- Managers see and decide anyone's leave and rosters in the tenant, not only
  their reports': nothing sets reporting lines yet.
- `security_officer` is named in the incident and correction guards, but no
  such role exists in `roles`, so nobody holds it.
- 56 routes rest on a written rule that only the IDOR cases test.
