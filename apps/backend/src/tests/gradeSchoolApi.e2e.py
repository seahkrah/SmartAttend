"""
A grade school's classes, subjects and students.

Two grade schools are created for this run (G and H), each with a principal,
and G with a teacher. The seeded school A is a university. Checked:

  - only a grade school has classes and subjects;
  - classes belong to a year and a grade, one name per grade per year, with a
    class teacher from the same school;
  - a child is registered without an email into a class, gets no invitation
    and no sign-in, and a child with an email is invited as before;
  - a student sits in one class a year: placing them elsewhere moves them;
  - capacity is kept, both when placing and when registering;
  - a class with students cannot be removed, nor a level whose grades have
    classes;
  - subjects, and which grades take them;
  - a teacher sees the classes they teach and cannot change them;
  - nothing crosses from one school to another, in the API or the database.
"""
import json, subprocess, sys, time, os
from support.psql import psql
RUN = str(int(time.time()))[-6:]
SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
d = json.load(open(f"{SP}/seed.json")); A = d['A']
sa = json.load(open(f"{SP}/superadmin.json"))
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
DB = os.environ.get("DATABASE_URL", "postgresql://jjelo@127.0.0.1:55432/jjelotech_dev")
P = F = 0
PW = "Grade-school-e2e-9!"

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

def activate_and_login(link, email):
    token = link.split('token=')[-1]
    call("POST", "/auth/activate", None, {"token": token, "password": PW, "confirmPassword": PW})
    co, r = call("POST", "/auth/login", None, {"platform": "school", "email": email, "password": PW})
    return r.get('accessToken') if isinstance(r, dict) else None

def grade_school(tag, stages):
    co, r = call("POST", "/superadmin/tenants", SU,
                 {"name": f"Grade School {tag} {RUN}", "code": f"GS2E-{tag}{RUN}", "kind": "school",
                  "school_type": "grade_school", "school_stages": stages})
    tid = (r.get('tenant') or {}).get('id') if isinstance(r, dict) else None
    email = f"principal.{tag.lower()}{RUN}@gs2e.test"
    co, r = call("POST", "/superadmin/tenant-admins", SU,
                 {"tenantId": tid, "email": email, "fullName": f"Principal {tag}", "handover": True})
    link = (r.get('invitation') or {}).get('link', '') if isinstance(r, dict) else ''
    return tid, activate_and_login(link, email)

# ----------------------------------------------------------------- set up
print("-- setting up two grade schools --")
G, GT = grade_school("G", ["elementary", "junior_high"])
H, HT = grade_school("H", ["elementary"])
check("two grade schools, each with a principal signed in", G and GT and H and HT)

co, r = call("GET", "/academics/structure", GT)
grades = {g['code']: g['id'] for g in r.get('gradeLevels', [])} if co == 200 else {}
co, r = call("GET", "/academics/structure", HT)
h_grades = {g['code']: g['id'] for g in r.get('gradeLevels', [])} if co == 200 else {}
check("G has Grades 1 to 9", list(grades) == [f"G{n}" for n in range(1, 10)], f"({list(grades)})")

co, r = call("POST", "/academics/years", GT,
             {"name": f"2026/2027", "startDate": "2026-09-01", "endDate": "2027-07-31", "isCurrent": True})
year = (r.get('year') or {}).get('id') if isinstance(r, dict) else None
check("G creates its current academic year", co == 201 and year, f"({co} {r})")
co, r = call("POST", "/academics/years", HT,
             {"name": f"2026/2027", "startDate": "2026-09-01", "endDate": "2027-07-31", "isCurrent": True})
h_year = (r.get('year') or {}).get('id') if isinstance(r, dict) else None

temail = f"teacher.{RUN}@gs2e.test"
co, r = call("POST", "/auth/admin/school/faculty", GT,
             {"facultyId": f"T-{RUN}", "firstName": "Musu", "lastName": "Kamara", "email": temail, "title": "Mrs."})
check("G adds a teacher", co == 201, f"({co} {r})")
teacher_user = r.get('userId') if isinstance(r, dict) else None
teacher = (r.get('facultyId') if isinstance(r, dict) else None)
co, r = call("POST", f"/auth/admin/school/users/{teacher_user}/invitation", GT, {"handover": True})
TT = activate_and_login((r.get('invitation') or {}).get('link', '') if isinstance(r, dict) else '', temail)
check("who signs in", bool(TT), f"({co} {r})")

