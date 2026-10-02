"""
The device list, remote sign-out, and step-up for sensitive actions.

A person sees their signed-in devices and can end any of them; an ended
device is signed out on its next request, not when its token expires. Nobody
can end another person's session.

Step-up: sensitive actions (opening break-glass, appointing administrators,
handing over a setup link, resetting someone's access) need the session to
have proved who it is within the last few minutes. The e2e environment sets
a long window so the other suites' seeded sessions keep working; this suite
ages its own session in the database to see the refusal.
"""
import base64, json, os, subprocess, urllib.parse

from support.psql import psql

SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
s = json.load(open(f"{SP}/seed.json")); A, B = s['A'], s['B']
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
DB = os.environ.get("DATABASE_URL", "postgresql://jjelo@127.0.0.1:55432/jjelotech_dev")
PASSWORD = "Passw0rd!x"
SA_EMAIL, SA_PASSWORD = "root@sa2e.test", "E2e-Superadmin-1!"
P = F = 0


def call(m, p, t=None, body=None):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "30", "-X", m, "-H", "Content-Type: application/json"]
    if t:
        cmd += ["-H", f"Authorization: Bearer {t}"]
    cmd.append(ROOT + p)
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    o = subprocess.run(cmd, capture_output=True, text=True).stdout
    txt, _, code = o.rpartition("\n")
    try:
        return int(code), json.loads(txt)
    except Exception:
        return int(code or 0), txt


def check(n, ok, dd=""):
    global P, F
    if ok:
        P += 1; print(f"  ok    {n}")
    else:
        F += 1; print(f"  FAIL  {n} {dd}")


def sid_of(token):
    part = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))["sid"]


def sign_in(email, password, path="/auth/login", platform="school"):
    body = {"email": email, "password": password}
    if path == "/auth/login":
        body["platform"] = platform
    co, r = call("POST", path, body=body)
    assert co == 200, (co, r)
    return r["accessToken"], r["refreshToken"]


def age(token, minutes=24 * 60):
    q = psql(DB, f"UPDATE auth_sessions SET authenticated_at = CURRENT_TIMESTAMP - INTERVAL '{int(minutes)} minutes' "
                 f"WHERE id = '{sid_of(token)}'")
    assert q.returncode == 0, q.stderr


print("-- the device list --")
d1, _ = sign_in("fac.a@e2e.test", PASSWORD)
d2, r2 = sign_in("fac.a@e2e.test", PASSWORD)
co, r = call("GET", "/auth/sessions", d1)
ids = [x["id"] for x in r.get("sessions", [])] if co == 200 else []
check("a person sees their signed-in devices", co == 200 and sid_of(d1) in ids and sid_of(d2) in ids, f"({co} {r})")
mine = [x for x in r.get("sessions", []) if x.get("current")]
check("the device asking is marked as this one", len(mine) == 1 and mine[0]["id"] == sid_of(d1), str(mine))
check("no token or hash is in the list", "Token" not in json.dumps(r) and "hash" not in json.dumps(r).lower())

print("-- remote sign-out --")
co, r = call("DELETE", f"/auth/sessions/{sid_of(d2)}", d1)
check("one device signs another out", co == 200, f"({co} {r})")
co, _ = call("GET", "/auth/me", d2)
check("that device is refused at once, not when its token expires", co == 401, f"({co})")
co, _ = call("POST", "/auth/refresh", body={"refreshToken": r2})
check("and cannot refresh", co == 401, f"({co})")
co, _ = call("GET", "/auth/me", d1)
check("the device that did it stays signed in", co == 200)

other = psql(DB, "SELECT s.id FROM auth_sessions s JOIN users u ON u.id = s.user_id "
                 "WHERE u.email = 'admin.b@e2e.test' AND s.revoked_at IS NULL LIMIT 1").stdout.strip()
if not other:
    tb, _ = sign_in("admin.b@e2e.test", PASSWORD)
    other = sid_of(tb)
co, r = call("DELETE", f"/auth/sessions/{other}", d1)
check("another person's session reads as missing", co == 404, f"({co} {r})")
live = psql(DB, f"SELECT revoked_at IS NULL FROM auth_sessions WHERE id = '{other}'").stdout.strip()
check("and is still live", live == "t", live)
for bad in ["00000000-0000-0000-0000-000000000000", "not-a-uuid", "' OR 1=1 --"]:
    co, _ = call("DELETE", "/auth/sessions/" + urllib.parse.quote(bad, safe=""), d1)
    check(f"ending {bad!r} reads as missing", co == 404, f"({co})")

