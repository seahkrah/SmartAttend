"""
SMS academic core and gradebook — the first complete vertical slice beyond
attendance.

Covers the whole chain a school actually runs on: an academic year, a term,
a programme, its curriculum, a student reading it, assessments on a course,
marks, a computed result, publication, and the transcript that comes out of
it. Every step is checked for function, for tenant isolation, for platform
isolation and for role enforcement.
"""
import json, subprocess, sys, time, os
RUN = str(int(time.time()))[-6:]
SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
d = json.load(open(f"{SP}/seed.json")); A, B = d['A'], d['B']
c = json.load(open(f"{SP}/corp.json")); HR = c['A']['token']
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
GHOST = "00000000-0000-4000-8000-000000000000"

# ---------------------------------------------------------------- platform
print("-- platform isolation --")
co, r = call("GET", "/years", HR, base="/academics")
check("EMS identity refused from SMS academics", co == 403, f"({co} {r})")
co, r = call("GET", "/schemes", HR, base="/gradebook")
check("EMS identity refused from SMS gradebook", co == 403, f"({co} {r})")
co, r = call("GET", "/years", None, base="/academics")
check("academics needs a token", co in (401, 403), f"({co})")

# ---------------------------------------------------------------- years
print("-- academic years --")
co, r = call("POST", "/years", AT,
             {"name": f"Year {RUN}", "startDate": "2026-09-01", "endDate": "2027-07-31",
              "isCurrent": True}, base="/academics")
check("create academic year", co == 201, f"({co} {r})")
year_a = r.get('year', {}).get('id') if co == 201 else None

co, r = call("POST", "/years", AT,
             {"name": f"Bad {RUN}", "startDate": "2027-09-01", "endDate": "2026-07-31"},
             base="/academics")
check("a year ending before it starts is refused", co == 400, f"({co} {r})")

co, r = call("POST", "/years", AT,
             {"name": f"Second {RUN}", "startDate": "2027-09-01", "endDate": "2028-07-31",
              "isCurrent": True}, base="/academics")
check("promoting a second year to current succeeds", co == 201, f"({co} {r})")
year_a2 = r.get('year', {}).get('id') if co == 201 else None

co, r = call("GET", "/years", AT, base="/academics")
current = [y for y in r.get('years', []) if y.get('is_current')]
check("exactly one year is current", len(current) == 1, f"({[y['name'] for y in current]})")

co, r = call("POST", "/years", FA,
             {"name": f"Nope {RUN}", "startDate": "2026-09-01", "endDate": "2027-07-31"},
             base="/academics")
check("a lecturer cannot create an academic year", co == 403, f"({co} {r})")
co, r = call("GET", "/years", FA, base="/academics")
check("a lecturer may read them", co == 200, f"({co} {r})")

# B's view must not contain A's year.
co, r = call("GET", "/years", BT, base="/academics")
b_years = [y['id'] for y in r.get('years', [])] if co == 200 else []
check("B does not see A's academic year", year_a not in b_years, f"({b_years})")
co, r = call("PATCH", f"/years/{year_a}", BT, {"name": "hijacked"}, base="/academics")
check("B cannot edit A's academic year", co == 404, f"({co} {r})")
co, r = call("DELETE", f"/years/{year_a}", BT, base="/academics")
check("B cannot delete A's academic year", co == 404, f"({co} {r})")

# ---------------------------------------------------------------- terms
print("-- terms --")
co, r = call("POST", "/terms", AT,
             {"name": f"Term {RUN}", "departmentId": A['deptId'], "academicYearId": year_a,
              "startDate": "2026-09-01", "endDate": "2027-01-31", "sequence": 1,
              "isActive": True}, base="/academics")
check("create term under a year", co == 201, f"({co} {r})")
term_a = r.get('term', {}).get('id') if co == 201 else None

co, r = call("POST", "/terms", AT,
             {"name": f"Cross {RUN}", "departmentId": B['deptId'], "academicYearId": year_a,
              "startDate": "2026-09-01", "endDate": "2027-01-31"}, base="/academics")
check("cannot attach a term to B's department", co == 404, f"({co} {r})")

