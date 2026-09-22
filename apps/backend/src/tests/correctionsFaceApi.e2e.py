"""
Attendance corrections (/api/corrections/*) and face verification (/api/face/*).

Neither surface worked. corrections carried no authentication at all, so every
route read a role off an undefined req.user and refused everyone. /api/face ran
on a third implementation of face matching whose queries named columns that do
not exist.

Neither was scoped either, and reviving them without that would have opened
one school's correction reasons, sign-offs and biometric templates to another.
The sharpest case is /face/verify, which used to enrol on first use: any
caller could post an embedding for any student and have it stored as that
student's face, with the response reporting "verified, confidence 100".
"""
import json, subprocess, sys, time
RUN = str(int(time.time()))[-6:]
SP = "/tmp/claude-0/-home-user-SmartAttend/d93ac8ad-306e-535c-92c4-36bf785b1524/scratchpad"
d = json.load(open(f"{SP}/seed.json")); A, B = d['A'], d['B']
c = json.load(open(f"{SP}/corp.json")); HR = c['A']['token']
ROOT = "http://127.0.0.1:5000/api"
P = F = 0

def call(m, p, t, body=None, base=""):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "25", "-X", m,
           "-H", f"Authorization: Bearer {t}", "-H", "Content-Type: application/json", ROOT + base + p]
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

AT, BT = A['token'], B['token']
FA, FB = A['facToken'], B['facToken']
DATE = time.strftime('%Y-%m-%d', time.gmtime(time.time() - 86400 * (int(RUN) % 90)))
REASON = "Corrected after reviewing the register with the student present"

# Each school marks a register, giving each an attendance row to correct.
# The register does not return the attendance row's id, so it is picked up
# from that school's own audit trail, which the marking trigger writes.
marks = {}
for tag, tok, admin, tenant in (('A', FA, AT, A), ('B', FB, BT, B)):
    call("POST", "/attendance/bulk-edit", tok,
         {"course_id": tenant['courseId'], "date": DATE, "action": "MARK_ALL_PRESENT"},
         base="/faculty")
    co, r = call("GET", "/logs?limit=50", admin, base="/audit")
    entries = r.get('logs', []) if co == 200 else []
    marks[tag] = next(
        (x['entity_id'] for x in entries
         if x.get('entity_type') == 'attendance' and x.get('entity_id')),
        None,
    )

print("-- corrections: authentication --")
co, r = call("GET", f"/statistics", AT, base="/corrections")
check("corrections reachable at all (router had no authentication)", co == 200, f"({co} {r})")
co, r = call("GET", "/statistics", "not-a-token", base="/corrections")
check("an invalid token is refused", co in (401, 403), f"({co})")

print("-- corrections: isolation --")
if marks['A'] and marks['B']:
    co, r = call("POST", f"/school/{marks['A']}", AT,
                 {"correctionReason": REASON, "correctionType": "data_entry_error",
                  "newStatus": "excused"}, base="/corrections")
    check("A corrects its own record", co == 200, f"({co} {r})")
    correction_a = r.get('data', {}).get('correctionId') if co == 200 else None

    co, r = call("POST", f"/school/{marks['B']}", AT,
                 {"correctionReason": REASON, "correctionType": "data_entry_error",
                  "newStatus": "excused"}, base="/corrections")
    check("A cannot correct B's record", co == 400 and 'not found' in str(r).lower(), f"({co} {r})")

    co, r = call("POST", f"/school/{marks['B']}", BT,
                 {"correctionReason": REASON, "correctionType": "data_entry_error",
                  "newStatus": "excused"}, base="/corrections")
    check("B corrects its own record", co == 200, f"({co} {r})")
    correction_b = r.get('data', {}).get('correctionId') if co == 200 else None

    def history(record_id, tok):
        co, r = call("GET", f"/history/{record_id}?type=school_attendance", tok, base="/corrections")
        data = r.get('data') if isinstance(r, dict) else None
        rows = data.get('corrections', data.get('history', [])) if isinstance(data, dict) else (data or [])
        return co, rows, r

    co, rows, raw = history(marks['B'], AT)
    check("B's correction history is empty to A", co == 200 and len(rows) == 0, f"({co} {raw})")
    co, rows, raw = history(marks['B'], BT)
    check("B reads its own history", co == 200 and len(rows) > 0, f"({co} {raw})")

    if correction_b:
        co, r = call("POST", f"/{correction_b}/revert", AT,
                     {"revertReason": "Reverting this after a second look at the register"},
                     base="/corrections")
        check("A cannot revert B's correction", co == 400, f"({co} {r})")
        co, rows, raw = history(marks['B'], BT)
        still_active = [x for x in rows if not x.get('is_reverted')]
        check("B's correction is still active", len(still_active) > 0, f"({raw})")

