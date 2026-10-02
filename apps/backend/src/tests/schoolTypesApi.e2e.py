"""
School types.

A school is created as a type (grade school, vocational, college,
university) offering chosen levels, and the tools its people get follow from
them. This suite checks the rules that protect a school's records:

  - a school cannot be created without a type, or with a level its type does
    not have;
  - a grade school's levels generate its grades, and adding a level adds
    grades without touching the ones it has;
  - a grade school's own people are told what kind of school it is, and are
    refused the university tools (programmes);
  - the type cannot change once the school has students, while its levels
    still can;
  - a school created before types existed is a university, and loses nothing.
"""
import json, subprocess, sys, time, os
from support.psql import psql
RUN = str(int(time.time()))[-6:]
SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
d = json.load(open(f"{SP}/seed.json")); A = d['A']
c = json.load(open(f"{SP}/corp.json"))
sa = json.load(open(f"{SP}/superadmin.json"))
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
DB = os.environ.get("DATABASE_URL", "postgresql://jjelo@127.0.0.1:55432/jjelotech_dev")
P = F = 0
GOOD = "Grade-school-e2e-9!"

def call(m, p, t=None, body=None):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "30", "-X", m,
           "-H", "Content-Type: application/json"]
    if t:
        cmd += ["-H", f"Authorization: Bearer {t}"]
    cmd.append(ROOT + p)
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    o = subprocess.run(cmd, capture_output=True, text=True).stdout
    txt, _, code = o.rpartition("\n")
    try:
        parsed = json.loads(txt)
    except Exception:
        parsed = txt
    return int(code), parsed

def sql(q):
    r = psql(DB, q)
    return r.stdout.strip(), r.stderr.strip()

def check(n, ok, dd=""):
    global P, F
    if ok:
        P += 1; print(f"  ok    {n}")
    else:
        F += 1; print(f"  FAIL  {n} {dd}")

SU, AT = sa['token'], A['token']

def grades_of(tenant):
    out, _ = sql(f"SELECT code FROM grade_levels WHERE tenant_id = '{tenant}' ORDER BY sort_order")
    return out.split("\n") if out else []

# ----------------------------------------------------------------- catalogue
print("-- the catalogue --")
co, r = call("GET", "/superadmin/school-types", SU)
keys = [t['key'] for t in r.get('types', [])] if isinstance(r, dict) else []
check("a superadmin reads the four school types", co == 200
      and keys == ['grade_school', 'vocational', 'college', 'university'], f"({co} {keys})")
check("each with its levels", co == 200 and all(len(t['stages']) > 0 for t in r['types']))
co, r = call("GET", "/superadmin/school-types", AT)
check("a school administrator cannot", co == 403, f"({co})")

# ------------------------------------------------------------------ creating
print("-- creating a grade school --")
co, r = call("POST", "/superadmin/tenants", SU,
             {"name": f"St. Joseph Elementary {RUN}", "code": f"ST2E-G{RUN}", "kind": "school",
              "school_type": "grade_school", "school_stages": ["elementary"]})
check("create a grade school offering elementary", co == 201, f"({co} {r})")
gs = (r.get('tenant') or {}).get('id') if isinstance(r, dict) else None
check("it is recorded as a grade school", isinstance(r, dict)
      and r.get('tenant', {}).get('school_type') == 'grade_school'
      and r.get('tenant', {}).get('school_stages') == ['elementary'], f"({r})")
check("elementary gives it Grades 1 to 6", grades_of(gs) == [f"G{n}" for n in range(1, 7)], f"({grades_of(gs)})")

co, r = call("POST", "/superadmin/tenants", SU,
             {"name": "Mixed up", "code": f"ST2E-X{RUN}", "kind": "school",
              "school_type": "grade_school", "school_stages": ["elementary", "masters"]})
check("a level from another type is refused", co == 400 and r.get('code') == 'INVALID_STAGE', f"({co} {r})")
co, r = call("POST", "/superadmin/tenants", SU,
             {"name": "No levels", "code": f"ST2E-Y{RUN}", "kind": "school",
              "school_type": "vocational", "school_stages": []})
