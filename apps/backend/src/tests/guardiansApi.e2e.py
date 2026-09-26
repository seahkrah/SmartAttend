"""
SMS guardians and the parent portal.

The school records who a student's guardians are and decides, per child,
what each may see. The guardian signs in and reads exactly that: their own
children, in their own school, in the areas the school has shared.

Covers the administrator's management of guardians and links, the portal
account (invitation, activation, sign-in), what the portal returns, and the
notices guardians receive. Each is checked for function, tenant isolation,
family isolation (one parent cannot reach another's child), per-area
permissions, platform isolation and role.
"""
import json, subprocess, sys, time, os
from datetime import date, timedelta

RUN = str(int(time.time()))[-6:]
SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
s = json.load(open(f"{SP}/seed.json")); A, B = s['A'], s['B']
c = json.load(open(f"{SP}/corp.json")); CORP = c['A']['token']
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
P = F = 0

def call(m, p, t, body=None, base=""):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "25", "-X", m,
           "-H", "Content-Type: application/json"]
    if t:
        cmd += ["-H", f"Authorization: Bearer {t}"]
    cmd.append(ROOT + base + p)
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    o = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8").stdout
    txt, _, code = o.rpartition("\n")
    try:
        parsed = json.loads(txt)
    except Exception:
        parsed = txt
    return int(code or 0), parsed

def check(n, ok, dd=""):
    global P, F
    if ok:
        P += 1; print(f"  ok    {n}")
    else:
        F += 1; print(f"  FAIL  {n} {dd}")

G = lambda m, p, t, b=None: call(m, p, t, b, base="/guardians")
PORTAL = lambda p, t: call("GET", p, t, base="/guardian")

AT, BT = A['token'], B['token']
FA = A['facToken']
STU_A = A['studentToken']
S0, S1 = A['students'][0], A['students'][1]
SB = B['students'][0]
GHOST = "00000000-0000-4000-8000-000000000000"
PASSWORD = "Guardian-Pa55word!"

# ============================================================ who may manage
print("-- who may manage guardians --")
co, r = G("GET", "", None)
check("guardians need a token", co in (401, 403), f"({co})")
co, r = G("GET", "", STU_A)
check("a student cannot manage guardians", co == 403, f"({co} {r})")
co, r = G("GET", "", FA)
check("a lecturer cannot manage guardians", co == 403, f"({co} {r})")
co, r = G("GET", "", CORP)
check("an EMS identity is refused from SMS guardians", co == 403, f"({co} {r})")

# ================================================================ recording
print("-- recording a guardian --")
co, r = G("POST", "", AT, {"lastName": "Mensah", "phone": "0200000001"})
check("a first name is required", co == 400, f"({co} {r})")
co, r = G("POST", "", AT, {"firstName": "Ama", "lastName": "Mensah"})
check("a guardian nobody can reach is refused", co == 400, f"({co} {r})")
co, r = G("POST", "", AT, {"firstName": "Ama", "lastName": "Mensah", "email": "not-an-email"})
check("a malformed email is refused", co == 400, f"({co} {r})")
co, r = G("POST", "", AT, {"firstName": "Ama", "lastName": "Mensah", "phone": "0200000001",
                            "students": [{"studentId": S0, "relationship": "aunt-ish"}]})
check("an unknown relationship is refused", co == 400, f"({co} {r})")
co, r = G("POST", "", AT, {"firstName": "Ama", "lastName": "Mensah", "phone": "0200000001",
                            "students": [{"studentId": SB}]})
check("another school's student cannot be linked at creation", co == 404, f"({co} {r})")
co, r = G("GET", f"?search=Mensah{RUN}", AT)
check("and nothing was saved by the refused request",
      co == 200 and r.get('guardians') == [], f"({co} {r})")

MOTHER_EMAIL = f"mother{RUN}@e2e.test"
co, r = G("POST", "", AT, {
    "firstName": "Ama", "lastName": f"Mensah{RUN}", "email": MOTHER_EMAIL.upper(),
    "phone": "0200000001", "occupation": "Nurse",
    "students": [{"studentId": S0, "relationship": "mother", "isPrimary": True}]})
check("record a guardian with a linked child", co == 201, f"({co} {r})")
mother = r.get('guardian', {}) if co == 201 else {}
MOTHER = mother.get('id')
check("the email is stored normalised", mother.get('email') == MOTHER_EMAIL, f"({mother.get('email')})")
check("the link is recorded as the child's primary contact",
      len(mother.get('students', [])) == 1 and mother['students'][0]['is_primary'] is True
      and mother['students'][0]['relationship'] == 'mother', f"({mother.get('students')})")
