"""
The operational routers: incidents, metrics, simulations, validation and the
retired tenant-admin duplicate.

Each was reachable and each was wrong in a different way.

  /api/incidents   15 routes with no authentication middleware at all, and
                   list/stats filtered on platform_id — one value shared by
                   every school.
  /api/metrics     filtered on `req.tenantId || req.headers['x-tenant-id']`,
                   both of which the caller controls: naming another tenant in
                   a header read its failure rates and drift statistics.
  /api/simulations same header-controlled tenant, plus no role check beyond
                   "has a token", on endpoints that stress the platform.
  /api/validation  no authentication; two handoff routes had no role check
                   either and answered "accepted" to anyone.
  /api/admin/...   a tenant-admin router with no tenant_id in it at all.
"""
import json, subprocess, sys, time
RUN = str(int(time.time()))[-6:]
SP = "/tmp/claude-0/-home-user-SmartAttend/d93ac8ad-306e-535c-92c4-36bf785b1524/scratchpad"
d = json.load(open(f"{SP}/seed.json")); A, B = d['A'], d['B']
c = json.load(open(f"{SP}/corp.json")); HR = c['A']['token']
ROOT = "http://127.0.0.1:5000/api"
P = F = 0

def call(m, p, t, body=None, base="", headers=None):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "25", "-X", m,
           "-H", "Content-Type: application/json"]
    if t:
        cmd += ["-H", f"Authorization: Bearer {t}"]
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    cmd.append(ROOT + base + p)
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

AT, BT = A['token'], B['token']
FA = A['facToken']

print("-- incidents: authentication --")
co, r = call("GET", "/open", None, base="/incidents")
check("unauthenticated request refused (router had no auth at all)",
      co in (401, 403), f"({co} {r})")
co, r = call("GET", "/open", "not-a-token", base="/incidents")
check("invalid token refused", co in (401, 403), f"({co})")

print("-- incidents: role --")
co, r = call("GET", "/open", FA, base="/incidents")
check("a lecturer may not read incidents", co == 403, f"({co} {r})")

print("-- incidents: reachable for an administrator --")
co, r = call("GET", "/open", AT, base="/incidents")
check("an administrator reads incidents 200 (whole router used to 403)",
      co == 200, f"({co} {r})")
if co == 200:
    rows = r.get('data', {}).get('incidents', [])
    check("only this school's incidents",
          all(x.get('affected_tenant_id') == A['tenantId'] for x in rows),
          f"({sorted({str(x.get('affected_tenant_id')) for x in rows})})")

co, r = call("GET", "/critical", AT, base="/incidents")
check("critical incidents 200", co == 200, f"({co} {r})")
co, r = call("GET", "/stats", AT, base="/incidents")
check("incident stats 200", co == 200, f"({co} {r})")

# A well-formed id the caller cannot see must read as absent, not forbidden.
GHOST = "00000000-0000-4000-8000-000000000000"
co, r = call("GET", f"/{GHOST}", AT, base="/incidents")
check("an unseen incident id is 404", co == 404, f"({co} {r})")
co, r = call("POST", f"/{GHOST}/acknowledge", AT, {"acknowledgementNote": "x"}, base="/incidents")
check("cannot acknowledge an unseen incident", co == 404, f"({co} {r})")

print("-- incident admin: superadmin only --")
co, r = call("GET", "", AT, base="/admin/incidents")
check("a tenant administrator is refused", co == 403, f"({co} {r})")
co, r = call("GET", "", None, base="/admin/incidents")
check("unauthenticated refused", co in (401, 403), f"({co})")

print("-- metrics: the tenant is not the caller's to choose --")
co, r = call("GET", "/failure-rates", AT, base="/metrics")
check("metrics 200 for an administrator", co == 200, f"({co} {r})")
own = r.get('tenant_id') if co == 200 else None
check("scoped to the caller's own tenant", own == A['tenantId'], f"({own} vs {A['tenantId']})")

# The header used to be taken verbatim as the filter.
co, r = call("GET", "/failure-rates", AT, base="/metrics",
             headers={"X-Tenant-Id": B['tenantId']})
check("naming another tenant in a header does not switch tenant",
      co != 200 or r.get('tenant_id') == A['tenantId'], f"({co} {r})")

co, r = call("GET", "/clock-drift", AT, base="/metrics", headers={"X-Tenant-Id": B['tenantId']})
check("clock drift stays on the caller's tenant",
      co != 200 or r.get('tenant_id') == A['tenantId'], f"({co} {r})")

