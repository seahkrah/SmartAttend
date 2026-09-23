"""
The control plane.

The superadmin router was rewritten because the previous one referenced
fourteen columns that do not exist and called a function that was replaced
with one that throws. Four endpoints the console calls on every load did not
exist at all.

So this suite leans on the things that were actually wrong: that every
endpoint the console calls answers, that the audit trail records failures and
denials rather than only successes, and that the destructive operations refuse
the cases that would leave the platform unrecoverable — deleting a tenant that
holds data, removing a tenant's only administrator, a superadmin deactivating
themselves.

Plus the obvious: nobody but a superadmin gets in.
"""
import json, subprocess, sys, time, os
RUN = str(int(time.time()))[-6:]
SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
d = json.load(open(f"{SP}/seed.json")); A, B = d['A'], d['B']
c = json.load(open(f"{SP}/corp.json"))
sa = json.load(open(f"{SP}/superadmin.json"))
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
P = F = 0

def call(m, p, t, body=None, base="/superadmin"):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "30", "-X", m,
           "-H", "Content-Type: application/json"]
    if t:
        cmd += ["-H", f"Authorization: Bearer {t}"]
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

SU = sa['token']
LOCKED = sa['lockedUserId']
SUPERADMIN_ID = sa['superadminId']
AT, BT = A['token'], B['token']
FA = A['facToken']
HR = c['A']['token']
STOK = A.get('studentToken')
GHOST = "00000000-0000-4000-8000-000000000000"

# ---------------------------------------------------------------- the gate
print("-- only a superadmin --")
co, r = call("GET", "/stats", None)
check("the control plane needs a token", co in (401, 403), f"({co})")
co, r = call("GET", "/stats", AT)
check("a school administrator is refused", co == 403, f"({co} {r})")
co, r = call("GET", "/stats", HR)
check("an EMS administrator is refused", co == 403, f"({co} {r})")
co, r = call("GET", "/stats", FA)
check("a lecturer is refused", co == 403, f"({co} {r})")
if STOK:
    co, r = call("GET", "/stats", STOK)
    check("a student is refused", co == 403, f"({co} {r})")
co, r = call("GET", "/tenants", AT)
check("nor can a tenant administrator list every tenant", co == 403, f"({co} {r})")

co, r = call("GET", "/stats", SU)
check("a superadmin is let in", co == 200, f"({co} {r})")

# ------------------------------------------------ everything the console calls
print("-- every endpoint the console calls answers --")
for path in ["/stats", "/entities", "/tenants", "/tenant-admins", "/users",
             "/audit-logs?limit=10", "/audit-trail", "/export/system-report",
             "/locked-users", "/admins/mapping", "/incidents", "/diagnostics"]:
    co, r = call("GET", path, SU)
    check(f"GET {path}", co == 200, f"({co} {str(r)[:120]})")

co, r = call("GET", "/health", SU)
check("GET /health answers", co in (200, 503), f"({co} {r})")
check("health names what it does not measure",
      isinstance(r, dict) and len(r.get('notMeasured', [])) > 0, f"({r})")

# ---------------------------------------------------------------- tenants
print("-- provisioning --")
co, r = call("POST", "/tenants", SU,
             {"name": f"Control Plane School {RUN}", "code": f"SA2E-S{RUN}", "kind": "school",
              "email": f"cp.{RUN}@sa2e.test"})
check("provision a school", co == 201, f"({co} {r})")
school = r.get('tenant', {}).get('id') or r.get('entity', {}).get('id')

co, r = call("POST", "/tenants", SU,
             {"name": f"Control Plane Co {RUN}", "code": f"SA2E-C{RUN}", "kind": "corporate"})
check("provision a company", co == 201, f"({co} {r})")
company = r.get('tenant', {}).get('id') or r.get('entity', {}).get('id')

co, r = call("POST", "/tenants", SU, {"name": "Dup", "code": f"SA2E-S{RUN}", "kind": "school"})
check("a duplicate code is refused", co == 409, f"({co} {r})")

co, r = call("POST", "/tenants", SU, {"name": "No code"})
check("a tenant without a code is refused", co == 400, f"({co} {r})")

co, r = call("POST", "/tenants", AT, {"name": "Sneaky", "code": f"X{RUN}"})
check("a tenant administrator cannot provision a tenant", co == 403, f"({co} {r})")