check("a new guardian has no account yet", mother.get('account') == 'none', f"({mother.get('account')})")

co, r = G("POST", "", AT, {"firstName": "Dup", "lastName": "Licate", "email": MOTHER_EMAIL})
check("the same email twice at one school is a duplicate", co == 409, f"({co} {r})")
co, r = G("POST", "", BT, {"firstName": "Ama", "lastName": f"Mensah{RUN}", "email": MOTHER_EMAIL,
                            "students": [{"studentId": SB, "relationship": "mother"}]})
check("another school may record the same parent", co == 201, f"({co} {r})")
MOTHER_B = r.get('guardian', {}).get('id') if co == 201 else None

co, r = G("POST", "", AT, {"firstName": "Kofi", "lastName": f"Mensah{RUN}", "phone": "0200000002",
                            "students": [{"studentId": S0, "relationship": "father"}]})
check("record a second guardian for the same child", co == 201, f"({co} {r})")
FATHER = r.get('guardian', {}).get('id') if co == 201 else None

# ================================================================== reading
print("-- listing and reading --")
co, r = G("GET", f"?search=Mensah{RUN}", AT)
ids = [g['id'] for g in r.get('guardians', [])] if co == 200 else []
check("search finds the school's guardians", MOTHER in ids and FATHER in ids, f"({co} {ids})")
check("and not another school's", MOTHER_B not in ids, f"({ids})")
co, r = G("GET", f"?studentId={S0}", AT)
ids = [g['id'] for g in r.get('guardians', [])] if co == 200 else []
check("list a student's guardians", MOTHER in ids and FATHER in ids, f"({co} {ids})")
co, r = G("GET", f"?studentId={SB}", AT)
check("another school's student has no guardians here", co == 200 and r.get('guardians') == [], f"({co} {r})")
co, r = G("GET", "?studentId=nope", AT)
check("a malformed student filter is refused, not passed to SQL", co == 404, f"({co})")

co, r = G("GET", f"/{MOTHER}", AT)
check("read one guardian", co == 200 and r.get('guardian', {}).get('id') == MOTHER, f"({co} {r})")
for label, tok in (("B's administrator", BT),):
    co, r = G("GET", f"/{MOTHER}", tok)
    check(f"{label} cannot read A's guardian", co == 404, f"({co} {r})")
    co, r = G("PATCH", f"/{MOTHER}", tok, {"occupation": "Hijacked"})
    check(f"{label} cannot edit A's guardian", co == 404, f"({co} {r})")
    co, r = G("POST", f"/{MOTHER}/students", tok, {"studentId": SB})
    check(f"{label} cannot link their student to A's guardian", co == 404, f"({co} {r})")
    co, r = G("DELETE", f"/{MOTHER}", tok)
    check(f"{label} cannot remove A's guardian", co == 404, f"({co} {r})")
co, r = G("GET", "/not-a-uuid", AT)
check("a malformed guardian id reads as absent", co == 404, f"({co})")
co, r = G("GET", f"/{GHOST}", AT)
check("an unknown guardian reads as absent", co == 404, f"({co})")

# ================================================================= changing
print("-- changing details and links --")
co, r = G("PATCH", f"/{MOTHER}", AT, {"occupation": "Midwife", "address": "12 Ring Road"})
check("correct a guardian's details", co == 200 and r['guardian']['occupation'] == 'Midwife', f"({co} {r})")
co, r = G("PATCH", f"/{FATHER}", AT, {"phone": None})
check("removing the only contact detail is refused", co == 400, f"({co} {r})")
co, r = G("PATCH", f"/{MOTHER}", AT, {})
check("an empty change is refused", co == 400, f"({co} {r})")

co, r = G("POST", f"/{MOTHER}/students", AT, {"studentId": S1, "relationship": "mother"})
check("link a second child", co == 201, f"({co} {r})")
LINK_S1 = r.get('linkId') if co == 201 else None
co, r = G("POST", f"/{MOTHER}/students", AT, {"studentId": S1})
check("the same link twice is refused", co == 409, f"({co} {r})")
co, r = G("POST", f"/{MOTHER}/students", AT, {"studentId": SB})
check("another school's student cannot be linked", co == 404, f"({co} {r})")
co, r = G("POST", f"/{MOTHER}/students", AT, {"studentId": GHOST})
check("a student that does not exist cannot be linked", co == 404, f"({co} {r})")

