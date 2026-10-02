"""
The audit trail as a hash chain per tenant (migration 079), and its verifier.

Each check tampers with tenant A's trail the way someone with the database
owner's access could (editing a row, deleting one, cutting the end off and
rewinding the head), sees the verifier (the API's and the command) report it
at the right position, then puts the row back exactly and sees the chain
whole again.
"""
import json, os, subprocess, tempfile

from support.psql import psql

SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
s = json.load(open(f"{SP}/seed.json")); A, B = s['A'], s['B']
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
DB = os.environ.get("DATABASE_URL", "postgresql://jjelo@127.0.0.1:55432/jjelotech_dev")
APP_DB = os.environ.get("APP_DATABASE_URL", "")
P = F = 0


def call(m, p, t, body=None):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "30", "-X", m,
           "-H", "Content-Type: application/json", "-H", f"Authorization: Bearer {t}", ROOT + p]
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


def q(sql, db=DB):
    r = psql(db, sql)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def owner_tamper(sql):
    """As the owner, with the immutability triggers off for exactly this statement."""
    q(f"BEGIN; ALTER TABLE audit_logs DISABLE TRIGGER USER; {sql}; ALTER TABLE audit_logs ENABLE TRIGGER USER; COMMIT")


def chain(t):
    co, r = call("GET", "/audit/chain", t)
    return co, (r.get("data") if isinstance(r, dict) else None) or {}


def cli(*args):
    return subprocess.run(["npx", "tsx", "src/scripts/verifyAuditChain.ts", *args],
                          capture_output=True, text=True, shell=os.name == "nt")


def event(t):
    """One audited action in A: add and remove a collector (two rows)."""
    co, r = call("POST", "/audit/streams", t, {"url": "http://127.0.0.1:9/never"})
    assert co == 201, (co, r)
    co, _ = call("DELETE", f"/audit/streams/{r['data']['id']}", t)
    assert co == 200


AT, BT, FT = A['token'], B['token'], A['facToken']

print("-- an intact chain --")
event(AT)
co, c = chain(AT)
check("A's administrator verifies A's trail", co == 200 and c.get("ok") is True, f"({co} {c})")
check("it has rows and a head at its last one", c.get("rows", 0) >= 2 and c.get("head", {}).get("seq") == c.get("last", {}).get("seq"), str(c))
n0 = c.get("rows", 0)
event(AT)
co, c = chain(AT)
check("new audited actions extend it, still intact", c.get("ok") is True and c.get("rows") == n0 + 2, f"({c.get('rows')} vs {n0 + 2})")
co, cb = chain(BT)
check("B's administrator verifies B's own chain, not A's", co == 200 and cb.get("chain") == B['tenantId'], str(cb.get("chain")))
co, _ = chain(FT)
check("a lecturer may not", co == 403, f"({co})")
r = cli("--tenant", A['tenantId'])
check("the command agrees", r.returncode == 0 and "ok      tenant" in r.stdout, r.stdout + r.stderr)

rows = int(c["rows"])
mid = rows // 2
orig = q(f"SELECT coalesce(justification, '<null>') FROM audit_logs WHERE tenant_id = '{A['tenantId']}' AND chain_seq = {mid}")

print("-- an edited row --")
owner_tamper(f"UPDATE audit_logs SET justification = 'quietly rewritten' WHERE tenant_id = '{A['tenantId']}' AND chain_seq = {mid}")
co, c = chain(AT)
kinds = [(p["kind"], p["seq"]) for p in c.get("problems", [])]
check("is found", c.get("ok") is False, str(c))
check("at its position, as an edit", ("content", mid) in kinds, str(kinds))
r = cli("--tenant", A['tenantId'])
check("the command fails on it", r.returncode == 1 and f"content at {mid}" in r.stdout, r.stdout)
restore = "NULL" if orig == "<null>" else "'" + orig.replace("'", "''") + "'"
owner_tamper(f"UPDATE audit_logs SET justification = {restore} WHERE tenant_id = '{A['tenantId']}' AND chain_seq = {mid}")
co, c = chain(AT)
check("put back exactly, the chain is whole again", c.get("ok") is True, str(c.get("problems")))

