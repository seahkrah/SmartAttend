"""
Cross-tenant holes found by a route-by-route audit, pinned shut.

Every route was called with another tenant's ids by every kind of identity,
and the answers compared with the same call made with the caller's own ids.
What came back is below, one section per hole. Each assertion states what
must stay true; the comment above it says what used to happen.

  /api/school      no platform gate, no roles; four routes went through
                   helpers that took an id and nothing else
  /api/corporate   no platform gate, no roles; three assignment routes with
                   no scoping at all; employees created with no tenant and
                   with the department and account taken on trust
  /api/files       purge swept every tenant; an upload could name another
                   tenant's record as its subject
  /api/notifications/dispatch   ran every tenant's outbox
  /api/incidents   who acknowledged and who resolved came from the body
"""
import json, subprocess, sys, time, os, tempfile
RUN = str(int(time.time()))[-6:]
SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
s = json.load(open(f"{SP}/seed.json")); SA, SB = s['A'], s['B']
c = json.load(open(f"{SP}/corp.json")); CA, CB = c['A'], c['B']
sa = json.load(open(f"{SP}/superadmin.json"))
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
TMP = tempfile.mkdtemp(prefix="xtenant-")
P = F = 0

def call(m, p, t, body=None):
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

def upload(token, name, data, category, owner_type=None, owner_id=None):
    path = os.path.join(TMP, name)
    with open(path, "wb") as fh:
        fh.write(data)
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "30", "-X", "POST",
           "-H", f"Authorization: Bearer {token}",
           "-F", f"file=@{path}", "-F", f"category={category}"]
    if owner_type:
        cmd += ["-F", f"ownerType={owner_type}"]
    if owner_id:
        cmd += ["-F", f"ownerId={owner_id}"]
    cmd.append(ROOT + "/files")
    o = subprocess.run(cmd, capture_output=True, text=True).stdout
    txt, _, code = o.rpartition("\n")
    try:
        parsed = json.loads(txt)
    except Exception:
        parsed = txt
    return int(code), parsed

def check(n, ok, d=""):
    global P, F
    if ok:
        P += 1; print(f"  ok    {n}")
    else:
        F += 1; print(f"  FAIL  {n} {d}")

S_ADMIN, S_FAC, S_STU = SA['token'], SA['facToken'], SA['studentToken']
S_ADMIN_B = SB['token']
C_HR, C_ADMIN, C_EMP, C_MGR = CA['token'], CA['adminToken'], CA['empToken'], CA['managerToken']
C_HR_B = CB['token']

# ===================================================================== school
print("-- /api/school: the platform and the roles --")

# A corporate identity used to list a school's students.
for label, tok in [("corporate admin", C_ADMIN), ("corporate employee", C_EMP)]:
    co, r = call("GET", "/school/students", tok)
    check(f"{label} cannot reach /api/school", co == 403, f"({co} {r})")

# A student used to be able to create, edit and unenrol other students.
co, r = call("GET", "/school/students", S_STU)
check("a student cannot list students", co == 403, f"({co})")
co, r = call("DELETE", f"/school/students/{SA['students'][1]}", S_STU)
check("a student cannot unenrol another student", co == 403, f"({co} {r})")
co, r = call("PUT", f"/school/students/{SA['students'][1]}", S_STU, {"first_name": "Renamed"})
check("a student cannot edit another student", co == 403, f"({co} {r})")
co, r = call("PUT", f"/school/students/{SA['students'][1]}", S_FAC, {"first_name": "Renamed"})
check("a lecturer cannot edit a student record", co == 403, f"({co} {r})")
co, r = call("GET", "/school/students", S_FAC)
check("a lecturer can still read the student list", co == 200, f"({co})")
co, r = call("GET", f"/school/students/{SA['students'][1]}", S_ADMIN)
check("the second student is untouched", co == 200 and r['data']['first_name'] != 'Renamed', f"({co} {r})")

print("-- /api/school: another school's ids --")