co, r = call("GET", f"/terms?yearId={year_a}", AT, base="/academics")
check("terms list by year", co == 200 and len(r.get('terms', [])) >= 1, f"({co} {r})")

# ---------------------------------------------------------------- programmes
print("-- programmes and curriculum --")
co, r = call("POST", "/programmes", AT,
             {"code": f"BSC{RUN}", "name": "BSc Computing", "departmentId": A['deptId'],
              "award": "BSc (Hons)", "durationYears": 3, "creditsRequired": 360},
             base="/academics")
check("create programme", co == 201, f"({co} {r})")
prog_a = r.get('programme', {}).get('id') if co == 201 else None

co, r = call("POST", "/programmes", BT,
             {"code": f"BSC{RUN}", "name": "BSc Computing", "durationYears": 3},
             base="/academics")
check("B may reuse A's programme code", co == 201, f"({co} {r})")
prog_b = r.get('programme', {}).get('id') if co == 201 else None
co, r = call("POST", "/programmes", AT,
             {"code": f"BSC{RUN}", "name": "Duplicate"}, base="/academics")
check("still unique within A", co == 409, f"({co} {r})")

co, r = call("POST", f"/programmes/{prog_a}/courses", AT,
             {"courseId": A['courseId'], "studyYear": 1, "requirement": "core", "credits": 20},
             base="/academics")
check("add a course to the curriculum", co == 201, f"({co} {r})")

co, r = call("POST", f"/programmes/{prog_a}/courses", AT,
             {"courseId": B['courseId'], "studyYear": 1}, base="/academics")
check("cannot put B's course in A's curriculum", co == 404, f"({co} {r})")

co, r = call("POST", f"/programmes/{prog_a}/courses", AT,
             {"courseId": A['courseId'], "studyYear": 9}, base="/academics")
check("a study year beyond the programme's length is refused", co == 400, f"({co} {r})")

co, r = call("GET", f"/programmes/{prog_a}", AT, base="/academics")
check("programme detail carries its curriculum",
      co == 200 and len(r.get('curriculum', [])) == 1, f"({co} {r})")
co, r = call("GET", f"/programmes/{prog_b}", AT, base="/academics")
check("A cannot read B's programme", co == 404, f"({co} {r})")

# ---------------------------------------------------------------- student programme
print("-- student programme enrolment --")
co, r = call("POST", f"/students/{A['students'][0]}/programme", AT,
             {"programmeId": prog_a, "academicYearId": year_a, "entryYear": 2026},
             base="/academics")
check("enrol a student on a programme", co == 201, f"({co} {r})")

co, r = call("POST", f"/students/{A['students'][0]}/programme", AT,
             {"programmeId": prog_a}, base="/academics")
check("a second active programme is refused", co == 409, f"({co} {r})")

co, r = call("POST", f"/students/{B['students'][0]}/programme", AT,
             {"programmeId": prog_a}, base="/academics")
check("cannot enrol B's student", co == 404, f"({co} {r})")

co, r = call("POST", f"/students/{A['students'][1]}/programme", AT,
             {"programmeId": prog_b}, base="/academics")
check("cannot enrol onto B's programme", co == 404, f"({co} {r})")

co, r = call("GET", f"/students/{A['students'][0]}/programme", AT, base="/academics")
check("read the student's programme", co == 200 and len(r.get('enrolments', [])) == 1, f"({co} {r})")
co, r = call("GET", f"/students/{B['students'][0]}/programme", AT, base="/academics")
check("cannot read B's student programme", co == 404, f"({co} {r})")

# ---------------------------------------------------------------- schemes
print("-- grading schemes --")
co, r = call("POST", "/schemes", AT, {
    "name": f"Standard {RUN}", "isDefault": True, "passMark": 40,
    "bands": [
        {"letter": "A", "minScore": 70, "maxScore": 100, "gradePoint": 4, "isPass": True},
        {"letter": "B", "minScore": 60, "maxScore": 69.99, "gradePoint": 3, "isPass": True},
        {"letter": "C", "minScore": 50, "maxScore": 59.99, "gradePoint": 2, "isPass": True},
        {"letter": "D", "minScore": 40, "maxScore": 49.99, "gradePoint": 1, "isPass": True},
        {"letter": "F", "minScore": 0, "maxScore": 39.99, "gradePoint": 0, "isPass": False},
    ]}, base="/gradebook")
