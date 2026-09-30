"""
EMS contracts, rosters and timesheets — the last three gaps, and the chain
that joins them.

These were built together because they are one chain rather than three
modules: a contract says how many hours somebody is engaged for, a roster
plans which ones, a timesheet records which ones happened, and the difference
between the last and the first is overtime, which is money.

So the assertions here fall into two halves. The first checks each link:
contracts cannot overlap, a published shift cannot be quietly retimed, hours
come from evidence rather than assertion. The second checks the joins, which
is where the value is and where the bugs would be — that a timesheet measures
against the contract that was in force and not the one signed since, that
approved leave reduces what somebody was contracted to work, that a revoked
check-in is not paid time, and that the overtime which reaches payroll is the
overtime that was signed off.

As everywhere else: function, tenant isolation, platform isolation, role.
"""
import json, subprocess, sys, time, os
from datetime import date, timedelta

RUN = str(int(time.time()))[-6:]
SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
c = json.load(open(f"{SP}/corp.json")); A, B = c['A'], c['B']
s = json.load(open(f"{SP}/seed.json")); SCHOOL = s['A']['token']
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
P = F = 0

def call(m, p, t, body=None, base="/workforce"):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "30", "-X", m,
           "-H", "Content-Type: application/json"]
    if t:
        cmd += ["-H", f"Authorization: Bearer {t}"]
    cmd.append(ROOT + base + p)
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    o = subprocess.run(cmd, capture_output=True, text=True).stdout
    txt, _, code = o.rpartition("\n")
    try:
        parsed = json.loads(txt)
    except Exception:
        parsed = txt
    return int(code), parsed

def check(n, ok, dd=""):
    global P, F
    if ok:
        P += 1; print(f"  ok    {n}")
    else:
        F += 1; print(f"  FAIL  {n} {dd}")

def num(v):
    try:
        return round(float(v), 2)
    except Exception:
        return None

HR_A, HR_B = A['token'], B['token']
DIR_A, DIR_B = A['dirToken'], B['dirToken']
EMP_A, EMP_B = A['empToken'], B['empToken']
E_A1, E_A2, E_A3 = A['employees'][0], A['employees'][1], A['employees'][2]
E_B1, E_B3 = B['employees'][0], B['employees'][2]
TS_A, TS_B = A['timesheetEmpId'], B['timesheetEmpId']
# The fixture lays down six identical weeks of check-ins. A run takes one of
# them, because it ends by exporting the sheet to payroll and an exported
# sheet cannot be rebuilt — which is the point of the module, and would make a
# single shared week usable exactly once per seed.
WEEK_A = A['timesheetWeeks'][int(RUN) % len(A['timesheetWeeks'])]
GHOST = "00000000-0000-4000-8000-000000000000"

def WDAY(n):
    """The nth day of the chosen week, as YYYY-MM-DD."""
    y, m, d = (int(x) for x in WEEK_A['start'].split('-'))
    return (date(y, m, d) + timedelta(days=n)).isoformat()

# The suite's own contracts live in a year of their own, so running it twice
# against one fixture cannot trip the no-overlapping-contracts constraint.
YEAR = 2040 + (int(RUN) % 55)
CS, CE = f"{YEAR}-01-01", f"{YEAR}-12-31"
# A Monday inside that year, for rostering.
MON = date(YEAR, 6, 1)
while MON.weekday() != 0:
    MON += timedelta(days=1)
r_day = lambda n: (MON + timedelta(days=n)).isoformat()

print(f"-- contract year {YEAR}, roster week from {r_day(0)} --")

print("-- platform and authentication isolation --")
co, r = call("GET", "/contracts", SCHOOL)
check("an SMS identity is refused from EMS contracts", co == 403, f"({co} {r})")
co, r = call("GET", "/shift-patterns", SCHOOL)
check("an SMS identity cannot read shift patterns", co == 403, f"({co} {r})")
co, r = call("GET", "/timesheets", SCHOOL)
check("an SMS identity cannot read timesheets", co == 403, f"({co} {r})")
co, r = call("GET", f"/roster?from={r_day(0)}&to={r_day(6)}", SCHOOL)
check("an SMS identity cannot read the roster", co == 403, f"({co} {r})")
co, r = call("GET", "/contracts", None)
check("contracts need a token", co in (401, 403), f"({co})")

# ===========================================================================
print("-- contracts --")
# ===========================================================================
co, r = call("POST", "/contracts", HR_A, {
    "employeeId": E_A3, "reference": f"CT-{RUN}", "contractType": "permanent",
    "jobTitle": "Operations Lead", "startDate": CS, "endDate": CE,
    "weeklyHours": 37.5, "workingDays": 5, "noticePeriodDays": 60})
check("HR drafts a contract", co == 201, f"({co} {r})")
ct = r.get('contract', {}).get('id') if co == 201 else None
check("a new contract is a draft",
      co == 201 and r['contract']['status'] == 'draft', f"({r})")

