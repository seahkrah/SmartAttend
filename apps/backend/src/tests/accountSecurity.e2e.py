"""
Accounts and sessions: what signing in, staying signed in, and getting an
account actually guarantee.

  * A session lives on the server. Logout, a password change, a reset, a
    deactivation or a stolen refresh token being replayed ends it at once,
    not when a token happens to expire.
  * Refresh tokens are single use. The one just replaced gets a "retry"
    during a short grace window (two tabs refreshing at once); after that,
    presenting it again ends the session.
  * Sign-in reveals nothing about an account before the password is right,
    and five wrong passwords pause sign-in for that address whether or not
    it exists.
  * Nobody chooses another person's password. Accounts are created with an
    invitation; resets are by emailed link; both links work once, expire,
    and never show up in the outbox an administrator can read.
  * Self-service sign-up waits for an administrator.

Reset and invitation links are read out of the outbox table directly, which
is exactly what an administrator cannot do through the API.
"""
import base64, json, os, re, subprocess, time, uuid
import urllib.request, urllib.error

SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
d = json.load(open(f"{SP}/seed.json")); A, B = d['A'], d['B']
c = json.load(open(f"{SP}/corp.json")); CA, CB = c['A'], c['B']
SU = json.load(open(f"{SP}/superadmin.json"))['token']
API = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
DB = os.environ.get("DATABASE_URL", "postgresql://jjelo@127.0.0.1:55432/jjelotech_dev")
RUN = uuid.uuid4().hex[:8]
P = F = 0

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def call(method, path, body=None, token=None, headers=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers=h)
    try:
        with opener.open(req, timeout=25) as r:
            raw, code, hdrs = r.read().decode(), r.status, r.headers
    except urllib.error.HTTPError as e:
        raw, code, hdrs = e.read().decode(), e.code, e.headers
    try:
        parsed = json.loads(raw) if raw else {}
    except Exception:
        parsed = raw
    return code, parsed, hdrs

def sql(q):
    return subprocess.run(["psql", DB, "-Atc", q], capture_output=True, text=True).stdout.strip()

def check(name, ok, detail=""):
    global P, F
    if ok:
        P += 1; print(f"  ok    {name}")
    else:
        F += 1; print(f"  FAIL  {name} {detail}")

def sid_of(access):
    payload = access.split('.')[1]
    payload += '=' * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))['sid']

def login(email, password, platform="school"):
    return call("POST", "/auth/login", {"platform": platform, "email": email, "password": password})

def outbox_link(event, email, wait=6.0):
    """The newest link of this kind sent to this address, and how many were sent."""
    deadline = time.time() + wait
    while True:
        rows = sql(f"SELECT id || '|' || body FROM notification_messages "
                   f"WHERE event_key = '{event}' AND destination = '{email}' ORDER BY created_at DESC")
        if rows or time.time() > deadline:
            break
        time.sleep(0.3)
    lines = [l for l in rows.split('\n') if l] if rows else []
    if not lines:
        return None, None, 0
    first = sql(f"SELECT id FROM notification_messages WHERE event_key = '{event}' "
                f"AND destination = '{email}' ORDER BY created_at DESC LIMIT 1")
    body = sql(f"SELECT body FROM notification_messages WHERE id = '{first}'")
    m = re.search(r"token=([A-Za-z0-9_-]+)", body)
    count = int(sql(f"SELECT COUNT(*) FROM notification_messages WHERE event_key = '{event}' "
                    f"AND destination = '{email}'"))
    return first, (m.group(1) if m else None), count

GOOD = "a quiet river at dawn " + RUN
BETTER = "the lighthouse keeper " + RUN
ADMIN_A = "admin.a@e2e.test"
FIXTURE_PASSWORD = "Passw0rd!x"

# ---------------------------------------------------------------------------
print("-- invitation: nobody chooses another person's password --")
email = f"invitee.{RUN}@e2e.test"
co, r, _ = call("POST", "/auth/admin/school/users", {"email": email, "fullName": "Ama Invitee", "role": "faculty"}, A['token'])
check("an administrator creates an account", co == 201, f"({co} {r})")
user_id = r.get('userId')
check("no password comes back", not any('password' in k.lower() for k in r), f"({list(r)})")
check("the invitation says how it travels", r.get('invitation', {}).get('delivery') in ('email', 'simulated'), f"({r})")