co, r = call("GET", "/verification-mismatches", AT, base="/metrics",
             headers={"X-Tenant-Id": B['tenantId']})
check("verification mismatches stay on the caller's tenant",
      co != 200 or r.get('tenant_id') == A['tenantId'], f"({co} {r})")

co, r = call("GET", "/failure-rates", None, base="/metrics")
check("metrics require authentication", co in (401, 403), f"({co})")

print("-- simulations: superadmin only --")
co, r = call("POST", "/time-drift", AT, base="/simulations")
check("an administrator may not run a failure simulation", co == 403, f"({co} {r})")
co, r = call("POST", "/time-drift", FA, base="/simulations")
check("a lecturer may not either", co == 403, f"({co} {r})")
co, r = call("POST", "/time-drift", None, base="/simulations")
check("unauthenticated refused", co in (401, 403), f"({co})")
co, r = call("POST", "/duplicate-storm", AT, base="/simulations")
check("the duplicate storm is refused before any role check passes",
      co in (403, 501), f"({co} {r})")

print("-- validation: superadmin only, and honest about what it cannot do --")
co, r = call("POST", "/handoff/session-1/accept", None, base="/validation")
check("handoff accept no longer answers to anyone", co in (401, 403), f"({co} {r})")
co, r = call("POST", "/handoff/session-1/accept", AT, base="/validation")
check("handoff accept refused to a tenant administrator", co == 403, f"({co} {r})")
co, r = call("GET", "/handoff/session-1/briefing", AT, base="/validation")
check("handoff briefing refused too", co == 403, f"({co} {r})")
co, r = call("POST", "/platform-readiness", AT, base="/validation")
check("platform readiness refused to a tenant administrator", co == 403, f"({co} {r})")
co, r = call("GET", "/health", None, base="/validation")
check("even the health listing needs a token", co in (401, 403), f"({co})")

print("-- retired tenant-admin duplicate --")
co, r = call("GET", "/school/stats", AT, base="/admin")
check("withdrawn, naming its replacement",
      co == 410 and 'replacement' in str(r), f"({co} {r})")
co, r = call("GET", "/school/users", AT, base="/admin")
check("user listing withdrawn", co == 410, f"({co} {r})")
co, r = call("GET", "/school/stats", None, base="/admin")
check("the withdrawal notice still needs a token", co in (401, 403), f"({co})")

print("-- the replacement works --")
co, r = call("GET", "/users", AT, base="/admin")
check("tenant-scoped user listing 200", co == 200, f"({co} {r})")
co, r = call("GET", "/admin/school/stats", AT, base="/auth")
check("tenant-scoped stats 200", co == 200, f"({co} {r})")

print("-- EMS identities stay out of SMS operations --")
co, r = call("GET", "/failure-rates", HR, base="/metrics")
check("an EMS identity reads only its own metrics",
      co != 200 or r.get('tenant_id') not in (A['tenantId'], B['tenantId']), f"({co} {r})")

print("-- registration approvals --")
# Authority used to be school_entities.admin_user_id, NULL for every entity,
# so this queue was permanently empty and no request could be acted on.
co, r = call("GET", "/admin/pending-approvals", AT, base="/auth")
check("approvals queue reachable for an administrator", co == 200, f"({co} {r})")
if co == 200:
    check("reports the caller's own platform", r.get('platform') == 'school', f"({r})")
co, r = call("GET", "/admin/pending-approvals", FA, base="/auth")
check("a lecturer has no approvals queue", co == 403, f"({co} {r})")
co, r = call("GET", "/admin/pending-approvals", None, base="/auth")
check("unauthenticated refused", co in (401, 403), f"({co})")

co, r = call("POST", "/admin/approval-action", AT,
             {"approvalId": GHOST, "action": "approve"}, base="/auth")
check("an approval outside the caller's tenant reads as absent",
      co == 404 and 'not found' in str(r).lower(), f"({co} {r})")

print("-- corporate stats --")
co, r = call("GET", "/admin/corporate/stats", HR, base="/auth")
check("an EMS administrator reads their own stats", co == 200, f"({co} {r})")
if co == 200:
    rate = r.get('stats', {}).get('checkinRate')
    check("the check-in rate is computed, not the hardcoded '92.3%'",
          rate is None or isinstance(rate, (int, float)), f"({rate!r})")
    check("the entity is the caller's own tenant",
          r.get('entity', {}).get('id') == c['A']['tenantId'], f"({r.get('entity')})")
co, r = call("GET", "/admin/corporate/stats", AT, base="/auth")
check("an SMS administrator is refused from the EMS dashboard", co == 403, f"({co} {r})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