def stats_of(tok):
    co, r = call("GET", "/statistics", tok, base="/corrections")
    if co != 200:
        return []
    data = r.get('data')
    if isinstance(data, dict):
        return data.get('statistics', data.get('stats', []))
    return data or []

a_stats = stats_of(AT)
b_stats = stats_of(BT)
check("statistics are per school",
      all(x.get('tenant_id') == A['tenantId'] for x in a_stats)
      and all(x.get('tenant_id') == B['tenantId'] for x in b_stats),
      f"(A {[x.get('tenant_id') for x in a_stats]}, B {[x.get('tenant_id') for x in b_stats]})")

co, r = call("GET", "/audit-trail?startDate=2000-01-01&endDate=2100-01-01", AT, base="/corrections")
check("audit trail 200", co == 200, f"({co} {r})")
if co == 200:
    trail = r.get('data', {}).get('auditTrail', [])
    check("trail is not empty", len(trail) > 0, f"({r.get('data')})")
    check("trail holds only A's corrections",
          all(x.get('tenant_id') == A['tenantId'] for x in trail),
          f"({[x.get('tenant_id') for x in trail]})")

hr_stats = stats_of(HR)
check("an EMS identity gets only its own, not SMS corrections",
      all(x.get('tenant_id') not in (A['tenantId'], B['tenantId']) for x in hr_stats),
      f"({[x.get('tenant_id') for x in hr_stats]})")

print("-- face: no enrolment as a side effect of verifying --")
ENC = [0.02 * (i % 5) for i in range(128)]
co, r = call("GET", f"/enrollment-status/{A['students'][0]}", FA, base="/face")
check("enrollment status 200 (service queried columns that do not exist)", co == 200, f"({co} {r})")
was_enrolled = r.get('data', {}).get('enrolled') if co == 200 else None

co, r = call("POST", "/verify", FA,
             {"sessionId": "00000000-0000-4000-8000-000000000000",
              "studentId": A['students'][0], "embedding": ENC}, base="/face")
check("verify against an unknown session does not succeed",
      co == 200 and r.get('data', {}).get('verified') is False, f"({co} {r})")
check("verify never reports a first enrolment",
      co == 200 and r.get('data', {}).get('isFirstEnrollment') is False, f"({r})")

co, r = call("GET", f"/enrollment-status/{A['students'][0]}", FA, base="/face")
check("verifying did not enrol the student",
      co == 200 and r.get('data', {}).get('enrolled') == was_enrolled, f"({co} {r})")

print("-- face: isolation --")
co, r = call("GET", f"/enrollment-status/{B['students'][0]}", FA, base="/face")
check("B's student status is 404 to A", co == 404, f"({co} {r})")
co, r = call("POST", "/enroll", FA, {"studentId": B['students'][0], "embedding": ENC}, base="/face")
check("A cannot enrol B's student", co == 404, f"({co} {r})")
co, r = call("POST", "/enroll", FA, {"studentId": A['students'][0], "embedding": ENC}, base="/face")
check("A enrols its own student", co == 201, f"({co} {r})")
check("the enrolment awaits a second person",
      co == 201 and r.get('data', {}).get('requiresVerification') is True, f"({r})")

co, r = call("POST", "/enroll", FA, {"studentId": A['students'][0], "embedding": ENC[:4]}, base="/face")
check("a short embedding is refused", co == 400, f"({co} {r})")

print("-- face: role and platform --")
co, r = call("POST", "/verify", HR,
             {"sessionId": "00000000-0000-4000-8000-000000000000",
              "studentId": A['students'][0], "embedding": ENC}, base="/face")
check("an EMS identity is refused from the SMS face API", co == 403, f"({co} {r})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