co, r, _ = login(email, "anything-at-all-123")
check("the new account cannot be signed in to with a guess", co == 401, f"({co} {r})")

co, r, _ = call("GET", "/auth/admin/school/users", None, A['token'])
row = next((u for u in r.get('users', []) if u['id'] == user_id), {})
check("the user list shows the account awaiting setup", row.get('awaitingSetup') is True, f"({row})")

msg_id, token, _ = outbox_link('account.invitation', email)
check("an invitation email is in the outbox with a link", bool(token), f"({msg_id})")
co, r, _ = call("GET", f"/notifications/messages/{msg_id}", None, A['token'])
check("the administrator sees the message was sent", co == 200, f"({co} {r})")
check("but not its link", r.get('message', {}).get('body') is None and r.get('message', {}).get('body_withheld') is True
      and token not in json.dumps(r), f"({str(r)[:200]})")

co, r, _ = call("PUT", "/notifications/templates", {"eventKey": "account.invitation", "channel": "email",
                "subject": "Hi", "body": "Click {{ link }}"}, A['token'])
check("an administrator cannot rewrite the invitation's wording", co == 403, f"({co} {r})")

co, r, _ = call("POST", "/auth/activate", {"token": token, "password": "password123", "confirmPassword": "password123"})
check("activation refuses a common password", co == 400 and r.get('problems'), f"({co} {r})")
co, r, _ = call("POST", "/auth/activate", {"token": token, "password": GOOD, "confirmPassword": GOOD + "x"})
check("activation refuses mismatched passwords", co == 400, f"({co} {r})")
co, r, _ = call("POST", "/auth/activate", {"token": "x" * 43, "password": GOOD, "confirmPassword": GOOD})
check("a made-up link is refused", co == 400, f"({co} {r})")
co, r, _ = call("POST", "/auth/activate", {"token": token, "password": GOOD, "confirmPassword": GOOD})
check("the person chooses their own password", co == 200, f"({co} {r})")
co, r, _ = call("POST", "/auth/activate", {"token": token, "password": BETTER, "confirmPassword": BETTER})
check("the link works once", co == 410, f"({co} {r})")
co, r, _ = login(email, GOOD)
check("they sign in with it", co == 200 and r.get('accessToken'), f"({co} {r})")
invitee_access = r.get('accessToken')

co, r, _ = call("POST", f"/auth/admin/school/users/{user_id}/invitation", {}, A['token'])
check("an account that has been used cannot be re-invited", co == 409, f"({co} {r})")
co, r, _ = call("POST", f"/auth/admin/school/users/{user_id}/invitation", {"handover": True}, B['token'])
check("another school cannot invite this school's user", co == 404, f"({co} {r})")

print("-- invitation: handing over a link when there is no email --")
email2 = f"handover.{RUN}@e2e.test"
co, r, _ = call("POST", "/auth/admin/school/users", {"email": email2, "fullName": "Kofi Handover", "role": "faculty"}, A['token'])
user2 = r.get('userId')
_, emailed_token, _ = outbox_link('account.invitation', email2)
co, r, _ = call("POST", f"/auth/admin/school/users/{user2}/invitation", {"handover": True}, A['token'])
link = r.get('invitation', {}).get('link', '')
check("the administrator can ask for the setup link itself", co == 200 and '/activate?token=' in link, f"({co} {r})")
check("that is audited", sql(f"SELECT COUNT(*) FROM audit_logs WHERE action_type = 'USER_SETUP_LINK_ISSUED' "
                             f"AND resource_id = '{user2}'") == '1')
