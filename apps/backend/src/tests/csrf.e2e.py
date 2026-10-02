"""
Browser sessions in cookies, and the CSRF protection they need.

The browser app signs in with `X-Auth-Transport: cookie`. It must then never
see a token: the session is two httpOnly, SameSite=Strict cookies, and what
the page holds is a CSRF token that every state-changing request must echo.
Bearer-token clients (every other suite) are unaffected and need no CSRF
token, since a browser never adds an Authorization header by itself.
"""
import json, os, subprocess, tempfile

SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
d = json.load(open(f"{SP}/seed.json")); A = d['A']
API = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
PASSWORD = "Passw0rd!x"
ORIGIN = "http://localhost:5173"
P = F = 0


def check(n, ok, dd=""):
    global P, F
    if ok:
        P += 1; print(f"  ok    {n}")
    else:
        F += 1; print(f"  FAIL  {n} {dd}")


def call(m, path, body=None, jar=None, headers=None, token=None, save=True):
    """curl with an optional cookie jar. Returns (status, body, Set-Cookie headers)."""
    hdr = tempfile.NamedTemporaryFile(delete=False); hdr.close()
    cmd = ["curl", "-s", "-D", hdr.name, "-w", "\n%{http_code}", "--max-time", "25", "-X", m,
           "-H", "Content-Type: application/json"]
    if jar:
        cmd += ["-b", jar] + (["-c", jar] if save else [])
    if token:
        cmd += ["-H", f"Authorization: Bearer {token}"]
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    cmd.append(API + path)
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    o = subprocess.run(cmd, capture_output=True, text=True).stdout
    txt, _, code = o.rpartition("\n")
    raw = open(hdr.name, encoding="utf-8", errors="replace").read()
    os.unlink(hdr.name)
    cookies = [l.split(":", 1)[1].strip() for l in raw.splitlines() if l.lower().startswith("set-cookie:")]
    try:
        parsed = json.loads(txt)
    except Exception:
        parsed = txt
    return int(code or 0), parsed, cookies


def cookie(cookies, name):
    return next((c for c in cookies if c.startswith(name + "=")), "")


def attrs(c):
    return {p.strip().split("=")[0].lower(): (p.strip().split("=", 1) + [""])[1] for p in c.split(";")[1:]}


def jar_value(jar, name):
    for line in open(jar, encoding="utf-8"):
        f = line.rstrip("\n").split("\t")
        if len(f) == 7 and f[5] == name:
            return f[6]
    return None


def new_jar():
    j = tempfile.NamedTemporaryFile(delete=False, suffix=".jar"); j.close()
    return j.name


COOKIE = {"X-Auth-Transport": "cookie", "Origin": ORIGIN}

print("-- signing in for a cookie session --")
jar = new_jar()
co, r, sc = call("POST", "/auth/login", {"platform": "school", "email": "admin.a@e2e.test", "password": PASSWORD},
                 jar=jar, headers=COOKIE)
check("signs in", co == 200, f"({co} {r})")
check("the answer holds no access token", isinstance(r, dict) and "accessToken" not in r, str(list(r) if isinstance(r, dict) else r))
check("nor a refresh token", isinstance(r, dict) and "refreshToken" not in r)
csrf = r.get("csrfToken") if isinstance(r, dict) else None
check("it holds a CSRF token", bool(csrf))
at, rt = cookie(sc, "jj_at"), cookie(sc, "jj_rt")
check("the access cookie is set", bool(at), str(sc))
check("httpOnly", "httponly" in attrs(at))
check("SameSite=Strict", attrs(at).get("samesite", "").lower() == "strict")
check("for /api only", attrs(at).get("path") == "/api")
check("the refresh cookie is httpOnly", "httponly" in attrs(rt))
check("SameSite=Strict too", attrs(rt).get("samesite", "").lower() == "strict")
check("and sent only to /api/auth", attrs(rt).get("path") == "/api/auth")

print("-- the cookie is the credential --")
co, r, _ = call("GET", "/auth/me", jar=jar, headers=COOKIE)
check("/me answers with the cookie alone", co == 200, f"({co} {r})")
co, r, _ = call("GET", "/auth/me")
check("and refuses without it", co == 401, f"({co})")
co, r, _ = call("GET", f"/school/students", jar=jar, headers=COOKIE)
check("a tenant route answers with the cookie", co == 200, f"({co} {r})")
co, r, _ = call("GET", "/auth/csrf", jar=jar, headers=COOKIE)
check("GET /auth/csrf returns the same token after a reload", co == 200 and r.get("csrfToken") == csrf, f"({co} {r})")

