import json, subprocess, sys
import os
SP = os.environ.get("E2E_FIXTURE_DIR",
                    os.path.join(os.getcwd(), ".e2e-fixtures"))
d=json.load(open(f"{SP}/seed.json")); A,B=d['A'],d['B']
BASE="http://127.0.0.1:5000/api/admin"
P=F=0
def call(method, path, token, body=None):
    cmd=["curl","-s","-w","\\n%{http_code}","--max-time","15","-X",method,
         "-H",f"Authorization: Bearer {token}","-H","Content-Type: application/json",BASE+path]
    if body is not None: cmd+=["-d",json.dumps(body)]
    out=subprocess.run(cmd,capture_output=True,text=True).stdout
    txt,_,code=out.rpartition("\n")
    try: parsed=json.loads(txt)
    except Exception: parsed=txt
    return int(code), parsed
def check(name, ok, detail=""):
    global P,F
    if ok: P+=1; print(f"  ok    {name}")
    else: F+=1; print(f"  FAIL  {name} {detail}")

print("-- happy path, Tenant A --")
c,r=call("GET","/analytics",A['token']); check("analytics 200", c==200, f"({c} {r})")
if c==200: check("analytics tenant-scoped", r.get('total_users',0)>=3 and r.get('faculty_count')==1 and r.get('total_courses',0)>=1, f"({r})")
c,r=call("GET","/users",A['token']); check("users 200", c==200, f"({c} {r})")
emails=sorted(u['email'] for u in (r.get('data') or [])) if c==200 else []
check("A sees only its own users", len(emails)>0 and all(e.endswith(".a@e2e.test") for e in emails), f"({emails})")
c,r=call("GET","/courses",A['token']); check("courses 200", c==200, f"({c} {r})")
codes=[x['code'] for x in (r.get('data') or [])] if c==200 else []
check("A sees only its own course", "CSC-A" in codes and not any(c.endswith("-B") for c in codes), f"({codes})")

print("\n-- cross-tenant attempts from A against B --")
c,r=call("PUT",f"/courses/{B['courseId']}",A['token'],{"name":"Hijacked"}); check("cannot update B course", c==404, f"({c} {r})")
c,r=call("PUT",f"/courses/{A['courseId']}/assign-faculty",A['token'],{"faculty_id":B['facultyId']}); check("cannot attach B faculty", c==404, f"({c} {r})")
c,r=call("POST","/courses",A['token'],{"name":"Probe Course","code":"PRB1","semester":B['semId']}); check("cannot use B semester", c==404, f"({c} {r})")
c,r=call("GET","/users",B['token'])
bemails=sorted(u['email'] for u in (r.get('data') or [])) if c==200 else []
check("B sees only its own users", len(bemails)>0 and all(e.endswith(".b@e2e.test") for e in bemails), f"({bemails})")

print("\n-- ownership is server-assigned --")
c,r=call("POST","/courses",A['token'],{"name":"Owned","code":"OWN1","semester":A['semId'],"tenant_id":B['tenantId']})
check("create course", c in (201,409), f"({c} {r})")
c2,r2=call("GET","/courses",B['token'])
bcodes=[x['code'] for x in (r2.get('data') or [])]
check("new course invisible to B", 'OWN1' not in bcodes, f"({bcodes})")

print("\n-- user creation + validation --")
c,r=call("POST","/users",A['token'],{"email":"bad","name":"X","role":"STUDENT"}); check("rejects bad email", c==400, f"({c})")
c,r=call("POST","/users",A['token'],{"email":"esc@e2e.test","name":"Esc","role":"ADMIN"}); check("refuses admin escalation", c==403, f"({c})")
c,r=call("POST","/users",A['token'],{"email":"new.a@e2e.test","name":"New A","role":"STUDENT"}); check("creates user", c in (201,409), f"({c} {r})")
check("returns temporary password", c==409 or (isinstance(r,dict) and 'temporary_password' in r), f"({list(r) if isinstance(r,dict) else r})")
newid = r.get('id') if isinstance(r,dict) and c==201 else None
c,r=call("POST","/users",A['token'],{"email":"new.a@e2e.test","name":"Dup","role":"STUDENT"}); check("duplicate email 409", c==409, f"({c})")
c,r=call("GET","/users",B['token'])
check("new A user invisible to B", 'new.a@e2e.test' not in str(r))
if newid:
    c,r=call("PUT",f"/users/{newid}",B['token'],{"name":"Hacked"}); check("B cannot update A user", c==404, f"({c})")
    c,r=call("DELETE",f"/users/{newid}",B['token']); check("B cannot delete A user", c==404, f"({c})")
    c,r=call("PUT",f"/users/{newid}",A['token'],{"name":"Renamed"}); check("A can update own user", c==200, f"({c} {r})")
    c,r=call("DELETE",f"/users/{newid}",A['token']); check("A can remove own user", c==200, f"({c})")

print("\n-- bulk import --")
c,r=call("POST","/users/bulk-import",A['token'],{"csv":chr(10).join(["email,name,role","bi1.a@e2e.test,Bulk One,STUDENT","bad,Bad Row,STUDENT","bi2.a@e2e.test,Bulk Two,ADMIN"])})
check("partial import 207", c==207, f"({c} {r})")
check("one imported, two rejected", isinstance(r,dict) and r.get('imported')==1 and r.get('failed')==2, f"({r})")

print("\n-- approvals, export, authz --")
c,r=call("GET","/approvals/pending",A['token']); check("approvals 200", c==200 and isinstance(r,list), f"({c})")
c,r=call("POST","/approvals/approve",A['token'],{"approval_id":"00000000-0000-0000-0000-000000000000"}); check("unknown approval 404", c==404, f"({c})")
c,r=call("POST","/approvals/reject",A['token'],{"approval_id":"00000000-0000-0000-0000-000000000000"}); check("reject without reason 400", c==400, f"({c})")
c,r=call("GET","/export/tenant-report?format=PDF",A['token']); check("PDF refused 415", c==415, f"({c})")
c,r=call("GET","/export/tenant-report?format=CSV",A['token']); check("CSV export 200", c==200 and 'email,name,role' in str(r), f"({c})")
check("export excludes B users", 'admin.b@e2e.test' not in str(r))
c,r=call("GET","/analytics","garbage"); check("bad token 401", c==401, f"({c})")
c,r=call("GET","/analytics",A['token'].replace('.','.x',1)); check("tampered token 401", c==401, f"({c})")

print(f"\n{P} passed, {F} failed")
sys.exit(0 if F==0 else 1)