co, r, _ = call("POST", "/auth/activate", {"token": emailed_token, "password": GOOD, "confirmPassword": GOOD})
check("the earlier emailed link stopped working", co == 410, f"({co} {r})")
handed = link.split('token=')[1]
co, r, _ = call("POST", "/auth/activate", {"token": handed, "password": GOOD, "confirmPassword": GOOD})
check("the handed-over link works", co == 200, f"({co} {r})")
admin_a_id = sql(f"SELECT id FROM users WHERE email = '{ADMIN_A}'")
co, r, _ = call("POST", f"/auth/admin/school/users/{admin_a_id}/invitation", {"handover": True}, A['token'])
check("no setup link for an administrator's account", co in (403, 409), f"({co} {r})")

print("-- invitation: an employer and the platform operator --")
co, r, _ = call("POST", "/corporate/admin/employees", {"firstName": "Yaw", "lastName": "Boateng",
                "email": f"yaw.{RUN}@c2e.test", "phone": "0200000000"}, CA['adminToken'])
check("an employer creates an employee", co == 201, f"({co} {r})")
check("with an invitation, not the old initial-plus-surname-123 password",
      'defaultPassword' not in r and r.get('invitation', {}).get('delivery') in ('email', 'simulated'), f"({r})")
emp_id = r.get('data', {}).get('id')
co, r, _ = call("POST", f"/corporate/admin/employees/{emp_id}/invitation", {"handover": True}, CB['adminToken'])
check("another employer cannot get that employee's setup link", co in (403, 404), f"({co} {r})")
co, r, _ = call("POST", f"/corporate/admin/employees/{emp_id}/invitation", {"handover": True}, CA['adminToken'])
check("the employer can, for handing over in person", co == 200 and '/activate?token=' in r.get('invitation', {}).get('link', ''), f"({co} {r})")
co, r, _ = login(f"yaw.{RUN}@c2e.test", "Yboateng123", platform="corporate")
check("the old predictable password does not work", co == 401, f"({co} {r})")

co, r, _ = call("POST", "/superadmin/tenant-admins", {"tenantId": A['tenantId'], "email": f"head.{RUN}@e2e.test",
                "fullName": "Deputy Head", "handover": True}, SU)
check("the operator appoints a school administrator by setup link", co == 201
      and '/activate?token=' in r.get('invitation', {}).get('link', '') and 'temporaryPassword' not in r, f"({co} {r})")
head_token = r.get('invitation', {}).get('link', '').split('token=')[-1]
co, r, _ = call("POST", "/auth/activate", {"token": head_token, "password": GOOD, "confirmPassword": GOOD})
check("who sets their own password with it", co == 200, f"({co} {r})")
co, r, _ = login(f"head.{RUN}@e2e.test", GOOD)
check("and signs in", co == 200, f"({co} {r})")

# ---------------------------------------------------------------------------
print("-- sessions: refresh rotates, and a replayed token ends the session --")
co, r, _ = login(email, GOOD)
access, refresh = r['accessToken'], r['refreshToken']
check("the refresh token is opaque, not a signed claim", refresh.count('.') == 0 and len(refresh) >= 40, f"({refresh[:20]})")
co, r, _ = call("POST", "/auth/refresh", {"refreshToken": refresh})
check("refresh answers a new pair", co == 200 and r.get('refreshToken') and r['refreshToken'] != refresh, f"({co} {r})")
access2, refresh2 = r.get('accessToken'), r.get('refreshToken')
check("in the same session", sid_of(access2) == sid_of(access))
co, r, _ = call("POST", "/auth/refresh", {"refreshToken": refresh})
check("the replaced token, straight away, is told to retry (two tabs)", co == 409 and r.get('code') == 'REFRESH_RACE', f"({co} {r})")
sql(f"UPDATE auth_sessions SET rotated_at = CURRENT_TIMESTAMP - INTERVAL '5 minutes' WHERE id = '{sid_of(access)}'")
co, r, _ = call("POST", "/auth/refresh", {"refreshToken": refresh})
check("the replaced token, later, ends the session", co == 401, f"({co} {r})")
check("the reason is recorded", sql(f"SELECT revoked_reason FROM auth_sessions WHERE id = '{sid_of(access)}'") == 'refresh_token_reused')
co, r, _ = call("POST", "/auth/refresh", {"refreshToken": refresh2})
check("so the thief's copy and the owner's both stop working", co == 401, f"({co} {r})")
co, r, _ = call("GET", "/auth/me", None, access2)
check("and the access token stops at once, not in fifteen minutes", co == 401, f"({co} {r})")
co, r, _ = call("POST", "/auth/refresh", {"refreshToken": "not-a-token-" + "y" * 40})
check("an unknown refresh token is refused", co == 401, f"({co} {r})")