co, r = call("POST", "/contracts", HR_A, {
    "employeeId": E_A3, "reference": f"CT-{RUN}B", "contractType": "fixed_term",
    "jobTitle": "Temp", "startDate": CS})
check("a fixed-term agreement without an end date is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/contracts", HR_A, {
    "employeeId": E_A3, "reference": f"CT-{RUN}C", "jobTitle": "X",
    "startDate": CE, "endDate": CS})
check("a contract ending before it starts is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/contracts", HR_A, {
    "employeeId": E_A3, "reference": f"CT-{RUN}D", "jobTitle": "X",
    "startDate": CS, "endDate": CE, "weeklyHours": 200})
check("a week with more hours than it has is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/contracts", HR_A, {
    "employeeId": E_A3, "reference": f"CT-{RUN}E", "jobTitle": "X",
    "startDate": "not-a-date"})
check("a malformed start date is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/contracts", HR_A, {
    "employeeId": E_A3, "reference": f"CT-{RUN}F", "jobTitle": "X",
    "startDate": f"{YEAR}-02-30", "endDate": CE})
check("a date that does not exist is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/contracts", HR_A, {
    "employeeId": E_A3, "reference": f"CT-{RUN}G", "jobTitle": "X",
    "startDate": CS, "endDate": CE, "managerId": E_A3})
check("somebody cannot report to themselves", co == 400, f"({co} {r})")

co, r = call("POST", "/contracts", EMP_A, {
    "employeeId": E_A3, "reference": f"SELF-{RUN}", "jobTitle": "Director",
    "startDate": CS, "endDate": CE})
check("an employee cannot write themselves a contract", co == 403, f"({co} {r})")
co, r = call("POST", "/contracts", HR_A, {
    "employeeId": E_B3, "reference": f"X-{RUN}", "jobTitle": "X",
    "startDate": CS, "endDate": CE})
check("A cannot contract B's employee", co == 404, f"({co} {r})")

co, r = call("PATCH", f"/contracts/{ct}", HR_A, {"jobTitle": "Operations Manager"})
check("a draft's terms can be revised", co == 200, f"({co} {r})")
check("the revision took", co == 200 and r['contract']['job_title'] == 'Operations Manager', f"({r})")

co, r = call("POST", f"/contracts/{ct}/activate", HR_A)
check("HR activates the contract", co == 200, f"({co} {r})")
check("it is active", co == 200 and r['contract']['status'] == 'active', f"({r})")
check("activating stamps when it was signed",
      co == 200 and r['contract']['signed_at'] is not None, f"({r})")

co, r = call("PATCH", f"/contracts/{ct}", HR_A, {"weeklyHours": 20})
check("an active contract's terms cannot be edited", co == 409, f"({co} {r})")
co, r = call("POST", f"/contracts/{ct}/activate", HR_A)
check("activating twice is refused", co == 409, f"({co} {r})")
co, r = call("DELETE", f"/contracts/{ct}", HR_A)
check("an active contract cannot be withdrawn", co == 409, f"({co} {r})")

co, r = call("POST", "/contracts", HR_A, {
    "employeeId": E_A3, "reference": f"CT-{RUN}OVER", "jobTitle": "Second job",
    "startDate": f"{YEAR}-06-01", "endDate": f"{YEAR}-09-30"})
check("a second contract overlapping the first is refused", co == 409, f"({co} {r})")

co, r = call("GET", "/contracts", HR_A)
a_refs = [x['reference'] for x in r.get('contracts', [])] if co == 200 else []
check("HR lists the tenant's contracts", co == 200 and f"CT-{RUN}" in a_refs, f"({co} {a_refs[:4]})")
co, r = call("GET", "/contracts", HR_B)
b_refs = [x['reference'] for x in r.get('contracts', [])] if co == 200 else []
check("B's list does not include A's contract", f"CT-{RUN}" not in b_refs, f"({b_refs[:4]})")
co, r = call("GET", "/contracts", EMP_A)
check("an employee cannot list the tenant's contracts", co == 403, f"({co} {r})")

co, r = call("PATCH", f"/contracts/{ct}", HR_B, {"jobTitle": "hijacked"})
check("B cannot touch A's contract", co == 404, f"({co} {r})")
co, r = call("POST", f"/contracts/{ct}/end", DIR_B, {"endDate": CE, "reason": "not mine"})
check("B's director cannot end A's contract", co == 404, f"({co} {r})")

print("-- an employee's own contract --")
co, r = call("GET", "/my/contract", EMP_A)
check("an employee reads their own contract", co == 200, f"({co} {r})")
# The fixture's contract belongs to a different employee, so the token used
# here should see either its own or nothing — never somebody else's.
if co == 200 and r.get('contract'):
    check("and it is theirs, not a colleague's",
          r['contract']['reference'] != f"CT-{RUN}", f"({r['contract']})")