# ----------------------------------------------------------- only a grade school
print("-- only a grade school has classes --")
co, r = call("GET", "/grade-school/classes", AT)
check("a university is refused classes", co == 403 and r.get('code') == 'NOT_FOR_SCHOOL_TYPE', f"({co} {r})")
co, r = call("GET", "/grade-school/subjects", AT)
check("and subjects", co == 403, f"({co} {r})")
co, r = call("GET", "/grade-school/classes", None)
check("and nobody gets in without signing in", co == 401, f"({co})")

# ------------------------------------------------------------------- classes
print("-- classes --")
co, r = call("GET", "/grade-school/classes", GT)
check("no classes yet, in the current year", co == 200 and r.get('classes') == []
      and (r.get('year') or {}).get('id') == year, f"({co} {r})")
co, r = call("POST", "/grade-school/classes", GT,
             {"academicYearId": year, "gradeLevelId": grades.get('G1'), "name": "A", "classTeacherId": teacher, "capacity": 3})
c1a = (r.get('class') or {}).get('id') if isinstance(r, dict) else None
check("create Grade 1A with a class teacher and room for 3", co == 201
      and r['class']['display_name'] == 'Grade 1A' and r['class']['class_teacher_name'] == 'Mrs. Musu Kamara', f"({co} {r})")
co, r = call("POST", "/grade-school/classes", GT, {"academicYearId": year, "gradeLevelId": grades.get('G1'), "name": "B"})
c1b = (r.get('class') or {}).get('id') if isinstance(r, dict) else None
check("and Grade 1B, with no teacher yet", co == 201, f"({co} {r})")
co, r = call("POST", "/grade-school/classes", GT, {"academicYearId": year, "gradeLevelId": grades.get('G1'), "name": "a"})
check("a second Grade 1A is refused", co == 409, f"({co} {r})")
co, r = call("POST", "/grade-school/classes", GT, {"academicYearId": year, "gradeLevelId": grades.get('G2'), "name": "A"})
c2a = (r.get('class') or {}).get('id') if isinstance(r, dict) else None
check("but Grade 2A is its own class", co == 201, f"({co} {r})")
co, r = call("POST", "/grade-school/classes", GT, {"academicYearId": year, "gradeLevelId": grades.get('G1'), "name": "C", "capacity": 0})
check("a capacity of 0 is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/grade-school/classes", GT, {"academicYearId": year, "gradeLevelId": grades.get('G1'), "name": ""})
check("a class needs a name", co == 400, f"({co} {r})")
co, r = call("POST", "/grade-school/classes", GT, {"academicYearId": year, "gradeLevelId": h_grades.get('G1'), "name": "Z"})
check("another school's grade reads as not found", co == 404, f"({co} {r})")
co, r = call("POST", "/grade-school/classes", GT, {"academicYearId": h_year, "gradeLevelId": grades.get('G1'), "name": "Z"})
check("so does another school's year", co == 404, f"({co} {r})")
co, r = call("POST", "/grade-school/classes", HT, {"academicYearId": h_year, "gradeLevelId": h_grades.get('G1'), "name": "A", "classTeacherId": teacher})
check("and another school's teacher", co == 404, f"({co} {r})")
co, r = call("POST", "/grade-school/classes", HT, {"academicYearId": h_year, "gradeLevelId": h_grades.get('G1'), "name": "A"})
h1a = (r.get('class') or {}).get('id') if isinstance(r, dict) else None
check("H has its own Grade 1A", co == 201, f"({co} {r})")

co, r = call("GET", "/grade-school/classes", GT)
names = [c['display_name'] for c in r.get('classes', [])] if co == 200 else []
check("G's classes are listed grade by grade", names == ['Grade 1A', 'Grade 1B', 'Grade 2A'], f"({names})")

# ---------------------------------------------------------- registering pupils
print("-- registering children --")
def register(t, n, **extra):
    body = {"studentId": f"P-{RUN}-{n}", "firstName": f"Child{n}", "lastName": "Doe", **extra}
    return call("POST", "/auth/admin/school/students", t, body)

