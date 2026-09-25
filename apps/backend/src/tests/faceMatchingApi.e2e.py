"""
Face matching (/api/biometrics) against real images.

Before this, every face path took 128 numbers from the browser and called
them a face; the browser made them by averaging the colour of 128 patches of
the camera frame. This suite drives the replacement with photographs: one
synthetic person in three head poses (and mirrored copies of those, so
verification never compares an image with itself), and photographs of a
different person as the impostor. See src/tests/fixtures/faces/README.md.

What is asserted, beyond the usual tenant and role boundaries:
  - nothing happens without recorded consent, and withdrawing it deletes the template;
  - each capture answers a fresh server challenge, once;
  - the head must turn as instructed, and every frame must be one person;
  - the wrong person is refused; the right one is matched;
  - a match backs exactly one attendance record, and the client cannot assert one.
"""
import json, subprocess, sys, time, os
RUN = str(int(time.time()))[-6:]
SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
FACES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "faces")
s = json.load(open(f"{SP}/seed.json")); A, B = s['A'], s['B']
c = json.load(open(f"{SP}/corp.json")); CA, CB = c['A'], c['B']
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
P = F = 0

def call(m, p, t, body=None):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "60", "-X", m,
           "-H", "Content-Type: application/json", "-H", f"Authorization: Bearer {t}", ROOT + p]
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    o = subprocess.run(cmd, capture_output=True, text=True).stdout
    txt, _, code = o.rpartition("\n")
    try:
        return int(code), json.loads(txt)
    except Exception:
        return int(code), txt

def post_frames(path, t, challenge, files):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "120", "-X", "POST",
           "-H", f"Authorization: Bearer {t}", "-F", f"challengeId={challenge}"]
    for f in files:
        cmd += ["-F", f"frames=@{os.path.join(FACES, f)};type=image/jpeg"]
    cmd.append(ROOT + path)
    o = subprocess.run(cmd, capture_output=True, text=True).stdout
    txt, _, code = o.rpartition("\n")
    try:
        return int(code), json.loads(txt)
    except Exception:
        return int(code), txt

def check(n, ok, d=""):
    global P, F
    if ok:
        P += 1; print(f"  ok    {n}")
    else:
        F += 1; print(f"  FAIL  {n} {d}")

ORIGINAL = {"center": "synthetic-center.jpg", "left": "synthetic-left.jpg", "right": "synthetic-right.jpg"}
MIRROR = {"center": "synthetic-center-m.jpg", "left": "synthetic-left-m.jpg", "right": "synthetic-right-m.jpg"}
OTHER = ["other-a.jpg", "other-b.jpg", "other-a-m.jpg"]

def frames_for(steps, faces=ORIGINAL):
    return [faces[p] for p in steps]

def challenge(t, body):
    co, r = call("POST", "/biometrics/challenges", t, body)
    return co, r, (r.get('challengeId') if co == 201 else None), (r.get('steps') if co == 201 else None)

AT, FA, STU, BT, FB = A['token'], A['facToken'], A['studentToken'], B['token'], B['facToken']
S0, S1 = A['students']
HR, EMP, HRB, CADMIN = CA['token'], CA['empToken'], CB['token'], CA['adminToken']

# ==================================================================== settings
print("-- off until an administrator turns it on --")
co, r = call("GET", "/biometrics/settings", AT)
check("settings readable", co == 200 and r['settings']['configured'] is True, f"({co} {r})")
check("off by default", co == 200 and r['settings']['enabled'] is False, f"({r})")
co, r, _, _ = challenge(FA, {"purpose": "identify", "scheduleId": A['scheduleId']})
check("no capture while it is off", co == 409 and r.get('code') == 'disabled', f"({co} {r})")
co, r = call("PUT", "/biometrics/settings", FA, {"enabled": True, "threshold": 0.5})
check("a lecturer cannot turn it on", co == 403, f"({co} {r})")
co, r = call("PUT", "/biometrics/settings", AT, {"enabled": True, "threshold": 0.9})
check("the school administrator turns it on", co == 200 and r['settings']['enabled'] is True, f"({co} {r})")
check("a threshold outside the safe band is clamped", co == 200 and r['settings']['threshold'] == 0.6, f"({r})")
co, r = call("PUT", "/biometrics/settings", AT, {"enabled": True, "threshold": 0.5})
co, r = call("GET", "/biometrics/settings", BT)
check("another school's switch is its own", co == 200 and r['settings']['enabled'] is False, f"({r})")