co, r = call("GET", f"/contracts/{ct}", EMP_A)
check("an employee cannot read a colleague's contract", co == 404, f"({co} {r})")

print("-- ending a contract --")
co, r = call("POST", f"/contracts/{ct}/end", HR_A, {"endDate": r_day(30), "reason": "Resigned"})
check("plain HR cannot end a contract", co == 403, f"({co} {r})")
co, r = call("POST", f"/contracts/{ct}/end", DIR_A, {"endDate": r_day(30)})
check("ending a contract has to say why", co == 400, f"({co} {r})")
co, r = call("POST", f"/contracts/{ct}/end", DIR_A, {
    "endDate": f"{YEAR - 5}-01-01", "reason": "Backdated"})
check("a contract cannot end before it started", co == 400, f"({co} {r})")

# ===========================================================================
print("-- shift patterns --")
# ===========================================================================
co, r = call("POST", "/shift-patterns", HR_A, {
    "code": f"EARLY{RUN}", "name": "Early", "startTime": "06:00",
    "endTime": "14:00", "breakMinutes": 30, "colour": "#3366CC"})
check("HR defines a day pattern", co == 201, f"({co} {r})")
early = r.get('pattern', {}).get('id') if co == 201 else None
check("its paid hours are worked out from its times",
      co == 201 and num(r['pattern']['paid_hours']) == 7.5, f"({r})")
check("and it does not cross midnight",
      co == 201 and r['pattern']['crosses_midnight'] is False, f"({r})")

co, r = call("POST", "/shift-patterns", HR_A, {
    "code": f"NIGHT{RUN}", "name": "Night", "startTime": "22:00",
    "endTime": "06:00", "breakMinutes": 60})
check("a night pattern is allowed", co == 201, f"({co} {r})")
night = r.get('pattern', {}).get('id') if co == 201 else None
check("a night shift's hours wrap past midnight rather than going negative",
      co == 201 and num(r['pattern']['paid_hours']) == 7.0, f"({r})")
check("and it is marked as crossing midnight",
      co == 201 and r['pattern']['crosses_midnight'] is True, f"({r})")

co, r = call("POST", "/shift-patterns", HR_A, {
    "code": f"BAD{RUN}", "name": "All break", "startTime": "09:00",
    "endTime": "12:00", "breakMinutes": 200})
check("a break longer than the shift is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/shift-patterns", HR_A, {
    "code": f"BAD2{RUN}", "name": "Zero", "startTime": "09:00", "endTime": "09:00"})
check("a shift starting and ending at the same time is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/shift-patterns", HR_A, {
    "code": f"BAD3{RUN}", "name": "Nonsense", "startTime": "25:00", "endTime": "26:00"})
check("an impossible time is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/shift-patterns", EMP_A, {
    "code": f"MINE{RUN}", "name": "Mine", "startTime": "10:00", "endTime": "11:00"})
check("an employee cannot define shift patterns", co == 403, f"({co} {r})")

co, r = call("POST", "/shift-patterns", HR_B, {
    "code": f"EARLY{RUN}", "name": "Early", "startTime": "07:00", "endTime": "15:00"})
check("B may reuse A's pattern code", co == 201, f"({co} {r})")
early_b = r.get('pattern', {}).get('id') if co == 201 else None
co, r = call("POST", "/shift-patterns", HR_A, {
    "code": f"EARLY{RUN}", "name": "Duplicate", "startTime": "08:00", "endTime": "16:00"})
check("still unique within A", co == 409, f"({co} {r})")
co, r = call("GET", "/shift-patterns", HR_A)
a_pats = [x['id'] for x in r.get('patterns', [])] if co == 200 else []
check("A's patterns do not include B's", early_b not in a_pats, f"({len(a_pats)})")
co, r = call("PATCH", f"/shift-patterns/{early_b}", HR_A, {"name": "hijacked"})
check("A cannot edit B's pattern", co == 404, f"({co} {r})")

co, r = call("PATCH", f"/shift-patterns/{early}", HR_A, {"breakMinutes": 600})
check("a change that swallows the shift is refused", co == 400, f"({co} {r})")

# ===========================================================================
print("-- the roster --")
# ===========================================================================
co, r = call("POST", "/roster", HR_A, {
    "employeeId": E_A3, "patternId": early, "workDate": r_day(0)})
check("HR rosters a shift from a pattern", co == 201, f"({co} {r})")
shift1 = r.get('shift', {}).get('id') if co == 201 else None
check("the shift copies the pattern's name",
      co == 201 and r['shift']['name'] == 'Early', f"({r})")
check("and its hours", co == 201 and num(r['shift']['paid_hours']) == 7.5, f"({r})")

co, r = call("POST", "/roster", HR_A, {
    "employeeId": E_A3, "patternId": early, "workDate": r_day(0)})