print("-- a deleted row --")
q("DROP TABLE IF EXISTS audit_tamper_backup")
q(f"CREATE TABLE audit_tamper_backup AS SELECT * FROM audit_logs WHERE tenant_id = '{A['tenantId']}' AND chain_seq = {mid}")
owner_tamper(f"DELETE FROM audit_logs WHERE tenant_id = '{A['tenantId']}' AND chain_seq = {mid}")
co, c = chain(AT)
kinds = [(p["kind"], p["seq"]) for p in c.get("problems", [])]
check("is found as a gap where it was", ("gap", mid) in kinds, str(kinds))
check("and a broken link after it", ("link", mid + 1) in kinds, str(kinds))
owner_tamper("INSERT INTO audit_logs SELECT * FROM audit_tamper_backup")
co, c = chain(AT)
check("put back, the chain is whole again", c.get("ok") is True, str(c.get("problems")))

print("-- the end cut off and the head rewound --")
cp = os.path.join(tempfile.gettempdir(), f"audit-checkpoint-{os.getpid()}.json")
if os.path.exists(cp):
    os.unlink(cp)
r = cli("--tenant", A['tenantId'], "--checkpoint", cp)
check("a checkpoint is saved from an intact chain", r.returncode == 0 and os.path.exists(cp), r.stdout + r.stderr)
last = int(q(f"SELECT max(chain_seq) FROM audit_logs WHERE tenant_id = '{A['tenantId']}'"))
prev = q(f"SELECT row_hash FROM audit_logs WHERE tenant_id = '{A['tenantId']}' AND chain_seq = {last - 1}")
q("DROP TABLE IF EXISTS audit_tamper_backup")
q(f"CREATE TABLE audit_tamper_backup AS SELECT * FROM audit_logs WHERE tenant_id = '{A['tenantId']}' AND chain_seq = {last}")
head = q(f"SELECT head_hash FROM audit_chain_heads WHERE chain = '{A['tenantId']}'")
owner_tamper(f"DELETE FROM audit_logs WHERE tenant_id = '{A['tenantId']}' AND chain_seq = {last}")
q(f"UPDATE audit_chain_heads SET seq = {last - 1}, head_hash = '{prev}' WHERE chain = '{A['tenantId']}'")
co, c = chain(AT)
check("the chain alone looks consistent (this is the case a checkpoint is for)", c.get("ok") is True, str(c.get("problems")))
r = cli("--tenant", A['tenantId'], "--checkpoint", cp)
check("against the checkpoint, the missing end is found", r.returncode == 1 and f"position {last}, seen before, is gone" in r.stdout, r.stdout)
owner_tamper("INSERT INTO audit_logs SELECT * FROM audit_tamper_backup")
q(f"UPDATE audit_chain_heads SET seq = {last}, head_hash = '{head}' WHERE chain = '{A['tenantId']}'")
q("DROP TABLE IF EXISTS audit_tamper_backup")
r = cli("--tenant", A['tenantId'], "--checkpoint", cp)
check("put back, the checkpoint agrees again", r.returncode == 0, r.stdout)
os.unlink(cp)

print("-- what the API's own database role cannot do --")
if APP_DB:
    for name, sql in [("delete a chain head", f"DELETE FROM audit_chain_heads WHERE chain = '{A['tenantId']}'"),
                      ("edit an audit row", f"UPDATE audit_logs SET justification = 'x' WHERE tenant_id = '{A['tenantId']}'"),
                      ("delete an audit row", f"DELETE FROM audit_logs WHERE tenant_id = '{A['tenantId']}'")]:
        r = psql(APP_DB, f"SELECT set_config('app.tenant_id', '{A['tenantId']}', false); {sql}")
        check(f"it cannot {name}", r.returncode != 0, (r.stdout + r.stderr)[:160])
else:
    check("APP_DATABASE_URL is set, so the runtime role can be tried", False)

event(AT)
co, c = chain(AT)
check("after all that, new rows still extend an intact chain", c.get("ok") is True and c.get("rows") == rows + 2, f"({c.get('rows')} vs {rows + 2})")

print(f"\n{P} passed, {F} failed")
raise SystemExit(1 if F else 0)
