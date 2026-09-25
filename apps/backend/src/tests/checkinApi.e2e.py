"""
Employee self-service check-in.

This replaced four routes under /api/corporate that checked no tenant and no
identity. The one that wrote took the employee id from the request body and
let the caller assert face verification, so a school student could record a
"face-verified" check-in against another company's employee. The rows it
wrote had no tenant, which meant the timesheet engine never counted them —
and also never counted a genuine check-in made the same way. The route was
unsafe and useless at once.

So the assertions here are about who decides what:

  identity     the employee is whoever is signed in; an id in the body is
               ignored, and so is a tenant
  time         the server's clock; a timestamp in the body is ignored
  face         never asserted by the client
  the join     a check-in made here is one the timesheet engine sees

And the usual: tenant isolation, platform isolation, and that the removed
routes stay removed.

It also covers the corporate administrator, whose pages refused every account
in the fixture until the fixture set corporate_entities.admin_user_id.
"""
import json, subprocess, sys, time, os
from datetime import datetime, timezone

SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
c = json.load(open(f"{SP}/corp.json")); A, B = c['A'], c['B']
s = json.load(open(f"{SP}/seed.json")); SCHOOL_STUDENT, SCHOOL_ADMIN = s['A']['studentToken'], s['A']['token']
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

def seconds_ago(iso):
    """How long ago an API timestamp was, from this machine's clock."""
    t = datetime.fromisoformat(iso.replace('Z', '+00:00'))
    return (datetime.now(timezone.utc) - t).total_seconds()

MGR, MGR_EMP = A['managerToken'], A['managerEmpId']
EMP_A, EMP_B, HR_A = A['empToken'], B['empToken'], A['token']
ADMIN_A = A['adminToken']

print("-- platform and authentication --")
for m, p in (("GET", "/my/attendance"), ("POST", "/my/check-in"), ("POST", "/my/check-out")):
    co, r = call(m, p, None)
    check(f"{m} {p} needs a token", co in (401, 403), f"({co})")
    co, r = call(m, p, SCHOOL_STUDENT)
    check(f"a school identity cannot {m} {p}", co == 403, f"({co} {r})")
co, r = call("POST", "/my/check-in", SCHOOL_ADMIN)
check("nor can a school administrator", co == 403, f"({co} {r})")

print("-- an account with no employee record --")
co, r = call("GET", "/my/attendance", ADMIN_A)
check("the corporate admin reads their attendance", co == 200, f"({co} {r})")
check("and is told they have no employee record",
      co == 200 and r.get('employee') is None, f"({r})")
co, r = call("POST", "/my/check-in", ADMIN_A)
check("so they cannot check in", co == 404, f"({co} {r})")

print("-- starting clean --")
co, r = call("GET", "/my/attendance", MGR)
check("the manager reads their own attendance", co == 200, f"({co} {r})")
check("and it is theirs", co == 200 and r.get('employee', {}).get('id') == MGR_EMP, f"({r.get('employee')})")
# A previous run that failed part way can leave the manager on the clock.
# Closing it is setup, not an assertion.
if co == 200 and r.get('onTheClock'):
    call("POST", "/my/check-out", MGR)
co, r = call("POST", "/my/check-out", MGR)
check("checking out when not checked in is refused", co == 409, f"({co} {r})")

print("-- nothing that matters comes from the client --")
co, r = call("POST", "/my/check-in", MGR, {
    "employeeId": B['employees'][0],        # somebody at another company
    "tenantId": B['tenantId'],              # and that company
    "faceVerified": True,                   # a claim
    "checkInTime": "2020-01-01T00:00:00Z",  # and a time
    "checkInType": "field",
    "siteLocation": "   Depot 4   ",
})
check("the manager checks in", co == 201, f"({co} {r})")
ci = r.get('checkIn', {}) if co == 201 else {}
mine = ci.get('id')
check("face verification cannot be asserted", ci.get('faceVerified') is False, f"({ci})")
check("the time is the server's, not the one sent",
      ci.get('checkInTime') and seconds_ago(ci['checkInTime']) < 300, f"({ci.get('checkInTime')})")
check("a legitimate choice of where is honoured", ci.get('checkInType') == 'field', f"({ci})")
check("and the site is tidied", ci.get('siteLocation') == 'Depot 4', f"({ci})")

# Off the clock to try a bad value, then back on for the rest of the suite.
call("POST", "/my/check-out", MGR)
co, r = call("POST", "/my/check-in", MGR, {"checkInType": "beach"})
check("an invalid check-in type is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/my/check-in", MGR)
check("the manager checks back in", co == 201, f"({co} {r})")
mine = r.get('checkIn', {}).get('id') if co == 201 else mine
t_in = time.time()

co, r = call("GET", "/my/attendance", MGR)
check("the manager is on the clock", co == 200 and r.get('onTheClock', {}).get('id') == mine, f"({co} {r.get('onTheClock')})")