co, r = call("GET", f"/tenants/{school}", SU)
check("read the new tenant", co == 200, f"({co} {r})")
check("it starts active",
      co == 200 and r.get('tenant', {}).get('status') == 'active', f"({r.get('tenant')})")

co, r = call("GET", f"/tenants/{GHOST}", SU)
check("an unknown tenant is 404", co == 404, f"({co})")
co, r = call("GET", "/tenants/not-a-uuid", SU)
check("a malformed tenant id is 404 rather than a 500", co == 404, f"({co})")

co, r = call("PATCH", f"/tenants/{school}", SU, {"name": f"Renamed {RUN}"})
check("rename a tenant", co == 200, f"({co} {r})")

# ------------------------------------------------------------- administrators
print("-- administrators --")
co, r = call("POST", "/tenant-admins", SU,
             {"tenantId": school, "email": f"head.{RUN}@sa2e.test", "fullName": "Head Teacher"})
check("appoint an administrator", co == 201, f"({co} {r})")
admin_one = r.get('admin', {}).get('id') if co == 201 else None
check("a one-time password is issued", bool(r.get('temporaryPassword')), f"({co})")

co, r = call("POST", "/tenant-admins", SU,
             {"tenantId": school, "email": f"head.{RUN}@sa2e.test", "fullName": "Again"})
check("the same email twice is refused", co == 409, f"({co} {r})")

co, r = call("POST", "/tenant-admins", SU,
             {"tenantId": GHOST, "email": f"x.{RUN}@sa2e.test", "fullName": "X"})
check("an administrator for an unknown tenant is 404", co == 404, f"({co} {r})")

# The rule that keeps a tenant recoverable.
co, r = call("DELETE", f"/tenant-admins/{admin_one}", SU)
check("the only administrator cannot be removed", co == 409, f"({co} {r})")
check("and the refusal names them",
      co == 409 and 'only administrator' in str(r.get('error')), f"({r})")

co, r = call("POST", "/tenant-admins", SU,
             {"tenantId": school, "email": f"deputy.{RUN}@sa2e.test", "fullName": "Deputy Head"})
check("appoint a second administrator", co == 201, f"({co} {r})")

co, r = call("DELETE", f"/tenant-admins/{admin_one}", SU)
check("now the first can be removed", co == 200, f"({co} {r})")
check("removal deactivates rather than deletes",
      co == 200 and r.get('deactivated') is True, f"({r})")

co, r = call("GET", "/admins/mapping", SU)
check("the mapping names tenants nobody administers",
      co == 200 and isinstance(r.get('unadministered'), list), f"({co} {r})")

# ---------------------------------------------------------------- lifecycle
print("-- lifecycle --")
co, r = call("POST", f"/tenants/{school}/lifecycle", SU, {"state": "suspended"})
check("suspending without a justification is refused", co == 400, f"({co} {r})")

co, r = call("POST", f"/tenants/{school}/lifecycle", SU,
             {"state": "nonsense", "justification": "x"})
check("an unknown state is refused", co == 400, f"({co} {r})")

co, r = call("POST", f"/tenants/{school}/lifecycle", SU,
             {"state": "suspended", "justification": f"Non-payment, run {RUN}"})
check("suspend the tenant", co == 200, f"({co} {r})")
check("suspension reports how many accounts it stopped",
      isinstance(r.get('affectedUsers'), int), f"({r})")
suspended_users = r.get('affectedUsers', 0)
check("it actually deactivated the tenant's accounts", suspended_users >= 1, f"({r})")

co, r = call("GET", f"/tenants/{school}", SU)
check("the tenant reads as suspended",
      co == 200 and r.get('tenant', {}).get('status') == 'suspended', f"({r.get('tenant')})")
check("and is no longer flagged active",
      co == 200 and r.get('tenant', {}).get('is_active') is False, f"({r.get('tenant')})")
check("the lifecycle move is on the record",
      co == 200 and any(x.get('new_state') == 'suspended' for x in r.get('lifecycle', [])),
      f"({r.get('lifecycle')})")

co, r = call("POST", f"/tenants/{school}/lifecycle", SU,
             {"state": "suspended", "justification": "again"})
check("suspending twice is refused", co == 409, f"({co} {r})")

# An account inside a suspended tenant must not be reactivated on its own.
co, r = call("GET", "/locked-users", SU)
inside = [u for u in r.get('users', []) if u.get('tenant_id') == school]
check("the tenant's accounts show as deactivated", len(inside) >= 1, f"({len(inside)})")
if inside:
    co, r = call("POST", "/locked-users/unlock", SU, {"userId": inside[0]['id']})
    check("an account inside a suspended tenant cannot be reactivated alone",
          co == 409, f"({co} {r})")