check("a school offering no level is refused", co == 400 and r.get('code') == 'STAGES_REQUIRED', f"({co} {r})")
out, _ = sql(f"SELECT COUNT(*) FROM tenants WHERE code IN ('ST2E-X{RUN}', 'ST2E-Y{RUN}')")
check("and neither refused school was half-created", out == "0", f"({out})")

# ------------------------------------------------------- its own administrator
print("-- what the grade school's administrator is given --")
co, r = call("POST", "/superadmin/tenant-admins", SU,
             {"tenantId": gs, "email": f"principal.{RUN}@st2e.test", "fullName": "School Principal",
              "handover": True})
check("appoint its principal", co == 201, f"({co} {r})")
link = (r.get('invitation') or {}).get('link', '') if isinstance(r, dict) else ''
co, r = call("POST", "/auth/activate", None,
             {"token": link.split('token=')[-1], "password": GOOD, "confirmPassword": GOOD})
check("who sets a password", co == 200, f"({co} {r})")
co, r = call("POST", "/auth/login", None,
             {"platform": "school", "email": f"principal.{RUN}@st2e.test", "password": GOOD})
GT = r.get('accessToken') if isinstance(r, dict) else None
check("and signs in", co == 200 and GT, f"({co} {r})")

co, r = call("GET", "/academics/structure", GT)
check("the school is told it is a grade school", co == 200 and r.get('type') == 'grade_school', f"({co} {r})")
check("with grades and without programmes", co == 200
      and r['features']['gradeLevels'] and not r['features']['programmes'], f"({r.get('features')})")
check("in its own words", co == 200 and r['labels']['teachers'] == 'Teachers'
      and r['labels']['subjects'] == 'Subjects', f"({r.get('labels')})")
check("its grades are Grade 1 to Grade 6", co == 200
      and [g['name'] for g in r['gradeLevels']] == [f"Grade {n}" for n in range(1, 7)], f"({r.get('gradeLevels')})")
offered = {s['key']: s['offered'] for s in r.get('stages', [])} if co == 200 else {}
check("elementary is offered and junior high is not",
      offered.get('elementary') is True and offered.get('junior_high') is False, f"({offered})")

co, r = call("GET", "/academics/programmes", GT)
check("programmes are refused to a grade school", co == 403 and r.get('code') == 'NOT_FOR_SCHOOL_TYPE', f"({co} {r})")
co, r = call("POST", "/academics/programmes", GT, {"code": "BSC", "name": "Bachelor of Science"})
check("and it cannot create one", co == 403, f"({co} {r})")
co, r = call("GET", "/academics/years", GT)
check("the tools every school uses still answer", co == 200, f"({co} {r})")

# ------------------------------------------------------------------- growing
print("-- growing from 1-6 to 1-9 --")
before = {g['code']: g['id'] for g in call("GET", "/academics/structure", GT)[1].get('gradeLevels', [])}
co, r = call("PATCH", f"/superadmin/tenants/{gs}", SU, {"school_stages": ["elementary", "junior_high"]})
check("add junior high", co == 200, f"({co} {r})")
co, r = call("GET", "/academics/structure", GT)
after = {g['code']: g['id'] for g in r.get('gradeLevels', [])}
check("the school now runs Grades 1 to 9", list(after) == [f"G{n}" for n in range(1, 10)], f"({list(after)})")
check("and Grades 1 to 6 are the same records as before",
      all(after.get(k) == v for k, v in before.items()) and len(before) == 6, f"({before} {after})")

co, r = call("PATCH", f"/superadmin/tenants/{gs}", SU, {"school_stages": ["kindergarten"]})
check("an unknown level is refused", co == 400 and r.get('code') == 'INVALID_STAGE', f"({co} {r})")
check("and the school is unchanged", grades_of(gs) == [f"G{n}" for n in range(1, 10)], f"({grades_of(gs)})")

co, r = call("PATCH", f"/superadmin/tenants/{gs}", SU, {"school_stages": ["early_childhood", "elementary", "junior_high"]})
check("add nursery and kindergarten", co == 200, f"({co} {r})")
check("they come before Grade 1", grades_of(gs)[:4] == ['N', 'K1', 'K2', 'G1'], f"({grades_of(gs)})")

