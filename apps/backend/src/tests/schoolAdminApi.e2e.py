"""
The school-administrator surface (/api/auth/admin/school/*) and the legacy
faculty router.

Both were rewritten because both scoped on users.platform_id — the platform,
shared by every school — rather than on the tenant. These assertions are
written to fail if that ever comes back: each one either confirms a caller
sees their own school's data, or confirms that a well-formed id belonging to
the other school is refused.
"""
import json, subprocess, sys, time
# Identifiers are unique per run, so the suite is repeatable against a database
# that already holds what a previous run created.
RUN = str(int(time.time()))[-6:]
SETTING = f"threshold_{RUN}"
import os
SP = os.environ.get("E2E_FIXTURE_DIR",
                    os.path.join(os.getcwd(), ".e2e-fixtures"))
d = json.load(open(f"{SP}/seed.json")); A, B = d['A'], d['B']
c = json.load(open(f"{SP}/corp.json")); HR = c['A']['token']
ROOT = "http://127.0.0.1:5000/api"
P = F = 0

def call(m, p, t, body=None, base="/auth"):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "25", "-X", m,
           "-H", f"Authorization: Bearer {t}", "-H", "Content-Type: application/json",
           ROOT + base + p]
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

# ---------------------------------------------------------------- platform
print("-- platform gate --")
co, r = call("GET", "/admin/school/courses", HR)
check("EMS identity refused from SMS admin", co == 403, f"({co} {r})")

# ---------------------------------------------------------------- courses
print("-- courses --")
co, r = call("GET", "/admin/school/courses", AT)
check("courses 200 (was 500: courses.platform_id does not exist)", co == 200, f"({co} {r})")
a_course_ids = [x['id'] for x in r.get('courses', [])] if co == 200 else []
check("A sees its own course", A['courseId'] in a_course_ids, f"({a_course_ids})")
check("B's course not visible to A", B['courseId'] not in a_course_ids)

co, r = call("GET", "/admin/school/courses", BT)
b_ids = [x['id'] for x in r.get('courses', [])] if co == 200 else []
check("B sees only its own", B['courseId'] in b_ids and A['courseId'] not in b_ids, f"({b_ids})")

co, r = call("POST", "/admin/school/courses", AT, dict(code=f"ISO-{RUN}", name="Isolation", credits=3, department="Engineering"))
check("create course 201", co == 201, f"({co} {r})")
new_course = r.get('courseId') if co == 201 else None

# The same code in another school is not a conflict: uniqueness is per tenant.
co, r = call("POST", "/admin/school/courses", BT, dict(code=f"ISO-{RUN}", name="Isolation", credits=3, department="Engineering"))
check("B may reuse A's course code", co == 201, f"({co} {r})")
b_new_course = r.get('courseId') if co == 201 else None
co, r = call("POST", "/admin/school/courses", AT, dict(code=f"ISO-{RUN}", name="Dup", department="Engineering"))
check("still unique within A", co == 409, f"({co} {r})")

co, r = call("PATCH", f"/admin/school/courses/{B['courseId']}", AT, {"name": "Hijacked"})
check("cannot rename B's course", co == 404, f"({co} {r})")
co, r = call("DELETE", f"/admin/school/courses/{B['courseId']}", AT)
check("cannot delete B's course", co == 404, f"({co} {r})")
co, r = call("GET", "/admin/school/courses", BT)
names = {x['id']: x['name'] for x in r.get('courses', [])}
check("B's course intact", names.get(B['courseId']) != "Hijacked", f"({names.get(B['courseId'])})")

# ---------------------------------------------------------------- rooms
print("-- rooms --")
co, r = call("GET", "/admin/school/rooms", AT)
check("rooms 200 (was 500: rooms.platform_id does not exist)", co == 200, f"({co} {r})")
a_rooms = [x['id'] for x in r.get('rooms', [])] if co == 200 else []
co, r = call("GET", "/admin/school/rooms", BT)
b_rooms = [x['id'] for x in r.get('rooms', [])] if co == 200 else []
check("room lists do not overlap", not (set(a_rooms) & set(b_rooms)), f"({a_rooms} {b_rooms})")

co, r = call("POST", "/admin/school/rooms", AT,
             dict(building="Science", roomNumber=f"S-{RUN}", capacity=40, floor=1, roomType="lab"))
check("create room 201 (floor column was missing)", co == 201, f"({co} {r})")
new_room = r.get('roomId') if co == 201 else None
if b_rooms:
    co, r = call("PATCH", f"/admin/school/rooms/{b_rooms[0]}", AT, {"capacity": 1})
    check("cannot edit B's room", co == 404, f"({co} {r})")

