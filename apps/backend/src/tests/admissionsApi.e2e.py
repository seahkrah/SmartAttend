"""
SMS admissions — the beginning of the student lifecycle.

Covers an intake opening, an applicant being registered, an application being
submitted into it, the review and decision path through offer and acceptance,
and the enrolment that produces a real student with a login, a student record
and a programme enrolment. Every step is checked for function, for the state
machine refusing what it should refuse, for tenant isolation, for platform
isolation and for role enforcement.
"""
import json, subprocess, sys, time, os
RUN = str(int(time.time()))[-6:]
SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
d = json.load(open(f"{SP}/seed.json")); A, B = d['A'], d['B']
c = json.load(open(f"{SP}/corp.json")); HR = c['A']['token']
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
P = F = 0

def call(m, p, t, body=None, base="/admissions"):
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
FA = A['facToken']
GHOST = "00000000-0000-4000-8000-000000000000"
TODAY = time.strftime("%Y-%m-%d")
PAST = time.strftime("%Y-%m-%d", time.localtime(time.time() - 86400 * 40))
SOON = time.strftime("%Y-%m-%d", time.localtime(time.time() + 86400 * 60))
YESTERDAY = time.strftime("%Y-%m-%d", time.localtime(time.time() - 86400))

# ---------------------------------------------------------------- the gate
print("-- platform and role enforcement --")
co, r = call("GET", "/intakes", HR)
check("EMS identity refused from SMS admissions", co == 403, f"({co} {r})")
co, r = call("GET", "/intakes", None)
check("admissions needs a token", co in (401, 403), f"({co})")
co, r = call("GET", "/intakes", FA)
check("faculty refused from admissions", co == 403, f"({co} {r})")
co, r = call("GET", "/overview", FA)
check("faculty refused from the admissions overview", co == 403, f"({co} {r})")

# ---------------------------------------------------------------- intakes
print("-- intakes --")
co, r = call("POST", "/intakes", AT,
             {"code": f"INT{RUN}", "name": f"September {RUN} entry",
              "opensAt": PAST, "closesAt": SOON, "capacity": 3, "status": "open"})
check("create an intake", co == 201, f"({co} {r})")
intake_a = r.get('intake', {}).get('id') if co == 201 else None

co, r = call("POST", "/intakes", AT,
             {"code": f"INT{RUN}", "name": "Duplicate", "opensAt": PAST, "closesAt": SOON})
check("a duplicate intake code is refused", co == 409, f"({co} {r})")

co, r = call("POST", "/intakes", AT,
             {"code": f"BAD{RUN}", "name": "Backwards", "opensAt": SOON, "closesAt": PAST})
check("an intake closing before it opens is refused", co == 400, f"({co} {r})")

co, r = call("POST", "/intakes", AT, {"name": "No code", "opensAt": PAST, "closesAt": SOON})
check("an intake without a code is refused", co == 400, f"({co} {r})")

co, r = call("POST", "/intakes", AT,
             {"code": f"SHUT{RUN}", "name": f"Closed cycle {RUN}",
              "opensAt": PAST, "closesAt": YESTERDAY, "status": "open"})
check("create an intake whose window has passed", co == 201, f"({co} {r})")
intake_shut = r.get('intake', {}).get('id') if co == 201 else None

co, r = call("POST", "/intakes", AT,
             {"code": f"YEAR{RUN}", "name": "Bad year", "opensAt": PAST,
              "closesAt": SOON, "academicYearId": GHOST})
check("an intake naming an unknown academic year is refused", co == 404, f"({co} {r})")

co, r = call("GET", "/intakes", AT)
check("list intakes", co == 200 and len(r.get('intakes', [])) >= 2, f"({co} {r})")
mine = [i['id'] for i in r.get('intakes', [])] if co == 200 else []

co, r = call("GET", "/intakes", BT)
check("tenant B does not see tenant A's intakes",
      co == 200 and intake_a not in [i['id'] for i in r.get('intakes', [])], f"({co} {r})")