print("-- a state-changing request needs the CSRF token --")
body = {"fullName": "Admin A"}
co, r, _ = call("PUT", "/auth/me", body, jar=jar, headers=COOKIE)
check("without it: refused", co == 403 and r.get("code") == "CSRF", f"({co} {r})")
co, r, _ = call("PUT", "/auth/me", body, jar=jar, headers={**COOKIE, "X-CSRF-Token": "x" * 43})
check("with a wrong one: refused", co == 403 and r.get("code") == "CSRF", f"({co} {r})")
co, r, _ = call("PUT", "/auth/me", body, jar=jar, headers={**COOKIE, "X-CSRF-Token": csrf})
check("with it: allowed", co == 200, f"({co} {r})")
co, r, _ = call("PUT", "/auth/me", body, jar=jar,
                headers={**COOKIE, "X-CSRF-Token": csrf, "Origin": "https://evil.example"})
check("from another origin, even with it: refused", co == 403, f"({co} {r})")
co, r, _ = call("POST", "/school/students", {"firstName": "X"}, jar=jar, headers=COOKIE)
check("a tenant write without it: refused", co == 403 and r.get("code") == "CSRF", f"({co} {r})")

print("-- the token belongs to its session --")
jar2 = new_jar()
co, r2, _ = call("POST", "/auth/login", {"platform": "school", "email": "admin.a@e2e.test", "password": PASSWORD},
                 jar=jar2, headers=COOKIE)
csrf2 = r2.get("csrfToken") if isinstance(r2, dict) else None
check("a second session gets a different token", bool(csrf2) and csrf2 != csrf)
co, r, _ = call("PUT", "/auth/me", body, jar=jar2, headers={**COOKIE, "X-CSRF-Token": csrf})
check("the first session's token does not work for the second", co == 403, f"({co} {r})")

print("-- Bearer clients are unaffected --")
co, r, _ = call("POST", "/auth/login", {"platform": "school", "email": "admin.a@e2e.test", "password": PASSWORD})
bearer = r.get("accessToken") if isinstance(r, dict) else None
check("a sign-in without the cookie header still returns tokens", bool(bearer) and bool(r.get("refreshToken")))
co, r, _ = call("PUT", "/auth/me", body, token=bearer)
check("and a Bearer write needs no CSRF token", co == 200, f"({co} {r})")

print("-- refresh and sign-out --")
co, r, sc = call("POST", "/auth/refresh", {}, jar=jar, headers=COOKIE)
check("refresh with the cookie alone", co == 200, f"({co} {r})")
check("answers no tokens", isinstance(r, dict) and "accessToken" not in r and "refreshToken" not in r)
check("and replaces both cookies", bool(cookie(sc, "jj_at")) and bool(cookie(sc, "jj_rt")))
check("the CSRF token stays that of the session", isinstance(r, dict) and r.get("csrfToken") == csrf)
co, r, _ = call("POST", "/auth/refresh", {}, jar=jar, headers={**COOKIE, "Origin": "https://evil.example"})
check("a refresh from another origin is refused", co == 403, f"({co} {r})")
co, r, _ = call("POST", "/auth/logout", {}, jar=jar, headers=COOKIE)
check("sign-out needs the CSRF token too", co == 403, f"({co} {r})")
saved = new_jar()
open(saved, "w").write(open(jar).read())
co, r, sc = call("POST", "/auth/logout", {}, jar=jar, headers={**COOKIE, "X-CSRF-Token": csrf})
check("sign-out with it", co == 200, f"({co} {r})")
check("clears the cookies", any(c.startswith("jj_at=;") for c in sc) and any(c.startswith("jj_rt=;") for c in sc), str(sc))
co, r, _ = call("GET", "/auth/me", jar=saved, headers=COOKIE, save=False)
check("a copy of the old cookie no longer works", co == 401, f"({co})")
co, r, _ = call("POST", "/auth/refresh", {}, jar=saved, headers=COOKIE, save=False)
check("nor does its refresh cookie", co == 401, f"({co})")

for j in (jar, jar2, saved):
    os.unlink(j)
print(f"\n{P} passed, {F} failed")
raise SystemExit(1 if F else 0)
