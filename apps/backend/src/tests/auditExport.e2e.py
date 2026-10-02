"""
Exporting the audit trail, and streaming it to the tenant's own collector.

The export is checked here without the database: every line's hash is the
SHA-256 of its canonical text, each line names the one before it, and the
last is the chain's head. The stream goes to a small collector this suite
runs, which checks every delivery's signature with the secret it was given
once, refuses one delivery to see it retried, and sees nothing skipped.
"""
import hashlib, hmac, http.server, json, os, socket, subprocess, threading, time

SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
s = json.load(open(f"{SP}/seed.json")); A, B = s['A'], s['B']
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
P = F = 0
GENESIS = "0" * 64


def call(m, p, t, body=None, raw=False):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "60", "-X", m,
           "-H", "Content-Type: application/json", "-H", f"Authorization: Bearer {t}", ROOT + p]
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    o = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8").stdout
    txt, _, code = o.rpartition("\n")
    if raw:
        return int(code or 0), txt
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


def chain_ok(rows, start_prev=GENESIS, start_seq=1):
    prev, seq = start_prev, start_seq
    for r in rows:
        if int(r["chain_seq"]) != seq or r["prev_hash"] != prev:
            return False, f"at {r['chain_seq']}"
        if hashlib.sha256(r["canonical"].encode("utf-8")).hexdigest() != r["row_hash"]:
            return False, f"hash at {r['chain_seq']}"
        prev, seq = r["row_hash"], seq + 1
    return True, ""


AT, BT, FT = A['token'], B['token'], A['facToken']
# A little activity first, so the chain is not empty.
co, r = call("POST", "/audit/streams", AT, {"url": "http://127.0.0.1:9/never"})
if co == 201:
    call("DELETE", f"/audit/streams/{r['data']['id']}", AT)

print("-- export --")
co, txt = call("GET", "/audit/export", AT, raw=True)
lines = [json.loads(l) for l in txt.splitlines() if l.strip()] if co == 200 else []
check("A's administrator exports A's trail as JSON lines", co == 200 and len(lines) >= 2, f"({co} {txt[:200]})")
check("only A's rows", all(l["tenant_id"] == A['tenantId'] for l in lines))
ok, where = chain_ok(lines)
check("and it checks out without the database: hashes, links, positions from 1", ok, where)
co, c = call("GET", "/audit/chain", AT)
check("its last line is the chain's head", lines and c["data"]["head"]["hash"] == lines[-1]["row_hash"], str(c.get("data", {}).get("head")))
canon = json.loads(lines[-1]["canonical"]) if lines else []
check("the canonical text is the row itself (its id and position)", canon[:3] == [int(lines[-1]["chain_seq"]), lines[-1]["prev_hash"], lines[-1]["id"]] if lines else False)

mid = len(lines) // 2
co, txt = call("GET", f"/audit/export?fromSeq={mid}&toSeq={mid + 1}", AT, raw=True)
part = [json.loads(l) for l in txt.splitlines() if l.strip()]
check("a slice by position", [int(p["chain_seq"]) for p in part] == [mid + 1] if mid + 1 <= len(lines) else True, str([p["chain_seq"] for p in part]))
ok, where = chain_ok(part, start_prev=lines[mid - 1]["row_hash"] if mid else GENESIS, start_seq=mid + 1) if part else (True, "")
check("which links onto the full export", ok, where)

co, txt = call("GET", "/audit/export", BT, raw=True)
blines = [json.loads(l) for l in txt.splitlines() if l.strip()] if co == 200 else []
a_ids = {l["id"] for l in lines}
check("B's administrator gets B's rows only", co == 200 and all(l["tenant_id"] == B['tenantId'] for l in blines) and not (a_ids & {l["id"] for l in blines}))
co, _ = call("GET", "/audit/export", FT, raw=True)
check("a lecturer may not export", co == 403, f"({co})")

print("-- streaming to the tenant's collector --")
received, fail_next, lock = [], {"n": 0}, threading.Lock()
secret_box = {}