check("the same person cannot be rostered twice over one span", co == 409, f"({co} {r})")

co, r = call("POST", "/roster", HR_A, {
    "employeeId": E_A3, "workDate": r_day(0), "startTime": "13:00", "endTime": "18:00"})
check("nor onto a shift that merely overlaps", co == 409, f"({co} {r})")
co, r = call("POST", "/roster", HR_A, {
    "employeeId": E_A3, "workDate": r_day(0), "startTime": "14:00", "endTime": "18:00"})
check("but a shift starting as the last one ends is fine", co == 201, f"({co} {r})")
shift_late = r.get('shift', {}).get('id') if co == 201 else None

# The decisive case for storing real instants rather than times of day.
co, r = call("POST", "/roster", HR_A, {
    "employeeId": E_A3, "patternId": night, "workDate": r_day(1)})
check("a night shift rosters", co == 201, f"({co} {r})")
night_shift = r.get('shift', {}).get('id') if co == 201 else None
co, r = call("POST", "/roster", HR_A, {
    "employeeId": E_A3, "workDate": r_day(2), "startTime": "05:00", "endTime": "09:00"})
check("a morning shift overlapping the night before it is refused", co == 409, f"({co} {r})")

co, r = call("POST", "/roster", HR_A, {
    "employeeId": E_A1, "patternId": early, "workDate": r_day(0)})
check("somebody with no contract that day cannot be rostered", co == 409, f"({co} {r})")
co, r = call("POST", "/roster", HR_A, {
    "employeeId": E_B3, "patternId": early, "workDate": r_day(3)})
check("A cannot roster B's employee", co == 404, f"({co} {r})")
co, r = call("POST", "/roster", HR_A, {
    "employeeId": E_A3, "patternId": early_b, "workDate": r_day(3)})
check("A cannot roster from B's pattern", co == 404, f"({co} {r})")
co, r = call("POST", "/roster", EMP_A, {
    "employeeId": E_A3, "patternId": early, "workDate": r_day(3)})
check("an employee cannot roster anybody", co == 403, f"({co} {r})")

print("-- rostering a week at a time --")
co, r = call("POST", "/roster/bulk", HR_A, {
    "employeeId": E_A3, "patternId": early,
    "from": r_day(7), "to": r_day(13), "weekdays": [1, 2, 3, 4, 5]})
check("a pattern rosters across a week", co == 201, f"({co} {r})")
check("five weekdays were rostered", co == 201 and r['rostered'] == 5, f"({r})")
check("and nothing clashed", co == 201 and len(r.get('clashes', [])) == 0, f"({r})")

co, r = call("POST", "/roster/bulk", HR_A, {
    "employeeId": E_A3, "patternId": early,
    "from": r_day(7), "to": r_day(13), "weekdays": [1, 2, 3, 4, 5]})
check("running it again rosters nothing", co == 201 and r['rostered'] == 0, f"({r})")
check("and reports every clash rather than skipping silently",
      co == 201 and len(r.get('clashes', [])) == 5, f"({r.get('clashes')})")

print("-- publishing --")
co, r = call("GET", f"/roster?from={r_day(0)}&to={r_day(13)}", EMP_A)
check("an employee sees no unpublished shifts",
      co == 200 and len(r.get('shifts', [])) == 0, f"({co} {r})")
co, r = call("GET", f"/roster?from={r_day(0)}&to={r_day(13)}", HR_A)
check("HR sees the whole roster", co == 200 and len(r.get('shifts', [])) >= 8, f"({co} {r})")
check("HR's view is the whole tenant", co == 200 and r.get('scope') == 'all', f"({r.get('scope')})")

co, r = call("GET", f"/roster/coverage?from={r_day(0)}&to={r_day(13)}", HR_A)
check("coverage reports the days", co == 200 and len(r.get('days', [])) >= 6, f"({co} {r})")
if co == 200 and r.get('days'):
    check("and says how much of it is still unpublished",
          all(d['unpublished'] == d['shifts'] for d in r['days']), f"({r['days'][:3]})")
co, r = call("GET", f"/roster/coverage?from={r_day(0)}&to={r_day(13)}", EMP_A)
check("an employee cannot read coverage", co == 403, f"({co} {r})")

co, r = call("POST", "/roster/publish", EMP_A, {"from": r_day(0), "to": r_day(13)})
check("an employee cannot publish a roster", co == 403, f"({co} {r})")
co, r = call("POST", "/roster/publish", HR_A, {"from": r_day(0), "to": r_day(13)})
check("HR publishes the fortnight", co == 200, f"({co} {r})")
check("every scheduled shift went out", co == 200 and r.get('published', 0) >= 8, f"({r})")

co, r = call("POST", "/roster/publish", HR_A, {"from": r_day(0), "to": r_day(13)})
check("publishing again publishes nothing", co == 200 and r.get('published') == 0, f"({r})")

