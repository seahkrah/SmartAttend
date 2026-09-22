# JjeloTech mockups — audit against the current application

Source: `design/JjeloTech Mockups.html` — 20 screens across six rounds (`t1`–`t6`).

This is a read of the design against what exists today. No code has been changed
on the basis of it yet.

## The headline

The mockups are not a restyle of the current app. They describe a **full School
Management System plus an Employee Management System**, with attendance as one
module inside each. The current codebase is an attendance product with some
admin around it.

Roughly a third of the screens restyle something that exists. The rest need
domains that have no tables, no routes, and no pages: admissions, curriculum,
fees, examinations, timesheets, and a guardian role.

## Design tokens

Every one of these differs from the current app.

| Token | Mockups | Current |
|-------|---------|---------|
| Primary | `#1d4ed8` blue | `#5d7fff` indigo |
| Accent | `#f7941d` orange | `#22c55e` green |
| Secondary | — (none; orange carries emphasis) | `#8b5cf6` violet |
| Dark ground | `#0b1220`, `#101828` | `slate-900` / `slate-950` |
| Light surfaces | `#f2f4f9`, `#f0f3f9`, `#eef3fd` | none — app is dark-only |
| Body text | `#475467`, `#344054`, `#667085` | `slate-300` / `slate-400` |
| Success / warning / danger | `#12b76a` / `#f7b35e` / `#b42318` | `green-500` / `amber-500` / `red-500` |
| Font | **Archivo** (Google Fonts) | Inter |

The orange is used sparingly and deliberately: the hero tile on the EMS
dashboard, primary actions on dark surfaces, and "needs attention" states. It is
not a general-purpose accent.

## Theming

Screens are split light and dark on purpose, by surface rather than by user
preference:

- **Light** — all admin and record surfaces: school admin, EMS, academics,
  operations, finance, admissions, settings, student portal, parent portal,
  transcript.
- **Dark** — faculty attendance capture, authentication, superadmin control
  plane, mobile check-in, and every marketing landing.

The app today is dark-only with no theme layer. This is the single largest
structural change, because it touches every component, not just the pages.

## Information architecture

The mockups use **one shell for both platforms**, with a `School | Employees`
switcher at the top of the sidebar and navigation grouped under headings.

```
School                          Employees
  OVERVIEW                        OVERVIEW
    Dashboard, Reports              Dashboard, HR analytics
  PEOPLE                          WORKFORCE
    Users, Students, Faculty        Employees, Departments, Roles & contracts
  ACADEMICS                       TIME & ATTENDANCE
    Colleges & Departments          Attendance, Shifts & rosters,
    Programmes & Curriculum         Timesheets, Leave requests
    Courses & Sections            SYSTEM
  OPERATIONS                        Incidents, Settings
    Rooms & Schedules,
    Enrollment, Attendance
  SYSTEM
    Approvals, Settings
```

Today these are separate layouts with flat navigation — `SchoolAdminLayout`,
`TenantAdminLayout`, `FacultyLayout`, `StudentLayout`, `SuperadminLayout`. The
school and corporate sides are entirely separate page trees (`SchoolAdmin*` vs
`CorporateAdmin*`) rather than one shell with a switcher.

## Screen-by-screen

| # | Mockup | Closest existing | Verdict |
|---|--------|------------------|---------|
| 1a | School Admin command dashboard | `SchoolAdminDashboardPage` | Restyle + regroup nav |
| 1b | Faculty attendance, live face scan | `FacultyAttendanceWorkflowPage`, `FaceCaptureComponent` | Restyle; the mechanism exists |
| 1c | Student portal, today at a glance | `StudentDashboardPage` | Restyle |
| 1d | Marketing landing, brand motif | `LandingPage` | Rebuild |
| 2a | SMS landing, module grid | `LandingPage` | New variant |
| 2b | Academics — programme & curriculum builder | — | **New domain** |
| 2c | Operations — timetable, clash detection | `SchoolAdminSchedulesPage` | Major rework |
| 2d | Finance — fees, invoices, clearance | — | **New domain** |
| 2e | Examinations — results & transcript approval | — | **New domain** |
| 3a | Corporate landing | — | New |
| 3b | EMS HR command centre | `CorporateAdminDashboardPage`, `HRAnalyticsPanelPage` | Restyle + regroup |
| 4a | Admissions — applicant pipeline | — | **New domain** |
| 4b | Superadmin control plane | `SuperadminDashboardPage`, `SuperadminConsolePage` | Restyle |
| 4c | EMS employee profile & timesheet | — | New — no timesheet model |
| 4d | Academic transcript, printable | — | **New** |
| 5a | Parent / guardian portal | — | **New role** — no guardian concept anywhere |
| 5b | Mobile check-in, both platforms | — | New |
| 6a | Authentication — sign in, register, superadmin | `LoginPage`, `RegisterPage`, `SuperadminLoginPage` | Restyle |
| 6b | Institution settings | `SchoolAdminSettingsPage` | Rework |
| 6c | Shared states & dialogs kit | `LoadingStates`, `ErrorDisplay`, `ConfirmationDialog`, `Toast` | Consolidate + restyle |

## Backend implications

The new domains are not front-end work. Each needs schema, routes and services
that do not exist:

- **Admissions** — applicants, intakes, rounds, review decisions
- **Curriculum** — programmes, versioned curricula, accreditation dates
- **Finance** — fee schedules, invoices, payments, clearance status
- **Examinations** — results, approval workflow, transcript generation
- **Timesheets & shifts** — rosters, shift coverage, overtime, payroll export
- **Guardians** — a role linked to students, with its own scoped portal
- **Leave management** — requests, approvals, balances

Details worth noting from the screens: settings carries institution-level
attendance rules (late threshold, minimum attendance to sit exams, geofencing,
guardian notification); the transcript is a printable document, not a page; and
the mobile check-in is one surface shared by students and employees.

## What I would suggest

Sequencing that gets visible value early without painting us into a corner:

1. **Design tokens and the theme layer.** Palette, Archivo, and light/dark
   support in `tailwind.config.js` and `index.css`. Everything else depends on
   it, and nothing else can be done properly first.
2. **The shared shell.** One layout with the platform switcher and grouped
   navigation, replacing the five separate layouts.
3. **The states kit (6c).** Empty, loading, error and permission states, plus
   dialogs and toasts — reused by every screen after this.
4. **Restyle what exists** — the eight screens in the table above that map onto
   real pages.
5. **New domains, one at a time**, each as a vertical slice through schema,
   API and UI. Admissions and Academics are the natural first two, since
   enrolment and results both depend on them.

Steps 1–4 are a realistic near-term target. Step 5 is a programme of work, not
a task — each domain is roughly the size of the attendance feature that already
exists.

## Viewing the mockups

Open `design/JjeloTech Mockups.html` in a browser. It is self-contained — fonts
and images are embedded. Screens are labelled `1a` through `6c` down the canvas.