# ---------------------------------------------------------------- schedules
print("-- schedules --")
co, r = call("GET", "/admin/school/schedules", AT)
check("schedules 200 (was 500: section/days_of_week missing)", co == 200, f"({co} {r})")
sched = r.get('schedules', []) if co == 200 else []
check("A sees its own schedule", any(s['id'] == A['scheduleId'] for s in sched), f"({[s['id'] for s in sched]})")
check("B's schedule not visible", not any(s['id'] == B['scheduleId'] for s in sched))
check("section is populated", all(s.get('section') is not None for s in sched), f"({sched[:1]})")
check("days_of_week is populated", all(s.get('days_of_week') for s in sched), f"({sched[:1]})")

if new_course and new_room:
    co, r = call("POST", "/admin/school/schedules", AT,
                 {"courseId": new_course, "facultyId": A['facultyId'], "roomId": new_room,
                  "daysOfWeek": [1, 3], "startTime": "08:00", "endTime": "09:00"})
    check("create multi-day schedule 201", co == 201, f"({co} {r})")
    made = r.get('scheduleId') if co == 201 else None

    # A room in this school, a course in the other: the cross-tenant reference
    # must be refused rather than silently stored.
    co, r = call("POST", "/admin/school/schedules", AT,
                 {"courseId": B['courseId'], "facultyId": A['facultyId'], "roomId": new_room,
                  "daysOfWeek": [2], "startTime": "08:00", "endTime": "09:00"})
    check("cannot schedule B's course", co == 404, f"({co} {r})")

    co, r = call("POST", "/admin/school/schedules", AT,
                 {"courseId": new_course, "facultyId": B['facultyId'], "roomId": new_room,
                  "daysOfWeek": [2], "startTime": "08:00", "endTime": "09:00"})
    check("cannot assign B's lecturer", co == 404, f"({co} {r})")

    co, r = call("POST", "/admin/school/schedules", AT,
                 {"courseId": new_course, "facultyId": A['facultyId'], "roomId": new_room,
                  "daysOfWeek": [1], "startTime": "08:30", "endTime": "09:30"})
    check("room double-booking refused 409", co == 409, f"({co} {r})")

    co, r = call("POST", "/admin/school/schedules", AT,
                 {"courseId": new_course, "facultyId": A['facultyId'], "roomId": new_room,
                  "daysOfWeek": [5], "startTime": "10:00", "endTime": "09:00"})
    check("end before start refused 400", co == 400, f"({co} {r})")

    co, r = call("POST", "/admin/school/schedules", AT,
                 {"courseId": new_course, "facultyId": A['facultyId'], "roomId": new_room,
                  "daysOfWeek": [9], "startTime": "10:00", "endTime": "11:00"})
    check("invalid day refused 400", co == 400, f"({co} {r})")

    if made:
        co, r = call("DELETE", f"/admin/school/schedules/{made}", AT)
        check("delete own schedule 200", co == 200, f"({co} {r})")

co, r = call("PATCH", f"/admin/school/schedules/{B['scheduleId']}", AT, {"startTime": "23:00"})
check("cannot edit B's schedule", co == 404, f"({co} {r})")
co, r = call("DELETE", f"/admin/school/schedules/{B['scheduleId']}", AT)
check("cannot delete B's schedule", co == 404, f"({co} {r})")

# ---------------------------------------------------------------- students
print("-- students --")
co, r = call("GET", "/admin/school/students", AT)
check("students 200", co == 200, f"({co} {r})")
a_students = [x['id'] for x in r.get('students', [])] if co == 200 else []
check("A sees its own students", all(s in a_students for s in A['students']), f"({a_students})")
check("B's students not visible", not any(s in a_students for s in B['students']))

# The by-id routes previously checked only that the caller administered some
# school, then acted on whatever id was in the path.
co, r = call("PATCH", f"/admin/school/students/{B['students'][0]}", AT, {"firstName": "Hijacked"})
check("cannot rename B's student", co == 404, f"({co} {r})")
co, r = call("PATCH", f"/admin/school/students/{B['students'][0]}/suspend", AT, {"suspended": True})
check("cannot suspend B's student", co == 404, f"({co} {r})")
co, r = call("DELETE", f"/admin/school/students/{B['students'][0]}", AT)
check("cannot delete B's student", co == 404, f"({co} {r})")
co, r = call("GET", "/admin/school/students", BT)
still = {x['id']: x for x in r.get('students', [])}
check("B's student still present", B['students'][0] in still, f"({list(still)})")
check("B's student not renamed", still.get(B['students'][0], {}).get('first_name') != "Hijacked")

co, r = call("POST", "/admin/school/students", AT,
             dict(studentId=f"ISO-{RUN}", firstName="Iso", lastName="Late",
                  email=f"iso.late.a.{RUN}@e2e.test", department="Engineering"))
