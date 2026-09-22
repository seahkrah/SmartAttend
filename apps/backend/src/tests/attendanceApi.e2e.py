import json, subprocess, sys
SP="/tmp/claude-0/-home-user-SmartAttend/d93ac8ad-306e-535c-92c4-36bf785b1524/scratchpad"
c=json.load(open(f"{SP}/corp.json")); A,B=c['A'],c['B']
BASE="http://127.0.0.1:5000/api/attendance"
P=F=0
def call(m,p,t,body=None):
    cmd=["curl","-s","-w","\n%{http_code}","--max-time","20","-X",m,
         "-H",f"Authorization: Bearer {t}","-H","Content-Type: application/json",BASE+p]
    if body is not None: cmd+=["-d",json.dumps(body)]
    o=subprocess.run(cmd,capture_output=True,text=True).stdout
    txt,_,code=o.rpartition("\n")
    try: parsed=json.loads(txt)
    except Exception: parsed=txt
    return int(code),parsed
def check(n,ok,d=""):
    global P,F
    if ok: P+=1; print(f"  ok    {n}")
    else: F+=1; print(f"  FAIL  {n} {d}")

EMP=A['empToken']; HR=A['token']; HRB=B['token']

print("-- self-service, as an employee --")
co,r=call("GET","/profile",EMP); check("profile 200", co==200, f"({co} {r})")
if co==200:
    check("profile is own identity", r.get('email','').startswith('emp1.a@'), f"({r.get('email')})")
    check("role resolved", r.get('role')=='EMPLOYEE', f"({r.get('role')})")
co,r=call("PUT","/profile",EMP,{"phone":"0777-000","name":"Emp1 Alpha"}); check("profile update 200", co==200, f"({co} {r})")
co,r=call("PUT","/profile",EMP,{"email":"hacker@x.test","role":"ADMIN"}); check("cannot change email/role", co==400, f"({co} {r})")
co,r=call("GET","/me/metrics",EMP); check("me/metrics 200", co==200, f"({co} {r})")
if co==200: check("metrics reflect own check-ins", r.get('present',0)>0, f"({r})")
co,r=call("GET","/me/courses",EMP); check("me/courses refused on EMS", co==403, f"({co})")
co,r=call("GET","/me/discrepancies",EMP); check("discrepancies 200", co==200 and isinstance(r,list), f"({co} {r})")
co,r=call("POST","/me/discrepancies",EMP,{"date_of_class":"2026-09-01","reported_status":"PRESENT","description":"I was on site that day"})
check("create discrepancy 201", co==201, f"({co} {r})")
co,r=call("POST","/me/discrepancies",EMP,{"date_of_class":"nope","reported_status":"PRESENT","description":"xxxxx"})
check("rejects bad date", co==400, f"({co})")
co,r=call("GET","/me/discrepancies",EMP); check("own report visible", co==200 and len(r)>=1 and all(x["status"]=="OPEN" for x in r), f"({len(r) if isinstance(r,list) else r})")
co,r=call("GET","/me/export?format=CSV",EMP); check("export CSV 200", co==200 and 'date,context' in str(r), f"({co})")
co,r=call("GET","/me/export?format=PDF",EMP); check("PDF refused 415", co==415, f"({co})")

print("\n-- self-service cannot widen --")
co,r=call("GET","/department/all",EMP); check("employee refused department view", co==403, f"({co})")
co,r=call("GET",f"/employees/{A['empId']}",EMP); check("employee refused employee view", co==403, f"({co})")

print("\n-- department views, as HR --")
co,r=call("GET","/department/all",HR); check("department/all 200", co==200, f"({co} {r})")
if co==200 and isinstance(r,list): check("only own departments", [d['department'] for d in r]==['Operations A'], f"({r})")
co,r=call("GET",f"/employees/{A['empId']}",HR); check("own employee 200", co==200, f"({co})")
co,r=call("GET",f"/employees/{B['employees'][0]}",HR); check("B employee 404", co==404, f"({co})")
co,r=call("GET",f"/employees/{A['empId']}",HRB); check("B HR cannot read A employee", co==404, f"({co})")
co,r=call("GET","/department/export?format=CSV",HR); check("department export 200", co==200 and 'department,name' in str(r), f"({co})")
check("export excludes B", 'emp1.b@c2e.test' not in str(r))
co,r=call("POST","/notifications/send",HR,{"member_ids":[B['employees'][0]],"message":"cross tenant"})
check("cannot notify B member", co==404, f"({co})")
co,r=call("POST","/notifications/send",HR,{"member_ids":[A['empId']],"message":"Please check in"})
check("notifies own member", co==200, f"({co} {r})")

print(f"\n{P} passed, {F} failed")
sys.exit(0 if F==0 else 1)