# ===================================================================== consent
print("-- consent comes first --")
co, r, _, _ = challenge(FA, {"purpose": "enroll", "subjectType": "student", "subjectId": S0})
check("no enrolment without consent", co == 409 and r.get('code') == 'no_consent', f"({co} {r})")
co, r = call("POST", f"/biometrics/subjects/student/{S0}/consent", FA, {"basis": "Signed form"})
check("a lecturer cannot record consent", co == 403, f"({co} {r})")
co, r = call("POST", f"/biometrics/subjects/student/{S0}/consent", AT, {"basis": "ok"})
check("consent must say how it was obtained", co == 400, f"({co} {r})")
co, r = call("POST", f"/biometrics/subjects/student/{S0}/consent", AT,
             {"basis": f"Guardian's signed consent form, run {RUN}"})
check("the administrator records consent", co == 201, f"({co} {r})")
co, r = call("POST", f"/biometrics/subjects/student/{S0}/consent", AT, {"basis": "Signed again"})
check("consent is recorded once", co == 409, f"({co} {r})")
co, r = call("POST", f"/biometrics/subjects/student/{S0}/consent", BT, {"basis": "Signed form"})
check("another school cannot record consent for this student", co == 404, f"({co} {r})")
co, r = call("POST", f"/biometrics/subjects/student/{S0}/consent", HR, {"basis": "Signed form"})
check("a corporate identity cannot either", co == 404, f"({co} {r})")

# ==================================================================== enrolment
print("-- enrolment --")
co, r, _, _ = challenge(STU, {"purpose": "enroll", "subjectType": "student", "subjectId": S0})
check("a student cannot enrol themselves", co == 403, f"({co} {r})")
co, r, _, _ = challenge(FB, {"purpose": "enroll", "subjectType": "student", "subjectId": S0})
check("another school's lecturer cannot enrol this student", co in (404, 409), f"({co} {r})")

co, r, ch, steps = challenge(FA, {"purpose": "enroll", "subjectType": "student", "subjectId": S0})
check("the student's lecturer starts an enrolment", co == 201 and ch and sorted(steps) == ["center", "left", "right"],
      f"({co} {r})")
wrong = list(reversed(steps)) if steps else []
co, r = post_frames("/biometrics/enroll", FA, ch, frames_for(wrong))
check("head turns in the wrong order are refused", co == 422 and r.get('code') == 'liveness_failed', f"({co} {r})")
co, r = post_frames("/biometrics/enroll", FA, ch, frames_for(steps))
check("a challenge cannot be answered twice", co == 410, f"({co} {r})")

co, r, ch, steps = challenge(FA, {"purpose": "enroll", "subjectType": "student", "subjectId": S0})
mixed = frames_for(steps)
mixed[steps.index("center")] = "other-a.jpg"
co, r = post_frames("/biometrics/enroll", FA, ch, mixed)
check("frames of two different people are refused", co == 422 and r.get('code') == 'inconsistent_frames', f"({co} {r})")

co, r, ch, steps = challenge(FA, {"purpose": "enroll", "subjectType": "student", "subjectId": S0})
nf = frames_for(steps); nf[0] = "no-face.jpg"
co, r = post_frames("/biometrics/enroll", FA, ch, nf)
check("an image with no face is refused", co == 422 and r.get('code') == 'no_face', f"({co} {r})")