check("create student 201", co == 201, f"({co} {r})")
made_student = r.get('studentId') if co == 201 else None
check("temporary password returned, not a shared default",
      isinstance(r, dict) and r.get('temporaryPassword', '') not in ('', 'Password'), f"({r})")

# Student numbers are unique per school, so B may reuse A's.
co, r = call("POST", "/admin/school/students", BT,
             dict(studentId=f"ISO-{RUN}", firstName="Iso", lastName="Late",
                  email=f"iso.late.b.{RUN}@e2e.test"))
check("B may reuse A's student number", co == 201, f"({co} {r})")
made_student_b = r.get('studentId') if co == 201 else None

if made_student:
    co, r = call("GET", "/admin/school/students", AT)
    mine = {x['id']: x for x in r.get('students', [])}
    check("new student lands in A", made_student in mine)
    check("department resolved within A", mine.get(made_student, {}).get('department') == "Engineering",
          f"({mine.get(made_student, {}).get('department')})")
    co, r = call("GET", "/admin/school/students", BT)
    check("new student not visible to B", made_student not in [x['id'] for x in r.get('students', [])])

# ---------------------------------------------------------------- faculty
print("-- faculty --")
co, r = call("GET", "/admin/school/faculty", AT)
check("faculty 200", co == 200, f"({co} {r})")
a_fac = [x['id'] for x in r.get('faculty', [])] if co == 200 else []
check("A sees its own faculty", A['facultyId'] in a_fac, f"({a_fac})")
check("B's faculty not visible", B['facultyId'] not in a_fac)
co, r = call("PATCH", f"/admin/school/faculty/{B['facultyId']}", AT, {"firstName": "Hijacked"})
check("cannot rename B's lecturer", co == 404, f"({co} {r})")
co, r = call("DELETE", f"/admin/school/faculty/{B['facultyId']}", AT)
check("cannot delete B's lecturer", co == 404, f"({co} {r})")
co, r = call("DELETE", f"/admin/school/faculty/{A['facultyId']}", AT)
check("teaching lecturer not deletable 409", co == 409, f"({co} {r})")

# ---------------------------------------------------------------- users
print("-- users --")
co, r = call("POST", "/admin/school/users", AT,
             dict(email=f"escalate.{RUN}@e2e.test", fullName="Esc", role="admin"))
check("admin cannot mint another admin", co == 403, f"({co} {r})")
co, r = call("GET", "/admin/school/users", AT)
check("users 200", co == 200, f"({co} {r})")
a_emails = {u['email'] for u in r.get('users', [])} if co == 200 else set()
co, r = call("GET", "/admin/school/users", BT)
b_emails = {u['email'] for u in r.get('users', [])} if co == 200 else set()
check("user lists do not overlap", not (a_emails & b_emails), f"({a_emails & b_emails})")

# ---------------------------------------------------------------- enrolments
print("-- enrolments --")
co, r = call("GET", "/admin/school/enrollments", AT)
check("enrollments 200", co == 200, f"({co} {r})")
a_enrol = r.get('enrollments', []) if co == 200 else []
check("only A's students appear", all(e['student_id'] in A['students'] or e['student_id'] == made_student
                                      for e in a_enrol), f"({[e['student_id'] for e in a_enrol]})")

# A schedule of ours plus a student of theirs must not enrol anyone.
co, r = call("POST", "/admin/school/enrollments", AT,
             {"studentId": B['students'][0], "scheduleId": A['scheduleId']})
check("cannot enrol B's student into A's class", co == 404, f"({co} {r})")
co, r = call("POST", "/admin/school/enrollments", AT,
             {"studentId": A['students'][0], "scheduleId": B['scheduleId']})
check("cannot enrol into B's class", co == 404, f"({co} {r})")
if a_enrol:
    co, r = call("GET", "/admin/school/enrollments", BT)
    b_enrol_ids = [e['id'] for e in r.get('enrollments', [])]
    if b_enrol_ids:
        co, r = call("DELETE", f"/admin/school/enrollments/{b_enrol_ids[0]}", AT)
        check("cannot remove B's enrolment", co == 404, f"({co} {r})")
        co, r = call("GET", "/admin/school/enrollments", BT)
        check("B's enrolment intact", b_enrol_ids[0] in [e['id'] for e in r.get('enrollments', [])])

