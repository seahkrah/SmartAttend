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
middleware that runs before its handler. Commit it with the route change.

```bash
node scripts/checks/permission-coverage.mjs
```

Run in CI, this fails when the map is stale, or when a route is neither public
nor behind authentication. It also fails when an authenticated route declares
no role guard, superadmin guard or written rule.

## The tests

`privilegeEscalation` (in `scripts/run-all-e2e.sh`) reads the map. It calls
every role-guarded route as every seeded caller the map leaves out, and
expects a refusal. It then runs same-tenant IDOR cases: one person reaching
another's transcript, attendance, invoice, pay, timesheet, leave, files or
face-matching record. Finally it tries self-promotion. The handler rules are
tested only by those cases, so add one when you add a rule.

## Single sign-on sessions

A session started through a tenant's identity provider acts only in that
tenant (`auth_sessions.bound_tenant_id`). The person's other memberships stay
closed to it until they sign in another way.

## Known limits

- Lecturers read any student's attendance, transcript and programme in their
  school, not only students they teach.
- Any lecturer can read every attendance-evidence file in the school.
- The role matrix has no callers for `it`, `security_officer` or guardians.