co, r, ch, steps = challenge(FA, {"purpose": "enroll", "subjectType": "student", "subjectId": S0})
tf = frames_for(steps); tf[0] = "two-faces.jpg"
co, r = post_frames("/biometrics/enroll", FA, ch, tf)
check("an image with two faces is refused", co == 422 and r.get('code') == 'multiple_faces', f"({co} {r})")

co, r, ch, steps = challenge(FA, {"purpose": "enroll", "subjectType": "student", "subjectId": S0})
co, r = post_frames("/biometrics/enroll", FA, ch, frames_for(steps)[:2])
check("too few frames for the challenge are refused", co == 422 and r.get('code') == 'wrong_frame_count', f"({co} {r})")

co, r, ch, steps = challenge(FA, {"purpose": "enroll", "subjectType": "student", "subjectId": S0})
co, r = post_frames("/biometrics/enroll", FA, ch, frames_for(steps))
check("a real three-pose capture enrols", co == 201 and r.get('enrolled') is True and r.get('framesUsed') == 3,
      f"({co} {r})")

co, r = call("GET", f"/biometrics/subjects/student/{S0}", AT)
check("status shows consent and enrolment", co == 200 and r.get('consent') and r.get('enrolment'), f"({co} {r})")
check("and never the template itself", co == 200 and 'ciphertext' not in json.dumps(r) and 'descriptor' not in json.dumps(r),
      f"({r})")
co, r = call("GET", f"/biometrics/subjects/student/{S0}", STU)
check("a student sees their own status", co == 200, f"({co} {r})")
co, r = call("GET", f"/biometrics/subjects/student/{S1}", STU)
check("but not a classmate's", co == 403, f"({co} {r})")
co, r = call("GET", f"/biometrics/subjects/student/{S0}", BT)
check("another school sees nothing", co == 404, f"({co} {r})")

# ============================================================== identification
print("-- identifying a student in class --")
co, r, _, _ = challenge(AT, {"purpose": "identify", "scheduleId": A['scheduleId']})
check("identification is for the lecturer", co == 403, f"({co} {r})")
co, r, _, _ = challenge(FB, {"purpose": "identify", "scheduleId": A['scheduleId']})
check("not another school's lecturer", co in (404, 409), f"({co} {r})")

co, r, ch, steps = challenge(FA, {"purpose": "identify", "scheduleId": A['scheduleId']})
co, r = post_frames("/biometrics/identify", FA, ch, OTHER)
check("a stranger is not matched to anyone", co == 422 and r.get('code') == 'not_matched', f"({co} {r})")

co, r, ch, steps = challenge(FA, {"purpose": "identify", "scheduleId": A['scheduleId']})
co, r = post_frames("/biometrics/identify", FA, ch, frames_for(steps, MIRROR))
match = r.get('matchId') if co == 200 else None
check("the enrolled student is identified from different images", co == 200 and r.get('student', {}).get('id') == S0,
      f"({co} {r})")
check("with a distance under the threshold", co == 200 and r['distance'] < r['threshold'], f"({r})")

# =============================================== spending a match on attendance
print("-- a match backs one attendance record --")
DAY1, DAY2 = "2026-03-02", "2026-03-03"
co, r = call("POST", "/faculty/attendance/mark", FA, {"schedule_id": A['scheduleId'], "date": DAY1,
             "entries": [{"student_id": S1, "status": "present", "face_verified": True}]})
check("(a mark claiming a face check with no match)", co == 200, f"({co} {r})")
co, r = call("GET", f"/faculty/schedules/{A['scheduleId']}/students?date={DAY1}", FA)
row = next((x for x in r.get('students', []) if x['student_id'] == S1), {}) if co == 200 else {}
check("is recorded without a face check: the flag in the body is not evidence",
      row.get('face_verified') is False, f"({co} {row})")

co, r = call("POST", "/faculty/attendance/mark", FA, {"schedule_id": A['scheduleId'], "date": DAY1,
             "entries": [{"student_id": S1, "status": "present", "face_match_id": match}]})