class Collector(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        with lock:
            if fail_next["n"] > 0:
                fail_next["n"] -= 1
                self.send_response(500); self.end_headers(); return
            received.append((self.headers.get("X-Jjelo-Timestamp"), self.headers.get("X-Jjelo-Signature"), body))
        self.send_response(204); self.end_headers()

    def log_message(self, *a):
        pass


sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close()
server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Collector)
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{port}/audit"

co, r = call("POST", "/audit/streams", FT, {"url": url})
check("a lecturer cannot add a collector", co == 403, f"({co})")
co, r = call("POST", "/audit/streams", AT, {"url": "ftp://example.org/x"})
check("a non-HTTP address is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/audit/streams", AT, {"url": url, "fromStart": True})
check("A's administrator adds one, from the start of the trail", co == 201 and r["data"].get("secret"), f"({co} {r})")
target = r["data"]["id"] if co == 201 else None
secret = r["data"]["secret"] if co == 201 else ""
co, lst = call("GET", "/audit/streams", AT)
check("the secret is shown once, never listed", co == 200 and secret and secret not in json.dumps(lst), "")


def delivered_events():
    out = []
    with lock:
        for ts, sig, body in received:
            out.append((ts, sig, body))
    return out


def wait_for(pred, seconds=30):
    end = time.time() + seconds
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.5)
    return False


co, c = call("GET", "/audit/chain", AT)
head = c["data"]["head"]["seq"]
check("every row so far arrives", wait_for(lambda: sum(len(json.loads(b)["events"]) for _, _, b in delivered_events()) >= head),
      f"({sum(len(json.loads(b)['events']) for _, _, b in delivered_events())} of {head})")
good_sig = all(sig == "v1=" + hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
               for ts, sig, body in delivered_events())
check("every delivery is signed with the tenant's secret", bool(delivered_events()) and good_sig)
forged = "v1=" + hmac.new(b"not-the-secret", b"x", hashlib.sha256).hexdigest()
check("(a collector can tell a forgery: another key's signature differs)", bool(delivered_events()) and all(sig != forged for _, sig, _ in delivered_events()))
events = [e for _, _, b in delivered_events() for e in json.loads(b)["events"]]
check("only A's rows, in chain order, each naming the one before",
      [e["chainSeq"] for e in events[:head]] == list(range(1, head + 1))
      and all(events[i]["prevHash"] == events[i - 1]["rowHash"] for i in range(1, min(head, len(events)))),
      str([e["chainSeq"] for e in events[:12]]))
check("each event carries its canonical text, so its hash can be checked",
      bool(events) and all(hashlib.sha256(e["canonical"].encode()).hexdigest() == e["rowHash"] for e in events))

print("-- a collector that is down --")
with lock:
    fail_next["n"] = 1
    before = len(received)
co, r2 = call("POST", "/audit/streams", AT, {"url": "http://127.0.0.1:9/never"})
if co == 201:
    call("DELETE", f"/audit/streams/{r2['data']['id']}", AT)
co, c = call("GET", "/audit/chain", AT)
new_head = c["data"]["head"]["seq"]
check("a refused delivery is retried until it lands", wait_for(lambda: any(e["chainSeq"] == new_head for _, _, b in delivered_events()
                                                                            for e in json.loads(b)["events"]), 40))
seqs = sorted({e["chainSeq"] for _, _, b in delivered_events() for e in json.loads(b)["events"]})
check("and nothing is skipped", seqs == list(range(1, new_head + 1)), f"(missing {sorted(set(range(1, new_head + 1)) - set(seqs))})")
co, lst = call("GET", "/audit/streams", AT)
mine = [t for t in lst.get("data", []) if t["id"] == target]
check("the target records where it has got to", mine and int(mine[0]["last_seq"]) == new_head, str(mine))

co, _ = call("DELETE", f"/audit/streams/{target}", BT)
check("B cannot remove A's collector", co == 404, f"({co})")
co, _ = call("DELETE", f"/audit/streams/{target}", AT)
check("A's administrator removes it", co == 200, f"({co})")
server.shutdown()

print(f"\n{P} passed, {F} failed")
raise SystemExit(1 if F else 0)
