"""
Access requests: the public "Request access" form and the operator's view.

The form stores an enquiry from an organisation, and only what is needed to
reply to it. Checked: what is required, the formats (ISO 3166 country, E.164
phone), consent, the bot trap, that nothing extra is stored, and that only a
superadmin reads or changes the requests.
"""
import json, subprocess, sys, time, os

RUN = str(int(time.time()))[-6:]
SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
s = json.load(open(f"{SP}/seed.json")); ADMIN = s['A']['token']; STUDENT = s['A']['studentToken']
SA = json.load(open(f"{SP}/superadmin.json"))['token']
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api/access-requests"
P = F = 0

def call(m, p, t, body=None):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "25", "-X", m, "-H", "Content-Type: application/json"]
    if t:
        cmd += ["-H", f"Authorization: Bearer {t}"]
    cmd.append(ROOT + p)
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

VALID = {
    "organisationName": f"Harbour Academy {RUN}", "organisationType": "school", "countryCode": "lr",
    "sizeBand": "201-1000", "contactName": "Grace  Kollie", "jobTitle": "Registrar",
    "email": f"Grace.{RUN}@Harbour-Academy.example", "phone": "+231 (77) 123-4567",
    "preferredContact": "whatsapp", "message": "We would like a demo.", "consent": True,
}

print("-- the public form --")
co, r = call("POST", "", None, {**VALID, "consent": False})
check("consent to be contacted is required", co == 400 and 'contact' in r.get('error', ''), f"({co} {r})")
co, r = call("POST", "", None, {**VALID, "countryCode": "Liberia"})
check("country must be an ISO 3166 code", co == 400, f"({co} {r})")
co, r = call("POST", "", None, {**VALID, "phone": "0771234567"})
check("a phone number without its country code is refused", co == 400 and '+' in r.get('error', ''), f"({co} {r})")
co, r = call("POST", "", None, {**VALID, "phone": None})
check("WhatsApp as the preferred contact needs a phone number", co == 400, f"({co} {r})")
co, r = call("POST", "", None, {k: v for k, v in VALID.items() if k != "organisationType"})
check("the kind of organisation is required", co == 400, f"({co} {r})")

co, r = call("POST", "", None, {**VALID, "password": "hunter2", "dateOfBirth": "1990-01-01", "nationalId": "X1"})
check("a complete request is received", co == 201 and r.get('received') is True and r.get('reference'), f"({co} {r})")
ref = r.get('reference') if co == 201 else ''

co, r = call("POST", "", None, {**VALID, "organisationName": f"Bot Co {RUN}", "website": "http://spam.example"})
check("the bot trap answers as if received", co == 201 and r.get('received') is True, f"({co} {r})")

print("-- who may read them --")
co, r = call("GET", "", None)
check("reading requests needs a token", co in (401, 403), f"({co})")
co, r = call("GET", "", ADMIN)
check("a school administrator cannot read them", co == 403, f"({co} {r})")
co, r = call("GET", "", STUDENT)
check("a student cannot read them", co == 403, f"({co} {r})")

co, r = call("GET", "?status=new", SA)
mine = [x for x in r.get('requests', []) if x['organisation_name'] == VALID['organisationName']] if co == 200 else []
check("the superadmin reads the new requests", co == 200 and len(mine) == 1, f"({co} {len(mine)})")
row = mine[0] if mine else {}
check("the reference is the start of the request id", row.get('id', '').upper().startswith(ref), f"({ref} {row.get('id')})")
check("the phone is stored in E.164", row.get('phone') == '+231771234567', f"({row.get('phone')})")
check("the country is stored upper-case", row.get('country_code') == 'LR', f"({row.get('country_code')})")
check("the email is stored lower-case", row.get('email') == VALID['email'].lower(), f"({row.get('email')})")
check("the name is tidied", row.get('contact_name') == 'Grace Kollie', f"({row.get('contact_name')})")
check("consent is recorded with its version", bool(row.get('consent_at')) and bool(row.get('consent_version')), f"({row})")
check("nothing beyond the form's fields is stored",
      not any(k in row for k in ('password', 'date_of_birth', 'national_id', 'dateOfBirth')), f"({sorted(row)})")
co, r = call("GET", "", SA)
check("the bot's request was not stored",
      co == 200 and not any(x['organisation_name'] == f"Bot Co {RUN}" for x in r.get('requests', [])), f"({co})")

print("-- handling them --")
rid = row.get('id')
co, r = call("PATCH", f"/{rid}", ADMIN, {"status": "contacted"})
check("a school administrator cannot change a request", co == 403, f"({co} {r})")
co, r = call("PATCH", f"/{rid}", SA, {"status": "contacted", "internalNotes": "Called on WhatsApp; demo booked."})
check("the superadmin marks it contacted, with notes",
      co == 200 and r['request']['status'] == 'contacted' and r['request']['handled_by'], f"({co} {r})")
co, r = call("PATCH", f"/{rid}", SA, {"status": "archived"})
check("an unknown status is refused", co == 400, f"({co} {r})")
co, r = call("PATCH", "/not-a-uuid", SA, {"status": "closed"})
check("a malformed id reads as absent", co == 404, f"({co})")
co, r = call("PATCH", f"/{rid}", SA, {"status": "closed"})
check("and closes it", co == 200 and r['request']['status'] == 'closed', f"({co} {r})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
