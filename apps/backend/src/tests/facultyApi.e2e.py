import json, subprocess, sys
import os
SP = os.environ.get("E2E_FIXTURE_DIR",
                    os.path.join(os.getcwd(), ".e2e-fixtures"))
d=json.load(open(f"{SP}/seed.json")); A,B=d['A'],d['B']
c=json.load(open(f"{SP}/corp.json")); HR=c['A']['token']
BASE="http://127.0.0.1:5000/api/faculty"
DATE="2026-09-15"
P=F=0
def call(m,p,t,body=None):
    cmd=["curl","-s","-w","\n%{http_code}","--max-time","25","-X",m,
         "-H",f"Authorization: Bearer {t}","-H","Content-Type: application/json",BASE+p]
    if body is not None: cmd+=["-d",json.dumps(body)]
    o=subprocess.run(cmd,capture_output=True,text=True).stdout
    txt,_,code=o.rpartition("\n")
    try: parsed=json.loads(txt)
    except Exception: parsed=txt
    return int(code),parsed
def check(n,ok,dd=""):
    global P,F
    if ok: P+=1; print(f"  ok    {n}")
    else: F+=1; print(f"  FAIL  {n} {dd}")

FA=A['facToken']; FB=B['facToken']

print("-- platform isolation --")
co,r=call("GET",f"/attendance/draft?course_id={A['courseId']}&date={DATE}",HR)
check("EMS identity refused from SMS", co==403, f"({co} {r})")

print("-- draft --")
co,r=call("GET",f"/attendance/draft?course_id={A['courseId']}&date={DATE}",FA)
check("draft 200", co==200, f"({co} {r})")
if co==200:
    check("roster is tenant-scoped", r.get('roster_count')==2, f"({r.get('roster_count')})")
    check("starts as DRAFT", r.get('status')=='DRAFT', f"({r.get('status')})")
    check("editable", r.get('editable') is True)
co,r=call("GET",f"/attendance/draft?course_id={B['courseId']}&date={DATE}",FA)
check("cannot draft B course", co==404, f"({co})")
co,r=call("GET",f"/attendance/draft?course_id={A['courseId']}&date=nope",FA)
check("rejects bad date", co==400, f"({co})")

print("-- bulk edit --")
co,r=call("POST","/attendance/bulk-edit",FA,{"course_id":A['courseId'],"date":DATE,"action":"MARK_ALL_PRESENT"})
check("bulk mark present", co==200 and r.get('affected_count')==2, f"({co} {r})")
co,r=call("POST","/attendance/bulk-edit",FA,{"course_id":B['courseId'],"date":DATE,"action":"MARK_ALL_PRESENT"})
check("cannot bulk-edit B course", co==404, f"({co})")
co,r=call("POST","/attendance/bulk-edit",FA,{"course_id":A['courseId'],"date":DATE,"action":"NUKE"})
check("rejects unknown action", co==400, f"({co})")
co,r=call("GET",f"/attendance/draft?course_id={A['courseId']}&date={DATE}",FA)
check("marks visible in draft", co==200 and r.get('marked_count')==2, f"({r.get('marked_count')})")

print("-- facial match --")
# This route used to take a "confidence" number from the client and, above
# 0.85, write the student present and face-verified. The real flow (identify,
# then cite the match) is in faceMatchingApi; here, what must be refused.
co,r=call("POST","/attendance/facial-match",FA,{"course_id":A['courseId'],"date":DATE,"student_id":A['students'][0],"confidence":0.97})
check("a confidence number from the client is not a face match", co==400 and 'face_match_id' in str(r), f"({co} {r})")
co,r=call("POST","/attendance/facial-match",FA,{"course_id":A['courseId'],"date":DATE,"student_id":A['students'][0],
                                                "face_match_id":"00000000-0000-4000-8000-000000000000"})
check("a made-up match id is refused", co==409 and r.get('code')=='match_unusable', f"({co} {r})")
co,r=call("POST","/attendance/facial-match",FA,{"course_id":A['courseId'],"date":DATE,"student_id":B['students'][0],
                                                "face_match_id":"00000000-0000-4000-8000-000000000000"})
check("cannot mark B student", co==404, f"({co})")

print("-- qr code --")
co,r=call("GET",f"/courses/{A['courseId']}/qr-code?date={DATE}",FA)
check("qr 200", co==200 and 'qr_code_data' in str(r), f"({co} {r})")
check("qr carries session + expiry", isinstance(r,dict) and r.get('session_id') and r.get('expires_at'), f"({r})")
co,r=call("GET",f"/courses/{B['courseId']}/qr-code",FA); check("cannot qr B course", co==404, f"({co})")

print("-- submit / lock lifecycle --")
co,r=call("POST","/attendance/lock",FA,{"course_id":A['courseId'],"date":DATE})
check("cannot lock before submit", co==409, f"({co} {r})")
co,r=call("POST","/attendance/submit",FA,{"course_id":A['courseId'],"date":DATE})
check("submit 200", co==200 and r.get('status')=='SUBMITTED', f"({co} {r})")
co,r=call("POST","/attendance/submit",FB,{"course_id":A['courseId'],"date":DATE})
check("B faculty cannot submit A register", co==404, f"({co})")
co,r=call("POST","/attendance/lock",FA,{"course_id":A['courseId'],"date":DATE})
check("lock 200", co==200 and r.get('status')=='LOCKED', f"({co} {r})")
co,r=call("POST","/attendance/lock",FA,{"course_id":A['courseId'],"date":DATE})
check("relock refused 409", co==409, f"({co})")
co,r=call("POST","/attendance/bulk-edit",FA,{"course_id":A['courseId'],"date":DATE,"action":"CLEAR"})
check("locked register refuses edits", co==409, f"({co} {r})")
co,r=call("POST","/attendance/facial-match",FA,{"course_id":A['courseId'],"date":DATE,"student_id":A['students'][0],
                                                "face_match_id":"00000000-0000-4000-8000-000000000000"})
check("locked register refuses facial match", co==409 and 'locked' in str(r).lower(), f"({co} {r})")
co,r=call("GET",f"/attendance/draft?course_id={A['courseId']}&date={DATE}",FA)
check("draft reports locked + not editable", co==200 and r.get('status')=='LOCKED' and r.get('editable') is False, f"({r.get('status')})")

print("-- export --")
co,r=call("GET",f"/attendance/export?course_id={A['courseId']}&format=CSV",FA)
check("export CSV 200", co==200 and 'date,enrollment_id' in str(r), f"({co})")
check("export excludes B students", 'stu1.b@e2e.test' not in str(r))
co,r=call("GET",f"/attendance/export?course_id={A['courseId']}&format=PDF",FA)
check("PDF refused 415", co==415, f"({co})")
co,r=call("GET",f"/attendance/export?course_id={B['courseId']}&format=CSV",FA)
check("cannot export B course", co==404, f"({co})")

print(f"\n{P} passed, {F} failed")
sys.exit(0 if F==0 else 1)