# These three read the other school's timetable, attendance and course list.
co, r = call("GET", f"/school/students/{SB['students'][0]}/schedules", S_ADMIN)
check("another school's student timetable is 404", co == 404, f"({co} {r})")
co, r = call("GET", f"/school/students/{SB['students'][0]}/attendance", S_ADMIN)
check("another school's student attendance is 404", co == 404, f"({co} {r})")
co, r = call("GET", f"/school/faculty/{SB['facultyId']}/courses", S_ADMIN)
check("another school's lecturer's courses is 404", co == 404, f"({co} {r})")

co, r = call("GET", f"/school/students/{SA['students'][0]}/schedules", S_ADMIN)
check("own student's timetable is 200 and shows own schedule",
      co == 200 and any(x['id'] == SA['scheduleId'] for x in r.get('data', [])), f"({co} {r})")
co, r = call("GET", f"/school/students/{SA['students'][0]}/attendance", S_ADMIN)
check("own student's attendance is 200", co == 200, f"({co} {r})")
co, r = call("GET", f"/school/students/{SA['students'][0]}/attendance?startDate=yesterday", S_ADMIN)
check("a malformed date is refused, not passed to SQL", co == 400, f"({co} {r})")
co, r = call("GET", f"/school/faculty/{SA['facultyId']}/courses", S_ADMIN)
check("own lecturer's courses is 200 and lists own course",
      co == 200 and any(x['course_id'] == SA['courseId'] for x in r.get('data', [])), f"({co} {r})")

# This one wrote a pairing across two schools; a corporate admin could do it.
co, r = call("POST", f"/school/faculty/{SA['facultyId']}/courses/{SB['courseId']}", S_ADMIN)
check("own lecturer cannot be put on another school's course", co == 404, f"({co} {r})")
co, r = call("POST", f"/school/faculty/{SB['facultyId']}/courses/{SA['courseId']}", S_ADMIN)
check("another school's lecturer cannot be put on own course", co == 404, f"({co} {r})")
co, r = call("POST", f"/school/faculty/{SB['facultyId']}/courses/{SB['courseId']}", C_ADMIN)
check("a corporate admin cannot assign a school's lecturer", co == 403, f"({co} {r})")
co, r = call("GET", f"/school/faculty/{SB['facultyId']}/courses", S_ADMIN_B)
check("school B's lecturer still has only B's course",
      co == 200 and {x['course_id'] for x in r.get('data', [])} == {SB['courseId']}, f"({co} {r})")
co, r = call("POST", f"/school/faculty/{SA['facultyId']}/courses/{SA['courseId']}", S_ADMIN)
check("own lecturer on own course is accepted", co == 201, f"({co} {r})")

print("-- /api/school: creation takes nothing on trust --")

co, r = call("GET", f"/school/students/{SB['students'][1]}", S_ADMIN_B)
b_user = r.get('data', {}).get('user_id') if co == 200 else None
check("(school B reads its own student's account id)", bool(b_user), f"({co} {r})")

co, r = call("POST", "/auth/admin/school/users", S_ADMIN,
             {"email": f"xt.{RUN}@e2e.test", "fullName": f"XT {RUN}", "role": "student"})
a_user = r.get('userId') if co == 201 else None
check("(school A creates an account to attach a record to)", bool(a_user), f"({co} {r})")

base = {"studentId": f"XT-{RUN}", "firstName": "Cross", "lastName": "Tenant",
        "college": "Computing", "email": f"xt.{RUN}@e2e.test", "status": "Freshman",
        "enrollmentYear": 2026}
co, r = call("POST", "/school/students", S_ADMIN, dict(base, userId=b_user))
check("a student record cannot be made for another school's account", co == 404, f"({co} {r})")
co, r = call("POST", "/school/students", S_ADMIN, dict(base, userId=a_user, departmentId=SB['deptId']))
check("a student record cannot be put in another school's department", co == 404, f"({co} {r})")
co, r = call("POST", "/school/students", S_ADMIN, dict(base, userId=a_user, departmentId=SA['deptId']))
made = r.get('data', {}) if co == 201 else {}
check("a student record with own account and department is created", co == 201, f"({co} {r})")
check("and the server wrote the tenant", made.get('tenant_id') == SA['tenantId'], f"({made.get('tenant_id')})")
if made.get('id'):
    co, r = call("GET", f"/school/students/{made['id']}", S_ADMIN)
    check("so the school can find it again", co == 200, f"({co})")
    co, r = call("PUT", f"/school/students/{made['id']}", S_ADMIN, {"department_id": SB['deptId']})
    check("and cannot move it into another school's department", co == 404, f"({co} {r})")