co, r = call("GET", f"/intakes/{intake_a}", BT)
check("tenant B reading A's intake gets 404", co == 404, f"({co} {r})")
co, r = call("PATCH", f"/intakes/{intake_a}", BT, {"name": "Hijacked"})
check("tenant B cannot rename A's intake", co == 404, f"({co} {r})")
co, r = call("DELETE", f"/intakes/{intake_a}", BT)
check("tenant B cannot delete A's intake", co == 404, f"({co} {r})")

co, r = call("GET", f"/intakes/{intake_a}", AT)
check("read own intake", co == 200 and r.get('intake', {}).get('id') == intake_a, f"({co} {r})")
check("an intake reports its remaining capacity",
      co == 200 and r.get('capacity', {}).get('remaining') == 3, f"({co} {r})")

co, r = call("GET", f"/intakes/{GHOST}", AT)
check("an unknown intake is 404", co == 404, f"({co})")
co, r = call("GET", "/intakes/not-a-uuid", AT)
check("a malformed intake id is 404 rather than a 500", co == 404, f"({co})")

# ---------------------------------------------------------------- applicants
print("-- applicants --")
co, r = call("POST", "/applicants", AT,
             {"firstName": "Ama", "lastName": "Mensah",
              "email": f"ama.{RUN}@e2e.test", "phone": "0200000001",
              "dateOfBirth": "2008-04-11", "priorSchool": "Accra High"})
check("register an applicant", co == 201, f"({co} {r})")
applicant_a = r.get('applicant', {}).get('id') if co == 201 else None
check("an applicant is given a reference",
      co == 201 and bool(r.get('applicant', {}).get('reference')), f"({co} {r})")
check("an applicant is not converted yet",
      co == 201 and r.get('applicant', {}).get('converted_student_id') is None, f"({co} {r})")

co, r = call("POST", "/applicants", AT,
             {"firstName": "Ama", "lastName": "Mensah", "email": f"ama.{RUN}@e2e.test"})
check("the same email twice in one school is refused", co == 409, f"({co} {r})")

co, r = call("POST", "/applicants", AT,
             {"firstName": "Bad", "lastName": "Email", "email": "not-an-email"})
check("an applicant without a usable email is refused", co == 400, f"({co} {r})")

co, r = call("POST", "/applicants", AT, {"firstName": "Only", "lastName": "Names"})
check("an applicant without an email is refused", co == 400, f"({co} {r})")

# The same address in another school is a different person's record, and must
# be allowed — the uniqueness is per tenant, not global.
co, r = call("POST", "/applicants", BT,
             {"firstName": "Ama", "lastName": "Mensah", "email": f"ama.{RUN}@e2e.test"})
check("the same email in another school is allowed", co == 201, f"({co} {r})")
applicant_b = r.get('applicant', {}).get('id') if co == 201 else None

co, r = call("POST", "/applicants", AT,
             {"firstName": "Kofi", "lastName": "Boateng", "email": f"kofi.{RUN}@e2e.test"})
check("register a second applicant", co == 201, f"({co} {r})")
applicant_2 = r.get('applicant', {}).get('id') if co == 201 else None

co, r = call("GET", f"/applicants?q=Mensah", AT)
check("search applicants by name",
      co == 200 and any(x['id'] == applicant_a for x in r.get('applicants', [])), f"({co} {r})")

co, r = call("GET", "/applicants", BT)
check("tenant B does not see tenant A's applicants",
      co == 200 and applicant_a not in [x['id'] for x in r.get('applicants', [])], f"({co} {r})")

co, r = call("GET", f"/applicants/{applicant_a}", BT)
check("tenant B reading A's applicant gets 404", co == 404, f"({co} {r})")
co, r = call("PATCH", f"/applicants/{applicant_a}", BT, {"lastName": "Hijacked"})
check("tenant B cannot edit A's applicant", co == 404, f"({co} {r})")

co, r = call("PATCH", f"/applicants/{applicant_a}", AT, {"phone": "0244000000"})
check("update own applicant",
      co == 200 and r.get('applicant', {}).get('phone') == "0244000000", f"({co} {r})")

