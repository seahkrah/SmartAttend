# Roadmap: to a pilot school in Monrovia

The goal, unchanged from the original MVP scope:

> One private school in Monrovia runs a complete term (enrolment, daily
> attendance, fee billing and collection, printed receipts and class lists)
> on the platform, and a second school onboards itself.

The platform is the Express/TypeScript build under `apps/`
([decisions/2026-09-30-keep-express-platform.md](decisions/2026-09-30-keep-express-platform.md)).
Stages are in order; each ends with the full check suite green.

## Stage 0 · Consolidate (days)

- [ ] Merge this branch into `main` (it is 59 commits ahead; `main` still
      holds the old prototype README).
- [ ] Review `feat/sms-reorg-phases-0-1` for anything not superseded, then
      archive it and `feat/jjelotech-mvp`.
- [ ] README reflects two-factor sign-in and links this roadmap.

## Stage 1 · Fit a Liberian K–12 school (≈2–3 weeks)

The pilot cannot start without these.

1. **K–12 academic structure.** Grade levels (nursery to 12th grade),
   classes/streams within a level, class teachers, subjects per level.
   Coexists with the tertiary model; a tenant chooses which it is.
   Attendance, enrolment and fees key off class and level.
   **Bulk roll-forward:** promote a whole school to the next year.
2. **Two currencies.** LRD and USD on fee items, invoices and payments; a
   payment in one currency against an invoice in the other records the rate
   used. Statements show both.
3. **Ledger.** Double-entry entries for every invoice, payment, waiver and
   reversal; a per-tenant trial balance that must be zero, checked in e2e.
4. **Mobile money by CSV.** Import a wallet statement (Orange Money, MTN
   Lonestar), match lines to students/invoices by reference, review, post.
5. **Paper.** Receipts, class lists and arrears statements: print layout and
   PDF.
6. **Assumption ledger.** Port `assumptions.yml`; a page in the superadmin
   console; features it blocks refuse to go live.

## Stage 2 · Work on a bad connection (≈2 weeks)

- [ ] Installable web app with a service worker; the shell loads offline.
- [ ] Offline attendance: a teacher's class roster is cached, marks are
      queued in IndexedDB and synced; conflicts resolved by server time,
      shown to the teacher.
- [ ] SMS delivery through one real provider available in Liberia: fee
      reminders and absence alerts to guardians (the outbox and templates
      exist).

## Stage 3 · Production readiness (≈1–2 weeks)

- [ ] Refresh token in an `httpOnly`, `SameSite=Strict` cookie with CSRF
      protection; nothing in `localStorage`.
- [ ] Staging environment; uptime and error alerting; a metrics exporter.
- [ ] Hosting sized and priced for the pilot; backups off the machine.
- [ ] Data import tooling for the pilot school's existing spreadsheets.
- [ ] Self-serve tenant onboarding wizard.
- [ ] Configurable MoE census and WAEC candidate exports (formats from the
      pilot school's last submissions).

## Stage 4 · Pilot, one term

Run it with one school. Measure fee collection, attendance capture and
support load. Gradebook and report cards are already built; switch them on
once the school has used fees and attendance for some weeks.

## Later, driven by the pilot

- Timetabling; assignments.
- Automated mobile-money confirmation (needs merchant API access).
- Employer side for Liberia: PAYE and NASSCORP rules, blocked on written
  rate schedules (see the assumption ledger).
- Passkeys (WebAuthn), single sign-on, shared rate-limit store for multiple
  API replicas.
