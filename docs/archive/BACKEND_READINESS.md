# Backend readiness for the current UI

Checked by running the system, not by reading it: PostgreSQL 16 in a container,
all migrations applied to an empty database, the real server started, and every
endpoint the frontend calls probed with its actual HTTP method.

## The database could not be built from scratch

Migrations stopped at **004 of 30**. Every environment that works today was
grown incrementally, so the failures below had never been exercised. A new
developer, a new deployment, or a restored-from-empty environment could not
have come up at all.

Fixed in the same change; the detail is in the commit message. In summary:

| Problem | Effect |
|---------|--------|
| Runner split SQL on `;` | Truncated every `DO` block and function in the set |
| `_OLD.sql` files executed | Four superseded files re-applied an older schema over the current one |
| No transaction per migration | A mid-file failure left the schema changed but the migration unrecorded |
| 005 redefined two of 004's views with unrelated contents | `authService` queries both by columns only 004 provides — those two superadmin queries fail wherever 005 ran |
| `superadmin_sessions` defined twice, incompatibly | `superadminSecurityService` used a third column name present in neither, so creating or validating a superadmin session always threw |
| Four tables redefined by a later migration | `CREATE TABLE IF NOT EXISTS` skipped each silently, leaving the new columns missing |
| Triggers on `incident_state_history` | That table exists in no migration and no code |
| Three `ADD CONSTRAINT` without `CHECK` | Syntax error — the audit scope/actor rules were never enforced |
| Several column and table name errors | A view selecting `sa.course_id` from a table that has neither that column nor `created_at`; `corporate_checkin` written singular; missing `attendance_record_id`, `is_verified`; a missing semicolon; a non-`IMMUTABLE` index predicate |

All 30 migrations now apply to an empty database — 107 tables, 24 views — and a
second run reports nothing pending.

## Two server entrypoints had diverged

`src/index.ts` and `src/server.ts` both build an Express app and mount
different sets of routes. `package.json` runs `server.ts`, and it was missing
six routers that exist on disk and that `index.ts` mounts:
`/api/admin`, `/api/faculty`, `/api/student`, `/api/face`, `/api/audit`,
`/api/time`.

That single omission accounted for **26 of the 68 dead endpoints**. Mounting
them is the fix; they are now mounted.

**This is worth resolving properly.** Two entrypoints that drift apart will do
this again. One should be deleted and the other made authoritative.

## Where it stands

Of the **85 endpoints the frontend calls**:

- **43 reachable** — they answer, mostly `401` unauthenticated, which is correct
- **42 return 404** — the route does not exist

The 42 are not a mounting problem; the routers are mounted and simply do not
define these paths.


**`/admin`** — 13 endpoints

- `DELETE /api/admin/users/1`
- `GET /api/admin/analytics`
- `GET /api/admin/approvals/pending`
- `GET /api/admin/courses`
- `GET /api/admin/export/tenant-report`
- `GET /api/admin/users`
- `POST /api/admin/approvals/approve`
- `POST /api/admin/approvals/reject`
- `POST /api/admin/courses`
- `POST /api/admin/users`
- `POST /api/admin/users/bulk-import`
- `PUT /api/admin/courses/1`
- `PUT /api/admin/users/1`

**`/hr`** — 12 endpoints

- `DELETE /api/hr/campaigns/1`
- `GET /api/hr/campaigns`
- `GET /api/hr/compliance/summary`
- `GET /api/hr/departments/metrics`
- `GET /api/hr/export/organization-report`
- `GET /api/hr/members`
- `GET /api/hr/members/1`
- `GET /api/hr/overview`
- `GET /api/hr/patterns`
- `POST /api/hr/campaigns`
- `POST /api/hr/campaigns/1/send`
- `POST /api/hr/notifications/send`

**`/attendance`** — 10 endpoints

- `GET /api/attendance/department/all`
- `GET /api/attendance/department/export`
- `GET /api/attendance/employees/1`
- `GET /api/attendance/me/courses`
- `GET /api/attendance/me/discrepancies`
- `GET /api/attendance/me/export`
- `GET /api/attendance/me/metrics`
- `GET /api/attendance/profile`
- `POST /api/attendance/notifications/send`
- `PUT /api/attendance/profile`

**`/faculty`** — 7 endpoints

- `GET /api/faculty/attendance/draft`
- `GET /api/faculty/attendance/export`
- `GET /api/faculty/courses/1/qr-code`
- `POST /api/faculty/attendance/bulk-edit`
- `POST /api/faculty/attendance/facial-match`
- `POST /api/faculty/attendance/lock`
- `POST /api/faculty/attendance/submit`


## What this means for the UI work

`/api/hr/*` has no router at all — the entire HR/EMS surface in the mockups
(screen 3b, the HR command centre) has no backend behind it. `hrService.ts`
calls twelve endpoints that were never written.

The `/api/admin/*` gaps are the tenant-admin user and course management the
school admin dashboard needs (screen 1a). `tenantAdmin.ts` is mounted but does
not implement users, courses, approvals, analytics or export.

The `/api/attendance/me/*` gaps are the student's own attendance view
(screen 1c), and the `/api/faculty/attendance/*` gaps are the submit, lock,
draft and export steps of the faculty capture flow (screen 1b).

So three of the four screens that DESIGN_AUDIT.md lists as "restyle, the page
exists" are partly backed by endpoints that do not exist. Restyling them would
produce screens that look right and do nothing.

## Suggested order

1. Delete one entrypoint and make the other authoritative, so mounts cannot
   drift again.
2. Implement the 42 missing endpoints against the existing schema, starting
   with the families the restyle targets depend on: `/admin`, then
   `/attendance/me`, then `/faculty/attendance`.
3. Build `/api/hr/*`, which is a new surface rather than a gap.
4. Only then restyle, so each screen is wired to something real.

## Reproducing this

```bash
# any PostgreSQL 16
createdb jjelotech_dev
cd apps/backend
export DATABASE_URL=postgresql://.../jjelotech_dev
npx tsx src/db/migrate.ts      # expect 30 applied, 0 failures
npx tsx src/server.ts
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/api/health   # 200
```