co, r = G("GET", f"/{FATHER}", AT)
father_link = r['guardian']['students'][0]['id'] if co == 200 else None
co, r = G("PATCH", f"/{FATHER}/students/{father_link}", AT, {"isPrimary": True})
check("make the father the primary contact", co == 200, f"({co} {r})")
co, r = G("GET", f"/{MOTHER}", AT)
m_s0 = next((x for x in r['guardian']['students'] if x['student_id'] == S0), {}) if co == 200 else {}
check("which demotes the mother: one primary per child", m_s0.get('is_primary') is False, f"({m_s0})")

co, r = G("PATCH", f"/{MOTHER}/students/{LINK_S1}", AT, {"canViewFees": False, "canViewResults": False})
check("withhold fees and results for the second child", co == 200, f"({co} {r})")
co, r = G("PATCH", f"/{MOTHER}/students/{LINK_S1}", AT, {"canViewFees": "no"})
check("a permission must be true or false", co == 400, f"({co} {r})")
co, r = G("PATCH", f"/{FATHER}/students/{LINK_S1}", AT, {"canViewFees": True})
check("a link cannot be edited through another guardian", co == 404, f"({co} {r})")

# ============================================================ portal account
print("-- portal account --")
co, r = G("POST", f"/{FATHER}/invitation", AT, {"handover": True})
check("a guardian without an email cannot be given an account", co == 400, f"({co} {r})")

co, r = G("POST", "", AT, {"firstName": "Clash", "lastName": f"Student{RUN}", "email": "stu1.a@e2e.test"})
clash = r.get('guardian', {}).get('id') if co == 201 else None
co, r = G("POST", f"/{clash}/invitation", AT, {"handover": True})
check("an email that signs in a student cannot also be a guardian login", co == 409, f"({co} {r})")
G("DELETE", f"/{clash}", AT)

co, r = G("POST", f"/{MOTHER}/invitation", AT, {"handover": True})
check("invite the mother, handing the link to the office", co == 200, f"({co} {r})")
link = (r.get('invitation') or {}).get('link', '')
check("a single-use setup link is returned", 'token=' in link, f"({r.get('invitation')})")
check("the account is now invited", r.get('guardian', {}).get('account') == 'invited', f"({r.get('guardian', {}).get('account')})")
token = link.split('token=')[-1]

co, r = call("POST", "/auth/activate", None, {"token": token, "password": PASSWORD, "confirmPassword": PASSWORD})
check("the guardian sets their own password", co == 200, f"({co} {r})")
co, r = call("POST", "/auth/activate", None, {"token": token, "password": PASSWORD, "confirmPassword": PASSWORD})
check("the link works once", co in (400, 404, 410), f"({co} {r})")

co, r = call("POST", "/auth/login", None, {"platform": "school", "email": MOTHER_EMAIL, "password": PASSWORD})
check("the guardian signs in to the school platform", co == 200, f"({co} {r})")
GT = r.get('accessToken') if co == 200 else None
check("as a guardian", (r.get('user') or {}).get('role') == 'guardian', f"({r.get('user')})")

co, r = G("POST", f"/{MOTHER}/invitation", AT, {"handover": True})
check("a guardian who has signed in is not invited again", co == 409, f"({co} {r})")

# ================================================================== portal
print("-- the parent portal --")
co, r = PORTAL("/children", None)
check("the portal needs a token", co in (401, 403), f"({co})")
co, r = PORTAL("/children", AT)
check("an administrator is not a guardian", co == 403, f"({co} {r})")
co, r = PORTAL("/children", STU_A)
check("a student is not a guardian", co == 403, f"({co} {r})")

co, r = PORTAL("/children", GT)
kids = {k['id']: k for k in r.get('children', [])} if co == 200 else {}
check("the guardian sees their children", co == 200 and set(kids) == {S0, S1}, f"({co} {list(kids)})")
check("with the school named", co == 200 and bool(r.get('school')), f"({r.get('school')})")
check("the first child's summary carries attendance and fees",
      'attendance' in kids.get(S0, {}).get('summary', {}) and 'fees' in kids.get(S0, {}).get('summary', {}),
      f"({kids.get(S0, {}).get('summary')})")
check("the second child's summary leaves out the fees the school withheld",
      'fees' not in kids.get(S1, {}).get('summary', {}), f"({kids.get(S1, {}).get('summary')})")
check("and says which areas are shared",
      kids.get(S1, {}).get('permissions') == {"attendance": True, "results": False, "fees": False},
      f"({kids.get(S1, {}).get('permissions')})")

co, r = PORTAL(f"/children/{S0}", GT)
check("a child's overview", co == 200 and r.get('student', {}).get('id') == S0, f"({co} {r})")
check("with attendance, results and fees", all(k in r for k in ('attendance', 'results', 'fees')), f"({list(r)})")
co, r = PORTAL(f"/children/{S1}", GT)
check("the overview leaves out what is withheld",
      co == 200 and 'attendance' in r and 'results' not in r and 'fees' not in r, f"({co} {list(r)})")