print("-- sessions: logout, per-device sign-out, expiry --")
co, r, _ = login(email, GOOD); s1 = r['accessToken']; s1r = r['refreshToken']
co, r, _ = login(email, GOOD); s2 = r['accessToken']
co, r, _ = call("GET", "/auth/sessions", None, s1)
ids = [s['id'] for s in r.get('sessions', [])]
check("the person sees their devices", co == 200 and sid_of(s1) in ids and sid_of(s2) in ids, f"({co} {r})")
check("with this one marked", any(s['current'] and s['id'] == sid_of(s1) for s in r.get('sessions', [])))
co, r, _ = call("DELETE", f"/auth/sessions/{sid_of(s2)}", None, A['token'])
check("someone else cannot sign out their device", co == 404, f"({co} {r})")
co, r, _ = call("DELETE", f"/auth/sessions/{sid_of(s2)}", None, s1)
check("they can sign out another device", co == 200, f"({co} {r})")
co, r, _ = call("GET", "/auth/me", None, s2)
check("which is signed out at once", co == 401, f"({co} {r})")
co, r, _ = call("POST", "/auth/logout", None, s1)
check("logout answers", co == 200, f"({co} {r})")
co, r, _ = call("GET", "/auth/me", None, s1)
check("and the token no longer works", co == 401 and r.get('code') == 'SESSION_ENDED', f"({co} {r})")
co, r, _ = call("POST", "/auth/refresh", {"refreshToken": s1r})
check("nor does its refresh token", co == 401, f"({co} {r})")
co, r, _ = login(email, GOOD); s3 = r['accessToken']
sql(f"UPDATE auth_sessions SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = '{sid_of(s3)}'")
co, r, _ = call("GET", "/auth/me", None, s3)
check("an expired session is refused", co == 401, f"({co} {r})")
co, r, _ = login(email, GOOD); s4 = r['accessToken']
co, r, _ = login(email, GOOD); s5 = r['accessToken']
co, r, _ = call("POST", "/auth/logout-all", None, s4)
check("sign out everywhere", co == 200 and r.get('sessionsEnded', 0) >= 2, f"({co} {r})")
co, r, _ = call("GET", "/auth/me", None, s5)
check("ends the other sessions too", co == 401, f"({co} {r})")

# ---------------------------------------------------------------------------
print("-- change password: other devices are signed out --")
co, r, _ = login(email, GOOD); here = r['accessToken']
co, r, _ = login(email, GOOD); there = r['accessToken']
co, r, _ = call("POST", "/auth/change-password", {"currentPassword": GOOD, "newPassword": "qwerty123", "confirmPassword": "qwerty123"}, here)
check("a common password is refused", co == 400, f"({co} {r})")
co, r, _ = call("POST", "/auth/change-password", {"currentPassword": "wrong " + GOOD, "newPassword": BETTER, "confirmPassword": BETTER}, here)
check("the current password must be right", co == 401, f"({co} {r})")
co, r, _ = call("POST", "/auth/change-password", {"currentPassword": GOOD, "newPassword": BETTER, "confirmPassword": BETTER}, here)
check("the password changes", co == 200 and r.get('otherSessionsEnded', 0) >= 1, f"({co} {r})")
co, r, _ = call("GET", "/auth/me", None, there)
check("the other device is signed out", co == 401, f"({co} {r})")
co, r, _ = call("GET", "/auth/me", None, here)
check("this one is not", co == 200, f"({co} {r})")
co, r, _ = login(email, GOOD)
check("the old password no longer works", co == 401, f"({co} {r})")