co, r = call("GET", f"/roster?from={r_day(0)}&to={r_day(13)}", HR_B)
check("B's roster does not show A's shifts",
      co == 200 and len(r.get('shifts', [])) == 0, f"({co} {r})")

print("-- a published shift is a commitment --")
co, r = call("GET", f"/roster/{shift1}", HR_A) if False else (0, {})
co, r = call("PATCH", f"/shift-patterns/{early}", HR_A, {"name": "Early (revised)"})
check("the pattern can still be renamed", co == 200, f"({co} {r})")
co, r = call("GET", f"/roster?from={r_day(0)}&to={r_day(0)}", HR_A)
if co == 200 and r.get('shifts'):
    names = [x['name'] for x in r['shifts']]
    check("a published shift keeps the name it was rostered under",
          'Early' in names and 'Early (revised)' not in names, f"({names})")

co, r = call("POST", f"/roster/{shift_late}/cancel", HR_A, {})
check("cancelling a shift has to say why", co == 400, f"({co} {r})")
co, r = call("POST", f"/roster/{shift_late}/cancel", HR_B, {"reason": "not mine"})
check("B cannot cancel A's shift", co == 404, f"({co} {r})")
co, r = call("POST", f"/roster/{shift_late}/cancel", HR_A, {"reason": "Cover no longer needed"})
check("HR cancels a shift", co == 200, f"({co} {r})")
co, r = call("POST", f"/roster/{shift_late}/cancel", HR_A, {"reason": "again"})
check("cancelling twice is refused", co == 409, f"({co} {r})")
co, r = call("POST", "/roster", HR_A, {
    "employeeId": E_A3, "workDate": r_day(0), "startTime": "14:00", "endTime": "18:00"})
check("a cancelled shift frees its span for another", co == 201, f"({co} {r})")

co, r = call("GET", f"/roster?from={r_day(0)}&to={r_day(13)}", EMP_A)
check("an employee still sees none of a colleague's published shifts",
      co == 200 and len(r.get('shifts', [])) == 0, f"({co} {r})")
check("and their scope says so", co == 200 and r.get('scope') == 'mine', f"({r.get('scope')})")
co, r = call("GET", "/roster?from=nonsense&to=nonsense", HR_A)
check("a malformed range is refused", co == 400, f"({co} {r})")

# ===========================================================================
print("-- timesheets: the evidence --")
# ===========================================================================
W_FROM, W_TO = WEEK_A['start'], WEEK_A['end']

co, r = call("GET", f"/timesheets/preview?employeeId={TS_A}&from={W_FROM}&to={W_TO}", HR_A)
check("HR previews a timesheet", co == 200, f"({co} {r})")
if co == 200:
    p = r['preview']
    #  Mon-Thu 08:00-16:30 = 4 x 8.5 = 34.00
    #  Fri     08:00-18:00 =           10.00  -> 44.00 worked
    #  Sat     09:00-13:00 FLAGGED      4.00  -> reported, never counted
    #  Sun     09:00-12:00 REVOKED      3.00  -> not counted at all
    #  Contract 40 h over 5 days, week is 7 days -> 40.00 contracted
    check("worked hours come from the closed, verified check-ins",
          num(p['workedHours']) == 44.0, f"({p})")
    check("a flagged check-in is reported rather than counted",
          num(p['flaggedHours']) == 4.0, f"({p})")
    check("a revoked check-in is not paid time at all",
          num(p['workedHours']) == 44.0 and num(p['flaggedHours']) == 4.0, f"({p})")
    check("contracted hours come from the contract in force",
          num(p['contractedHours']) == 40.0, f"({p})")
    check("approved hours default to what the evidence says",
          num(p['approvedHours']) == 44.0, f"({p})")
    check("overtime is what the approved hours exceeded",
          num(p['overtimeHours']) == 4.0, f"({p})")
    check("the contract is named on the preview",
          p.get('contract') and p['contract']['weeklyHours'] == 40, f"({p.get('contract')})")
    days = {d['workDate']: d for d in p['entries']}
    SUN = WEEK_A['end']
    SAT = WDAY(5)
    check("a day with nothing on it is left off", SUN not in days, f"({list(days)})")
    check("the flagged day is on it", SAT in days, f"({list(days)})")
    check("the flagged day contributes no worked hours",
          num(days.get(SAT, {}).get('workedHours')) == 0.0, f"({days.get(SAT)})")
    check("nothing is rostered against that week",
          num(p['rosteredHours']) == 0.0, f"({p})")

co, r = call("GET", f"/timesheets/preview?employeeId={TS_B}&from={W_FROM}&to={W_TO}", HR_A)
check("A cannot preview B's employee", co == 404, f"({co} {r})")
co, r = call("GET", f"/timesheets/preview?employeeId={TS_A}&from={W_FROM}&to={W_TO}", EMP_A)
check("an employee cannot preview timesheets", co == 403, f"({co} {r})")
co, r = call("GET", f"/timesheets/preview?employeeId={TS_A}&from=2029-01-01&to=2029-12-31", HR_A)
check("a period longer than two months is refused", co == 400, f"({co} {r})")