co, r = call("POST", "/school/faculty", S_ADMIN,
             {"userId": b_user, "employeeId": f"XF-{RUN}", "firstName": "X", "lastName": "F",
              "college": "Computing", "email": f"xf.{RUN}@e2e.test"})
check("a faculty record cannot be made for another school's account", co == 404, f"({co} {r})")
co, r = call("PUT", f"/school/faculty/{SA['facultyId']}", S_ADMIN, {"department_id": SB['deptId']})
check("a lecturer cannot be moved into another school's department", co == 404, f"({co} {r})")

# ================================================================== corporate
print("-- /api/corporate: the platform and the roles --")

co, r = call("GET", "/corporate/departments", S_ADMIN)
check("a school identity cannot reach /api/corporate", co == 403, f"({co} {r})")

# An employee used to be able to do all of this.
co, r = call("POST", "/corporate/departments", C_EMP, {"name": f"Mine {RUN}"})
check("an employee cannot create a department", co == 403, f"({co} {r})")
co, r = call("PUT", f"/corporate/departments/{CA['deptId']}", C_EMP, {"name": "Taken over"})
check("an employee cannot rename a department", co == 403, f"({co} {r})")
co, r = call("DELETE", f"/corporate/departments/{CA['deptId']}", C_EMP)
check("an employee cannot delete a department", co == 403, f"({co} {r})")
co, r = call("GET", "/corporate/employees", C_EMP)
check("an employee cannot list colleagues' records", co == 403, f"({co} {r})")
co, r = call("PATCH", f"/corporate/employees/{CA['hrEmpId']}/terminate", C_EMP)
check("an employee cannot terminate a colleague", co == 403, f"({co} {r})")
co, r = call("PUT", f"/corporate/employees/{CA['hrEmpId']}", C_EMP, {"designation": "Intern"})
check("an employee cannot edit a colleague", co == 403, f"({co} {r})")
co, r = call("PATCH", f"/corporate/employees/{CA['hrEmpId']}/terminate", C_MGR)
check("a manager cannot terminate either", co == 403, f"({co} {r})")
co, r = call("GET", "/corporate/employees", C_MGR)
check("a manager can read the employee list", co == 200, f"({co})")
co, r = call("GET", "/corporate/departments", C_EMP)
check("an employee can still see the department list", co == 200, f"({co})")

print("-- /api/corporate: the assignment routes are gone --")

# None checked a tenant or a role; any identity could read, create or end
# another employer's assignments.
co, _ = call("GET", f"/corporate/employees/{CB['employees'][0]}/assignments", C_HR)
check("list assignments is gone", co == 404, f"({co})")
co, _ = call("POST", "/corporate/assignments", C_HR,
             {"employeeId": CB['employees'][0], "assignmentType": "field", "assignedDate": "2029-01-01"})
check("create assignment is gone", co == 404, f"({co})")
co, _ = call("PATCH", "/corporate/assignments/00000000-0000-4000-8000-000000000000/end", C_HR)
check("end assignment is gone", co == 404, f"({co})")

print("-- /api/corporate: employee records --")

co, r = call("GET", f"/corporate/employees/{CB['employees'][0]}", C_HR_B)
b_emp_user = r.get('data', {}).get('user_id') if co == 200 else None
check("(employer B reads its own employee's account id)", bool(b_emp_user), f"({co} {r})")

co, r = call("GET", "/corporate/admin/settings", C_ADMIN)
a_admin_user = r.get('entity', {}).get('admin_user_id') if co == 200 else None
check("(employer A's admin account, which has no employee record)", bool(a_admin_user), f"({co} {r})")

emp = {"employeeId": f"XE-{RUN}", "firstName": "Cross", "lastName": "Tenant",
       "email": f"xe.{RUN}@c2e.test", "phone": "0200000000"}