# ---------------------------------------------------------------------------
print("-- password reset: by emailed link, without revealing who has an account --")
co1, r1, h1 = call("POST", "/auth/password/forgot", {"email": f"nobody.{RUN}@e2e.test", "platform": "school"})
co2, r2, _ = call("POST", "/auth/password/forgot", {"email": email, "platform": "school"})
check("an unknown address and a real one get the same answer", co1 == co2 == 202 and r1 == r2, f"({co1} {r1} / {co2} {r2})")
check("the endpoint is rate limited", any('"account"' in v for v in (h1.get_all('RateLimit-Policy') or [])),
      f"({h1.get_all('RateLimit-Policy')})")
msg_id, reset, sent = outbox_link('account.password_reset', email)
check("the real one is sent a link", bool(reset), f"({msg_id})")
check("the unknown one is sent nothing", sql(f"SELECT COUNT(*) FROM notification_messages WHERE destination = 'nobody.{RUN}@e2e.test'") == '0')
call("POST", "/auth/password/forgot", {"email": email, "platform": "school"})
time.sleep(1.0)
_, _, sent_again = outbox_link('account.password_reset', email, wait=0)
check("asking again at once does not send another", sent_again == sent, f"({sent} -> {sent_again})")
co, r, _ = call("GET", f"/notifications/messages/{msg_id}", None, A['token'])
check("the administrator cannot read the reset link", reset not in json.dumps(r) and r.get('message', {}).get('body') is None, f"({co})")
co, r, _ = login(email, BETTER); before = r.get('accessToken')
co, r, _ = call("POST", "/auth/password/reset", {"token": reset, "password": "short", "confirmPassword": "short"})
check("the reset refuses a weak password", co == 400, f"({co} {r})")
NEWEST = "maps of forgotten islands " + RUN
co, r, _ = call("POST", "/auth/password/reset", {"token": reset, "password": NEWEST, "confirmPassword": NEWEST})
check("the reset sets the new password", co == 200, f"({co} {r})")
co, r, _ = call("GET", "/auth/me", None, before)
check("and signs out every existing session", co == 401, f"({co} {r})")
co, r, _ = call("POST", "/auth/password/reset", {"token": reset, "password": NEWEST, "confirmPassword": NEWEST})
check("the link works once", co == 410, f"({co} {r})")
co, r, _ = login(email, BETTER)
check("the old password is gone", co == 401, f"({co} {r})")
co, r, _ = login(email, NEWEST)
check("the new one works", co == 200, f"({co} {r})")
sql(f"UPDATE auth_tokens SET used_at = NULL, expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second', "
    f"created_at = CURRENT_TIMESTAMP - INTERVAL '1 hour' WHERE token_hash = encode(sha256('{reset}'::bytea), 'hex')")
co, r, _ = call("POST", "/auth/password/reset", {"token": reset, "password": NEWEST, "confirmPassword": NEWEST})
check("an expired link is refused", co == 410, f"({co} {r})")

# ---------------------------------------------------------------------------
print("-- sign-in: nothing revealed before the password, and guessing is paused --")
co1, r1, _ = login(f"ghost.{RUN}@e2e.test", "wrong password here")
co2, r2, _ = login(email, "wrong password here")
check("an unknown address and a wrong password look the same", co1 == co2 == 401 and r1 == r2, f"({r1} / {r2})")
call("POST", "/auth/login", {"platform": "school", "email": email, "password": "spoofed attempt"},
     headers={"X-Forwarded-For": "203.0.113.9"})
check("a client cannot choose the address it is recorded under",
      sql(f"SELECT ip FROM auth_failed_logins WHERE email_norm = '{email}' ORDER BY attempted_at DESC LIMIT 1") == '127.0.0.1')
for i in range(3):
    login(email, f"wrong {i}")
co, r, h = login(email, NEWEST)
check("after five failures even the right password is refused", co == 429 and r.get('code') == 'LOGIN_LOCKED', f"({co} {r})")
check("with a Retry-After", int(h.get('Retry-After') or 0) > 0, f"({h.get('Retry-After')})")
for i in range(4):
    login(f"ghost.{RUN}@e2e.test", f"wrong {i}")