print("-- building the sheet --")
co, r = call("POST", "/timesheets", HR_A, {
    "employeeId": TS_A, "periodStart": W_FROM, "periodEnd": W_TO})
check("HR builds the timesheet", co == 201, f"({co} {r})")
ts = r.get('timesheet', {}).get('id') if co == 201 else None
if co == 201:
    t = r['timesheet']
    check("the stored sheet says what the preview did",
          num(t['worked_hours']) == 44.0 and num(t['overtime_hours']) == 4.0, f"({t})")
    check("it starts as a draft", t['status'] == 'draft', f"({t})")
    check("it records which contract it measured against",
          t['contract_id'] is not None, f"({t})")
    check("six days are on it", len(r.get('entries', [])) == 6, f"({len(r.get('entries', []))})")

co, r = call("POST", "/timesheets", HR_A, {
    "employeeId": TS_A, "periodStart": W_FROM, "periodEnd": W_TO})
check("rebuilding a draft is allowed", co == 201, f"({co} {r})")
check("and does not double its days",
      co == 201 and len(r.get('entries', [])) == 6, f"({len(r.get('entries', []))})")
co, r = call("POST", "/timesheets", HR_A, {
    "employeeId": TS_A, "periodStart": WEEK_A['nextStart'], "periodEnd": WEEK_A['nextEnd']})
check("a sheet for the following week is fine", co == 201, f"({co} {r})")
next_ts = r.get('timesheet', {}).get('id') if co == 201 else None
co, r = call("POST", "/timesheets", HR_A, {
    "employeeId": TS_A, "periodStart": WEEK_A['end'], "periodEnd": WEEK_A['nextEnd']})
check("a sheet overlapping one that exists is refused", co == 409, f"({co} {r})")
co, r = call("POST", "/timesheets", HR_A, {
    "employeeId": TS_B, "periodStart": W_FROM, "periodEnd": W_TO})
check("A cannot build a sheet for B's employee", co == 404, f"({co} {r})")

co, r = call("GET", f"/timesheets/{ts}", HR_A)
check("the sheet lists its days", co == 200 and len(r.get('entries', [])) == 6, f"({co} {r})")
entries = {e['work_date'][:10]: e for e in r.get('entries', [])} if co == 200 else {}
FRI = WDAY(4)
friday = entries.get(FRI, {}).get('id')
check("Friday's ten hours are on it",
      num(entries.get(FRI, {}).get('worked_hours')) == 10.0, f"({entries.get(FRI)})")
co, r = call("GET", f"/timesheets/{ts}", HR_B)
check("B cannot read A's timesheet", co == 404, f"({co} {r})")
co, r = call("GET", f"/timesheets/{ts}", EMP_B)
check("B's employee cannot read A's timesheet", co == 404, f"({co} {r})")
co, r = call("GET", f"/timesheets/{GHOST}", HR_A)
check("a timesheet that does not exist is a 404", co == 404, f"({co} {r})")

print("-- adjusting a day --")
co, r = call("PATCH", f"/timesheets/{ts}/days/{friday}", HR_A, {"approvedHours": 9})
check("an adjustment has to record why", co == 400, f"({co} {r})")
co, r = call("PATCH", f"/timesheets/{ts}/days/{friday}", HR_A, {
    "approvedHours": 9, "note": "Left an hour early, agreed with the manager"})
check("HR adjusts an approved figure", co == 200, f"({co} {r})")
if co == 200:
    check("the total follows the day", num(r['timesheet']['approved_hours']) == 43.0, f"({r})")
    check("and so does the overtime", num(r['timesheet']['overtime_hours']) == 3.0, f"({r})")
    check("but the worked figure does not move",
          num(r['timesheet']['worked_hours']) == 44.0, f"({r})")
co, r = call("PATCH", f"/timesheets/{ts}/days/{friday}", HR_A, {
    "approvedHours": 30, "note": "impossible"})
check("a day cannot hold more than 24 hours", co == 400, f"({co} {r})")
co, r = call("PATCH", f"/timesheets/{ts}/days/{friday}", EMP_A, {
    "approvedHours": 20, "note": "mine"})
# 404 rather than 403: this sheet belongs to a colleague, and the path guard
# refuses it before the role guard is reached. The stronger answer — a
# colleague's timesheet does not exist as far as this caller is concerned.
check("a colleague's timesheet cannot be reached at all", co == 404, f"({co} {r})")