check("a match for one student cannot be spent on another", co == 409 and r.get('code') == 'match_unusable',
      f"({co} {r})")
co, r = call("POST", "/faculty/attendance/mark", FA, {"schedule_id": A['scheduleId'], "date": DAY1,
             "entries": [{"student_id": S0, "status": "present", "face_match_id": match}]})
check("the match backs the student it identified", co == 200, f"({co} {r})")
co, r = call("GET", f"/faculty/schedules/{A['scheduleId']}/students?date={DAY1}", FA)
row = next((x for x in r.get('students', []) if x['student_id'] == S0), {}) if co == 200 else {}
check("and the record says so", row.get('face_verified') is True, f"({row})")
co, r = call("POST", "/faculty/attendance/mark", FA, {"schedule_id": A['scheduleId'], "date": DAY2,
             "entries": [{"student_id": S0, "status": "present", "face_match_id": match}]})
check("the same match cannot back a second record", co == 409, f"({co} {r})")
co, r = call("POST", "/attendance/mark-with-face", FA,
             {"studentId": S0, "sessionId": "00000000-0000-4000-8000-000000000000",
              "verificationMethod": "FACE_RECOGNITION", "faceEncoding": [0.1] * 128})
check("session marking by face no longer takes numbers from the client", co == 400, f"({co} {r})")

co, r, ch, steps = challenge(FA, {"purpose": "identify", "scheduleId": A['scheduleId']})
co, r = post_frames("/biometrics/identify", FA, ch, frames_for(steps, MIRROR))
match2 = r.get('matchId') if co == 200 else None
co, r = call("POST", "/faculty/attendance/facial-match", FA,
             {"course_id": A['courseId'], "date": DAY2, "student_id": S0, "face_match_id": match2})
check("the course register accepts a fresh match", co == 200 and r.get('face_verified') is True, f"({co} {r})")
co, r = call("POST", "/faculty/attendance/facial-match", FA,
             {"course_id": A['courseId'], "date": "2026-03-04", "student_id": S0, "face_match_id": match2})
check("and not the same match again", co == 409, f"({co} {r})")

# ================================================================= the log
co, r = call("GET", "/biometrics/events", FA)
check("a lecturer cannot read the log", co == 403, f"({co} {r})")
co, r = call("GET", f"/biometrics/events?subjectType=student&subjectId={S0}", AT)
acts = {(e['action'], e['outcome']) for e in r.get('events', [])} if co == 200 else set()
check("the log records consent, the failed and successful enrolments and the match",
      {("consent_granted", "success"), ("enrolled", "failure"), ("enrolled", "success"),
       ("identified", "success")} <= acts, f"({co} {acts})")
co, r = call("GET", "/biometrics/events", BT)
check("another school's log is its own", co == 200 and all(e['subject_id'] != S0 for e in r.get('events', [])),
      f"({co})")

# ================================================================ withdrawal
print("-- withdrawing consent deletes the template --")
co, r = call("DELETE", f"/biometrics/subjects/student/{S0}/consent", AT, {"reason": f"Guardian withdrew, run {RUN}"})
check("the administrator withdraws consent", co == 200 and r.get('templateDeleted') is True, f"({co} {r})")
co, r = call("GET", f"/biometrics/subjects/student/{S0}", AT)
check("nothing is left enrolled", co == 200 and r.get('consent') is None and r.get('enrolment') is None, f"({co} {r})")
co, r, ch, steps = challenge(FA, {"purpose": "identify", "scheduleId": A['scheduleId']})
co, r = post_frames("/biometrics/identify", FA, ch, frames_for(steps, MIRROR))
check("and the student can no longer be identified", co == 422 and r.get('code') == 'not_matched', f"({co} {r})")

# ================================================================ employees
print("-- employee check-in --")
co, r = call("GET", "/workforce/my/attendance", EMP)
emp_id = CA['empId']
co, r = call("PUT", "/biometrics/settings", HR, {"enabled": True, "threshold": 0.5})
check("HR (not a director) cannot turn it on", co == 403, f"({co} {r})")
co, r = call("PUT", "/biometrics/settings", CA['dirToken'], {"enabled": True, "threshold": 0.5})
check("the HR director turns it on", co == 200, f"({co} {r})")

