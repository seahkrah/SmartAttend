# Guardians and the parent portal

A school records who each student's guardians are: parents, carers, grandparents,
sponsors. For each child it decides what each guardian may see. Guardians are told
about absences, invoices, payments and published results. If the school invites
them, they sign in to a read-only parent portal.

## The model

| Table | What it holds |
|---|---|
| `guardians` | A person at one school: name, email and/or phone, address, occupation, staff-only notes. `user_id` is set once they have a portal account. |
| `guardian_students` | The link between a guardian and a student: relationship, whether this guardian is the child's **primary contact** (at most one per child), and four switches (`can_view_attendance`, `can_view_results`, `can_view_fees`, `receives_notifications`). |

Both tables have a `NOT NULL tenant_id`. `guard_same_tenant()` (migration 055) refuses
a link that joins one school's guardian to another school's student, whatever route
it comes from. A guardian record needs either an email address or a phone number.
There's no point recording a contact nobody can reach.

The `guardian` role exists on the school platform only (migration 062).

## Why access is set per link

A sponsor paying the fees has no business reading the child's results. A separated
parent's access is a decision the school makes for each child. So access belongs to
each link, not to the guardian as a whole. The same guardian may see everything for
one child and only attendance for another.

## Recording comes first; an account is optional

Most guardians begin as a name and a phone number on an admission form. They get
absence and fee notices by SMS or email whether or not they ever sign in. A portal
account is a second step: **Guardians → Children and access → Email invitation**
(or **Setup link** to hand the single-use link over in person). Nobody at the school
chooses or sees the guardian's password.

A parent with children at two schools keeps **one** account. The second school's
invitation adds that school to the existing account (the portal lets them switch
schools like any multi-school account). An email that already signs in a student,
lecturer or administrator can't also be a guardian login. Sign-in finds an account
by email and platform, so two school accounts can't share an address.

Removing a guardian removes them from this school only. Their account is
deactivated only if it belongs to no other school.

## The portal

`/guardian` lists the guardian's children, each with the figures the school
shares. `/guardian/children/:id` has Overview, Attendance, Timetable, Results and
Fees. What the portal enforces:

- The guardian record comes from the signed-in identity and school, never from
  the request.
- A child is reachable only through a link to that guardian at that school.
  Anything else (another family's child, another school's student, a made-up id)
  returns **404**, so ids can't be probed.
- An area the school hasn't shared returns **403** with the reason. The guardian
  already knows the child exists, so the reason gives nothing away.
- Guardians see **issued** invoices only. A draft shown to the person paying reads
  as a bill the school hasn't sent. Students and staff still see drafts, marked
  as drafts.
- Results are published results only (the `student_transcript` view).
- The portal is read-only.

The student and staff routes don't become a way around these rules: `/fees/statement`,
`/gradebook/students/:id/transcript` and `/student/*` all refuse a guardian.

## Notifications

| Event | When | Needs |
|---|---|---|
| `guardian.absence` | A lecturer **submits** a register with the student marked absent | `can_view_attendance` |
| `guardian.invoice_issued` | An invoice for the student is issued | `can_view_fees` |
| `guardian.payment_received` | A payment is recorded against one | `can_view_fees` |
| `guardian.results_published` | Results for a course the student took are published | `can_view_results` |

Every notice also needs `receives_notifications`. Absence notices go out when the
register is submitted, not on each mark. A lecturer toggling a mark while taking the
register mustn't send a false alarm. They're deduplicated per student, course and day,
so re-submitting a corrected register doesn't send a second message. Delivery uses
the existing outbox: in-app for guardians with an account, and email and SMS wherever
the school recorded an address or number (simulated until the school configures a
provider).

## Tests

`apps/backend/src/tests/guardiansApi.e2e.py` has 106 checks: management, validation,
tenant and family isolation, per-area permissions, invitation and activation through
to sign-in, the portal, the side-door routes, notifications and removal.