print("-- submission and approval --")
co, r = call("POST", f"/timesheets/{ts}/decision", DIR_A, {"decision": "approved"})
check("a sheet that was never submitted cannot be decided", co == 409, f"({co} {r})")
co, r = call("POST", f"/timesheets/{ts}/submit", HR_A)
check("HR submits the sheet", co == 200, f"({co} {r})")
check("it is submitted", co == 200 and r['timesheet']['status'] == 'submitted', f"({r})")
co, r = call("POST", f"/timesheets/{ts}/decision", HR_A, {"decision": "approved"})
check("whoever submitted it cannot approve it", co == 403, f"({co} {r})")
co, r = call("POST", f"/timesheets/{ts}/decision", DIR_A, {"decision": "rejected"})
check("a rejection has to say why", co == 400, f"({co} {r})")
co, r = call("POST", f"/timesheets/{ts}/decision", DIR_B, {"decision": "approved"})
check("B's director cannot decide A's sheet", co == 404, f"({co} {r})")
co, r = call("POST", f"/timesheets/{ts}/decision", EMP_A, {"decision": "approved"})
check("nor decided", co == 404, f"({co} {r})")
co, r = call("POST", f"/timesheets/{ts}/decision", DIR_A, {
    "decision": "approved", "note": "Checked against the rota"})
check("the director approves it", co == 200, f"({co} {r})")
check("it is approved", co == 200 and r['timesheet']['status'] == 'approved', f"({r})")

co, r = call("PATCH", f"/timesheets/{ts}/days/{friday}", HR_A, {
    "approvedHours": 12, "note": "after the fact"})
check("an approved sheet's days cannot be changed", co == 409, f"({co} {r})")
co, r = call("POST", "/timesheets", HR_A, {
    "employeeId": TS_A, "periodStart": W_FROM, "periodEnd": W_TO})
check("an approved sheet cannot be rebuilt", co == 409, f"({co} {r})")
co, r = call("POST", f"/timesheets/{ts}/decision", DIR_A, {"decision": "rejected", "note": "x"})
check("deciding twice is refused", co == 409, f"({co} {r})")

# ===========================================================================
print("-- the join to payroll --")
# ===========================================================================
co, r = call("GET", f"/timesheets/{ts}/rate", HR_A)
check("the hourly rate is derived before anything is spent", co == 200, f"({co} {r})")
if co == 200:
    # 2080.00 a month, twelve months, over a 40-hour week: 2080 x 12 / 2080 = 12.00
    check("it is annual pay over annual contracted hours",
          num(r['hourlyRate']) == 12.0, f"({r})")
    check("and the figure an export would post is shown with it",
          num(r['atMultiplierOne']) == 36.0, f"({r})")

co, r = call("POST", "/components", HR_A, {
    "code": f"WOT{RUN}", "name": "Overtime", "kind": "earning",
    "calculation": "fixed", "defaultAmount": 0}, base="/payroll")
check("an overtime component exists to pay it against", co == 201, f"({co} {r})")
ot = r.get('component', {}).get('id') if co == 201 else None
co, r = call("POST", "/components", HR_A, {
    "code": f"WDED{RUN}", "name": "A deduction", "kind": "deduction",
    "calculation": "fixed", "defaultAmount": 10}, base="/payroll")
ded = r.get('component', {}).get('id') if co == 201 else None

# The period an export lands in is seeded, not created here: payroll periods
# of one frequency cannot overlap, so a suite creating its own would clash with
# its own previous run.
co, r = call("GET", "/periods", HR_A, base="/payroll")
period = next((x for x in r.get('periods', []) if x['code'].endswith('-WF')), None) if co == 200 else None
check("a payroll period covers the week", period is not None, f"({co} {r})")

co, r = call("POST", f"/timesheets/{ts}/export", HR_A, {"componentId": ot})
check("plain HR cannot send hours to payroll", co == 403, f"({co} {r})")
co, r = call("POST", f"/timesheets/{ts}/export", DIR_A, {"componentId": ded})
check("overtime cannot be paid against a deduction", co == 409, f"({co} {r})")
co, r = call("POST", f"/timesheets/{ts}/export", DIR_A, {"componentId": ot, "multiplier": 99})
check("an absurd multiplier is refused", co == 400, f"({co} {r})")
co, r = call("POST", f"/timesheets/{ts}/export", DIR_B, {"componentId": ot})
check("B's director cannot export A's sheet", co == 404, f"({co} {r})")

co, r = call("POST", f"/timesheets/{ts}/export", DIR_A, {"componentId": ot, "multiplier": 1.5})
check("the director sends it to payroll", co == 200, f"({co} {r})")
if co == 200:
    # 3 hours of overtime at 12.00, time and a half: 3 x 12 x 1.5 = 54.00
    check("the amount is hours times rate times the multiplier",
          num(r['amount']) == 54.0, f"({r})")
    check("it names the hours it paid for", num(r['overtimeHours']) == 3.0, f"({r})")
    check("the sheet is marked as exported",
          r['timesheet']['status'] == 'exported', f"({r['timesheet']})")
    check("and points at the payroll input it became",
          r['timesheet']['payroll_input_id'] is not None, f"({r['timesheet']})")

