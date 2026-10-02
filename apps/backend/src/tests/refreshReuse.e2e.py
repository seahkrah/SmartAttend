"""
Refresh-token rotation and reuse detection.

Every refresh replaces the refresh token. The replaced one, presented again
within 30 seconds, is two tabs racing (409, retry). Presented later, someone
has a copy: the whole session ends, so the copy, the current token and every
access token of the session stop working together.
"""
import json, os, subprocess, time

API = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api/auth"
PASSWORD = "Passw0rd!x"
P = F = 0


def check(n, ok, dd=""):
    global P, F
    if ok:
        P += 1; print(f"  ok    {n}")
    else:
        F += 1; print(f"  FAIL  {n} {dd}")


def call(m, p, body=None, token=None):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "25", "-X", m, "-H", "Content-Type: application/json"]
    if token:
        cmd += ["-H", f"Authorization: Bearer {token}"]
    cmd.append(API + p)
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    o = subprocess.run(cmd, capture_output=True, text=True).stdout
    txt, _, code = o.rpartition("\n")
    try:
        return int(code), json.loads(txt)
    except Exception:
        return int(code or 0), txt


def sign_in():
    co, r = call("POST", "/login", {"platform": "school", "email": "fac.a@e2e.test", "password": PASSWORD})
    assert co == 200, (co, r)
    return r["accessToken"], r["refreshToken"]


print("-- rotation --")
at0, rt0 = sign_in()
co, r = call("POST", "/refresh", {"refreshToken": rt0})
check("a refresh succeeds", co == 200, f"({co} {r})")
at1, rt1 = r.get("accessToken"), r.get("refreshToken")
check("and replaces the refresh token", bool(rt1) and rt1 != rt0)
co, _ = call("GET", "/me", token=at1)
check("the new access token works", co == 200)

print("-- two tabs racing --")
co, r = call("POST", "/refresh", {"refreshToken": rt0})
check("the replaced token, at once again: 409 (retry)", co == 409 and r.get("code") == "REFRESH_RACE", f"({co} {r})")
co, _ = call("GET", "/me", token=at1)
check("and the session is untouched", co == 200)

print("-- a copy used later ends the session --")
print("  (waiting out the 30-second race window)")
time.sleep(31)
co, r = call("POST", "/refresh", {"refreshToken": rt0})
check("the replaced token after the window: refused", co == 401, f"({co} {r})")
co, r = call("POST", "/refresh", {"refreshToken": rt1})
check("and so is the current one: the session is over", co == 401, f"({co} {r})")
co, _ = call("GET", "/me", token=at1)
check("its access token stops working at once", co == 401)
co, _ = call("GET", "/me", token=at0)
check("as does the first one", co == 401)

print("-- other sessions of the same person are not affected --")
at2, rt2 = sign_in()
at3, rt3 = sign_in()
co, r = call("POST", "/refresh", {"refreshToken": rt2})
rt2b = r.get("refreshToken")
time.sleep(31)
co, _ = call("POST", "/refresh", {"refreshToken": rt2})
check("reuse in one session", co == 401)
co, _ = call("GET", "/me", token=at3)
check("leaves another session signed in", co == 200)
co, r = call("POST", "/refresh", {"refreshToken": rt3})
check("and refreshing", co == 200, f"({co} {r})")

print("-- nonsense --")
for bad in ["", "x", "y" * 300, rt0 + "x"]:
    co, _ = call("POST", "/refresh", {"refreshToken": bad})
    check(f"refresh token of length {len(bad)} refused", co in (400, 401), f"({co})")

print(f"\n{P} passed, {F} failed")
raise SystemExit(1 if F else 0)