co, r = call("POST", "/corporate/employees", C_HR, dict(emp, userId=b_emp_user))
check("an employee record cannot be made for another employer's account", co == 404, f"({co} {r})")
co, r = call("POST", "/corporate/employees", C_HR, dict(emp, userId=a_admin_user, departmentId=CB['deptId']))
check("an employee record cannot be put in another employer's department", co == 404, f"({co} {r})")
co, r = call("POST", "/corporate/employees", C_HR, dict(emp, userId=a_admin_user, departmentId=CA['deptId']))
made = r.get('data', {}) if co == 201 else {}
check("an employee record with own account and department is created", co == 201, f"({co} {r})")
# The route used to insert without a tenant, so the record it had just made
# was invisible to every tenant-scoped feature, its own employer's included.
check("and the server wrote the tenant", made.get('tenant_id') == CA['tenantId'], f"({made.get('tenant_id')})")
if made.get('id'):
    co, r = call("GET", f"/corporate/employees/{made['id']}", C_HR)
    check("so the employer can find it again", co == 200, f"({co})")
    co, r = call("GET", f"/corporate/employees/{made['id']}", C_HR_B)
    check("and the other employer cannot", co == 404, f"({co})")

co, r = call("PUT", f"/corporate/employees/{CA['employees'][0]}", C_HR, {"department_id": CB['deptId']})
check("an employee cannot be moved into another employer's department", co == 404, f"({co} {r})")
co, r = call("PUT", f"/corporate/employees/{CA['employees'][0]}", C_HR, {"department_id": CA['deptId']})
check("but can be moved within their own", co == 200, f"({co} {r})")

co, r = call("POST", "/corporate/admin/employees", C_ADMIN,
             {"firstName": "Via", "lastName": f"Admin{RUN}", "email": f"via.{RUN}@c2e.test",
              "phone": "0200000001", "departmentId": CB['deptId']})
check("the admin screen cannot use another employer's department", co == 404, f"({co} {r})")
# A missing phone used to fail at the employee insert, after the account had
# been created, so the address was then taken by an account with no record.
co, r = call("POST", "/corporate/admin/employees", C_ADMIN,
             {"firstName": "Via", "lastName": f"Admin{RUN}", "email": f"via.{RUN}@c2e.test",
              "departmentId": CA['deptId']})
check("the admin screen refuses an employee with no phone", co == 400, f"({co} {r})")
co, r = call("POST", "/corporate/admin/employees", C_ADMIN,
             {"firstName": "Via", "lastName": f"Admin{RUN}", "email": f"via.{RUN}@c2e.test",
              "phone": "0200000001", "departmentId": CA['deptId']})
made = r.get('data', {}) if co == 201 else {}
check("the admin screen creates an employee, the refused attempt having left nothing behind",
      co == 201, f"({co} {r})")
check("with the employer's tenant", made.get('tenant_id') == CA['tenantId'], f"({made.get('tenant_id')})")
if made.get('id'):
    co, r = call("GET", f"/corporate/employees/{made['id']}", C_HR)
    check("visible to the employer's HR, which scopes by tenant", co == 200, f"({co})")
    co, r = call("PATCH", f"/corporate/admin/employees/{made['id']}/terminate", C_ADMIN)
    check("(and terminated again)", co == 200, f"({co} {r})")

# ====================================================================== files
print("-- /api/files: purge is per tenant --")

co, r = upload(S_ADMIN_B, f"b-{RUN}.txt", f"School B note {RUN}\n".encode(), "other")
b_file = r.get('file', {}).get('id') if co == 201 else None
check("(school B uploads a file)", bool(b_file), f"({co} {r})")
co, r = call("DELETE", f"/files/{b_file}", S_ADMIN_B, {"reason": f"Deleted in run {RUN}"})
check("(and deletes it; the bytes wait out the grace period)", co == 200, f"({co} {r})")

# School A purging with no grace period used to destroy B's bytes as well.
co, r = call("POST", "/files/purge", S_ADMIN, {"olderThanDays": 0})
check("school A purges its own deleted files", co == 200, f"({co} {r})")
co, r = call("POST", "/files/purge", S_ADMIN_B, {"olderThanDays": 0})
check("school B's deleted file was still there for B to purge",
      co == 200 and (r.get('purged') or 0) >= 1, f"({co} {r})")