co, r = PORTAL(f"/children/{S0}/attendance", GT)
check("read a child's attendance", co == 200 and 'summary' in r and 'records' in r, f"({co} {r})")
co, r = PORTAL(f"/children/{S0}/attendance?from=yesterday", GT)
check("a malformed date is refused", co == 400, f"({co} {r})")
co, r = PORTAL(f"/children/{S0}/schedule", GT)
check("read a child's timetable", co == 200 and isinstance(r.get('schedule'), list), f"({co} {r})")
co, r = PORTAL(f"/children/{S0}/results", GT)
check("read a child's published results", co == 200 and 'entries' in r and 'cgpa' in r, f"({co} {r})")
co, r = PORTAL(f"/children/{S0}/fees", GT)
check("read a child's fee statement", co == 200 and 'summary' in r and 'invoices' in r, f"({co} {r})")

co, r = PORTAL(f"/children/{S1}/fees", GT)
check("fees the school withheld are refused, and say why", co == 403 and 'fees' in (r.get('error') or ''), f"({co} {r})")
co, r = PORTAL(f"/children/{S1}/results", GT)
check("results the school withheld are refused", co == 403, f"({co} {r})")

# Family and tenant isolation: the decisive cases. Another family's child at
# the same school — made here, because the fixture school has only this
# guardian's two.
co, r = call("POST", "/auth/admin/school/students", AT, dict(
    studentId=f"GRD-{RUN}", firstName="Other", lastName="Family",
    email=f"other.family.{RUN}@e2e.test"))
check("(another family's child is enrolled at the school)", co == 201, f"({co} {r})")
OTHER = r.get('studentId') if co == 201 else GHOST
co, r = G("POST", "", AT, {"firstName": "Their", "lastName": f"Parent{RUN}", "phone": "0200000009",
                            "students": [{"studentId": OTHER, "relationship": "parent"}]})
check("(with a guardian of their own)", co == 201, f"({co} {r})")
co, r = PORTAL(f"/children/{OTHER}", GT)
check("another family's child at the same school reads as absent", co == 404, f"({co} {r})")
for area in ("attendance", "schedule", "results", "fees"):
    co, r = PORTAL(f"/children/{OTHER}/{area}", GT)
    check(f"and so does their {area}", co == 404, f"({co} {r})")
co, r = PORTAL(f"/children/{SB}", GT)
check("a child at another school reads as absent", co == 404, f"({co} {r})")
co, r = PORTAL(f"/children/{SB}/fees", GT)
check("and so do their fees", co == 404, f"({co} {r})")
co, r = PORTAL(f"/children/{GHOST}", GT)
check("an unknown child reads as absent", co == 404, f"({co})")
co, r = PORTAL("/children/not-a-uuid/results", GT)
check("a malformed id reads as absent", co == 404, f"({co})")

# The side doors: the student and staff routes do not become a way round the
# portal's own rules.
co, r = call("GET", f"/fees/statement?studentId={S1}", GT)
check("the fees router does not serve a guardian a child's statement", co in (403, 404), f"({co} {r})")
co, r = call("GET", f"/gradebook/students/{S1}/transcript", GT)
check("the gradebook does not serve a guardian a transcript", co in (403, 404), f"({co} {r})")
co, r = call("GET", "/student/dashboard", GT)
check("a guardian is not a student", co in (403, 404), f"({co} {r})")
co, r = G("GET", "", GT)
check("a guardian cannot manage guardians", co == 403, f"({co} {r})")
co, r = call("GET", "/leave/types", GT)
check("a guardian is refused from EMS", co == 403, f"({co} {r})")

# ============================================================= notifications
print("-- what guardians are told --")
# An absence, on a register the lecturer submits.
day = (date.today() - timedelta(days=1 + int(RUN) % 200)).isoformat()
co, r = call("POST", "/faculty/attendance/mark", FA, {
    "schedule_id": A['scheduleId'], "date": day,
    "entries": [{"student_id": S0, "status": "absent"}, {"student_id": S1, "status": "present"}]})
check("(a lecturer marks the first child absent)", co == 200, f"({co} {r})")
# The fixture is rebuilt for every run, so every absence notice about these
# children in the outbox was caused by this section. The outbox list carries
# no bodies (they can hold personal details), so messages are counted, not read.
absence = lambda sid: call("GET", f"/notifications/messages?eventKey=guardian.absence&relatedId={sid}", AT)
co, r = absence(S0)
check("marking alone tells nobody: the register is not submitted yet",
      co == 200 and r.get('messages') == [], f"({co} {r})")