co, r = call("POST", "/tenant-admins", SU,
             {"tenantId": school, "email": f"late.{RUN}@sa2e.test", "fullName": "Late"})
check("no administrator can be added to a suspended tenant", co == 409, f"({co} {r})")

co, r = call("POST", f"/tenants/{school}/lifecycle", SU,
             {"state": "active", "justification": "Paid"})
check("reactivate the tenant", co == 200, f"({co} {r})")
check("reactivation says accounts are not restored automatically",
      'not reactivated automatically' in str(r.get('note')), f"({r.get('note')})")

# Now the account can come back.
if inside:
    co, r = call("POST", "/locked-users/unlock", SU, {"userId": inside[0]['id']})
    check("once the tenant is active the account can be reactivated", co == 200, f"({co} {r})")
    co, r = call("POST", "/locked-users/unlock", SU, {"userId": inside[0]['id']})
    check("reactivating an active account is refused", co == 409, f"({co} {r})")

co, r = call("POST", "/locked-users/unlock", SU, {"userId": GHOST})
check("reactivating an unknown account is 404", co == 404, f"({co} {r})")
co, r = call("POST", "/locked-users/unlock", SU, {})
check("unlock without a userId is refused", co == 400, f"({co} {r})")

co, r = call("POST", f"/tenants/{company}/lifecycle", SU,
             {"state": "archived", "justification": f"Contract ended, run {RUN}"})
check("archive a tenant", co == 200, f"({co} {r})")
co, r = call("POST", f"/tenants/{company}/lifecycle", SU,
             {"state": "active", "justification": "Changed our mind"})
check("an archived tenant cannot be brought back", co == 409, f"({co} {r})")

# ------------------------------------------------------------------ deletion
print("-- deletion --")
co, r = call("DELETE", f"/tenants/{school}", SU)
check("a tenant holding data cannot be deleted", co == 409, f"({co} {r})")
check("and the refusal says what it holds",
      co == 409 and isinstance(r.get('holds'), dict), f"({r})")

co, r = call("DELETE", f"/tenants/{A['tenantId']}", SU)
check("a populated school cannot be deleted either", co == 409, f"({co} {r})")

co, r = call("POST", "/tenants", SU,
             {"name": f"Empty {RUN}", "code": f"SA2E-E{RUN}", "kind": "school"})
empty = r.get('tenant', {}).get('id') or r.get('entity', {}).get('id')
co, r = call("DELETE", f"/tenants/{empty}", SU)
check("an empty tenant can be deleted", co == 200, f"({co} {r})")
co, r = call("GET", f"/tenants/{empty}", SU)
check("and is gone afterwards", co == 404, f"({co})")

# -------------------------------------------------------------------- users
print("-- users --")
co, r = call("GET", f"/users?q=head.{RUN}", SU)
check("search users", co == 200 and len(r.get('users', [])) >= 1, f"({co} {r})")

co, r = call("PATCH", f"/users/{SUPERADMIN_ID}", SU, {"isActive": False})
check("a superadmin cannot deactivate themselves", co == 409, f"({co} {r})")
co, r = call("DELETE", f"/users/{SUPERADMIN_ID}", SU)
check("nor delete themselves", co == 409, f"({co} {r})")

co, r = call("GET", "/users", SU)
me = [u for u in r.get('users', []) if u['id'] == SUPERADMIN_ID]
check("the superadmin is still active", me and me[0]['is_active'] is True, f"({me})")

co, r = call("POST", "/locked-users/unlock", SU, {"userId": LOCKED})
check("reactivate a deactivated account", co == 200, f"({co} {r})")

co, r = call("PATCH", f"/users/{LOCKED}", SU, {"fullName": f"Renamed {RUN}"})
check("rename a user", co == 200, f"({co} {r})")
check("the rename took",
      co == 200 and r.get('user', {}).get('full_name') == f"Renamed {RUN}", f"({r})")

co, r = call("DELETE", f"/users/{LOCKED}", SU)
check("deactivate a user", co == 200, f"({co} {r})")

co, r = call("PATCH", f"/users/{GHOST}", SU, {"fullName": "X"})
check("an unknown user is 404", co == 404, f"({co})")

# ---------------------------------------------------------------- incidents
print("-- incidents --")
co, r = call("POST", "/incidents", SU,
             {"title": f"Control plane test {RUN}", "severity": "MEDIUM",
              "description": "Raised by the e2e suite"})