print("-- step-up --")
sa, _ = sign_in(SA_EMAIL, SA_PASSWORD, path="/auth/login-superadmin")
grant = {"tenantId": A['tenantId'], "reason": "Step-up test: confirming break-glass needs a recent sign-in", "minutes": 5}
psql(DB, "UPDATE break_glass_grants SET closed_at = CURRENT_TIMESTAMP "
         f"WHERE superadmin_id = (SELECT id FROM users WHERE email = '{SA_EMAIL}') AND closed_at IS NULL")
age(sa)
co, r = call("POST", "/superadmin/break-glass", sa, grant)
check("break-glass from a session that signed in a day ago: refused", co == 403 and r.get("code") == "STEP_UP_REQUIRED", f"({co} {r})")
co, r = call("POST", "/auth/step-up", sa, {"password": "wrong-" + SA_PASSWORD})
check("step-up with a wrong password: refused", co == 403 and r.get("code") == "STEP_UP_FAILED", f"({co} {r})")
co, r = call("POST", "/auth/step-up", sa, {"code": "123456"})
check("with a code when two-factor is off: refused", co == 403 and r.get("code") == "STEP_UP_FAILED", f"({co} {r})")
co, r = call("POST", "/auth/step-up", sa, {})
check("with nothing: refused", co == 400, f"({co} {r})")
co, r = call("POST", "/superadmin/break-glass", sa, grant)
check("still refused after failed step-ups", co == 403 and r.get("code") == "STEP_UP_REQUIRED", f"({co} {r})")
co, r = call("POST", "/auth/step-up", sa, {"password": SA_PASSWORD})
check("step-up with the password", co == 200 and r.get("steppedUp") is True, f"({co} {r})")
co, r = call("POST", "/superadmin/break-glass", sa, grant)
check("then break-glass opens", co in (200, 201), f"({co} {r})")
gid = (r.get("grant") or r).get("id") if isinstance(r, dict) else None
if gid:
    call("POST", f"/superadmin/break-glass/{gid}/close", sa, {})

# A tenant administrator handing over a setup link needs it too; an emailed
# invitation does not. fac.a has signed in, so a permitted invitation
# answers 409, which is fine: the point is what the step-up gate says.
adm, _ = sign_in("admin.a@e2e.test", PASSWORD)
fac = psql(DB, "SELECT id FROM users WHERE email = 'fac.a@e2e.test'").stdout.strip()
age(adm)
co, r = call("POST", f"/auth/admin/school/users/{fac}/invitation", adm, {"handover": True})
check("a handed-over setup link from an aged session: refused", co == 403 and r.get("code") == "STEP_UP_REQUIRED", f"({co} {r})")
co, r = call("POST", f"/auth/admin/school/users/{fac}/invitation", adm, {})
check("an emailed invitation is not held up by step-up", not (co == 403 and isinstance(r, dict) and r.get("code") == "STEP_UP_REQUIRED"), f"({co} {r})")
co, r = call("POST", f"/auth/admin/school/users/{fac}/reset-access", adm, {})
check("resetting someone's access from an aged session: refused", co == 403 and r.get("code") == "STEP_UP_REQUIRED", f"({co} {r})")

co, _ = call("POST", "/auth/logout", sa, {})
co, r = call("POST", "/auth/step-up", sa, {"password": SA_PASSWORD})
check("a signed-out session cannot step up", co == 401, f"({co} {r})")

# Last, and as the superadmin: it ends every one of that person's sessions,
# and the suites that run after this one use the seeded school and company
# sessions, never the superadmin's.
print("-- signing out everywhere --")
e1, _ = sign_in(SA_EMAIL, SA_PASSWORD, path="/auth/login-superadmin")
e2, _ = sign_in(SA_EMAIL, SA_PASSWORD, path="/auth/login-superadmin")
co, r = call("POST", "/auth/logout-all", e1, {})
check("signs out every device", co == 200 and r.get("sessionsEnded", 0) >= 2, f"({co} {r})")
for name, t in (("this one", e1), ("and the others", e2)):
    co, _ = call("GET", "/auth/me", t)
    check(f"{name} too", co == 401, f"({co})")

print(f"\n{P} passed, {F} failed")
raise SystemExit(1 if F else 0)