# ------------------------------------------------------- a programme to offer
print("-- programme setup --")
co, r = call("POST", "/programmes", AT,
             {"code": f"ADM{RUN}", "name": f"BSc Admissions Test {RUN}",
              "durationYears": 4}, base="/academics")
check("create a programme to offer", co == 201, f"({co} {r})")
prog_a = r.get('programme', {}).get('id') if co == 201 else None

co, r = call("POST", "/programmes", BT,
             {"code": f"ADMB{RUN}", "name": f"Other school programme {RUN}"},
             base="/academics")
check("tenant B has a programme of its own", co == 201, f"({co} {r})")
prog_b = r.get('programme', {}).get('id') if co == 201 else None

# ---------------------------------------------------------------- applications
print("-- applications --")
co, r = call("POST", "/applications", AT,
             {"applicantId": applicant_a, "intakeId": intake_a,
              "choices": [{"programmeId": prog_a, "rank": 1}]})
check("start an application as a draft", co == 201, f"({co} {r})")
app_a = r.get('application', {}).get('id') if co == 201 else None
check("a new application is a draft",
      co == 201 and r.get('application', {}).get('status') == 'draft', f"({co} {r})")
check("an application is given a reference",
      co == 201 and bool(r.get('application', {}).get('reference')), f"({co} {r})")

co, r = call("POST", "/applications", AT, {"applicantId": applicant_a})
check("an application without an intake is refused", co == 400, f"({co} {r})")

co, r = call("POST", "/applications", AT,
             {"applicantId": GHOST, "intakeId": intake_a})
check("an application for an unknown applicant is 404", co == 404, f"({co} {r})")

# The decisive cross-tenant case: A's admin naming B's applicant. The row
# exists, so a missing tenant predicate would return 201.
co, r = call("POST", "/applications", AT,
             {"applicantId": applicant_b, "intakeId": intake_a})
check("an application naming another school's applicant is 404", co == 404, f"({co} {r})")

co, r = call("POST", "/applications", AT,
             {"applicantId": applicant_2, "intakeId": intake_a,
              "choices": [{"programmeId": prog_b, "rank": 1}]})
check("a choice naming another school's programme is 404", co == 404, f"({co} {r})")

co, r = call("POST", "/applications", AT,
             {"applicantId": applicant_2, "intakeId": intake_shut, "submit": True})
check("submitting into a closed window is refused", co == 409, f"({co} {r})")

co, r = call("GET", f"/applications/{app_a}", BT)
check("tenant B reading A's application gets 404", co == 404, f"({co} {r})")

co, r = call("GET", f"/applications/{app_a}", AT)
check("read own application", co == 200, f"({co} {r})")
check("a draft's only moves are submit and withdraw",
      co == 200 and sorted(r.get('allowedTransitions', [])) == ['submitted', 'withdrawn'],
      f"({co} {r.get('allowedTransitions')})")
check("the application carries its choices",
      co == 200 and len(r.get('choices', [])) == 1, f"({co} {r.get('choices')})")

co, r = call("GET", "/applications", BT)
check("tenant B does not see tenant A's applications",
      co == 200 and app_a not in [x['id'] for x in r.get('applications', [])], f"({co} {r})")

co, r = call("GET", f"/applications?intakeId={intake_a}", AT)
check("filter applications by intake",
      co == 200 and any(x['id'] == app_a for x in r.get('applications', [])), f"({co} {r})")

# ---------------------------------------------------------- the state machine
print("-- state machine --")
co, r = call("POST", f"/applications/{app_a}/transition", AT, {"to": "offer",
                                                               "offeredProgrammeId": prog_a})
check("a draft cannot jump straight to an offer", co == 409, f"({co} {r})")

co, r = call("POST", f"/applications/{app_a}/transition", AT, {"to": "enrolled"})
check("a draft cannot be marked enrolled", co in (400, 409), f"({co} {r})")

co, r = call("POST", f"/applications/{app_a}/transition", AT, {"to": "nonsense"})
check("an unknown status is refused", co == 400, f"({co} {r})")