co, r, _ = login(f"ghost.{RUN}@e2e.test", "anything")
check("an address with no account is paused the same way", co == 429, f"({co} {r})")
sql(f"DELETE FROM auth_failed_logins WHERE email_norm IN ('{email}', 'ghost.{RUN}@e2e.test')")
co, r, _ = login(email, NEWEST)
check("once the pause lifts, sign-in works and clears the count", co == 200, f"({co} {r})")
check("(count cleared)", sql(f"SELECT COUNT(*) FROM auth_failed_logins WHERE email_norm = '{email}'") == '0')
live = r.get('accessToken')

print("-- deactivation takes effect on the next request --")
co, r, _ = call("PATCH", f"/auth/admin/school/users/{user_id}", {"action": "disable"}, A['token'])
check("the administrator disables the account", co == 200, f"({co} {r})")
time.sleep(0.5)
check("and it is audited", sql(f"SELECT COUNT(*) FROM audit_logs WHERE action_type = 'USER_DISABLE' "
                               f"AND resource_id = '{user_id}' AND actor_role = 'tenant_admin'") == '1')
co, r, _ = call("GET", "/auth/me", None, live)
check("its session stops working at once", co == 401, f"({co} {r})")
co, r, _ = login(email, NEWEST)
check("and it cannot sign in", co == 403 and r.get('code') == 'INACTIVE', f"({co} {r})")

# ---------------------------------------------------------------------------
print("-- self-service sign-up waits for an administrator --")
co, r, _ = call("POST", "/auth/register", {"platform": "school", "email": f"legacy.{RUN}@e2e.test",
                "fullName": "Legacy", "password": GOOD, "confirmPassword": GOOD})
check("the legacy sign-up that took a role id from the client is gone", co == 404, f"({co} {r})")
reg = f"applicant.{RUN}@e2e.test"
body = {"platform": "school", "email": reg, "fullName": "Esi Applicant", "role": "student",
        "entityId": A['tenantId'], "password": "12345678", "confirmPassword": "12345678"}
co, r, _ = call("POST", "/auth/register-with-role", body)
check("sign-up refuses a weak password", co == 400, f"({co} {r})")
body.update(password=GOOD, confirmPassword=GOOD)
co, r, _ = call("POST", "/auth/register-with-role", body)
check("a student sign-up is accepted for approval", co == 201 and r.get('requiresApproval') is True, f"({co} {r})")
co, r, _ = login(reg, GOOD)
check("and cannot sign in until approved", co == 403 and r.get('code') == 'PENDING_APPROVAL', f"({co} {r})")
check("it is not a member of the school in the meantime",
      sql(f"SELECT COUNT(*) FROM user_tenant_memberships m JOIN users u ON u.id = m.user_id WHERE u.email = '{reg}'") == '0')

co, r, _ = call("POST", "/auth/register-superadmin", {"email": f"root.{RUN}@e2e.test", "fullName": "Root",
                "password": GOOD, "confirmPassword": GOOD})
check("nobody can make themselves a superadmin", co == 403, f"({co} {r})")
co, r, _ = call("POST", "/auth/register-superadmin", {"email": f"root.{RUN}@e2e.test", "fullName": "Root",
                "password": GOOD, "confirmPassword": GOOD}, headers={"X-Bootstrap-Token": "guess"})
check("not with a guessed bootstrap token either", co == 403, f"({co} {r})")

# ---------------------------------------------------------------------------
print("-- browsers: which sites may call the API --")
co, r, h = call("OPTIONS", "/auth/login", None, headers={"Origin": "https://evil.example",
                "Access-Control-Request-Method": "POST"})
check("a foreign site gets no CORS grant", not h.get('Access-Control-Allow-Origin'), f"({h.get('Access-Control-Allow-Origin')})")
co, r, h = call("OPTIONS", "/auth/login", None, headers={"Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST"})
check("the app's own origin does", h.get('Access-Control-Allow-Origin') == "http://localhost:5173", f"({dict(h)})")
co, r, h = call("GET", "/health")
check("responses carry security headers", h.get('X-Content-Type-Options') == 'nosniff'
      and 'default-src' in (h.get('Content-Security-Policy') or '') and not h.get('X-Powered-By'), f"({dict(h)})")

print(f"\n{P} passed, {F} failed")
raise SystemExit(1 if F else 0)
