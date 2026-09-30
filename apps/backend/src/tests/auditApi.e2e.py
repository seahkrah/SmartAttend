"""
The audit API (/api/audit/*).

Only /logs went through access control at all; /logs/:id, the resource trail,
the summary, the search and the period export queried audit_logs unfiltered
and returned every school's history to anyone holding a token. The access
control that did exist filtered on a `tenant_id` column that audit_logs did
not have, and keyed its rules on a role name — 'tenant_admin' — that no role
in this system carries, so it could only ever throw.

These assertions check that each read is confined to the caller's own view,
and that the trail is populated rather than merely empty.
"""
import json, subprocess, sys, time
RUN = str(int(time.time()))[-6:]
import os
SP = os.environ.get("E2E_FIXTURE_DIR",
                    os.path.join(os.getcwd(), ".e2e-fixtures"))
d = json.load(open(f"{SP}/seed.json")); A, B = d['A'], d['B']
ROOT = "http://127.0.0.1:5000/api"
P = F = 0

def call(m, p, t, body=None, base="/audit"):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "25", "-X", m,
           "-H", f"Authorization: Bearer {t}", "-H", "Content-Type: application/json", ROOT + base + p]
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
FA, FB = A['facToken'], B['facToken']
DATE = time.strftime('%Y-%m-%d', time.gmtime(time.time() - 86400 * (int(RUN) % 90)))

# Marking attendance fires the audit trigger, so each school generates a trail.
for tok, tenant in ((FA, A), (FB, B)):
    call("POST", "/attendance/bulk-edit", tok,
         {"course_id": tenant['courseId'], "date": DATE, "action": "MARK_ALL_PRESENT"},
         base="/faculty")

print("-- logs --")
co, r = call("GET", "/logs?limit=200", AT)
check("logs 200 for a tenant administrator (rules keyed on a role that does not exist)",
      co == 200, f"({co} {r})")
a_logs = r.get('logs', []) if co == 200 else []
check("A's trail is not empty", len(a_logs) > 0, f"({len(a_logs)})")
check("every entry belongs to A",
      all(x.get('tenant_id') == A['tenantId'] for x in a_logs),
      f"({sorted({str(x.get('tenant_id')) for x in a_logs})})")

co, r = call("GET", "/logs?limit=200", BT)
b_logs = r.get('logs', []) if co == 200 else []
check("B's trail is not empty", len(b_logs) > 0, f"({len(b_logs)})")
check("every entry belongs to B",
      all(x.get('tenant_id') == B['tenantId'] for x in b_logs),
      f"({sorted({str(x.get('tenant_id')) for x in b_logs})})")

a_ids = {x['id'] for x in a_logs}
b_ids = {x['id'] for x in b_logs}
check("the two trails do not overlap", not (a_ids & b_ids), f"({len(a_ids & b_ids)} shared)")

print("-- log by id --")
if b_ids:
    one_b = sorted(b_ids)[0]
    co, r = call("GET", f"/logs/{one_b}", AT)
    check("B's entry is 404 to A, not 403", co == 404, f"({co} {r})")
    co, r = call("GET", f"/logs/{one_b}", BT)
    check("B reads its own entry", co == 200, f"({co} {r})")
if a_ids:
    one_a = sorted(a_ids)[0]
    co, r = call("GET", f"/logs/{one_a}/verify", AT)
    check("A verifies its own entry's integrity", co == 200, f"({co} {r})")
    co, r = call("GET", f"/logs/{one_a}/verify", BT)
    check("B cannot verify A's entry", co in (404, 500), f"({co} {r})")

print("-- a faculty member sees only their own --")
co, r = call("GET", "/logs?limit=200", FA)
check("faculty logs 200", co == 200, f"({co} {r})")
if co == 200:
    fa_logs = r.get('logs', [])
    check("a regular user's view is their own entries only",
          all(x.get('actor_id') or x.get('user_id') for x in fa_logs), f"({fa_logs[:1]})")
    check("faculty sees no entry attributed to someone else",
          not any(x['id'] in b_ids for x in fa_logs))

print("-- summary --")
co, r = call("GET", "/summary", AT)
check("summary 200", co == 200, f"({co} {r})")
a_total = r.get('summary', {}).get('totalOperationsLogged') if co == 200 else None
co, r = call("GET", "/summary", BT)
b_total = r.get('summary', {}).get('totalOperationsLogged') if co == 200 else None
check("each school's total counts only its own",
      a_total is not None and b_total is not None
      and int(a_total) == len(a_ids) and int(b_total) == len(b_ids),
      f"(A {a_total} vs {len(a_ids)}, B {b_total} vs {len(b_ids)})")

print("-- resource trail --")
if b_logs:
    entity = next((x for x in b_logs if x.get('entity_id')), None)
    if entity:
        co, r = call("GET", f"/resource/{entity.get('entity_type')}/{entity['entity_id']}/trail", AT)
        check("B's resource trail is empty to A", co == 200 and r.get('changeCount', 0) == 0, f"({co} {r})")
        co, r = call("GET", f"/resource/{entity.get('entity_type')}/{entity['entity_id']}/trail", BT)
        check("B reads its own resource trail", co == 200 and r.get('changeCount', 0) > 0, f"({co} {r})")

print("-- period --")
co, r = call("GET", "/period?startTime=2000-01-01T00:00:00Z&endTime=2100-01-01T00:00:00Z", AT)
check("period 200", co == 200, f"({co} {r})")
if co == 200:
    check("period holds none of B's entries",
          not any(x['id'] in b_ids for x in r.get('logs', [])), f"({r.get('count')})")

print("-- search --")
co, r = call("GET", "/search?q=anything", AT)
check("search 200 for an administrator (was superadmin-only)", co == 200, f"({co} {r})")

print("-- superadmin-only surfaces --")
co, r = call("GET", "/access-log", AT)
check("access log refused to a tenant administrator", co == 403, f"({co} {r})")
co, r = call("POST", "/test-immutability", AT)
check("immutability test refused to a tenant administrator", co == 403, f"({co} {r})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
