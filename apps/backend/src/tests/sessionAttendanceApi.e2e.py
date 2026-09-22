"""
Session-based attendance and face recognition (/api/attendance/*).

This surface took ids straight from the request and queried on them alone:
any session, any student, any course, from any school. It also could not work
at all — the attendance insert named a column that does not exist, and the
face service wrote user ids into a column referencing students(id).

These assertions cover both halves: that the endpoints now function, and that
each one refuses the other school's ids.
"""
import json, subprocess, sys, time
RUN = str(int(time.time()))[-6:]
SP = "/tmp/claude-0/-home-user-SmartAttend/d93ac8ad-306e-535c-92c4-36bf785b1524/scratchpad"
d = json.load(open(f"{SP}/seed.json")); A, B = d['A'], d['B']
c = json.load(open(f"{SP}/corp.json")); HR = c['A']['token']
BASE = "http://127.0.0.1:5000/api/attendance"
P = F = 0

def call(m, p, t, body=None):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "25", "-X", m,
           "-H", f"Authorization: Bearer {t}", "-H", "Content-Type: application/json", BASE + p]
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

FA, FB = A['facToken'], B['facToken']
AT, BT = A['token'], B['token']

# The faculty user id is what course_sessions.lecturer_id holds.
def user_id_of(tok):
    import base64
    payload = tok.split('.')[1]
    payload += '=' * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))['userId']

FA_USER, FB_USER = user_id_of(FA), user_id_of(FB)

# A window that is open right now, so marking is not refused on timing.
now = time.time()
# Sessions are unique per course, date and start time, so each run picks its own.
SLOT = f"{6 + int(RUN) % 12:02d}:{int(RUN) % 60:02d}"
SLOT_END = f"{7 + int(RUN) % 12:02d}:{int(RUN) % 60:02d}"
OPEN = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(now - 3600))
CLOSE = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(now + 3600))
# school_attendance is unique per (schedule, student, date) as well as per
# (student, session), so two sessions of the same class on one day cannot both
# be recorded. That is the register flow's invariant and normal for a class
# that meets once a day; it does mean each run of this suite needs its own
# date, or it collides with the marks the previous run left behind.
TODAY = time.strftime('%Y-%m-%d', time.gmtime(now - 86400 * (int(RUN) % 90)))

print("-- platform gate --")
co, r = call("GET", f"/courses/{A['courseId']}/sessions", HR)
check("EMS identity refused", co == 403, f"({co} {r})")

print("-- create session --")
co, r = call("POST", "/sessions", FA, {
    "courseId": A['courseId'], "sessionNumber": int(RUN[-4:]), "sessionDate": TODAY,
    "startTime": SLOT, "endTime": SLOT_END,
    "attendanceOpenAt": OPEN, "attendanceCloseAt": CLOSE, "lecturerId": FA_USER})
check("create session 201", co == 201, f"({co} {r})")
session_a = r.get('data', {}).get('id') if co == 201 else None

co, r = call("POST", "/sessions", FA, {
    "courseId": B['courseId'], "sessionNumber": int(RUN[-4:]), "sessionDate": TODAY,
    "startTime": SLOT, "endTime": SLOT_END,
    "attendanceOpenAt": OPEN, "attendanceCloseAt": CLOSE, "lecturerId": FA_USER})
check("cannot create against B's course", co == 404, f"({co} {r})")

co, r = call("POST", "/sessions", FA, {
    "courseId": A['courseId'], "sessionNumber": int(RUN[-4:]) + 1, "sessionDate": TODAY,
    "startTime": SLOT, "endTime": SLOT_END,
    "attendanceOpenAt": OPEN, "attendanceCloseAt": CLOSE, "lecturerId": FB_USER})
check("cannot assign B's lecturer", co == 404, f"({co} {r})")

# B's own session, to read across the boundary with.
co, r = call("POST", "/sessions", FB, {
    "courseId": B['courseId'], "sessionNumber": int(RUN[-4:]), "sessionDate": TODAY,
    "startTime": SLOT, "endTime": SLOT_END,
    "attendanceOpenAt": OPEN, "attendanceCloseAt": CLOSE, "lecturerId": FB_USER})
check("B creates its own session 201", co == 201, f"({co} {r})")
session_b = r.get('data', {}).get('id') if co == 201 else None

print("-- read session --")
if session_a:
    co, r = call("GET", f"/sessions/{session_a}", FA)
    check("own session 200", co == 200, f"({co} {r})")
if session_b:
    co, r = call("GET", f"/sessions/{session_b}", FA)
    check("B's session is 404, not readable", co == 404, f"({co} {r})")
    co, r = call("PUT", f"/sessions/{session_b}", FA, {"status": "CANCELLED"})
    check("cannot update B's session", co == 404, f"({co} {r})")
    co, r = call("GET", f"/sessions/{session_b}", FB)
    check("B still sees its own session as SCHEDULED",
          co == 200 and r.get('data', {}).get('status') == 'SCHEDULED', f"({co} {r})")