co, r = register(GT, 1, classId=c1a)
kid1 = r.get('studentId') if isinstance(r, dict) else None
check("a child is registered without an email, into Grade 1A", co == 201 and r.get('classId') == c1a, f"({co} {r})")
check("and is sent no invitation", co == 201 and r.get('invitation') is None, f"({r})")
out, _ = sql(f"SELECT u.email LIKE '%@students.invalid', u.is_active, s.status FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = '{kid1}'")
check("their account has an undeliverable address", out.startswith("t|"), f"({out})")
check("and a grade school's status", out.endswith("|active"), f"({out})")

co, r = register(GT, 2, email=f"child2.{RUN}@gs2e.test", classId=c1a)
kid2 = r.get('studentId') if isinstance(r, dict) else None
check("an older child with an email is invited as before", co == 201 and r.get('invitation') is not None, f"({co} {r})")
co, r = register(GT, 3)
kid3 = r.get('studentId') if isinstance(r, dict) else None
check("a child can be registered and placed later", co == 201 and r.get('classId') is None, f"({co} {r})")
co, r = register(GT, 4, classId=h1a)
check("not into another school's class", co == 404, f"({co} {r})")
co, r = register(AT, 5, classId=c1a)
check("a university does not place students in classes", co == 400, f"({co} {r})")
co, r = register(AT, 6)
check("and still requires an email", co == 400, f"({co} {r})")

co, r = call("GET", f"/grade-school/classes/{c1a}/students", GT)
ids = [s['id'] for s in r.get('students', [])] if co == 200 else []
check("Grade 1A lists its two children", sorted(ids) == sorted([kid1, kid2]), f"({co} {r})")
co, r = call("GET", "/auth/admin/school/students?page=1&pageSize=50", GT)
row = next((s for s in r.get('students', []) if s['id'] == kid1), {}) if co == 200 else {}
check("the students list shows the child's class", row.get('current_class') == 'Grade 1A', f"({row.get('current_class')})")
co, r = call("GET", "/grade-school/unplaced-students", GT)
check("the child placed later is listed as unplaced", co == 200 and [s['id'] for s in r['students']] == [kid3], f"({co} {r})")

# ------------------------------------------------------------------ placement
print("-- one class a year --")
co, r = call("POST", f"/grade-school/classes/{c1b}/students", GT, {"studentIds": [kid2]})
check("move the second child to Grade 1B", co == 200 and r.get('placed') == 1, f"({co} {r})")
out, _ = sql(f"SELECT COUNT(*), MIN(class_id::text) FROM class_placements WHERE student_id = '{kid2}'")
check("they are in one class, 1B", out == f"1|{c1b}", f"({out})")
co, r = call("POST", f"/grade-school/classes/{c1a}/students", GT, {"studentIds": [kid3]})
check("place the third child in 1A", co == 200, f"({co} {r})")
co, r = call("POST", f"/grade-school/classes/{c1a}/students", GT, {"studentIds": [kid2]})
check("1A has room for 3, so the second child can come back", co == 200, f"({co} {r})")
co, r = register(GT, 7, classId=c1a)
check("registering a fourth child into full 1A is refused", co == 409, f"({co} {r})")
co, r = call("POST", f"/grade-school/classes/{c1b}/students", GT, {"studentIds": [kid1, kid2, kid3]})
check("1B has no limit: all three move there", co == 200 and r.get('placed') == 3, f"({co} {r})")
co, r = call("PATCH", f"/grade-school/classes/{c1b}", GT, {"capacity": 2})
check("1B cannot be given a capacity below its size", co == 409, f"({co} {r})")
co, r = call("POST", f"/grade-school/classes/{h1a}/students", GT, {"studentIds": [kid1]})
check("G cannot place into H's class", co == 404, f"({co} {r})")
co, r = call("POST", f"/grade-school/classes/{h1a}/students", HT, {"studentIds": [kid1]})
check("nor H place G's child", co == 404, f"({co} {r})")
co, r = call("GET", f"/grade-school/classes/{c1b}/students", HT)
check("nor read G's class list", co == 404, f"({co} {r})")