# ---------------------------------------------------------------- settings
print("-- settings --")
co, r = call("PUT", "/admin/school/settings", AT, dict(key=SETTING, value="75"))
check("save setting 200 (platform_settings never existed)", co == 200, f"({co} {r})")
co, r = call("GET", "/admin/school/settings", AT)
check("A reads back its own value", r.get('settings', {}).get(SETTING) == "75", f"({r})")
co, r = call("GET", "/admin/school/settings", BT)
check("B unaffected by A's setting", SETTING not in r.get('settings', {}), f"({r})")
co, r = call("PUT", "/admin/school/settings", BT, dict(key=SETTING, value="50"))
co, r = call("GET", "/admin/school/settings", AT)
check("A's value survives B's write", r.get('settings', {}).get(SETTING) == "75", f"({r})")
co, r = call("PUT", "/admin/school/settings", AT, {"key": "bad key!", "value": "x"})
check("invalid setting key refused 400", co == 400, f"({co} {r})")

# ---------------------------------------------------------------- overview
print("-- overview and reports --")
co, r = call("GET", "/admin/school/attendance/overview", AT)
check("overview 200 (was 500: class_schedules.platform_id)", co == 200, f"({co} {r})")
if co == 200:
    check("overview covers only A's schedules",
          all(row['schedule_id'] != B['scheduleId'] for row in r), f"({r})")
co, r = call("GET", "/admin/school/reports/attendance", AT)
check("report 200", co == 200, f"({co} {r})")
if co == 200:
    check("report holds no B students",
          all(rec['student_id'] not in B['students'] for rec in r.get('records', [])))
# A filter naming the other school's schedule must narrow to nothing, never widen.
co, r = call("GET", f"/admin/school/reports/attendance?scheduleId={B['scheduleId']}", AT)
check("filtering by B's schedule yields nothing", co == 200 and r.get('totalRecords') == 0, f"({co} {r})")

# ---------------------------------------------------------------- legacy faculty
print("-- legacy faculty router --")
co, r = call("GET", "/students", FA, base="/faculty")
check("faculty/students 200 (was 500: student_schedules missing)", co == 200, f"({co} {r})")
if co == 200:
    check("only A's students listed",
          all(s['student_id'] in A['students'] for s in r), f"({[s.get('student_id') for s in r]})")

co, r = call("GET", f"/enrollment/available?schedule_id={A['scheduleId']}", FA, base="/faculty")
check("enrollment/available 200", co == 200, f"({co} {r})")
if co == 200:
    ids = [s['id'] for s in r]
    check("does not offer B's students (was scoped by platform)",
          not any(s in ids for s in B['students']), f"({ids})")

co, r = call("POST", "/enrollment/add", FA, {"schedule_id": A['scheduleId'], "student_id": B['students'][0]}, base="/faculty")
check("cannot enrol B's student", co == 404, f"({co} {r})")
co, r = call("POST", "/enrollment/add", FA, {"schedule_id": B['scheduleId'], "student_id": A['students'][0]}, base="/faculty")
check("cannot enrol into B's schedule", co == 403, f"({co} {r})")

co, r = call("POST", "/face-enroll", FA, {"student_id": B['students'][0], "embedding": [0.1] * 128}, base="/faculty")
check("cannot enrol B student's face", co == 404, f"({co} {r})")
co, r = call("POST", "/face-enroll", FA, {"student_id": A['students'][0], "embedding": [0.1] * 128}, base="/faculty")
check("own student's face enrols 200", co == 200, f"({co} {r})")
co, r = call("POST", "/face-enroll", FA, {"student_id": A['students'][0], "embedding": [0.2] * 128}, base="/faculty")
check("re-enrolling replaces rather than erroring", co == 200, f"({co} {r})")
co, r = call("POST", "/face-enroll", FA, {"student_id": A['students'][0], "embedding": ["x"] * 128}, base="/faculty")
check("non-numeric embedding refused 400", co == 400, f"({co} {r})")

co, r = call("GET", f"/face-status?schedule_id={A['scheduleId']}", FA, base="/faculty")
check("face-status 200", co == 200, f"({co} {r})")
co, r = call("GET", f"/face-status?schedule_id={B['scheduleId']}", FA, base="/faculty")
check("cannot read B schedule's face status", co == 403, f"({co} {r})")

co, r = call("GET", "/dashboard", FA, base="/faculty")
check("faculty dashboard 200", co == 200, f"({co} {r})")
co, r = call("GET", "/schedules", FA, base="/faculty")
check("faculty schedules 200", co == 200, f"({co} {r})")
if co == 200:
    check("schedules carry section and days",
          all(s.get('section') is not None and s.get('days_of_week') for s in r), f"({r[:1]})")
co, r = call("GET", "/reports", FA, base="/faculty")
check("faculty reports 200", co == 200, f"({co} {r})")
co, r = call("GET", f"/courses/{B['courseId']}/roster", FA, base="/faculty")
check("cannot read B course roster", co == 404, f"({co} {r})")

co, r = call("GET", "/dashboard", HR, base="/faculty")
check("EMS identity refused from faculty router", co == 403, f"({co} {r})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
