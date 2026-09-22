"""Cross-tenant checks for the pre-existing corporate router.

These routes scoped by platform_id and called it tenant scoping. GET
/corporate/departments returned every employer's departments to every
employer. This suite pins the fix.
"""
import json, subprocess, sys
SP="/tmp/claude-0/-home-user-SmartAttend/d93ac8ad-306e-535c-92c4-36bf785b1524/scratchpad"
c=json.load(open(f"{SP}/corp.json")); A,B=c['A'],c['B']
P=F=0
def req(method, path, token, body=None):
    cmd=["curl","-s","-w","\n%{http_code}","--max-time","20","-X",method,
         "-H",f"Authorization: Bearer {token}","-H","Content-Type: application/json","http://127.0.0.1:5000/api"+path]
    if body: cmd+=["-d",json.dumps(body)]
    o=subprocess.run(cmd,capture_output=True,text=True).stdout
    t,_,code=o.rpartition("\n"); return int(code), t
def check(n,ok,d=""):
    global P,F
    if ok: P+=1; print(f"  ok    {n}")
    else: F+=1; print(f"  FAIL  {n} {d}")

code, body = req("GET","/corporate/departments",A['token'])
check("departments 200", code==200, f"({code})")
check("A sees own department", "Operations A" in body)
check("B department not visible", "Operations B" not in body, "*** LEAK ***")
code, body = req("GET","/corporate/departments",B['token'])
check("B sees own only", "Operations B" in body and "Operations A" not in body)

code, body = req("GET","/corporate/employees",A['token'])
check("employees 200", code==200, f"({code})")
check("A employees only", "emp1.a@c2e.test" in body and "emp1.b@c2e.test" not in body)
code, _ = req("GET",f"/corporate/employees/{B['employees'][0]}",A['token'])
check("B employee by id is 404", code==404, f"({code})")
code, _ = req("GET",f"/corporate/employees/{A['employees'][0]}",A['token'])
check("own employee by id is 200", code==200, f"({code})")

code, _ = req("PUT",f"/corporate/departments/{B['deptId']}",A['token'],{"name":"Hijacked"})
check("cannot rename B department", code==404, f"({code})")
code, _ = req("DELETE",f"/corporate/departments/{B['deptId']}",A['token'])
check("cannot delete B department", code==404, f"({code})")
code, body = req("GET","/corporate/departments",B['token'])
check("B department intact", "Operations B" in body and "Hijacked" not in body)

# identifier namespaces are per tenant
code, body = req("POST","/corporate/departments",A['token'],{"name":"Operations B","code":"OPSB"})
check("A may reuse B's name and code", code==201, f"({code} {body[:120]})")
newid = json.loads(body).get('id') if code==201 else None
code, _ = req("POST","/corporate/departments",A['token'],{"name":"Operations B"})
check("still unique within A", code==409, f"({code})")
if newid: req("DELETE",f"/corporate/departments/{newid}",A['token'])

print(f"\n{P} passed, {F} failed")
sys.exit(0 if F==0 else 1)
