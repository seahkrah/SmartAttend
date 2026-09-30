"""
EMS leave management — the second complete vertical slice.

Leave is where an HR system starts: the first thing every employee uses and
the first approval chain a manager touches. Before this the EMS could record
a check-in and nothing else.

Covers types, balances, the request lifecycle, approvals and the calendar,
each checked for function, tenant isolation, platform isolation and role.
"""
import json, subprocess, sys, time, os
from datetime import date, timedelta

RUN = str(int(time.time()))[-6:]
SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
c = json.load(open(f"{SP}/corp.json")); A, B = c['A'], c['B']
s = json.load(open(f"{SP}/seed.json")); SCHOOL = s['A']['token']
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
P = F = 0

def call(m, p, t, body=None, base="/leave"):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "25", "-X", m,
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

HR_A, HR_B = A['token'], B['token']
EMP_A, EMP_B = A['empToken'], B['empToken']
GHOST = "00000000-0000-4000-8000-000000000000"

# Dates well ahead, so the notice-period rules have room and each run is clear
# of the last. A Monday start keeps the working-day arithmetic predictable.
base = date.today() + timedelta(days=60 + (int(RUN) % 120))
while base.weekday() != 0:
    base += timedelta(days=1)
d = lambda n: (base + timedelta(days=n)).isoformat()

print("-- platform isolation --")
co, r = call("GET", "/types", SCHOOL)
check("an SMS identity is refused from EMS leave", co == 403, f"({co} {r})")
co, r = call("GET", "/types", None)
check("leave needs a token", co in (401, 403), f"({co})")

print("-- leave types --")
co, r = call("POST", "/types", HR_A, {
    "code": f"ANN{RUN}", "name": "Annual leave", "daysPerYear": 20,
    "minNoticeDays": 3, "allowsHalfDay": True})
check("HR creates a leave type", co == 201, f"({co} {r})")
annual = r.get('type', {}).get('id') if co == 201 else None

co, r = call("POST", "/types", HR_A, {
    "code": f"UNP{RUN}", "name": "Unpaid leave", "daysPerYear": 0, "isPaid": False})
check("an uncapped type needs no entitlement", co == 201, f"({co} {r})")
unpaid = r.get('type', {}).get('id') if co == 201 else None

co, r = call("POST", "/types", EMP_A, {"code": f"X{RUN}", "name": "Self-serve"})
check("an employee cannot define leave policy", co == 403, f"({co} {r})")

co, r = call("POST", "/types", HR_B, {
    "code": f"ANN{RUN}", "name": "Annual leave", "daysPerYear": 25})
check("B may reuse A's type code", co == 201, f"({co} {r})")
annual_b = r.get('type', {}).get('id') if co == 201 else None
co, r = call("POST", "/types", HR_A, {"code": f"ANN{RUN}", "name": "Duplicate"})
check("still unique within A", co == 409, f"({co} {r})")

co, r = call("GET", "/types", HR_A)
a_types = [t['id'] for t in r.get('types', [])] if co == 200 else []
check("A's types do not include B's", annual_b not in a_types, f"({a_types})")
co, r = call("PATCH", f"/types/{annual_b}", HR_A, {"name": "hijacked"})
check("A cannot edit B's leave type", co == 404, f"({co} {r})")

print("-- balances --")
co, r = call("GET", f"/balances?year={base.year}", EMP_A)
check("an employee reads their own balances", co == 200, f"({co} {r})")
if co == 200:
    by_type = {b['leaveTypeId']: b for b in r.get('balances', [])}
    check("the balance is seeded from the type's entitlement",
          by_type.get(annual, {}).get('entitled') == 20, f"({by_type.get(annual)})")
    check("nothing taken yet", by_type.get(annual, {}).get('available') == 20,
          f"({by_type.get(annual)})")

co, r = call("GET", f"/balances?employeeId={B['empId']}&year={base.year}", HR_A)
check("HR cannot read B's employee balances", co == 404, f"({co} {r})")

co, r = call("PUT", "/balances", HR_A,
             {"employeeId": A['empId'], "leaveTypeId": annual, "year": base.year,
              "entitledDays": 25, "carriedOver": 3})
check("HR sets an entitlement", co == 200, f"({co} {r})")

co, r = call("PUT", "/balances", EMP_A,
             {"employeeId": A['empId'], "leaveTypeId": annual, "year": base.year,
              "entitledDays": 99})
check("an employee cannot set their own entitlement", co == 403, f"({co} {r})")

co, r = call("PUT", "/balances", HR_A,
             {"employeeId": B['empId'], "leaveTypeId": annual, "year": base.year,
              "entitledDays": 99})