check("raise an incident", co == 201, f"({co} {r})")
incident = r.get('incident', {}).get('id') if co == 201 else None

co, r = call("POST", "/incidents", SU, {"title": "No severity"})
check("an incident without a severity is refused", co == 400, f"({co} {r})")

co, r = call("POST", "/incidents", SU, {"title": "Bad", "severity": "catastrophic"})
check("a severity outside the vocabulary is refused", co == 400, f"({co} {r})")

co, r = call("PUT", f"/incidents/{incident}", SU, {"status": "RESOLVED"})
check("resolving without a root cause is refused", co == 400, f"({co} {r})")

co, r = call("PUT", f"/incidents/{incident}", SU, {"status": "INVESTIGATING"})
check("move an incident to investigating", co == 200, f"({co} {r})")
check("picking it up is stamped",
      r.get('incident', {}).get('acknowledged_at') is not None, f"({r})")

co, r = call("PUT", f"/incidents/{incident}", SU, {"status": "NOT_A_STATE"})
check("a status outside the vocabulary is refused", co == 400, f"({co} {r})")

co, r = call("POST", "/incidents/override", SU, {"incidentId": incident})
check("an override without a reason is refused", co == 400, f"({co} {r})")

co, r = call("POST", "/incidents/override", SU,
             {"incidentId": incident, "reason": f"False positive, run {RUN}"})
check("override an incident", co == 200, f"({co} {r})")
check("the override resolves it",
      r.get('incident', {}).get('status') == 'RESOLVED', f"({r})")
check("and the reason is on the record",
      f"run {RUN}" in str(r.get('incident', {}).get('resolution_notes')), f"({r})")

co, r = call("POST", "/incidents/override", SU,
             {"incidentId": incident, "reason": "again"})
check("overriding a resolved incident is refused", co == 409, f"({co} {r})")

co, r = call("POST", "/incidents/override", AT, {"incidentId": incident, "reason": "x"})
check("a tenant administrator cannot override an incident", co == 403, f"({co} {r})")

# ------------------------------------------------------------------- audit
print("-- the audit trail records more than successes --")
co, r = call("GET", "/audit-logs?limit=200", SU)
logs = r.get('logs', []) if co == 200 else []
check("read the audit log", co == 200 and len(logs) > 0, f"({co} {len(logs)})")

results = {x.get('result') for x in logs}
check("successes are recorded", 'SUCCESS' in results, f"({results})")
# The whole point: the previous logAuditEntry hardcoded SUCCESS, so a refusal
# left no trace at all.
check("denials are recorded too", 'DENIED' in results, f"({results})")

denied = [x for x in logs if x.get('result') == 'DENIED']
check("a denial says why",
      any(x.get('error_message') for x in denied), f"({denied[:2]})")

lifecycle = [x for x in logs if x.get('action_type') == 'TENANT_LIFECYCLE']
check("the suspension carries its justification",
      any(f"run {RUN}" in str(x.get('justification')) for x in lifecycle), f"({lifecycle[:2]})")
check("and captures the before and after state",
      any(x.get('before_state') and x.get('after_state') for x in lifecycle), f"({lifecycle[:1]})")

co, r = call("GET", "/audit-trail?limit=200", SU)
trail = r.get('trail', []) if co == 200 else []
check("the combined trail answers", co == 200 and len(trail) > 0, f"({co} {len(trail)})")
sources = {x.get('source') for x in trail}
check("it merges the audit log, the action log and the lifecycle history",
      {'audit', 'action', 'lifecycle'} <= sources, f"({sources})")

co, r = call("GET", "/export/system-report", SU)
report = r.get('report', {}) if co == 200 else {}
check("the system report builds", co == 200, f"({co} {r})")
check("it counts tenants", isinstance(report.get('summary', {}).get('tenants'), int), f"({report})")
check("it names tenants with no administrator",
      isinstance(report.get('tenantsWithoutAnAdministrator'), int), f"({report})")
check("it is generated now, not from a snapshot",
      report.get('generatedAt', '').startswith(time.strftime('%Y-%m-%d')), f"({report.get('generatedAt')})")

co, r = call("GET", "/audit-trail", AT)
check("a tenant administrator cannot read the platform trail", co == 403, f"({co} {r})")
co, r = call("GET", "/export/system-report", AT)
check("nor export the system report", co == 403, f"({co} {r})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