co, r = call("POST", f"/applications/{app_a}/transition", AT, {})
check("a transition without a target is refused", co == 400, f"({co} {r})")

co, r = call("POST", f"/applications/{app_a}/transition", BT, {"to": "submitted"})
check("tenant B cannot move A's application", co == 404, f"({co} {r})")

co, r = call("POST", f"/applications/{app_a}/transition", FA, {"to": "submitted"})
check("faculty cannot move an application", co == 403, f"({co} {r})")

co, r = call("POST", f"/applications/{app_a}/transition", AT, {"to": "submitted"})
check("submit the application", co == 200, f"({co} {r})")
check("submission is stamped",
      co == 200 and r.get('application', {}).get('submitted_at') is not None, f"({co} {r})")

co, r = call("POST", f"/applications/{app_a}/transition", AT, {"to": "submitted"})
check("submitting twice is refused", co == 409, f"({co} {r})")

co, r = call("POST", f"/applications/{app_a}/transition", AT,
             {"to": "under_review", "note": "Passed initial screening"})
check("move to review", co == 200, f"({co} {r})")

co, r = call("POST", f"/applications/{app_a}/transition", AT, {"to": "offer"})
check("an offer without a programme is refused", co == 400, f"({co} {r})")

co, r = call("POST", f"/applications/{app_a}/transition", AT,
             {"to": "offer", "offeredProgrammeId": prog_b})
check("an offer of another school's programme is 404", co == 404, f"({co} {r})")

co, r = call("POST", f"/applications/{app_a}/transition", AT,
             {"to": "offer", "offeredProgrammeId": prog_a, "offerExpiresAt": SOON})
check("make an offer", co == 200, f"({co} {r})")
check("the offer names the programme",
      co == 200 and r.get('application', {}).get('offered_programme_id') == prog_a, f"({co} {r})")
check("an offer holder may accept or decline",
      co == 200 and sorted(r.get('allowedTransitions', [])) == ['accepted', 'declined', 'withdrawn'],
      f"({co} {r.get('allowedTransitions')})")

co, r = call("POST", f"/applications/{app_a}/transition", AT, {"to": "accepted"})
check("accept the offer", co == 200, f"({co} {r})")

co, r = call("POST", f"/applications/{app_a}/transition", AT, {"to": "rejected"})
check("an accepted offer cannot then be rejected", co == 409, f"({co} {r})")

# ---------------------------------------------------------------- the trail
print("-- the audit trail --")
co, r = call("GET", f"/applications/{app_a}/events", AT)
events = r.get('events', []) if co == 200 else []
check("every transition is recorded", co == 200 and len(events) == 5, f"({co} {len(events)})")
check("the trail names the actor",
      co == 200 and all(e.get('actor_id') for e in events), f"({co} {events[:1]})")
check("the trail records what it moved from",
      co == 200 and any(e.get('from_status') == 'offer' and e.get('to_status') == 'accepted'
                        for e in events), f"({co} {events})")
co, r = call("GET", f"/applications/{app_a}/events", BT)
check("tenant B cannot read A's trail", co == 404, f"({co} {r})")

# ---------------------------------------------------------------- enrolment
print("-- enrolment --")
co, r = call("POST", f"/applications/{app_a}/enrol", BT, {})
check("tenant B cannot enrol A's applicant", co == 404, f"({co} {r})")

co, r = call("POST", f"/applications/{app_a}/enrol", FA, {})
check("faculty cannot enrol", co == 403, f"({co} {r})")

co, r = call("POST", f"/applications/{app_a}/enrol", AT,
             {"studentId": f"ADM-{RUN}", "entryYear": 2026})
check("enrol the accepted applicant", co == 201, f"({co} {r})")
enrolled = r if co == 201 else {}
student_id = enrolled.get('student', {}).get('id')
check("enrolment produces a student", bool(student_id), f"({co} {r})")
check("enrolment invites the student instead of issuing a password",
      'temporaryPassword' not in enrolled
      and enrolled.get('invitation', {}).get('delivery') in ('email', 'simulated'), f"({co} {r})")