check("HR cannot set B's employee entitlement", co == 404, f"({co} {r})")

print("-- preview --")
co, r = call("POST", "/requests/preview", EMP_A,
             {"startDate": d(0), "endDate": d(4), "leaveTypeId": annual})
check("a Monday-to-Friday span is five days",
      co == 200 and r.get('totalDays') == 5, f"({co} {r})")
co, r = call("POST", "/requests/preview", EMP_A,
             {"startDate": d(0), "endDate": d(6)})
check("a weekend inside the span does not consume entitlement",
      co == 200 and r.get('totalDays') == 5, f"({co} {r})")
co, r = call("POST", "/requests/preview", EMP_A,
             {"startDate": d(0), "endDate": d(0), "halfDays": [d(0)]})
check("a half day counts as 0.5", co == 200 and r.get('totalDays') == 0.5, f"({co} {r})")
co, r = call("POST", "/requests/preview", EMP_A, {"startDate": d(5), "endDate": d(6)})
check("a weekend-only request is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/requests/preview", EMP_A, {"startDate": d(4), "endDate": d(0)})
check("an end before the start is refused", co == 400, f"({co} {r})")

print("-- requests --")
co, r = call("POST", "/requests", EMP_A,
             {"leaveTypeId": annual, "startDate": d(0), "endDate": d(2),
              "reason": "Family"})
check("an employee submits a request", co == 201, f"({co} {r})")
req1 = r.get('request', {}).get('id') if co == 201 else None
check("three working days", co == 201 and r.get('totalDays') == 3, f"({r.get('totalDays')})")

co, r = call("GET", f"/balances?year={base.year}", EMP_A)
by_type = {b['leaveTypeId']: b for b in r.get('balances', [])} if co == 200 else {}
check("a pending request is deducted from what is available",
      by_type.get(annual, {}).get('pending') == 3
      and by_type.get(annual, {}).get('available') == 25, f"({by_type.get(annual)})")

co, r = call("POST", "/requests", EMP_A,
             {"leaveTypeId": annual, "startDate": d(1), "endDate": d(3)})
check("overlapping leave is refused", co == 409, f"({co} {r})")

co, r = call("POST", "/requests", EMP_A,
             {"leaveTypeId": annual, "startDate": d(1), "endDate": d(1)})
check("a single day inside an existing request is refused too", co == 409, f"({co} {r})")

co, r = call("POST", "/requests", EMP_A,
             {"leaveTypeId": annual, "startDate": d(0), "endDate": d(40)})
check("more days than remain is refused", co == 409, f"({co} {r})")

# Starting today, over three days: any three consecutive days include a
# working day, so the range is never refused as empty (as "today" alone is on
# a weekend) before the notice rule is reached.
co, r = call("POST", "/requests", EMP_A,
             {"leaveTypeId": annual, "startDate": date.today().isoformat(),
              "endDate": (date.today() + timedelta(days=2)).isoformat()})
check("short notice is refused", co == 400 and 'notice' in str(r).lower(), f"({co} {r})")

co, r = call("POST", "/requests", EMP_A, {"leaveTypeId": annual_b, "startDate": d(7), "endDate": d(8)})
check("cannot request against B's leave type", co == 404, f"({co} {r})")

co, r = call("POST", "/requests", EMP_A,
             {"leaveTypeId": annual, "employeeId": B['empId'],
              "startDate": d(7), "endDate": d(8)})
check("an employee naming someone else still books their own",
      co in (201, 409), f"({co} {r})")
req_self = r.get('request', {}).get('id') if co == 201 else None
if req_self:
    call("POST", f"/requests/{req_self}/cancel", EMP_A)

print("-- visibility --")
co, r = call("GET", "/requests", EMP_A)
check("an employee sees their own requests", co == 200 and len(r.get('requests', [])) >= 1,
      f"({co} {r})")
co, r = call("GET", "/requests?scope=all", EMP_A)
mine = r.get('requests', []) if co == 200 else []
check("scope=all does not widen an employee's view",
      all(x['employee_id'] == A['empId'] for x in mine), f"({[x['employee_id'] for x in mine]})")

co, r = call("GET", "/requests?scope=all", HR_A)
a_reqs = [x['id'] for x in r.get('requests', [])] if co == 200 else []
check("HR sees the company's requests", req1 in a_reqs, f"({a_reqs})")

co, r = call("GET", "/requests?scope=all", HR_B)
b_reqs = [x['id'] for x in r.get('requests', [])] if co == 200 else []
check("B's HR does not see A's requests", req1 not in b_reqs, f"({b_reqs})")