# ------------------------------------------------------ changing type, empty
print("-- the type of an empty school can change --")
co, r = call("PATCH", f"/superadmin/tenants/{gs}", SU, {"school_type": "vocational", "school_stages": ["certificate"]})
check("a school with no students can become vocational", co == 200, f"({co} {r})")
check("it has no grades any more", grades_of(gs) == [], f"({grades_of(gs)})")
co, r = call("GET", "/academics/structure", GT)
check("and is given trades instead", co == 200 and r['features']['programmes']
      and r['labels']['programmes'] == 'Trades', f"({co} {r})")
co, r = call("GET", "/academics/programmes", GT)
check("which it can now use", co == 200, f"({co} {r})")
co, r = call("PATCH", f"/superadmin/tenants/{gs}", SU, {"school_type": "grade_school", "school_stages": ["elementary"]})
check("and back to a grade school", co == 200 and grades_of(gs) == [f"G{n}" for n in range(1, 7)], f"({co} {grades_of(gs)})")

# ------------------------------------------------- a school that has students
print("-- a school with students --")
students, _ = sql(f"SELECT COUNT(*) FROM students WHERE tenant_id = '{A['tenantId']}'")
check("(precondition: the seeded school has students)", students not in ("", "0"), f"({students})")
co, r = call("GET", "/academics/structure", AT)
check("a school created before types is a university", co == 200 and r.get('type') == 'university', f"({co} {r})")
co, r = call("GET", "/academics/programmes", AT)
check("and keeps its programmes", co == 200, f"({co} {r})")
co, r = call("PATCH", f"/superadmin/tenants/{A['tenantId']}", SU,
             {"school_type": "grade_school", "school_stages": ["elementary"]})
check("its type cannot change: it has students", co == 409 and r.get('code') == 'SCHOOL_TYPE_LOCKED', f"({co} {r})")
co, r = call("GET", "/academics/structure", AT)
check("and it is still a university", co == 200 and r.get('type') == 'university', f"({r.get('type')})")
co, r = call("PATCH", f"/superadmin/tenants/{A['tenantId']}", SU,
             {"school_type": "university", "school_stages": ["undergraduate", "masters"]})
check("but it can add a level", co == 200, f"({co} {r})")
co, r = call("GET", "/academics/structure", AT)
check("masters is now offered", co == 200
      and any(s['key'] == 'masters' and s['offered'] for s in r.get('stages', [])), f"({r.get('stages')})")
call("PATCH", f"/superadmin/tenants/{A['tenantId']}", SU, {"school_type": "university", "school_stages": ["undergraduate"]})

# ------------------------------------------------------------------ refusals
print("-- who and what can be given a type --")
co, r = call("PATCH", f"/superadmin/tenants/{A['tenantId']}", AT, {"school_type": "grade_school", "school_stages": ["elementary"]})
check("a school administrator cannot change their own school's type", co == 403, f"({co} {r})")
co, r = call("PATCH", f"/superadmin/tenants/{c['A']['tenantId']}", SU, {"school_type": "college", "school_stages": ["diploma"]})
check("a company cannot be given a school type", co == 400 and r.get('code') == 'NOT_A_SCHOOL', f"({co} {r})")
_, err = sql(f"UPDATE tenants SET school_type = 'kindergarten' WHERE id = '{gs}'")
check("the database refuses a type that does not exist", 'tenants_school_type_check' in err, f"({err})")
_, err = sql(f"UPDATE tenants SET school_type = 'college' WHERE id = '{c['A']['tenantId']}'")
check("and a school type on a company", 'tenants_school_type_kind' in err, f"({err})")

# ------------------------------------------------------------------ deleting
print("-- deleting an empty grade school --")
co, r = call("POST", "/superadmin/tenants", SU,
             {"name": f"Never Opened {RUN}", "code": f"ST2E-D{RUN}", "kind": "school",
              "school_type": "grade_school", "school_stages": ["senior_high"]})
empty = (r.get('tenant') or {}).get('id') if isinstance(r, dict) else None
check("create one", co == 201 and grades_of(empty) == ['G10', 'G11', 'G12'], f"({co} {r})")
co, r = call("DELETE", f"/superadmin/tenants/{empty}", SU)
check("its grades do not stop it being deleted", co == 200, f"({co} {r})")
out, _ = sql(f"SELECT COUNT(*) FROM grade_levels WHERE tenant_id = '{empty}'")
check("and they go with it", out == "0", f"({out})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