co, r = call("POST", f"/biometrics/subjects/employee/{emp_id}/consent", EMP,
             {"basis": f"Agreed in the self-service portal, run {RUN}"})
check("an employee records their own consent", co == 201, f"({co} {r})")
co, r, _, _ = challenge(EMP, {"purpose": "enroll", "subjectType": "employee", "subjectId": emp_id})
check("but cannot enrol their own face", co == 403, f"({co} {r})")
co, r, _, _ = challenge(HRB, {"purpose": "enroll", "subjectType": "employee", "subjectId": emp_id})
check("another employer's HR cannot enrol them", co in (404, 409), f"({co} {r})")
co, r, _, _ = challenge(EMP, {"purpose": "verify"})
check("no verification before enrolment", co == 409 and r.get('code') == 'not_enrolled', f"({co} {r})")

co, r, ch, steps = challenge(HR, {"purpose": "enroll", "subjectType": "employee", "subjectId": emp_id})
co, r = post_frames("/biometrics/enroll", HR, ch, frames_for(steps))
check("HR enrols the employee", co == 201, f"({co} {r})")

co, r, ch, steps = challenge(EMP, {"purpose": "verify"})
co, r = post_frames("/biometrics/verify", HR, ch, frames_for(steps, MIRROR))
check("a challenge answers only to the person it was issued to", co == 410, f"({co} {r})")

co, r, ch, steps = challenge(EMP, {"purpose": "verify"})
co, r = post_frames("/biometrics/verify", EMP, ch, OTHER)
check("someone else's face does not check the employee in", co == 422 and r.get('code') == 'not_matched', f"({co} {r})")

co, r, ch, steps = challenge(EMP, {"purpose": "verify"})
co, r = post_frames("/biometrics/verify", EMP, ch, frames_for(steps, MIRROR))
vmatch = r.get('matchId') if co == 200 else None
check("the employee's own face verifies", co == 200 and vmatch, f"({co} {r})")

co, r = call("POST", "/workforce/my/check-out", EMP)   # in case an earlier suite left one open
co, r = call("POST", "/workforce/my/check-in", EMP, {"checkInType": "office", "faceMatchId": vmatch})
check("check-in cites the match", co == 201 and r.get('checkIn', {}).get('faceVerified') is True, f"({co} {r})")
co, r = call("POST", "/workforce/my/check-out", EMP)
co, r = call("POST", "/workforce/my/check-in", EMP, {"checkInType": "office", "faceMatchId": vmatch})
check("the same match cannot check in twice", co == 409, f"({co} {r})")
co, r = call("POST", "/workforce/my/check-in", EMP, {"checkInType": "office"})
check("check-in without a face is still possible", co == 201 and r.get('checkIn', {}).get('faceVerified') is False,
      f"({co} {r})")
co, r = call("POST", "/workforce/my/check-out", EMP)

print("-- repeated failures pause face check-in --")
for _ in range(4):
    co, r, ch, steps = challenge(EMP, {"purpose": "verify"})
    post_frames("/biometrics/verify", EMP, ch, OTHER)
co, r, _, _ = challenge(EMP, {"purpose": "verify"})
check("after five failed matches, face check-in pauses", co == 429 and r.get('code') == 'paused', f"({co} {r})")

co, r = call("DELETE", f"/biometrics/subjects/employee/{emp_id}/consent", EMP, {"reason": "Changed my mind"})
check("the employee withdraws their own consent", co == 200, f"({co} {r})")
co, r = call("GET", f"/biometrics/subjects/employee/{emp_id}", HR)
check("and HR sees the template gone", co == 200 and r.get('enrolment') is None, f"({co} {r})")

print(f"\n{P} passed, {F} failed")
sys.exit(0 if F == 0 else 1)
