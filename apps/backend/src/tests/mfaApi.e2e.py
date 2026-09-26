"""
Two-factor sign-in (TOTP): setup, the code step of sign-in, recovery codes,
turning it off, and a superadmin's reset for a lost phone.

Codes are computed here from the secret the setup call returns, exactly as an
authenticator app would (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits).
Uses fac.b@e2e.test, which no later suite signs in as; the next run's fixtures
recreate it without two-factor.
"""
import base64, hashlib, hmac, json, os, struct, subprocess, time

SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
API = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
DB = os.environ.get("DATABASE_URL", "postgresql://jjelo@127.0.0.1:55432/jjelotech_dev")
EMAIL, PASSWORD = "fac.b@e2e.test", "Passw0rd!x"
P = F = 0

def call(m, p, t=None, body=None):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "25", "-X", m, "-H", "Content-Type: application/json"]
    if t:
        cmd += ["-H", f"Authorization: Bearer {t}"]
    cmd.append(API + p)
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    o = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8").stdout
    txt, _, code = o.rpartition("\n")
    try:
        parsed = json.loads(txt)
    except Exception:
        parsed = txt
    return int(code or 0), parsed

def check(n, ok, dd=""):
    global P, F
    if ok:
        P += 1; print(f"  ok    {n}")
    else:
        F += 1; print(f"  FAIL  {n} {dd}")

