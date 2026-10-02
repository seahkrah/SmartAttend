"""
Break-glass: a superadmin acting inside a tenant's data.

Before migration 071 a superadmin's X-Tenant-Id was enough. Now it needs an
open, time-boxed grant with a reason. Opening it is written to the tenant's
own audit trail, every request under it is logged, and the tenant's
administrators can read both.
"""
import json, os, subprocess, sys

from support.psql import psql

SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
s = json.load(open(f"{SP}/seed.json")); A, B = s['A'], s['B']
sa = json.load(open(f"{SP}/superadmin.json"))
SU = sa['token']
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
DB = os.environ.get("DATABASE_URL", "postgresql://jjelo@127.0.0.1:55432/jjelotech_dev")
P = F = 0


def call(m, p, t, body=None, tenant=None):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "30", "-X", m,
           "-H", "Content-Type: application/json", "-H", f"Authorization: Bearer {t}"]
    if tenant:
        cmd += ["-H", f"X-Tenant-Id: {tenant}"]
    cmd.append(ROOT + p)
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    o = subprocess.run(cmd, capture_output=True, text=True).stdout
    txt, _, code = o.rpartition("\n")
    try:
        return int(code), json.loads(txt)
    except Exception:
        return int(code), txt


def check(n, ok, dd=""):
    global P, F
    if ok:
        P += 1; print(f"  ok    {n}")
    else:
        F += 1; print(f"  FAIL  {n} {dd}")


REASON = "Investigating a reported attendance discrepancy for the head teacher"
PROBE = "/metrics/failure-rates"

# Any grants this superadmin left open from an earlier run would let the
# first check pass for the wrong reason.
psql(DB, f"UPDATE break_glass_grants SET closed_at = CURRENT_TIMESTAMP WHERE superadmin_id = '{sa['superadminId']}' AND closed_at IS NULL")

print("-- without a grant --")
co, r = call("GET", PROBE, SU, tenant=A['tenantId'])
check("a superadmin cannot act inside a tenant without break-glass", co == 403, f"({co} {r})")
check("and is told how to open it", isinstance(r, dict) and 'break-glass' in str(r.get('message', '')).lower(), f"({r})")

print("-- opening --")
co, r = call("POST", "/superadmin/break-glass", SU, {"tenantId": A['tenantId']})
check("a reason is required", co == 400, f"({co})")
co, r = call("POST", "/superadmin/break-glass", SU, {"tenantId": A['tenantId'], "reason": "because"})
check("a short reason is refused", co == 400, f"({co})")
co, r = call("POST", "/superadmin/break-glass", SU, {"tenantId": A['tenantId'], "reason": REASON, "minutes": 61})
check("more than an hour is refused", co == 400, f"({co})")
co, r = call("POST", "/superadmin/break-glass", SU, {"tenantId": "00000000-0000-4000-8000-000000000000", "reason": REASON})
check("an unknown tenant is 404", co == 404, f"({co})")
co, r = call("POST", "/superadmin/break-glass", A['token'], {"tenantId": A['tenantId'], "reason": REASON})
check("a tenant administrator cannot open break-glass", co in (401, 403), f"({co})")

co, r = call("POST", "/superadmin/break-glass", SU, {"tenantId": A['tenantId'], "reason": REASON, "minutes": 15})
check("a superadmin opens a 15-minute grant for A", co == 201, f"({co} {r})")
grant = (r.get('grant') or {}) if isinstance(r, dict) else {}
gid = grant.get('id')

print("-- under the grant --")
co, r = call("GET", PROBE, SU, tenant=A['tenantId'])
check("now the superadmin can act in A", co == 200 and isinstance(r, dict) and r.get('tenant_id') == A['tenantId'], f"({co} {r})")
co, r = call("GET", PROBE, SU, tenant=B['tenantId'])
check("a grant for A does not open B", co == 403, f"({co})")

print("-- what the tenant sees --")
co, r = call("GET", "/admin/break-glass", A['token'])
mine = [g for g in (r.get('grants', []) if isinstance(r, dict) else []) if g.get('id') == gid]
check("A's administrator sees the grant", co == 200 and len(mine) == 1, f"({co} {r})")
check("with its reason", bool(mine) and mine[0].get('reason') == REASON, f"({mine})")
check("and every request made under it", bool(mine) and any(x.get('path') == "/api" + PROBE for x in mine[0].get('requests', [])), f"({mine})")
co, r = call("GET", "/admin/break-glass", B['token'])
check("B's administrator does not see A's grant",
      co == 200 and not any(g.get('id') == gid for g in r.get('grants', [])), f"({co} {r})")
co, r = call("GET", "/audit/logs?limit=200", A['token'])
check("opening it is in A's own audit trail",
      co == 200 and any(x.get('action_type') == 'BREAK_GLASS_OPENED' and x.get('resource_id') == gid for x in r.get('logs', [])),
      f"({co})")

print("-- the record cannot be rewritten --")
q = psql(DB, f"UPDATE break_glass_grants SET reason = 'nothing to see' WHERE id = '{gid}'")
check("a grant's reason cannot be changed", q.returncode != 0, f"({q.stdout} {q.stderr})")
q = psql(DB, f"UPDATE break_glass_grants SET expires_at = expires_at + interval '1 day' WHERE id = '{gid}'")
check("nor its window extended", q.returncode != 0, f"({q.stdout})")
q = psql(DB, f"UPDATE break_glass_access_log SET path = '/elsewhere' WHERE grant_id = '{gid}'")
check("the access log is append-only", q.returncode != 0, f"({q.stdout})")
q = psql(DB, f"INSERT INTO break_glass_grants (tenant_id, superadmin_id, reason, expires_at) VALUES "
             f"('{A['tenantId']}', '{sa['superadminId']}', '{REASON}', CURRENT_TIMESTAMP + interval '2 hours')")
check("the database refuses a window over an hour", q.returncode != 0, f"({q.stdout})")

print("-- closing --")
co, r = call("POST", f"/superadmin/break-glass/{gid}/close", SU, {})
check("the superadmin closes the grant", co == 200, f"({co} {r})")
co, r = call("GET", PROBE, SU, tenant=A['tenantId'])
check("after closing, access is refused again", co == 403, f"({co})")
co, r = call("POST", f"/superadmin/break-glass/{gid}/close", SU, {})
check("a closed grant cannot be closed again", co == 404, f"({co})")
co, r = call("GET", "/audit/logs?limit=200", A['token'])
check("closing it is in A's audit trail too",
      co == 200 and any(x.get('action_type') == 'BREAK_GLASS_CLOSED' and x.get('resource_id') == gid for x in r.get('logs', [])),
      f"({co})")

print(f"\n{P} passed, {F} failed")
sys.exit(0 if F == 0 else 1)
