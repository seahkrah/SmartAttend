import json, subprocess, sys
import os
SP = os.environ.get("E2E_FIXTURE_DIR",
                    os.path.join(os.getcwd(), ".e2e-fixtures"))
c=json.load(open(f"{SP}/corp.json")); A,B=c['A'],c['B']
s=json.load(open(f"{SP}/seed.json")); SCHOOL=s['A']       # a school admin token
BASE="http://127.0.0.1:5000/api/hr"
P=F=0
def call(method, path, token, body=None, base=BASE):
    cmd=["curl","-s","-w","\n%{http_code}","--max-time","20","-X",method,
         "-H",f"Authorization: Bearer {token}","-H","Content-Type: application/json",base+path]
    if body is not None: cmd+=["-d",json.dumps(body)]
    out=subprocess.run(cmd,capture_output=True,text=True).stdout
    txt,_,code=out.rpartition("\n")
    try: parsed=json.loads(txt)
    except Exception: parsed=txt
    return int(code), parsed
def check(n, ok, d=""):
    global P,F
    if ok: P+=1; print(f"  ok    {n}")
    else: F+=1; print(f"  FAIL  {n} {d}")

print("-- platform isolation --")
co,r=call("GET","/overview",SCHOOL['token']); check("school identity refused from EMS", co==403, f"({co} {r})")

print("\n-- overview / metrics --")
co,r=call("GET","/overview",A['token']); check("overview 200", co==200, f"({co} {r})")
if co==200:
    check("headcount is tenant-scoped", r.get('total_members')==3, f"({r})")
    check("bands computed", r.get('chronic_absentees',0)>=1, f"({r})")
co,r=call("GET","/departments/metrics",A['token']); check("dept metrics 200", co==200, f"({co} {r})")
names=[d['name'] for d in r] if co==200 and isinstance(r,list) else []
check("only own departments", names==['Operations A'], f"({names})")

print("\n-- members --")
co,r=call("GET","/members",A['token']); check("members 200", co==200, f"({co} {r})")
mails=sorted(m['email'] for m in (r.get('data') or [])) if co==200 else []
check("only own employees", all(e.endswith('.a@c2e.test') for e in mails) and len(mails)==3, f"({mails})")
co,r=call("GET",f"/members/{B['employees'][0]}",A['token']); check("cannot read B employee", co==404, f"({co})")
co,r=call("GET",f"/members/{A['employees'][0]}",A['token']); check("can read own employee", co==200, f"({co})")

print("\n-- patterns / compliance --")
co,r=call("GET","/patterns",A['token']); check("patterns 200", co==200 and isinstance(r,list), f"({co} {r})")
if co==200: check("detects an absentee", any(p['pattern']!='NONE' for p in r), f"({r})")
co,r=call("GET","/compliance/summary",A['token']); check("compliance 200", co==200, f"({co} {r})")
if co==200: check("compliance scoped", r.get('headcount')==3, f"({r})")

print("\n-- campaigns --")
co,r=call("POST","/campaigns",A['token'],{"name":"Nudge","criteria":"BAD","message_template":"hello there"})
check("rejects unknown criteria", co==400, f"({co})")
co,r=call("POST","/campaigns",A['token'],{"name":"Nudge A","criteria":"NO_ACTIVITY_30DAYS","message_template":"Please check in"})
check("creates campaign 201", co==201, f"({co} {r})")
cid = r.get('id') if isinstance(r,dict) else None
check("recipients resolved server-side", isinstance(r,dict) and len(r.get('recipients',[]))>=1, f"({r.get('recipients') if isinstance(r,dict) else r})")
co,r=call("GET","/campaigns",B['token'])
check("B cannot see A campaign", co==200 and all(x['name']!='Nudge A' for x in (r.get('data') or [])), f"({r})")
if cid:
    co,r=call("POST",f"/campaigns/{cid}/send",B['token']); check("B cannot send A campaign", co==404, f"({co})")
    co,r=call("DELETE",f"/campaigns/{cid}",B['token']); check("B cannot cancel A campaign", co==404, f"({co})")
    co,r=call("POST",f"/campaigns/{cid}/send",A['token']); check("A sends own campaign", co==200, f"({co} {r})")
    sent = r.get('sent_count') if isinstance(r,dict) else 0
    check("delivered to >=1 recipient", sent>=1, f"({sent})")
    co,r=call("POST",f"/campaigns/{cid}/send",A['token']); check("resend refused 409", co==409, f"({co})")
    co,r=call("DELETE",f"/campaigns/{cid}",A['token']); check("cancel after send refused 409", co==409, f"({co})")

print("\n-- direct notifications --")
co,r=call("POST","/notifications/send",A['token'],{"member_ids":[B['employees'][0]],"message":"cross tenant attempt"})
check("cannot notify B employee", co==404, f"({co} {r})")
co,r=call("POST","/notifications/send",A['token'],{"member_ids":[A['employees'][0], B['employees'][0]],"message":"mixed list"})
check("mixed list refused entirely", co==404, f"({co})")
co,r=call("POST","/notifications/send",A['token'],{"member_ids":[A['employees'][0]],"message":"Please check in tomorrow"})
check("notifies own employee", co==200 and r.get('sent_count')==1, f"({co} {r})")
co,r=call("POST","/notifications/send",A['token'],{"member_ids":[],"message":"x"}); check("empty list 400", co==400, f"({co})")

print("\n-- export --")
co,r=call("GET","/export/organization-report?format=XLSX",A['token']); check("XLSX refused 415", co==415, f"({co})")
co,r=call("GET","/export/organization-report?format=CSV",A['token']); check("CSV 200", co==200 and 'name,email' in str(r), f"({co})")
check("export excludes B employees", 'emp1.b@c2e.test' not in str(r))

print(f"\n{P} passed, {F} failed")
sys.exit(0 if F==0 else 1)