check("create a grading scheme with bands", co == 201, f"({co} {r})")
scheme_a = r.get('scheme', {}).get('id') if co == 201 else None

co, r = call("POST", "/schemes", AT, {
    "name": f"Overlap {RUN}",
    "bands": [
        {"letter": "A", "minScore": 60, "maxScore": 100, "gradePoint": 4},
        {"letter": "B", "minScore": 50, "maxScore": 70, "gradePoint": 3},
    ]}, base="/gradebook")
check("overlapping bands are refused", co == 409, f"({co} {r})")

co, r = call("POST", "/schemes", AT, {"name": f"Empty {RUN}", "bands": []}, base="/gradebook")
check("a scheme with no bands is refused", co == 400, f"({co} {r})")

co, r = call("POST", "/schemes", FA, {"name": "x", "bands": [
    {"letter": "A", "minScore": 0, "maxScore": 100, "gradePoint": 4}]}, base="/gradebook")
check("a lecturer cannot define the grade scale", co == 403, f"({co} {r})")

# B needs its own default scheme for later assertions.
co, r = call("POST", "/schemes", BT, {
    "name": f"B scheme {RUN}", "isDefault": True,
    "bands": [
        {"letter": "P", "minScore": 40, "maxScore": 100, "gradePoint": 4, "isPass": True},
        {"letter": "F", "minScore": 0, "maxScore": 39.99, "gradePoint": 0, "isPass": False},
    ]}, base="/gradebook")
check("B defines its own scheme", co == 201, f"({co} {r})")

co, r = call("GET", "/schemes", AT, base="/gradebook")
a_schemes = [s['id'] for s in r.get('schemes', [])] if co == 200 else []
co, r = call("GET", "/schemes", BT, base="/gradebook")
b_schemes = [s['id'] for s in r.get('schemes', [])] if co == 200 else []
check("scheme lists do not overlap", not (set(a_schemes) & set(b_schemes)),
      f"({set(a_schemes) & set(b_schemes)})")

# ---------------------------------------------------------------- assessments
print("-- assessments --")
co, r = call("POST", f"/courses/{A['courseId']}/assessments", FA,
             {"title": f"Midterm {RUN}", "kind": "midterm", "maxScore": 50, "weight": 40},
             base="/gradebook")
check("a lecturer creates an assessment on their course", co == 201, f"({co} {r})")
mid = r.get('assessment', {}).get('id') if co == 201 else None

co, r = call("POST", f"/courses/{A['courseId']}/assessments", FA,
             {"title": f"Final {RUN}", "kind": "exam", "maxScore": 100, "weight": 60},
             base="/gradebook")
check("and a second, taking the total to 100%", co == 201, f"({co} {r})")
final = r.get('assessment', {}).get('id') if co == 201 else None

co, r = call("POST", f"/courses/{A['courseId']}/assessments", FA,
             {"title": f"Extra {RUN}", "weight": 10}, base="/gradebook")
check("weights beyond 100% are refused", co == 409, f"({co} {r})")

co, r = call("POST", f"/courses/{B['courseId']}/assessments", FA,
             {"title": f"Cross {RUN}", "weight": 10}, base="/gradebook")
check("cannot add an assessment to B's course", co == 404, f"({co} {r})")

co, r = call("POST", f"/courses/{A['courseId']}/assessments", FB,
             {"title": f"Foreign {RUN}", "weight": 10}, base="/gradebook")
check("B's lecturer cannot touch A's course", co == 404, f"({co} {r})")

co, r = call("GET", f"/courses/{A['courseId']}/assessments", AT, base="/gradebook")
check("assessment weights total 100", co == 200 and r.get('weightComplete') is True,
      f"({co} {r.get('weightTotal')})")

# ---------------------------------------------------------------- marks
print("-- marks --")
co, r = call("GET", f"/assessments/{mid}/scores", FA, base="/gradebook")
check("the mark sheet lists every enrolled student",
      co == 200 and len(r.get('scores', [])) == 2, f"({co} {r})")