co, r = call("POST", "/faculty/attendance/submit", FA, {"course_id": A['courseId'], "date": day})
check("(the lecturer submits the register)", co == 200, f"({co} {r})")

co, r = absence(S0)
msgs = r.get('messages', []) if co == 200 else []
check("the absence is queued for the child's guardians", len(msgs) >= 1, f"({co} {r})")
by_channel = sorted((m.get('channel'), m.get('destination')) for m in msgs)
check("in-app and email for the mother, who has an account and an address",
      any(c == 'in_app' for c, _ in by_channel) and ('email', MOTHER_EMAIL) in by_channel, f"({by_channel})")
check("SMS to both parents' phones",
      ('sms', '0200000001') in by_channel and ('sms', '0200000002') in by_channel, f"({by_channel})")
co, r = absence(S1)
check("a child marked present causes no absence notice", co == 200 and r.get('messages') == [], f"({co} {r})")

co, r = call("POST", "/faculty/attendance/submit", FA, {"course_id": A['courseId'], "date": day})
co, r = absence(S0)
check("re-submitting the register does not write twice",
      co == 200 and len(r.get('messages', [])) == len(msgs), f"({len(r.get('messages', []))} vs {len(msgs)})")

for _ in range(10):
    co, r = call("POST", "/notifications/dispatch", AT, {})
    if co != 200 or (r.get('swept', {}).get('claimed') or 0) == 0:
        break
co, r = call("GET", "/notifications/inbox", GT)
check("the guardian finds the absence in their inbox",
      co == 200 and any(day in (n.get('body') or '') for n in r.get('notifications', [])), f"({co} {r})")

# Fees: shared for the first child, withheld for the second.
co, r = call("POST", "/fees/invoices", AT, {"studentId": S0, "issue": True, "currency": "GHS", "lines": [
    {"code": f"G{RUN}", "description": "Guardian test tuition", "unitAmount": "321.00"}]})
check("(the bursar issues an invoice for the first child)", co == 201, f"({co} {r})")
inv0 = r.get('invoice', {}).get('id') if co == 201 else None
co, r = call("GET", f"/notifications/messages?eventKey=guardian.invoice_issued&relatedId={inv0}", AT)
check("the guardians are told about the invoice", co == 200 and len(r.get('messages', [])) >= 1, f"({co} {r})")

co, r = call("POST", "/fees/invoices", AT, {"studentId": S1, "issue": True, "currency": "GHS", "lines": [
    {"code": f"H{RUN}", "description": "Withheld tuition", "unitAmount": "123.00"}]})
inv1 = r.get('invoice', {}).get('id') if co == 201 else None
co, r = call("GET", f"/notifications/messages?eventKey=guardian.invoice_issued&relatedId={inv1}", AT)
check("but not about fees the school does not share with them",
      co == 200 and len(r.get('messages', [])) == 0, f"({co} {r})")

co, r = call("POST", "/fees/invoices", AT, {"studentId": S0, "currency": "GHS", "lines": [
    {"code": f"D{RUN}", "description": "Draft only", "unitAmount": "99.00"}]})
draft = r.get('invoice', {}).get('id') if co == 201 else None
co, r = PORTAL(f"/children/{S0}/fees", GT)
listed = {i['id'] for i in r.get('invoices', [])} if co == 200 else set()
check("the guardian's statement lists the issued invoice", inv0 in listed, f"({co} {listed})")
check("and not a draft the school has not sent", draft not in listed, f"({listed})")

# ================================================================= removal
print("-- removing a guardian --")
co, r = G("DELETE", f"/{MOTHER}/students/{LINK_S1}", AT)
check("unlink the second child", co == 200, f"({co} {r})")
co, r = PORTAL(f"/children/{S1}", GT)
check("who is then out of the guardian's reach", co == 404, f"({co} {r})")

co, r = G("DELETE", f"/{MOTHER}", AT)
check("remove the mother from the school", co == 200, f"({co} {r})")
check("her account belongs to no other school, so it is deactivated",
      r.get('accountDeactivated') is True, f"({r})")
co, r = PORTAL("/children", GT)
check("and her signed-in session no longer reaches the portal", co in (401, 403, 404), f"({co} {r})")
co, r = call("POST", "/auth/login", None, {"platform": "school", "email": MOTHER_EMAIL, "password": PASSWORD})
check("nor can she sign in again", co in (401, 403), f"({co})")
co, r = G("GET", f"/{MOTHER_B}", BT)
check("the other school's record of the same parent is untouched", co == 200, f"({co} {r})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