check("the application is now enrolled",
      enrolled.get('application', {}).get('status') == 'enrolled', f"({co} {r})")
check("the application points at the student it produced",
      enrolled.get('application', {}).get('student_id') == student_id, f"({co} {r})")

co, r = call("POST", f"/applications/{app_a}/enrol", AT, {})
check("enrolling the same application twice is refused", co == 409, f"({co} {r})")

co, r = call("GET", f"/applicants/{applicant_a}", AT)
check("the applicant is now linked to the student",
      co == 200 and r.get('applicant', {}).get('converted_student_id') == student_id,
      f"({co} {r.get('applicant', {}).get('converted_student_id')})")

# The student has to be real to the rest of SMS, not just to admissions.
co, r = call("GET", "/admin/school/students", AT, base="/auth")
listed = r.get('students', []) if co == 200 else []
check("the new student appears in the school's student list",
      any(s.get('id') == student_id for s in listed), f"({co} {len(listed)})")

co, r = call("GET", "/admin/school/students", BT, base="/auth")
check("the new student does not appear in the other school's list",
      co == 200 and not any(s.get('id') == student_id for s in r.get('students', [])),
      f"({co})")

co, r = call("GET", f"/students/{student_id}/programme", AT, base="/academics")
check("enrolment created the programme enrolment",
      co == 200 and any(sp.get('programme_id') == prog_a for sp in r.get('enrolments', [])),
      f"({co} {r})")

# ------------------------------------------------------- the rest of the path
print("-- the other decision paths --")
co, r = call("POST", "/applications", AT,
             {"applicantId": applicant_2, "intakeId": intake_a, "submit": True})
check("start a second application, submitted", co == 201, f"({co} {r})")
app_2 = r.get('application', {}).get('id') if co == 201 else None
check("a submitted application is stamped",
      co == 201 and r.get('application', {}).get('submitted_at') is not None, f"({co} {r})")

co, r = call("POST", "/applications", AT,
             {"applicantId": applicant_2, "intakeId": intake_a})
check("a second live application to the same intake is refused", co == 409, f"({co} {r})")

co, r = call("POST", f"/applications/{app_2}/transition", AT,
             {"to": "waitlisted", "note": "Strong but oversubscribed"})
check("waitlist an application", co == 200, f"({co} {r})")

co, r = call("POST", f"/applications/{app_2}/transition", AT, {"to": "accepted"})
check("a waitlisted applicant cannot accept an offer nobody made", co == 409, f"({co} {r})")

co, r = call("POST", f"/applications/{app_2}/transition", AT,
             {"to": "offer", "offeredProgrammeId": prog_a})
check("a place freeing up moves a waitlisted applicant to offer", co == 200, f"({co} {r})")

co, r = call("POST", f"/applications/{app_2}/transition", AT,
             {"to": "declined", "note": "Went elsewhere"})
check("decline an offer", co == 200, f"({co} {r})")

co, r = call("POST", f"/applications/{app_2}/transition", AT, {"to": "withdrawn"})
check("a declined application is finished", co == 409, f"({co} {r})")

co, r = call("POST", f"/applications/{app_2}/enrol", AT, {})
check("a declined applicant cannot be enrolled", co == 409, f"({co} {r})")

# A declined application does not block a fresh attempt at the same intake.
co, r = call("POST", "/applications", AT,
             {"applicantId": applicant_2, "intakeId": intake_a})
check("a declined applicant may apply again", co == 201, f"({co} {r})")
app_3 = r.get('application', {}).get('id') if co == 201 else None

# ---------------------------------------------------------------- capacity
print("-- capacity --")
co, r = call("GET", f"/intakes/{intake_a}", AT)
check("the enrolled place is counted against capacity",
      co == 200 and r.get('capacity', {}).get('taken') == 1, f"({co} {r.get('capacity')})")

co, r = call("PATCH", f"/intakes/{intake_a}", AT, {"capacity": 1})
check("tighten the intake to a single place", co == 200, f"({co} {r})")

co, r = call("POST", f"/applications/{app_3}/transition", AT, {"to": "submitted"})
check("submit the third application", co == 200, f"({co} {r})")