co, r = call("GET", f"/courses/{A['courseId']}/sessions", FA)
check("course sessions 200", co == 200, f"({co} {r})")
if co == 200:
    check("only A's sessions listed", all(s['courseId'] == A['courseId'] for s in r.get('data', [])))
co, r = call("GET", f"/courses/{B['courseId']}/sessions", FA)
check("B's course yields nothing", co == 200 and r.get('total') == 0, f"({co} {r})")

print("-- mark attendance --")
if session_a:
    co, r = call("POST", "/mark-with-face", FA, {
        "studentId": A['students'][0], "sessionId": session_a, "verificationMethod": "MANUAL"})
    check("mark 201 (insert named a column that does not exist)", co == 201, f"({co} {r})")
    check("recorded present", co == 201 and r.get('data', {}).get('status') == 'present', f"({r})")

    co, r = call("POST", "/mark-with-face", FA, {
        "studentId": A['students'][0], "sessionId": session_a, "verificationMethod": "MANUAL"})
    check("double mark refused", co == 400, f"({co} {r})")

    co, r = call("POST", "/mark-with-face", FA, {
        "studentId": B['students'][0], "sessionId": session_a, "verificationMethod": "MANUAL"})
    check("cannot mark B's student", co == 400 and 'not found' in str(r).lower(), f"({co} {r})")

if session_b:
    co, r = call("POST", "/mark-with-face", FA, {
        "studentId": A['students'][0], "sessionId": session_b, "verificationMethod": "MANUAL"})
    check("cannot mark into B's session", co == 400 and 'not found' in str(r).lower(), f"({co} {r})")

print("-- attendance reports --")
if session_a:
    co, r = call("GET", f"/sessions/{session_a}/attendance", FA)
    check("session attendance 200", co == 200, f"({co} {r})")
    if co == 200:
        check("holds A's mark", any(x['studentId'] == A['students'][0] for x in r.get('data', [])), f"({r})")
        check("markedAt is populated, not created_at",
              all(x.get('markedAt') for x in r.get('data', [])), f"({r.get('data')})")
if session_b:
    co, r = call("GET", f"/sessions/{session_b}/attendance", FA)
    check("B's session attendance is empty to A", co == 200 and r.get('total') == 0, f"({co} {r})")

co, r = call("GET", f"/students/{A['students'][0]}/courses/{A['courseId']}/attendance", FA)
check("student course attendance 200", co == 200, f"({co} {r})")
co, r = call("GET", f"/students/{B['students'][0]}/courses/{B['courseId']}/attendance", FA)
check("B's student history is empty to A", co == 200 and r.get('total') == 0, f"({co} {r})")

print("-- face enrolment --")
ENC = [0.01 * (i % 7) for i in range(128)]
co, r = call("POST", "/face/enroll", FA, {
    "studentId": A['students'][1], "faceEncoding": ENC,
    "encodingDimension": 128, "faceConfidence": 0.95})
check("enrol own student 201 (wrote user ids into a students FK)", co == 201, f"({co} {r})")
enrolment = r.get('data', {}).get('enrollmentId') if co == 201 else None

co, r = call("POST", "/face/enroll", FA, {
    "studentId": B['students'][0], "faceEncoding": ENC,
    "encodingDimension": 128, "faceConfidence": 0.95})
check("cannot enrol B's student", co == 400 and 'not found' in str(r).lower(), f"({co} {r})")

co, r = call("POST", "/face/enroll", FA, {
    "studentId": A['students'][1], "faceEncoding": ENC[:10],
    "encodingDimension": 128, "faceConfidence": 0.95})
check("wrong-length encoding refused 400", co == 400, f"({co} {r})")

if enrolment:
    # The capturer may not also be the verifier.
    co, r = call("POST", "/face/verify", FA, {"enrollmentId": enrolment})
    check("self-verification refused", co == 400, f"({co} {r})")
    co, r = call("POST", "/face/verify", FB, {"enrollmentId": enrolment})
    check("B cannot verify A's enrolment", co == 400 and 'not found' in str(r).lower(), f"({co} {r})")
    co, r = call("POST", "/face/verify", AT, {"enrollmentId": enrolment})
    check("A's admin verifies it 200", co == 200, f"({co} {r})")

co, r = call("GET", f"/face/enrollment-status/{A['students'][1]}", FA)
check("enrolment status 200", co == 200, f"({co} {r})")
if co == 200:
    check("shows an active, verified enrolment",
          r.get('data', {}).get('hasActiveEnrollment') and r.get('data', {}).get('isVerified'), f"({r})")
co, r = call("GET", f"/face/enrollment-status/{B['students'][0]}", FA)
check("B's student status is 404 to A", co == 404, f"({co} {r})")

print("-- face verification during marking --")
if session_a:
    co, r = call("POST", "/mark-with-face", FA, {
        "studentId": A['students'][1], "sessionId": session_a,
        "verificationMethod": "FACE_RECOGNITION",
        "faceEncoding": ENC, "encodingDimension": 128})
    check("matching face marks present", co == 201 and r.get('data', {}).get('faceVerified') is True, f"({co} {r})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