co, r = call("PUT", f"/assessments/{mid}/scores", FA,
             {"scores": [{"studentId": A['students'][0], "score": 45},
                         {"studentId": A['students'][1], "score": 25}]}, base="/gradebook")
check("save marks", co == 200 and r.get('written') == 2, f"({co} {r})")

co, r = call("PUT", f"/assessments/{mid}/scores", FA,
             {"scores": [{"studentId": A['students'][0], "score": 999}]}, base="/gradebook")
check("a mark above the assessment maximum is refused", co == 400, f"({co} {r})")

co, r = call("PUT", f"/assessments/{mid}/scores", FA,
             {"scores": [{"studentId": B['students'][0], "score": 40}]}, base="/gradebook")
check("cannot mark a student who is not enrolled", co == 400, f"({co} {r})")

co, r = call("PUT", f"/assessments/{mid}/scores", FA,
             {"scores": [{"studentId": A['students'][0], "status": "graded"}]}, base="/gradebook")
check("a graded mark with no score is refused", co == 400, f"({co} {r})")

co, r = call("PUT", f"/assessments/{final}/scores", FA,
             {"scores": [{"studentId": A['students'][0], "score": 80},
                         {"studentId": A['students'][1], "status": "absent"}]}, base="/gradebook")
check("an absence records without a score", co == 200, f"({co} {r})")

# ---------------------------------------------------------------- results
print("-- results --")
co, r = call("GET", f"/courses/{A['courseId']}/results", FA, base="/gradebook")
check("results compute", co == 200, f"({co} {r})")
if co == 200:
    by_student = {x['studentId']: x for x in r.get('results', [])}
    s1 = by_student.get(A['students'][0])
    s2 = by_student.get(A['students'][1])
    # 45/50 at 40% = 36; 80/100 at 60% = 48; total 84 -> A
    check("weighted total is correct", s1 and abs(s1['totalScore'] - 84.0) < 0.01,
          f"({s1})")
    check("the grade band is applied", s1 and s1['letter'] == 'A', f"({s1})")
    # 25/50 at 40% = 20; absent on the final = 0; total 20 -> F
    check("an absence counts as zero, not as missing",
          s2 and abs(s2['totalScore'] - 20.0) < 0.01, f"({s2})")
    check("a failing mark is graded F", s2 and s2['letter'] == 'F', f"({s2})")
    check("weights are reported as complete",
          s1 and abs(s1['weightDeclared'] - 100.0) < 0.01, f"({s1})")

co, r = call("GET", f"/courses/{B['courseId']}/results", FA, base="/gradebook")
check("cannot compute results for B's course", co == 404, f"({co} {r})")

co, r = call("POST", f"/courses/{A['courseId']}/results/publish", FA, {}, base="/gradebook")
check("a lecturer cannot publish results", co == 403, f"({co} {r})")

co, r = call("POST", f"/courses/{A['courseId']}/results/publish", AT, {}, base="/gradebook")
check("the registrar publishes", co == 200 and r.get('published') == 2, f"({co} {r})")

co, r = call("POST", f"/courses/{B['courseId']}/results/publish", AT, {}, base="/gradebook")
check("cannot publish B's course", co == 404, f"({co} {r})")

# ---------------------------------------------------------------- transcript
print("-- transcript --")
co, r = call("GET", f"/students/{A['students'][0]}/transcript", AT, base="/gradebook")
check("transcript 200", co == 200, f"({co} {r})")
if co == 200:
    check("it carries the published result", len(r.get('entries', [])) >= 1, f"({r})")
    check("the programme is shown", r.get('programme') is not None, f"({r.get('programme')})")
    check("a CGPA is computed", r.get('cgpa') is not None, f"({r.get('cgpa')})")

co, r = call("GET", f"/students/{B['students'][0]}/transcript", AT, base="/gradebook")
check("cannot read B's student's transcript", co == 404, f"({co} {r})")

co, r = call("GET", f"/students/{A['students'][0]}/transcript", FB, base="/gradebook")
check("B's lecturer cannot read A's transcript", co == 404, f"({co} {r})")

co, r = call("GET", f"/students/{GHOST}/transcript", AT, base="/gradebook")
check("an unknown student is 404", co == 404, f"({co} {r})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