co, r = call("GET", "/my/attendance", EMP_B)
b_ids = {x['id'] for x in r.get('history', [])} | ({r['onTheClock']['id']} if r.get('onTheClock') else set())
check("the check-in did not land on the other company's employee", mine not in b_ids, f"({co})")
co, r = call("GET", "/my/attendance", EMP_A)
a_ids = {x['id'] for x in r.get('history', [])}
check("nor on a colleague", mine not in a_ids, f"({co})")
co, r = call("GET", "/my/attendance", HR_A)
check("nor on HR, who reads only their own",
      mine not in {x['id'] for x in r.get('history', [])}, f"({co})")

print("-- one check-in at a time --")
co, r = call("POST", "/my/check-in", MGR)
check("checking in twice is refused", co == 409, f"({co} {r})")

print("-- a forgotten check-in --")
co, r = call("GET", "/my/attendance", EMP_A)
# The fixture leaves this employee a trail of check-ins that were never closed,
# one a day for weeks; only the one from the last day is still on the clock.
stale = r.get('needsAttention', []) if co == 200 else []
check("check-ins left open for days are reported for HR", len(stale) >= 1, f"({len(stale)})")
check("and none of them is the one on the clock",
      r.get('onTheClock') is None or all(x['id'] != r['onTheClock']['id'] for x in stale), f"({r.get('onTheClock')})")
# The fixture's recent one is closed by the first run of this suite; after
# that the employee is put on the clock here, so the next two assertions run
# every time rather than only against a fresh seed.
if not r.get('onTheClock'):
    call("POST", "/my/check-in", EMP_A)
    co, r = call("GET", "/my/attendance", EMP_A)
open_id = (r.get('onTheClock') or {}).get('id')
co, r = call("POST", "/my/check-out", EMP_A)
check("checking out closes the recent one",
      co == 200 and open_id is not None and r['checkIn']['id'] == open_id, f"({co} {r})")
co, r = call("GET", "/my/attendance", EMP_A)
still = {x['id'] for x in r.get('needsAttention', [])}
check("and leaves the old ones for HR rather than recording a shift of days",
      len(still) == len(stale), f"({len(still)} vs {len(stale)})")

print("-- the join to timesheets --")
# Held open long enough to be worth a hundredth of an hour, so the timesheet
# has something to count. The removed route wrote rows the timesheet engine
# could not see; this is the assertion that the new one does not.
remaining = 20 - (time.time() - t_in)
if remaining > 0:
    time.sleep(remaining)
co, r = call("POST", "/my/check-out", MGR)
check("the manager checks out", co == 200, f"({co} {r})")
closed = r.get('checkIn', {}) if co == 200 else {}
check("the same check-in is closed", closed.get('id') == mine, f"({closed})")
check("its hours are recorded", num(closed.get('hours')) is not None and num(closed.get('hours')) >= 0.0, f"({closed})")
co, r = call("POST", "/my/check-out", MGR)
check("checking out twice is refused", co == 409, f"({co} {r})")

co, r = call("GET", "/my/attendance", MGR)
week = r.get('week', {}) if co == 200 else {}
check("this week's hours include it", num(week.get('verifiedHours')) is not None and num(week.get('verifiedHours')) >= 0.01, f"({week})")
today = week.get('to')
co, r = call("GET", f"/timesheets/preview?employeeId={MGR_EMP}&from={today}&to={today}", HR_A)
check("and so does a timesheet built by HR", co == 200 and num(r['preview']['workedHours']) >= 0.01, f"({co} {r})")
if co == 200:
    check("the page and the timesheet agree",
          num(r['preview']['workedHours']) == num(week.get('verifiedHours')), f"({r['preview']['workedHours']} vs {week.get('verifiedHours')})")

print("-- the routes this replaced stay gone --")
victim = B['employees'][0]
for label, m, p, body in (
    ("POST /corporate/checkins", "POST", "/checkins",
     {"employeeId": victim, "checkInType": "office", "faceVerified": True}),
    ("POST /corporate/checkins/:id/checkout", "POST", f"/checkins/{mine}/checkout", {}),
    ("GET /corporate/employees/:id/checkins", "GET", f"/employees/{victim}/checkins", None),
    ("GET /corporate/checkins/department/:id", "GET", f"/checkins/department/{B['deptId']}", None),
):
    co, r = call(m, p, EMP_A, body, base="/corporate")
    check(f"{label} no longer exists", co == 404, f"({co})")

print("-- the corporate administrator --")
for p in ("/dashboard", "/admin/employees", "/admin/attendance", "/admin/settings"):
    co, r = call("GET", p, ADMIN_A, base="/corporate")
    check(f"the tenant administrator reaches /corporate{p}", co == 200, f"({co} {r})")
co, r = call("GET", "/dashboard", HR_A, base="/corporate")
check("HR, who administers nothing, is refused it", co == 403, f"({co} {r})")
co, r = call("GET", "/admin/employees", ADMIN_A, base="/corporate")
if co == 200:
    rows = r.get('data') or r.get('employees') or []
    emails = [x.get('email', '') for x in rows]
    check("and sees only their own company", emails and all(e.endswith('.a@c2e.test') for e in emails), f"({emails})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
