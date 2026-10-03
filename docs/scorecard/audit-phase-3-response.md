# Response to the Phase 3 independent audit

The audit is [audit-phase-3.md](audit-phase-3.md), by an agent that had not
seen the implementer's reasoning. It reran every gate and the full e2e runner
at `6cd2f23` (43 suites passing), confirmed the permission map against what
Express serves, and confirmed findings #32 to #35 were fixed. It then found
six defects by reading the code. It did not reproduce F1 to F3 over HTTP;
the regressions below do.

Its scores were lower on four dimensions:

| Dimension | Implementer | Audit |
|---|---|---|
| Tenant isolation | 8.5 | 7.3 |
| Authentication | 8.5 | 7.5 |
| Authorisation and audit | 8.5 | 7.5 |
| Compliance | 4.0 | 3.0 |

By rule 5 of `rubric.yml` those lower scores stand for Phase 3. The causes
were fixed before the phase closed, as follows.

## Defects

| # | Audit finding | Action |
|---|---|---|
| F1 | **High: one tenant changes a shared account everywhere.** `PUT /api/admin/users/:userId` and the school-admin actions write `users.role_id` and `is_active`, which belong to the account, not the tenant. | Fixed (findings #37). The audit also asked whether the routes' "belongs to another organisation" checks could see other tenants. They could not: `user_tenant_memberships` is a `security_invoker` view under row-level security, so every such check quietly passed. `authService.memberElsewhere` now asks on the system pool. A shared account's role, status and details are refused (409) or left as they are, and only the membership here changes. This applies to admin edits, school-admin actions, student and lecturer edits and suspensions, guardian edits and removals, and employee termination. A trigger is the backstop. Migration 083's first version needed a SECURITY DEFINER function to see other tenants, and `rlsNoContext` refused it (the platform has none). Migration 084 replaces it: each account counts its live memberships in `users.membership_count`, kept by BEFORE triggers on the membership tables, which need no view of other tenants. Outside the system pool, an account counting more than one keeps its role, status and details, except the person's own details, and only those triggers can change the count. Tested over HTTP (`privilegeEscalation`: role and status refused, account unchanged by a disable) and in the database (`identityIsolation`: switching off and renaming refused, an unshared account still editable, the count cannot be rewritten). |
| F2 | Medium: lecturers write attendance for classes they do not teach. | Fixed (#38). Opening a session needs the course to be one the caller teaches. The session is the caller's, and naming another lecturer is refused (404 outside the tenant, 403 inside). Changing or marking a session needs the caller to teach its course. The earlier answers for another tenant's course (404) and an unknown session when marking (400) are kept. Tested with a second lecturer in the same school. |
| F3 | Medium: raising one's own pay or hours. | Fixed (#39). Pay components (add and remove), payroll inputs (add and remove), writing, changing or activating a contract, timesheet hours, and the timesheet decision all refuse the caller's own record. The decision also refuses the person it is for, not only whoever submitted it. Tested with HR's and the manager's own records. |
| F4 | Low: `it` and `manager` read and delete every file. | Fixed (#40): `FILE_STAFF_ROLES` (admin, hr, hr_director) in one place. Tested: a manager and an IT user cannot read or delete an employee's file, and HR can. |
| F5 | Low: managers act tenant-wide in leave. | Agreed; **open** (#41). Reporting lines exist (`employees.manager_id`) but nothing sets them, and the leave and roster suites assume tenant-wide managers. |
| F6 | Low: `requireRole` reads the role from the token. | Fixed (#42): it reads the account's current role. |

## Weak gates

| Gate | Audit said | Now |
|---|---|---|
| W1 | `router.all` and RegExp routes are invisible. | In the map, as `ALL` and under their pattern, and they must be declared: 571 routes. The 8 retired `router.all` routes declare that they answer 410 to everyone. The route inventory, which the fuzzer fills in, still lists method routes only. |
| W2 | The gate does not check order. | A tag on a route's last function (after the handler) no longer counts, and the gate fails on it. Shown failing with a probe route. |
| W3 | 107 routes rest on written claims, lightly tested. | Still true, and now said in `authorisation.md`. The suite adds cases for lecturer writes, self-dealing, file staff and shared accounts. |
| W4 | Every parameter filled with a nonexistent UUID; 404 counted as a refusal. | Parameters named for students, courses, schedules, lecturers, departments, semesters and employees are filled with the caller's tenant's real ids. 113 of 4,012 calls still answer 404, and the suite reports the count. |
| W5 | No guardian or IT caller. | Added: a guardian, a school IT and a corporate IT user, made by the suite (eleven callers). `security_officer` is not a role anyone holds, and the docs now say so. |
| W6 | Sibling-router middleware is not shown. | Not changed. As the audit says, it is harmless today; noted here. |

## Scores

The audit's lower scores stand for this phase: tenant isolation 7.3,
authentication 7.5, authorisation and audit 7.5, compliance 3.0. The
regenerated scorecard applies them. The fixes above are what the next audit
should find in place.