co, r = call("POST", f"/applications/{app_3}/transition", AT,
             {"to": "offer", "offeredProgrammeId": prog_a})
check("an offer past the intake's capacity is refused", co == 409, f"({co} {r})")

co, r = call("POST", f"/applications/{app_3}/transition", AT,
             {"to": "offer", "offeredProgrammeId": prog_a, "force": True})
check("an over-capacity offer can be made deliberately", co == 200, f"({co} {r})")

# ---------------------------------------------------------------- choices
print("-- programme choices --")
co, r = call("POST", f"/applications/{app_3}/choices", AT, {"programmeId": prog_a})
check("add a programme choice", co == 201, f"({co} {r})")
choice_id = r.get('choice', {}).get('id') if co == 201 else None
check("a choice added without a rank takes the next one",
      co == 201 and r.get('choice', {}).get('preference_rank') == 1, f"({co} {r})")

co, r = call("POST", f"/applications/{app_3}/choices", AT, {"programmeId": prog_a})
check("the same programme twice is refused", co == 409, f"({co} {r})")

co, r = call("POST", f"/applications/{app_3}/choices", AT, {"programmeId": prog_b})
check("another school's programme cannot be chosen", co == 404, f"({co} {r})")

co, r = call("POST", f"/applications/{app_3}/choices", BT, {"programmeId": prog_b})
check("tenant B cannot add a choice to A's application", co == 404, f"({co} {r})")

co, r = call("GET", f"/applications/{app_3}/choices", AT)
check("list the choices", co == 200 and len(r.get('choices', [])) == 1, f"({co} {r})")

co, r = call("DELETE", f"/applications/{app_3}/choices/{choice_id}", BT)
check("tenant B cannot remove A's choice", co == 404, f"({co} {r})")

co, r = call("DELETE", f"/applications/{app_3}/choices/{choice_id}", AT)
check("remove a choice", co == 200, f"({co} {r})")

# ---------------------------------------------------------------- documents
print("-- documents --")
co, r = call("POST", f"/applications/{app_3}/documents", AT,
             {"kind": "transcript", "label": "Secondary school transcript"})
check("ask for a document", co == 201, f"({co} {r})")
doc_id = r.get('document', {}).get('id') if co == 201 else None
check("a requested document starts awaited",
      co == 201 and r.get('document', {}).get('status') == 'awaited', f"({co} {r})")

co, r = call("POST", f"/applications/{app_3}/documents", AT, {"kind": "id"})
check("a document without a label is refused", co == 400, f"({co} {r})")

# A document is an upload now, identified by the file it produced. fileUrl
# used to be free text: any string at all, including a URL pointing somewhere
# else entirely, shown in the registry as this applicant's transcript.
co, r = call("POST", "/files", AT, None, base="")
upload_cmd = [
    "curl", "-s", "-w", "\n%{http_code}", "--max-time", "25", "-X", "POST",
    "-H", f"Authorization: Bearer {AT}",
    "-F", "file=@/dev/stdin;filename=t.pdf;type=application/pdf",
    "-F", "category=application_document",
    ROOT + "/files",
]
proc = subprocess.run(upload_cmd, input=b"%PDF-1.7\ntrailer\n", capture_output=True)
out = proc.stdout.decode()
txt, _, code = out.rpartition("\n")
uploaded = json.loads(txt) if code.strip() == "201" else {}
file_id = uploaded.get('file', {}).get('id')
check("upload a document file", bool(file_id), f"({code} {txt[:120]})")

co, r = call("POST", f"/applications/{app_3}/documents", AT,
             {"kind": "transcript", "label": "Uploaded transcript", "fileId": file_id})
check("attach a document by the file it produced", co == 201, f"({co} {r})")
check("the URL is derived from the file rather than typed",
      co == 201 and r.get('document', {}).get('file_url') == f"/api/files/{file_id}/download",
      f"({r.get('document', {}).get('file_url')})")
check("and the document points at the file",
      co == 201 and r.get('document', {}).get('file_id') == file_id, f"({r})")