print("-- decisions --")
co, r = call("POST", f"/requests/{req1}/decision", EMP_A, {"decision": "approved"})
check("an employee cannot approve", co == 403, f"({co} {r})")

co, r = call("POST", f"/requests/{req1}/decision", HR_B, {"decision": "approved"})
check("B's HR cannot decide A's request", co == 404, f"({co} {r})")

co, r = call("POST", f"/requests/{req1}/decision", HR_A, {"decision": "maybe"})
check("an unknown decision is refused", co == 400, f"({co} {r})")

co, r = call("POST", f"/requests/{req1}/decision", HR_A,
             {"decision": "approved", "note": "Cover arranged"})
check("HR approves", co == 200, f"({co} {r})")

co, r = call("POST", f"/requests/{req1}/decision", HR_A, {"decision": "rejected"})
check("a decided request cannot be decided again", co == 409, f"({co} {r})")

co, r = call("GET", f"/balances?year={base.year}", EMP_A)
by_type = {b['leaveTypeId']: b for b in r.get('balances', [])} if co == 200 else {}
check("approval moves the days from pending to taken",
      by_type.get(annual, {}).get('taken') == 3
      and by_type.get(annual, {}).get('pending') == 0, f"({by_type.get(annual)})")

# An HR user requesting their own leave must not be able to sign it off.
co, r = call("POST", "/requests", HR_A,
             {"leaveTypeId": annual, "startDate": d(14), "endDate": d(15)})
if co == 201:
    own = r['request']['id']
    co2, r2 = call("POST", f"/requests/{own}/decision", HR_A, {"decision": "approved"})
    check("nobody decides their own leave, HR included", co2 == 403, f"({co2} {r2})")
else:
    check("nobody decides their own leave, HR included", False, f"(setup failed {co} {r})")

print("-- rejection releases the balance --")
co, r = call("POST", "/requests", EMP_A,
             {"leaveTypeId": annual, "startDate": d(21), "endDate": d(22)})
req2 = r.get('request', {}).get('id') if co == 201 else None
co, r = call("POST", f"/requests/{req2}/decision", HR_A, {"decision": "rejected"})
check("HR rejects", co == 200, f"({co} {r})")
co, r = call("GET", f"/balances?year={base.year}", EMP_A)
by_type = {b['leaveTypeId']: b for b in r.get('balances', [])} if co == 200 else {}
check("a rejected request returns its days",
      by_type.get(annual, {}).get('pending') == 0, f"({by_type.get(annual)})")

print("-- cancellation --")
co, r = call("POST", "/requests", EMP_A,
             {"leaveTypeId": annual, "startDate": d(28), "endDate": d(29)})
req3 = r.get('request', {}).get('id') if co == 201 else None
co, r = call("POST", f"/requests/{req3}/cancel", EMP_B)
check("another company's employee cannot cancel it", co == 404, f"({co} {r})")
co, r = call("POST", f"/requests/{req3}/cancel", EMP_A)
check("an employee cancels their own", co == 200, f"({co} {r})")
co, r = call("POST", f"/requests/{req3}/cancel", EMP_A)
check("a cancelled request cannot be cancelled again", co == 409, f"({co} {r})")
co, r = call("POST", "/requests", EMP_A,
             {"leaveTypeId": annual, "startDate": d(28), "endDate": d(29)})
check("cancelling frees the dates for a new request", co == 201, f"({co} {r})")

print("-- calendar --")
co, r = call("GET", f"/calendar?from={d(0)}&to={d(4)}", HR_A)
check("the calendar lists who is away", co == 200 and len(r.get('days', [])) >= 3, f"({co} {r})")
if co == 200:
    check("weekends are not listed as leave",
          all(float(x['portion']) > 0 for x in r.get('days', [])), f"({r.get('days')})")
co, r = call("GET", f"/calendar?from={d(0)}&to={d(4)}", EMP_A)
check("an employee cannot read the company calendar", co == 403, f"({co} {r})")
co, r = call("GET", f"/calendar?from={d(0)}&to={d(4)}", HR_B)
check("B's calendar does not show A's people",
      co == 200 and len(r.get('days', [])) == 0, f"({co} {r})")
co, r = call("GET", "/calendar?from=nonsense&to=nonsense", HR_A)
check("a malformed range is refused", co == 400, f"({co} {r})")

print("-- deleting a type in use --")
co, r = call("DELETE", f"/types/{annual}", HR_A)
check("a type with requests against it cannot be deleted", co == 409, f"({co} {r})")
co, r = call("DELETE", f"/types/{unpaid}", HR_A)
check("an unused type deletes", co == 200, f"({co} {r})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