# -------------------------------------------------------------------- removal
print("-- removing --")
co, r = call("DELETE", f"/grade-school/classes/{c1b}", GT)
check("a class with students cannot be removed", co == 409, f"({co} {r})")
co, r = call("PATCH", f"/superadmin/tenants/{G}", SU, {"school_stages": ["junior_high"]})
check("nor the level whose grades have classes", co == 409 and r.get('code') == 'STAGE_IN_USE', f"({co} {r})")
co, r = call("DELETE", f"/grade-school/classes/{c1b}/students/{kid3}", GT)
check("take a child out of a class", co == 200, f"({co} {r})")
co, r = call("DELETE", f"/grade-school/classes/{c2a}", GT)
check("an empty class can be removed", co == 200, f"({co} {r})")

# ------------------------------------------------------------------- subjects
print("-- subjects --")
co, r = call("POST", "/grade-school/subjects", GT, {"code": "math", "name": "Mathematics"})
math = (r.get('subject') or {}).get('id') if isinstance(r, dict) else None
check("add Mathematics", co == 201 and r['subject']['code'] == 'MATH', f"({co} {r})")
co, r = call("POST", "/grade-school/subjects", GT, {"code": "MATH", "name": "Maths again"})
check("a second MATH is refused", co == 409, f"({co} {r})")
co, r = call("POST", "/grade-school/subjects", HT, {"code": "MATH", "name": "Mathematics"})
check("but H has its own", co == 201, f"({co} {r})")
co, r = call("PUT", f"/grade-school/subjects/{math}/grades", GT, {"gradeLevelIds": [grades['G1'], grades['G2']]})
check("Grades 1 and 2 take Mathematics", co == 200, f"({co} {r})")
co, r = call("GET", "/grade-school/subjects", GT)
sub = next((s for s in r.get('subjects', []) if s['id'] == math), {}) if co == 200 else {}
check("and the list says so", sub.get('grade_level_ids') == [grades['G1'], grades['G2']], f"({sub})")
co, r = call("PUT", f"/grade-school/subjects/{math}/grades", GT, {"gradeLevelIds": [h_grades['G1']]})
check("another school's grade cannot take it", co == 404, f"({co} {r})")
co, r = call("DELETE", f"/grade-school/subjects/{math}", GT)
check("a subject grades take cannot be deleted", co == 409, f"({co} {r})")
co, r = call("PATCH", f"/grade-school/subjects/{math}", GT, {"isActive": False})
check("but can be made inactive", co == 200 and r['subject']['is_active'] is False, f"({co} {r})")
call("PUT", f"/grade-school/subjects/{math}/grades", GT, {"gradeLevelIds": []})
co, r = call("DELETE", f"/grade-school/subjects/{math}", GT)
check("and deleted once no grade takes it", co == 200, f"({co} {r})")

# -------------------------------------------------------------------- teacher
print("-- the class teacher --")
co, r = call("GET", "/grade-school/classes?mine=1", TT)
check("the teacher sees the class they teach", co == 200
      and [c['display_name'] for c in r.get('classes', [])] == ['Grade 1A'], f"({co} {r})")
co, r = call("GET", f"/grade-school/classes/{c1a}/students", TT)
check("and can read a class list", co == 200, f"({co} {r})")
co, r = call("POST", "/grade-school/classes", TT, {"academicYearId": year, "gradeLevelId": grades['G3'], "name": "A"})
check("but cannot create a class", co == 403, f"({co} {r})")
co, r = call("POST", f"/grade-school/classes/{c1a}/students", TT, {"studentIds": [kid3]})
check("nor place a child", co == 403, f"({co} {r})")

# ------------------------------------------------------------------- database
print("-- the database keeps schools apart --")
_, err = sql(f"INSERT INTO class_placements (tenant_id, student_id, class_id, academic_year_id) VALUES ('{H}', '{kid3}', '{h1a}', '{h_year}')")
check("a placement joining two schools is refused", 'belongs to another tenant' in err, f"({err})")
_, err = sql(f"INSERT INTO school_classes (tenant_id, academic_year_id, grade_level_id, name) VALUES ('{G}', '{year}', '{h_grades['G1']}', 'X')")
check("so is a class on another school's grade", 'belongs to another tenant' in err, f"({err})")
out, _ = sql(f"SELECT academic_year_id FROM class_placements WHERE student_id = '{kid1}'")
check("a placement's year is its class's", out == year, f"({out})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