def totp(secret_b32, step):
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))
    mac = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    o = mac[-1] & 0x0F
    return str((struct.unpack(">I", mac[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000).zfill(6)

def step_now():
    return int(time.time()) // 30

def login():
    return call("POST", "/auth/login", None, {"platform": "school", "email": EMAIL, "password": PASSWORD})

def enable_fresh(token):
    """Sets up and confirms two-factor; returns (secret, step used, recovery codes, new token)."""
    co, r = call("POST", "/auth/mfa/setup", token, {})
    secret = r.get("secret", "") if isinstance(r, dict) else ""
    s = step_now()
    co, r = call("POST", "/auth/mfa/enable", token, {"code": totp(secret, s)})
    return secret, s, (r.get("recoveryCodes") or []) if isinstance(r, dict) else [], (r.get("accessToken") if isinstance(r, dict) else None), co

# Fresh sessions: the fixtures' tokens last fifteen minutes and this suite runs last.
SA = call("POST", "/auth/login-superadmin", None, {"email": "root@sa2e.test", "password": "E2e-Superadmin-1!"})[1].get("accessToken")
ADMIN = call("POST", "/auth/login", None, {"platform": "school", "email": "admin.a@e2e.test", "password": PASSWORD})[1].get("accessToken")

try:
    print("-- setup --")
    co, r = login()
    check("without two-factor, a password signs in", co == 200 and r.get("accessToken") and not r.get("mfaRequired"), f"({co} {r})")
    other = r.get("accessToken")
    co, r = login()
    tok = r.get("accessToken")
    co, me = call("GET", "/auth/me", tok)
    user_id = me.get("user", {}).get("id") if isinstance(me, dict) else None

    co, r = call("GET", "/auth/mfa", tok)
    check("status: off, not required outside production", co == 200 and r.get("enabled") is False and r.get("required") is False, f"({co} {r})")
    co, r = call("GET", "/auth/mfa", None)
    check("status needs a session", co == 401, f"({co})")

    co, r = call("POST", "/auth/mfa/setup", tok, {})
    secret = r.get("secret", "")
    check("setup returns a base32 secret and an otpauth URI",
          co == 200 and len(secret) == 32 and r.get("otpauthUri", "").startswith("otpauth://totp/JJELOTECH%20SYSTEMS")
          and f"secret={secret}" in r.get("otpauthUri", ""), f"({co} {r})")
    co, r = call("GET", "/auth/mfa", tok)
    check("an unconfirmed secret is not yet on", r.get("enabled") is False, f"({r})")
    co, r = login()
    check("nor does it change sign-in", co == 200 and r.get("accessToken"), f"({co} {r})")

    co, r = call("POST", "/auth/mfa/enable", tok, {"code": "000000" if totp(secret, step_now()) != "000000" else "111111"})
    check("a wrong code does not turn it on", co == 400 and r.get("code") == "MFA_INVALID", f"({co} {r})")
    s0 = step_now()
    co, r = call("POST", "/auth/mfa/enable", tok, {"code": totp(secret, s0)})
    codes = r.get("recoveryCodes") or []
    check("the right code turns it on and returns ten recovery codes",
          co == 200 and r.get("enabled") is True and len(codes) == 10 and len(set(codes)) == 10, f"({co} {r})")
    tok = r.get("accessToken") or tok
    co, r = call("GET", "/auth/me", tok)
    check("this session carries on", co == 200, f"({co})")
    co, r = call("GET", "/auth/me", other)
    check("other sessions, signed in by password alone, are ended", co == 401, f"({co})")
    co, r = call("POST", "/auth/mfa/setup", tok, {})
    check("setup cannot silently replace a working authenticator", co == 409, f"({co} {r})")
    co, r = call("GET", "/auth/mfa", tok)
    check("status: on, ten codes left", r.get("enabled") is True and r.get("recoveryCodesLeft") == 10, f"({r})")

    print("-- signing in --")
    co, r = login()
    mfa_token = r.get("mfaToken")
    check("the password now leads to a code step, not a session",
          co == 200 and r.get("mfaRequired") is True and mfa_token and "accessToken" not in r, f"({co} {r})")
    co, r = call("POST", "/auth/mfa/verify", None, {"mfaToken": "not-a-token", "code": "123456"})
    check("an unknown challenge is refused", co == 401 and r.get("code") == "MFA_EXPIRED", f"({co} {r})")
    co, r = call("POST", "/auth/mfa/verify", None, {"mfaToken": mfa_token})
    check("a code is required", co == 400, f"({co} {r})")
    wrong = "000000" if totp(secret, step_now()) != "000000" else "111111"
    co, r = call("POST", "/auth/mfa/verify", None, {"mfaToken": mfa_token, "code": wrong})
    check("a wrong code is refused, with the tries left", co == 401 and r.get("code") == "MFA_INVALID" and r.get("attemptsLeft") == 4, f"({co} {r})")
    co, r = call("POST", "/auth/mfa/verify", None, {"mfaToken": mfa_token, "code": totp(secret, s0)})
    check("the code used to turn it on cannot be used again", co == 401 and r.get("code") == "MFA_INVALID", f"({co} {r})")
    s1 = s0 + 1
    co, r = call("POST", "/auth/mfa/verify", None, {"mfaToken": mfa_token, "code": totp(secret, s1)})
    check("the next code completes the sign-in", co == 200 and r.get("accessToken") and r.get("refreshToken")
          and r.get("user", {}).get("email") == EMAIL, f"({co} {r})")
    tok = r.get("accessToken") or tok
    co, r = call("GET", "/auth/me", tok)
    check("and the session works", co == 200, f"({co})")
    co, r = call("POST", "/auth/mfa/verify", None, {"mfaToken": mfa_token, "code": totp(secret, s1 + 1)})
    check("a completed challenge cannot be used twice", co == 401 and r.get("code") == "MFA_EXPIRED", f"({co} {r})")

    co, r = login()
    co, r = call("POST", "/auth/mfa/verify", None, {"mfaToken": r.get("mfaToken"), "code": totp(secret, s1)})
    check("a code already used to sign in cannot be replayed", co == 401 and r.get("code") == "MFA_INVALID", f"({co} {r})")

    print("-- recovery codes --")
    co, r = login()
    co, r = call("POST", "/auth/mfa/verify", None, {"mfaToken": r.get("mfaToken"), "recoveryCode": codes[0].lower().replace("-", " ")})
    check("a recovery code signs in, however it is typed", co == 200 and r.get("accessToken") and r.get("recoveryCodesLeft") == 9, f"({co} {r})")
    tok = r.get("accessToken") or tok
    co, r = login()
    co, r = call("POST", "/auth/mfa/verify", None, {"mfaToken": r.get("mfaToken"), "recoveryCode": codes[0]})
    check("each recovery code works once", co == 401 and r.get("code") == "MFA_INVALID", f"({co} {r})")

    co, r = call("POST", "/auth/mfa/recovery-codes", tok, {"password": "wrong-password", "recoveryCode": codes[1]})
    check("new recovery codes need the password", co == 401 and r.get("code") == "REAUTH_FAILED", f"({co} {r})")
    co, r = call("POST", "/auth/mfa/recovery-codes", tok, {"password": PASSWORD})
    check("and a code", co == 401, f"({co} {r})")
    co, r = call("POST", "/auth/mfa/recovery-codes", tok, {"password": PASSWORD, "recoveryCode": codes[2]})
    fresh = r.get("recoveryCodes") or []
    check("password and a code give ten new ones", co == 200 and len(fresh) == 10 and not set(fresh) & set(codes), f"({co} {r})")
    co, r = login()
    co, r = call("POST", "/auth/mfa/verify", None, {"mfaToken": r.get("mfaToken"), "recoveryCode": codes[3]})
    check("the old set stops working", co == 401, f"({co} {r})")

    print("-- turning it off --")
    co, r = call("POST", "/auth/mfa/disable", tok, {"password": PASSWORD})
    check("turning it off needs a code as well as the password", co == 401, f"({co} {r})")
    co, r = call("POST", "/auth/mfa/disable", tok, {"password": PASSWORD, "recoveryCode": fresh[0]})
    check("with both, it is off", co == 200 and r.get("enabled") is False, f"({co} {r})")
    co, r = login()
    check("and the password alone signs in again", co == 200 and r.get("accessToken"), f"({co} {r})")
    tok = r.get("accessToken") or tok
    co, r = call("POST", "/auth/mfa/disable", tok, {"password": PASSWORD, "code": "123456"})
    check("turning off what is off says so", co == 409, f"({co} {r})")

    print("-- a lost phone: the superadmin's reset --")
    secret, s, codes, newtok, co = enable_fresh(tok)
    check("two-factor on again (new secret)", co == 200 and len(codes) == 10, f"({co})")
    tok = newtok or tok
    co, r = call("DELETE", f"/superadmin/users/{user_id}/mfa", ADMIN)
    check("a school administrator cannot use the superadmin reset", co in (401, 403), f"({co} {r})")
    co, r = call("DELETE", f"/superadmin/users/{user_id}/mfa", SA, {"justification": "Lost phone, identity checked in person"})
    check("a superadmin can reset it", co == 200 and r.get("reset") is True, f"({co} {r})")
    co, r = call("GET", "/auth/me", tok)
    check("which ends the person's sessions", co == 401, f"({co})")
    co, r = login()
    check("and they sign in with their password to set it up again", co == 200 and r.get("accessToken"), f"({co} {r})")
    tok = r.get("accessToken") or tok
    co, r = call("DELETE", f"/superadmin/users/{user_id}/mfa", SA, {})
    check("resetting an account without two-factor says so", co == 409, f"({co} {r})")
    audit = subprocess.run(["psql", DB, "-Atc",
        f"SELECT COUNT(*) FROM superadmin_audit_log WHERE action_type = 'USER_MFA_RESET' AND result = 'SUCCESS' AND target_entity_id = '{user_id}'"],
        capture_output=True, text=True).stdout.strip()
    check("the reset is in the audit trail", audit not in ("", "0"), f"({audit})")

    print("-- guessing --")
    secret, s, codes, newtok, co = enable_fresh(tok)
    co, r = login()
    mt = r.get("mfaToken")
    bad = [c for c in ("000000", "111111", "222222", "333333", "444444", "555555")
           if c not in {totp(secret, step_now() + d) for d in (-1, 0, 1)}]
    results = [call("POST", "/auth/mfa/verify", None, {"mfaToken": mt, "code": c}) for c in bad[:5]]
    check("a challenge allows five tries", [x[1].get("code") for x in results] == ["MFA_INVALID"] * 4 + ["MFA_EXPIRED"], f"({results})")
    co, r = call("POST", "/auth/mfa/verify", None, {"mfaToken": mt, "code": totp(secret, step_now())})
    check("after which even the right code is refused", co == 401 and r.get("code") == "MFA_EXPIRED", f"({co} {r})")
    co, r = login()
    check("and wrong codes count towards the sign-in lockout", co == 429, f"({co} {r})")
finally:
    # Leave the account as the fixtures made it, even after a failure.
    subprocess.run(["psql", DB, "-Atc",
        f"DELETE FROM auth_failed_logins WHERE email_norm = '{EMAIL}';"
        f"DELETE FROM user_mfa WHERE user_id IN (SELECT id FROM users WHERE email = '{EMAIL}');"
        f"DELETE FROM user_mfa_recovery_codes WHERE user_id IN (SELECT id FROM users WHERE email = '{EMAIL}');"],
        capture_output=True, text=True)

print(f"{P} passed, {F} failed")
raise SystemExit(1 if F else 0)
