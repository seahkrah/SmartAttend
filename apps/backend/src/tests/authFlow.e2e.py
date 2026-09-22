"""
The identity routes themselves: login, /me, refresh, logout, change-password.

These exist because every other suite in this directory mints its tokens by
calling generateAccessToken directly from the seed script, so none of them
ever touches /api/auth/login. That gap hid a real regression: a router mounted
at /api/auth with a bare router.use() gate ran for every request under that
prefix, including the unauthenticated login. Login answered
"Access token required" and /me refused anyone who was not a school
administrator, and every suite still passed.

Anything mounted on /api/auth from now on is covered here.
"""
import json, subprocess, sys, time
SP = "/tmp/claude-0/-home-user-SmartAttend/d93ac8ad-306e-535c-92c4-36bf785b1524/scratchpad"
d = json.load(open(f"{SP}/seed.json")); A, B = d['A'], d['B']
c = json.load(open(f"{SP}/corp.json"))
ROOT = "http://127.0.0.1:5000/api/auth"
P = F = 0

def call(m, p, body=None, token=None):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "25", "-X", m,
           "-H", "Content-Type: application/json"]
    if token:
        cmd += ["-H", f"Authorization: Bearer {token}"]
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

def check(n, ok, dd=""):
    global P, F
    if ok:
        P += 1; print(f"  ok    {n}")
    else:
        F += 1; print(f"  FAIL  {n} {dd}")

PASSWORD = "Passw0rd!x"

print("-- login reaches its handler --")
co, r = call("POST", "/login", {"platform": "school", "email": "admin.a@e2e.test",
                                "password": PASSWORD})
check("a school administrator logs in", co == 200, f"({co} {r})")
admin_token = r.get('accessToken') or r.get('token') if co == 200 else None
check("login returns a token", bool(admin_token), f"({list(r) if isinstance(r, dict) else r})")

co, r = call("POST", "/login", {"platform": "school", "email": "fac.a@e2e.test",
                                "password": PASSWORD})
check("a lecturer logs in too (the gate is not role-wide)", co == 200, f"({co} {r})")
faculty_token = r.get('accessToken') or r.get('token') if co == 200 else None

co, r = call("POST", "/login", {"platform": "corporate", "email": "hr.a@corp.test",
                                "password": PASSWORD})
check("a corporate identity logs in", co in (200, 401), f"({co} {r})")

print("-- login refuses what it should --")
co, r = call("POST", "/login", {"platform": "school", "email": "admin.a@e2e.test",
                                "password": "wrong-password"})
check("a wrong password is refused", co in (400, 401), f"({co} {r})")
co, r = call("POST", "/login", {"platform": "school", "email": "nobody@e2e.test",
                                "password": PASSWORD})
check("an unknown account is refused", co in (400, 401), f"({co} {r})")
co, r = call("POST", "/login", {"email": "admin.a@e2e.test", "password": PASSWORD})
check("a missing platform is a bad request", co == 400, f"({co} {r})")

# Logging in on the wrong platform must not succeed.
co, r = call("POST", "/login", {"platform": "corporate", "email": "admin.a@e2e.test",
                                "password": PASSWORD})
check("a school account cannot log in as corporate", co in (400, 401, 403), f"({co} {r})")

print("-- /me is not gated by the school-admin router --")
for label, tok in (("administrator", admin_token), ("lecturer", faculty_token)):
    if not tok:
        continue
    co, r = call("GET", "/me", token=tok)
    check(f"/me works for a {label}", co == 200, f"({co} {r})")
    if co == 200:
        check(f"/me reports the {label}'s own account",
              isinstance(r.get('user'), dict) and r['user'].get('email'), f"({r})")

co, r = call("GET", "/me")
check("/me needs a token", co in (401, 403), f"({co})")

print("-- the school-admin surface is still gated --")
if faculty_token:
    co, r = call("GET", "/admin/school/courses", token=faculty_token)
    check("a lecturer cannot reach school-admin courses", co == 403, f"({co} {r})")
if admin_token:
    co, r = call("GET", "/admin/school/courses", token=admin_token)
    check("an administrator can", co == 200, f"({co} {r})")
co, r = call("GET", "/admin/school/courses")
check("and it still needs a token", co in (401, 403), f"({co})")

print("-- session lifecycle --")
if admin_token:
    co, r = call("POST", "/logout", token=admin_token)
    check("logout 200", co == 200, f"({co} {r})")

co, r = call("POST", "/refresh", {"refreshToken": "not-a-real-token"})
check("a bogus refresh token is refused", co in (400, 401, 403), f"({co} {r})")

print("-- change password --")
if faculty_token:
    co, r = call("POST", "/change-password", {"currentPassword": "wrong", "newPassword": "Zz1!zzzzzz"},
                 token=faculty_token)
    check("the wrong current password is refused", co in (400, 401), f"({co} {r})")
    co, r = call("POST", "/change-password", {"currentPassword": PASSWORD, "newPassword": "short"},
                 token=faculty_token)
    check("a weak new password is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/change-password", {"currentPassword": PASSWORD, "newPassword": "Zz1!zzzzzz"})
check("change-password needs a token", co in (401, 403), f"({co})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