uploaded_doc = r.get('document', {}).get('id') if co == 201 else None

co, r = call("POST", f"/applications/{app_3}/documents", AT,
             {"kind": "x", "label": "Ghost file", "fileId": GHOST})
check("a fileId that names no file is 404", co == 404, f"({co} {r})")

# Both branches of the update, because they bind different parameters and a
# mismatch there only shows at runtime.
co, r = call("PATCH", f"/applications/{app_3}/documents/{uploaded_doc}", AT,
             {"note": "Checked against the original"})
check("updating a document without verifying it works", co == 200, f"({co} {r})")

co, r = call("PATCH", f"/applications/{app_3}/documents/{uploaded_doc}", AT,
             {"status": "verified"})
check("and verifying it works", co == 200, f"({co} {r})")
check("verification records who",
      co == 200 and r.get('document', {}).get('verified_by') is not None, f"({r})")
check("and the file survives the update",
      co == 200 and r.get('document', {}).get('file_id') == file_id, f"({r})")

co, r = call("PATCH", f"/applications/{app_3}/documents/{doc_id}", AT,
             {"status": "received", "fileUrl": f"https://files.e2e.test/{RUN}.pdf"})
check("record a document as received", co == 200, f"({co} {r})")

co, r = call("PATCH", f"/applications/{app_3}/documents/{doc_id}", AT, {"status": "verified"})
check("verify a document", co == 200, f"({co} {r})")
check("verification records who did it",
      co == 200 and r.get('document', {}).get('verified_by') is not None, f"({co} {r})")

co, r = call("PATCH", f"/applications/{app_3}/documents/{doc_id}", BT, {"status": "rejected"})
check("tenant B cannot touch A's document", co == 404, f"({co} {r})")

co, r = call("GET", f"/applications/{app_3}/documents", BT)
check("tenant B cannot list A's documents", co == 404, f"({co} {r})")

co, r = call("DELETE", f"/applications/{app_3}/documents/{doc_id}", AT)
check("remove a document", co == 200, f"({co} {r})")

# ---------------------------------------------------------------- reporting
print("-- reporting --")
co, r = call("GET", f"/intakes/{intake_a}/funnel", AT)
f_ = r.get('funnel', {}) if co == 200 else {}
check("read the intake funnel", co == 200, f"({co} {r})")
check("the funnel counts every application on the intake",
      f_.get('total') == 3, f"({f_.get('total')})")
check("the funnel counts what was enrolled", f_.get('enrolled') == 1, f"({f_})")
check("the funnel reports a yield rate", f_.get('yieldRate') is not None, f"({f_})")

co, r = call("GET", f"/intakes/{intake_a}/funnel", BT)
check("tenant B cannot read A's funnel", co == 404, f"({co} {r})")

co, r = call("GET", "/overview", AT)
check("read the admissions overview", co == 200, f"({co} {r})")
check("the overview counts what is waiting to be enrolled",
      co == 200 and isinstance(r.get('readyToEnrol'), int), f"({co} {r})")
check("the overview lists the open intakes",
      co == 200 and any(i['id'] == intake_a for i in r.get('openIntakes', [])), f"({co} {r})")

co, r = call("GET", "/overview", BT)
check("the other school's overview does not count A's applications",
      co == 200 and intake_a not in [i['id'] for i in r.get('openIntakes', [])], f"({co} {r})")

# ------------------------------------------------------------ intake removal
print("-- intake removal --")
co, r = call("DELETE", f"/intakes/{intake_a}", AT)
check("an intake with applications cannot be deleted", co == 409, f"({co} {r})")

co, r = call("POST", "/intakes", AT,
             {"code": f"GONE{RUN}", "name": "Unused", "opensAt": PAST, "closesAt": SOON})
unused = r.get('intake', {}).get('id') if co == 201 else None
co, r = call("DELETE", f"/intakes/{unused}", AT)
check("an unused intake can be deleted", co == 200, f"({co} {r})")
co, r = call("GET", f"/intakes/{unused}", AT)
check("the deleted intake is gone", co == 404, f"({co})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