print("-- /api/files: an upload's subject is in the uploader's tenant --")

co, r = upload(S_ADMIN, f"x-{RUN}.txt", f"about someone else {RUN}\n".encode(), "other",
               "student", SB['students'][0])
check("a file cannot name another school's student as its subject", co == 404, f"({co} {r})")
co, r = upload(S_ADMIN, f"y-{RUN}.txt", f"about a thing {RUN}\n".encode(), "other",
               "spaceship", SA['students'][0])
check("an unknown subject type is refused", co == 400, f"({co} {r})")
co, r = upload(S_ADMIN, f"z-{RUN}.txt", f"about our student {RUN}\n".encode(), "other",
               "student", SA['students'][0])
check("own student is accepted as the subject",
      co == 201 and r.get('file', {}).get('ownerId') == SA['students'][0], f"({co} {r})")

# ============================================================== notifications
print("-- /api/notifications/dispatch: one tenant's outbox --")

co = 0
for _ in range(20):
    co, r = call("POST", "/notifications/dispatch", S_ADMIN, {})
    if co != 200 or (r.get('swept', {}).get('claimed') or 0) == 0:
        break
check("(school A drains its own outbox)", co == 200, f"({co} {r})")

co, r = call("POST", "/fees/invoices", S_ADMIN_B,
             {"studentId": SB['students'][0], "issue": True, "currency": "GHS",
              "lines": [{"code": "T", "description": f"Isolation test {RUN}", "unitAmount": "10.00"}]})
inv = r.get('invoice', {}).get('id') if co == 201 else None
check("(school B issues an invoice, which queues messages)", bool(inv), f"({co} {r})")

co, r = call("GET", f"/notifications/messages?relatedId={inv}", S_ADMIN_B)
queued = r.get('messages', []) if co == 200 else []
check("(B's messages are pending)", len(queued) >= 1 and all(m['status'] == 'pending' for m in queued),
      f"({co} {queued})")

# A's "send now" used to run the global dispatcher: it sent B's mail and
# reported how much there was.
co, r = call("POST", "/notifications/dispatch", S_ADMIN, {})
check("school A's dispatch claims nothing of B's",
      co == 200 and (r.get('swept', {}).get('claimed') or 0) == 0, f"({co} {r})")
co, r = call("GET", f"/notifications/messages?relatedId={inv}", S_ADMIN_B)
check("B's messages are still pending afterwards",
      co == 200 and all(m['status'] == 'pending' for m in r.get('messages', [])), f"({co} {r})")
co, r = call("POST", "/notifications/dispatch", S_ADMIN_B, {})
check("B's own dispatch sends them", co == 200 and (r.get('swept', {}).get('claimed') or 0) >= 1, f"({co} {r})")

# ================================================================== incidents
print("-- /api/incidents: the actor is the caller --")

inc = sa.get('schoolAIncidentId')
co, r = call("GET", "/auth/me", S_ADMIN)
me = r.get('user', {}).get('id') if co == 200 else None
check("(school A's administrator)", bool(me and inc), f"({co} {inc})")

# The body used to decide who acknowledged and who resolved, so a caller could
# record anyone at all, another tenant's user included.
co, r = call("PATCH", f"/incidents/{inc}", S_ADMIN,
             {"acknowledgedByUserId": b_user, "resolvedByUserId": b_user, "status": "RESOLVED"})
check("school A resolves its incident", co == 200, f"({co} {r})")
co, r = call("GET", f"/incidents/{inc}", S_ADMIN)
row = r.get('data', {}) if co == 200 else {}
check("acknowledged by the caller, not the id in the body",
      row.get('acknowledged_by_user_id') == me, f"({row.get('acknowledged_by_user_id')})")
check("resolved by the caller, not the id in the body",
      row.get('resolved_by_user_id') == me, f"({row.get('resolved_by_user_id')})")
check("and resolved", row.get('status') == 'RESOLVED', f"({row.get('status')})")
co, r = call("GET", f"/incidents/{inc}", S_ADMIN_B)
check("another school cannot see the incident", co == 404, f"({co})")

print(f"\n{P} passed, {F} failed")
sys.exit(0 if F == 0 else 1)