if period:
    co, r = call("GET", f"/periods/{period['id']}/inputs", HR_A, base="/payroll")
    mine = [x for x in r.get('inputs', []) if x['employee_id'] == TS_A
            and x['component_id'] == ot] if co == 200 else []
    check("the overtime is staged against the payroll period", len(mine) == 1, f"({co} {r})")
    if mine:
        check("at the amount the export reported", num(mine[0]['amount']) == 54.0, f"({mine[0]})")
        check("and the note says how it was worked out",
              'overtime at' in str(mine[0].get('note')), f"({mine[0].get('note')})")

co, r = call("POST", f"/timesheets/{ts}/export", DIR_A, {"componentId": ot})
check("exporting twice is refused", co == 409, f"({co} {r})")
co, r = call("POST", f"/timesheets/{ts}/submit", HR_A)
check("an exported sheet cannot be reopened", co == 409, f"({co} {r})")

print("-- leave reduces what was contracted --")
# A second week for the same employee, with a day of approved leave in it, to
# show that the contracted figure the overtime is measured against moves.
co, r = call("POST", "/types", HR_A, {
    "code": f"WFL{RUN}", "name": "Unpaid", "daysPerYear": 0, "isPaid": False},
    base="/leave")
lt = r.get('type', {}).get('id') if co == 201 else None
check("a leave type exists", co == 201, f"({co} {r})")
co, r = call("POST", "/requests", HR_A, {
    "employeeId": TS_A, "leaveTypeId": lt,
    "startDate": WEEK_A['leaveDay'], "endDate": WEEK_A['leaveDay'], "reason": "Personal"},
    base="/leave")
check("a day of leave is requested inside the next week", co == 201, f"({co} {r})")
lr = r.get('request', {}).get('id') if co == 201 else None
co, r = call("POST", f"/requests/{lr}/decision", DIR_A, {"decision": "approved"}, base="/leave")
check("it is approved", co == 200, f"({co} {r})")

co, r = call("GET", f"/timesheets/preview?employeeId={TS_A}"
             f"&from={WEEK_A['nextStart']}&to={WEEK_A['nextEnd']}", HR_A)
check("the following week previews", co == 200, f"({co} {r})")
if co == 200:
    p = r['preview']
    # 40 h over 5 days is 8 h a day; one day of leave leaves 4 payable days.
    check("a day of approved leave reduces the contracted hours",
          num(p['contractedHours']) == 32.0, f"({p})")
    check("the leave day is on the sheet with no hours against it",
          any(d['source'] == 'leave' for d in p['entries']), f"({p['entries']})")
    check("and nothing was worked that week",
          num(p['workedHours']) == 0.0, f"({p})")

print("-- what an employee may do with their own sheet --")
co, r = call("POST", "/timesheets", HR_A, {
    "employeeId": E_A1, "periodStart": r_day(0), "periodEnd": r_day(6)})
check("a sheet is built for the employee holding the token", co == 201, f"({co} {r})")
own = r.get('timesheet', {}).get('id') if co == 201 else None

co, r = call("GET", f"/timesheets/{own}", EMP_A)
check("they can read their own sheet", co == 200, f"({co} {r})")
co, r = call("PATCH", f"/timesheets/{own}/days/{GHOST}", EMP_A, {
    "approvedHours": 8, "note": "mine"})
check("but cannot adjust a day on it", co == 403, f"({co} {r})")
co, r = call("POST", f"/timesheets/{own}/submit", EMP_A)
check("they can submit it", co == 200, f"({co} {r})")
co, r = call("POST", f"/timesheets/{own}/decision", EMP_A, {"decision": "approved"})
check("and cannot approve it", co == 403, f"({co} {r})")
co, r = call("POST", f"/timesheets/{own}/decision", DIR_A, {"decision": "approved"})
check("a director can", co == 200, f"({co} {r})")

print("-- an employee's own records --")
co, r = call("GET", "/my/timesheets", EMP_A)
check("an employee reads their own timesheets", co == 200, f"({co} {r})")
mine_ids = [x['id'] for x in r.get('timesheets', [])] if co == 200 else []
check("and not a colleague's", ts not in mine_ids, f"({mine_ids})")
co, r = call("GET", "/my/timesheets", EMP_B)
check("B's employee sees none of A's",
      co == 200 and ts not in [x['id'] for x in r.get('timesheets', [])], f"({co} {r})")

print("-- malformed ids --")
for path in ("/contracts/not-a-uuid", "/timesheets/not-a-uuid", "/shift-patterns/not-a-uuid"):
    co, r = call("GET", path, HR_A) if path.startswith("/timesheets") else call("PATCH", path, HR_A, {})
    check(f"a malformed id on {path.split('/')[1]} is a 404", co == 404, f"({co} {r})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
