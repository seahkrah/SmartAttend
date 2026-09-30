"""
Notification delivery.

The platform has had a notifications table since the beginning, and nothing
ever left the building: every writer inserted the row with status 'sent'
already set. So the assertions here lean hardest on the thing that was wrong —
that a message which went nowhere must never report itself as sent — and on
the rules that make an outbox worth having: a queued message cannot be edited,
a duplicate does not re-send, an opt-out is respected, a suppressed address is
not written to, and a template with a hole in it does not go out at all.

Alongside that, the usual four: function, tenant isolation, platform
independence (both SMS and EMS send), and role enforcement.
"""
import json, subprocess, sys, time, os
RUN = str(int(time.time()))[-6:]
SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
d = json.load(open(f"{SP}/seed.json")); A, B = d['A'], d['B']
c = json.load(open(f"{SP}/corp.json"))
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
P = F = 0

def call(m, p, t, body=None, base="/notifications"):
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

AT, BT = A['token'], B['token']
FA = A['facToken']
STOK = A.get('studentToken')
HR, EMP = c['A']['token'], c['A']['empToken']
STU_A = A['students'][0]
GHOST = "00000000-0000-4000-8000-000000000000"
SOON = time.strftime("%Y-%m-%d", time.localtime(time.time() + 86400 * 30))
PAST = time.strftime("%Y-%m-%d", time.localtime(time.time() - 86400 * 20))

# ---------------------------------------------------------------- the gate
print("-- authentication and roles --")
co, r = call("GET", "/channels", None)
check("notifications need a token", co in (401, 403), f"({co})")
co, r = call("GET", "/channels", FA)
check("faculty cannot read channel configuration", co == 403, f"({co} {r})")
co, r = call("GET", "/messages", FA)
check("faculty cannot read the outbox", co == 403, f"({co} {r})")
co, r = call("GET", "/inbox", FA)
check("but faculty can read their own inbox", co == 200, f"({co} {r})")

# Notifications are not gated on a platform: both SMS and EMS send.
co, r = call("GET", "/channels", HR)
check("an EMS administrator reaches their own channels", co == 200, f"({co} {r})")

# ---------------------------------------------------------------- channels
print("-- channels --")
co, r = call("GET", "/channels", AT)
check("read the channels", co == 200, f"({co} {r})")
chans = {x['channel']: x for x in r.get('channels', [])} if co == 200 else {}
check("all four channels are reported", len(chans) == 4, f"({list(chans)})")
check("in_app is ready without any configuration",
      chans.get('in_app', {}).get('ready') is True, f"({chans.get('in_app')})")
check("an unconfigured email channel falls back to the log provider",
      chans.get('email', {}).get('provider') == 'log', f"({chans.get('email')})")

co, r = call("PUT", "/channels/email", AT,
             {"provider": "smtp", "config": {"host": "smtp.example.test", "port": 587,
                                             "username": "school"},
              "fromAddress": f"noreply.{RUN}@e2e.test", "fromName": "E2E School A",
              "secretEnvVar": "E2E_SMTP_PASSWORD_NOT_SET"})
check("configure an SMTP channel", co == 200, f"({co} {r})")
check("a channel whose secret is unset is not ready",
      co == 200 and r.get('ready') is False, f"({co} {r})")
check("and says which variable is missing",
      co == 200 and 'E2E_SMTP_PASSWORD_NOT_SET' in str(r.get('reason')), f"({r.get('reason')})")

# The rule that keeps credentials out of a table many admins can read.
co, r = call("PUT", "/channels/email", AT,
             {"provider": "smtp",
              "config": {"host": "smtp.example.test", "password": "hunter2"},
              "fromAddress": "x@e2e.test"})
check("a password in the config blob is refused", co == 400, f"({co} {r})")
check("and the refusal says what to do instead",
      co == 400 and 'secretEnvVar' in str(r.get('error')), f"({r.get('error')})")

co, r = call("PUT", "/channels/email", AT,
             {"provider": "smtp", "config": {"host": "h", "apiKey": "sk-live-xxx"},
              "fromAddress": "x@e2e.test"})
check("an api key in the config blob is refused too", co == 400, f"({co} {r})")

co, r = call("PUT", "/channels/sms", AT,
             {"provider": "webhook", "config": {"url": "http://relay.e2e.test/send"},
              "secretEnvVar": "E2E_RELAY_SECRET"})
check("a plaintext relay URL is rejected on readiness",
      co == 200 and r.get('ready') is False, f"({co} {r})")
check("because the relay must be https",
      co == 200 and 'https' in str(r.get('reason')), f"({r.get('reason')})")

co, r = call("PUT", "/channels/email", AT, {"provider": "in_app", "fromAddress": "x@e2e.test"})
check("a provider that does not fit its channel is refused", co == 400, f"({co} {r})")

co, r = call("PUT", "/channels/nonsense", AT, {"provider": "log"})
check("an unknown channel is refused", co == 400, f"({co} {r})")

co, r = call("PUT", "/channels/email", FA, {"provider": "log"})
check("faculty cannot configure a channel", co == 403, f"({co} {r})")

# Back to something that can actually run, for the rest of the suite.
co, r = call("PUT", "/channels/email", AT,
             {"provider": "log", "fromAddress": f"noreply.{RUN}@e2e.test",
              "fromName": "E2E School A"})
check("fall back to the log provider", co == 200 and r.get('ready') is True, f"({co} {r})")

co, r = call("GET", "/channels", BT)
bchans = {x['channel']: x for x in r.get('channels', [])} if co == 200 else {}
check("tenant B's email channel is untouched by A's configuration",
      bchans.get('email', {}).get('provider') == 'log'
      and bchans.get('email', {}).get('fromAddress') is None,
      f"({bchans.get('email')})")

# --------------------------------------------------------------- templates
print("-- templates --")
co, r = call("GET", "/templates", AT)
check("read the templates", co == 200, f"({co} {r})")
events = {e['eventKey']: e for e in r.get('events', [])} if co == 200 else {}
check("the known events are listed", 'admission.offer' in events, f"({list(events)[:5]})")
check("an untouched event reports itself as a default",
      all(ch['source'] == 'default' for ch in events.get('admission.offer', {}).get('channels', [])),
      f"({events.get('admission.offer')})")

co, r = call("PUT", "/templates", AT,
             {"eventKey": "admission.offer", "channel": "email",
              "subject": "A place at {{ tenantName }} — {{ reference }}",
              "body": "Dear {{ firstName }}, we are delighted to offer you {{ programmeName }}."})
check("override a template", co == 200, f"({co} {r})")
tpl_id = r.get('template', {}).get('id') if co == 200 else None

co, r = call("PUT", "/templates", AT,
             {"eventKey": "admission.offer", "channel": "email",
              "subject": "Hello", "body": "Dear {{ firstName }}, your {{ inventedThing }} awaits."})
check("a template using a variable the event does not provide is refused",
      co == 400, f"({co} {r})")
check("and the refusal lists what is available",
      co == 400 and isinstance(r.get('available'), list), f"({r})")

co, r = call("PUT", "/templates", AT,
             {"eventKey": "not.a.real.event", "channel": "email",
              "subject": "x", "body": "y"})
check("a template for an event the system never raises is refused", co == 400, f"({co} {r})")

co, r = call("PUT", "/templates", AT,
             {"eventKey": "admission.offer", "channel": "email", "body": "No subject"})
check("an email template without a subject is refused", co == 400, f"({co} {r})")

co, r = call("PUT", "/templates", AT,
             {"eventKey": "admission.offer", "channel": "email",
              "subject": "x", "body": "   "})
check("an empty template body is refused", co == 400, f"({co} {r})")

co, r = call("GET", "/templates", AT)
events = {e['eventKey']: e for e in r.get('events', [])}
email_tpl = next(ch for ch in events['admission.offer']['channels'] if ch['channel'] == 'email')
check("the override is reported as the tenant's own",
      email_tpl['source'] == 'tenant', f"({email_tpl})")

co, r = call("GET", "/templates", BT)
bevents = {e['eventKey']: e for e in r.get('events', [])}
b_email = next(ch for ch in bevents['admission.offer']['channels'] if ch['channel'] == 'email')
check("tenant B still sees the platform default",
      b_email['source'] == 'default', f"({b_email})")

co, r = call("POST", "/templates/preview", AT,
             {"eventKey": "admission.offer", "channel": "email",
              "data": {"firstName": "Ama", "programmeName": "BSc Computing",
                       "reference": "A-123", "intakeName": "Sept"}})
check("preview a template", co == 200, f"({co} {r})")
check("preview substitutes the variables",
      co == 200 and 'Ama' in r.get('body', ''), f"({r.get('body')})")

co, r = call("POST", "/templates/preview", AT,
             {"eventKey": "admission.offer", "channel": "email", "data": {}})
check("preview names what is missing",
      co == 200 and 'firstName' in r.get('missing', []), f"({r.get('missing')})")

co, r = call("DELETE", f"/templates/{tpl_id}", BT)
check("tenant B cannot delete A's template", co == 404, f"({co} {r})")

co, r = call("DELETE", f"/templates/{tpl_id}", AT)
check("delete the override", co == 200 and r.get('revertedToDefault') is True, f"({co} {r})")

# ---------------------------------------------------- the honesty assertion
print("-- a simulated message is never reported as sent --")
co, r = call("POST", "/channels/email/test", AT, {})
check("send a test on the log-backed email channel", co == 200, f"({co} {r})")
result = r.get('result', {}) or {}
check("the test message is recorded as simulated, not sent",
      result.get('status') == 'simulated', f"({result})")
check("and says plainly that nothing was transmitted",
      'not sent' in str(result.get('provider_response', '')).lower(), f"({result})")
check("the provider is named as the log transport",
      result.get('provider') == 'log', f"({result})")

co, r = call("POST", "/channels/in_app/test", AT, {})
check("send a test on the in-app channel", co == 200, f"({co} {r})")
check("in-app delivery really is sent, because it went somewhere real",
      (r.get('result') or {}).get('status') == 'sent', f"({r.get('result')})")

co, r = call("GET", "/inbox", AT)
check("the in-app test lands in the sender's own inbox",
      co == 200 and any('test' in (n.get('body') or '').lower()
                        for n in r.get('notifications', [])), f"({co} {r})")

co, r = call("POST", "/channels/email/test", FA, {})
check("faculty cannot send a test", co == 403, f"({co} {r})")

# ------------------------------------------------------------- the outbox
print("-- the outbox --")
co, r = call("GET", "/messages", AT)
check("read the outbox", co == 200, f"({co} {r})")
msgs = r.get('messages', []) if co == 200 else []
check("the test messages are in it", len(msgs) >= 2, f"({len(msgs)})")
check("every message records its destination",
      all(m.get('destination') for m in msgs), f"({msgs[:1]})")
sim = next((m for m in msgs if m['status'] == 'simulated'), None)
check("a simulated message is visible as such in the outbox", sim is not None, f"({msgs[:2]})")

co, r = call("GET", f"/messages/{sim['id']}", AT)
check("read one message with its attempts", co == 200, f"({co} {r})")
check("the attempt log records the delivery",
      co == 200 and len(r.get('attempts', [])) >= 1, f"({r.get('attempts')})")
check("the attempt records which transport handled it",
      co == 200 and r['attempts'][0]['provider'] == 'log', f"({r.get('attempts')})")

co, r = call("GET", f"/messages/{sim['id']}", BT)
check("tenant B cannot read A's message", co == 404, f"({co} {r})")
co, r = call("POST", f"/messages/{sim['id']}/retry", BT, {})
check("tenant B cannot retry A's message", co == 404, f"({co} {r})")

co, r = call("POST", f"/messages/{sim['id']}/retry", AT, {})
check("a delivered message cannot be re-sent", co == 409, f"({co} {r})")

co, r = call("GET", "/messages", BT)
check("tenant B's outbox does not hold A's messages",
      co == 200 and sim['id'] not in [m['id'] for m in r.get('messages', [])], f"({co})")

co, r = call("GET", "/messages?channel=email", AT)
check("filter the outbox by channel",
      co == 200 and all(m['channel'] == 'email' for m in r.get('messages', [])), f"({co} {r})")

# ------------------------------------------------ admissions, end to end
print("-- admissions actually writes to applicants --")
co, r = call("POST", "/intakes", AT,
             {"code": f"NI{RUN}", "name": f"Notify intake {RUN}",
              "opensAt": PAST, "closesAt": SOON, "status": "open"}, base="/admissions")
intake = r.get('intake', {}).get('id') if co == 201 else None
check("an intake to apply to", co == 201, f"({co} {r})")

co, r = call("POST", "/applicants", AT,
             {"firstName": "Nia", "lastName": "Owusu", "email": f"nia.{RUN}@e2e.test",
              "phone": "0201234567"}, base="/admissions")
applicant = r.get('applicant', {}).get('id') if co == 201 else None
check("an applicant with an email address", co == 201, f"({co} {r})")

co, r = call("POST", "/programmes", AT,
             {"code": f"NP{RUN}", "name": f"BSc Notify {RUN}"}, base="/academics")
prog = r.get('programme', {}).get('id') if co == 201 else None

co, r = call("POST", "/applications", AT,
             {"applicantId": applicant, "intakeId": intake, "submit": True},
             base="/admissions")
app_id = r.get('application', {}).get('id') if co == 201 else None
check("submit an application", co == 201, f"({co} {r})")

co, r = call("GET", f"/messages?eventKey=admission.submitted", AT)
sub = [m for m in r.get('messages', []) if m['destination'] == f"nia.{RUN}@e2e.test"]
check("submitting writes to the applicant", len(sub) >= 1, f"({r.get('messages')})")
check("the acknowledgement is addressed to their email",
      any(m['channel'] == 'email' for m in sub), f"({sub})")

co, r = call("POST", f"/applications/{app_id}/transition", AT,
             {"to": "offer", "offeredProgrammeId": prog}, base="/admissions")
check("make an offer", co == 200, f"({co} {r})")

co, r = call("GET", "/messages?eventKey=admission.offer", AT)
offers = [m for m in r.get('messages', []) if m['destination'] == f"nia.{RUN}@e2e.test"]
check("the offer letter is queued", len(offers) >= 1, f"({r.get('messages')})")
check("the offer letter carries a subject",
      any(m.get('subject') for m in offers), f"({offers})")

# The dedupe rule: changing your mind is not a second offer.
co, r = call("POST", f"/applications/{app_id}/transition", AT,
             {"to": "withdrawn"}, base="/admissions")
co, r = call("GET", "/messages?eventKey=admission.offer", AT)
again = [m for m in r.get('messages', []) if m['destination'] == f"nia.{RUN}@e2e.test"]
check("the offer letter was written once", len(again) == len(offers), f"({len(again)} vs {len(offers)})")

co, r = call("GET", "/messages", BT)
check("the other school never sees the applicant's message",
      co == 200 and f"nia.{RUN}@e2e.test" not in [m['destination'] for m in r.get('messages', [])],
      f"({co})")

# ---------------------------------------------------------- suppressions
print("-- suppressions --")
co, r = call("POST", "/suppressions", AT,
             {"channel": "email", "destination": f"bounced.{RUN}@e2e.test",
              "reason": "hard_bounce", "note": "550 no such user"})
check("suppress an address", co == 201, f"({co} {r})")

co, r = call("POST", "/suppressions", FA, {"channel": "email", "destination": "x@e2e.test"})
check("faculty cannot suppress an address", co == 403, f"({co} {r})")

co, r = call("POST", "/applicants", AT,
             {"firstName": "Kojo", "lastName": "Bounced",
              "email": f"bounced.{RUN}@e2e.test"}, base="/admissions")
bounced_applicant = r.get('applicant', {}).get('id') if co == 201 else None

co, r = call("POST", "/applications", AT,
             {"applicantId": bounced_applicant, "intakeId": intake, "submit": True},
             base="/admissions")
check("an application from the suppressed address is still accepted", co == 201, f"({co} {r})")

co, r = call("GET", "/messages", AT)
check("but nothing is queued to the suppressed address",
      co == 200 and not any(m['destination'] == f"bounced.{RUN}@e2e.test"
                            and m['channel'] == 'email'
                            for m in r.get('messages', [])),
      f"({[m['destination'] for m in r.get('messages', [])][:5]})")

co, r = call("GET", "/suppressions", AT)
sup = r.get('suppressions', []) if co == 200 else []
check("read the suppression list", co == 200 and len(sup) >= 1, f"({co} {r})")
sup_id = sup[0]['id'] if sup else None

co, r = call("GET", "/suppressions", BT)
check("tenant B's suppression list is its own",
      co == 200 and sup_id not in [x['id'] for x in r.get('suppressions', [])], f"({co} {r})")

co, r = call("DELETE", f"/suppressions/{sup_id}", BT)
check("tenant B cannot lift A's suppression", co == 404, f"({co} {r})")
co, r = call("DELETE", f"/suppressions/{sup_id}", AT)
check("lift the suppression", co == 200, f"({co} {r})")

# ----------------------------------------------------------- preferences
print("-- preferences --")
if STOK:
    co, r = call("GET", "/preferences", STOK)
    check("a student reads their own preferences", co == 200, f"({co} {r})")
    prefs = r.get('preferences', []) if co == 200 else []
    check("every category and channel is listed, not only stored rows",
          len(prefs) > 4, f"({len(prefs)})")
    check("nothing stored means opted in",
          all(p['enabled'] for p in prefs), f"({[p for p in prefs if not p['enabled']][:2]})")
    check("account messages are marked as not switchable",
          any(p['locked'] for p in prefs if p['category'] == 'account'), f"({prefs[:3]})")

    co, r = call("PUT", "/preferences", STOK,
                 {"category": "fees", "channel": "email", "enabled": False})
    check("a student turns off fee emails", co == 200, f"({co} {r})")

    co, r = call("PUT", "/preferences", STOK,
                 {"category": "account", "channel": "email", "enabled": False})
    check("account messages cannot be turned off", co == 409, f"({co} {r})")

    co, r = call("PUT", "/preferences", STOK,
                 {"category": "system", "channel": "email", "enabled": False})
    check("system messages cannot be turned off either", co == 409, f"({co} {r})")

    co, r = call("PUT", "/preferences", STOK, {"category": "fees", "channel": "carrier-pigeon",
                                               "enabled": False})
    check("an unknown channel is refused", co == 400, f"({co} {r})")

    # Now bill them and check the opt-out is honoured.
    co, r = call("POST", "/invoices", AT,
                 {"studentId": STU_A, "issue": True, "currency": "GHS",
                  "lines": [{"code": "T", "description": f"Notify test {RUN}",
                             "unitAmount": "100.00"}]}, base="/fees")
    inv = r.get('invoice', {}).get('id') if co == 201 else None
    check("raise and issue an invoice", co == 201, f"({co} {r})")

    # Scoped to this invoice: earlier suites bill the same student, and those
    # messages were queued before the opt-out existed.
    co, r = call("GET", f"/messages?relatedId={inv}", AT)
    mine = r.get('messages', []) if co == 200 else []
    check("the outbox can be asked what was sent about one invoice",
          len(mine) >= 1, f"({co} {r})")
    check("no fee email is queued for the student who opted out",
          not any(m['channel'] == 'email' for m in mine), f"({mine})")
    check("but the in-app notice still goes, because only email was turned off",
          any(m['channel'] == 'in_app' for m in mine), f"({mine})")

    # Nothing is in the inbox yet, because the outbox has not been drained:
    # an in-app row is created by delivery, not by queueing.
    co, r = call("GET", "/inbox", STOK)
    before = len(r.get('notifications', [])) if co == 200 else 0
    check("a queued in-app message is not in the inbox until it is delivered",
          co == 200 and not any('100.00' in (n.get('body') or '')
                                for n in r.get('notifications', [])), f"({co} {r})")

    # Swept until it comes back empty, not once. A sweep claims a bounded
    # batch of this tenant's outbox oldest-first, so where earlier suites have
    # already queued a batch's worth for this school, one sweep never reaches
    # a message queued a moment ago. That is the dispatcher working as designed;
    # assuming a single sweep drains everything is what put this assertion on
    # a knife edge.
    co = 0
    for _ in range(10):
        co, r = call("POST", "/dispatch", AT, {})
        if co != 200 or (r.get('swept', {}).get('claimed') or 0) == 0:
            break
    check("drain the outbox", co == 200, f"({co} {r})")

    co, r = call("GET", "/inbox", STOK)
    check("the student sees the invoice in their inbox once it is delivered",
          co == 200 and any('100.00' in (n.get('body') or '')
                            for n in r.get('notifications', [])), f"({co} {r})")
    note_id = next((n['id'] for n in r.get('notifications', [])), None)
    check("the inbox reports an unread count",
          co == 200 and isinstance(r.get('unread'), int) and r['unread'] >= 1, f"({r.get('unread')})")

    co, r = call("POST", f"/inbox/{note_id}/read", STOK)
    check("mark a notification as read", co == 200, f"({co} {r})")
    check("reading stamps when", r.get('notification', {}).get('read_at') is not None, f"({r})")

    # The decisive case: one person's inbox is not another's.
    co, r = call("POST", f"/inbox/{note_id}/read", AT)
    check("another user cannot mark that notification read", co == 404, f"({co} {r})")

    co, r = call("GET", "/inbox?unread=true", STOK)
    check("the unread filter excludes what was just read",
          co == 200 and note_id not in [n['id'] for n in r.get('notifications', [])], f"({co} {r})")

    co, r = call("POST", "/inbox/read-all", STOK)
    check("mark everything read", co == 200, f"({co} {r})")
    co, r = call("GET", "/inbox", STOK)
    check("nothing is unread afterwards", co == 200 and r.get('unread') == 0, f"({r.get('unread')})")
else:
    check("student token present in the fixture", False, "(seed.json has no studentToken)")

# -------------------------------------------------------------------- EMS
print("-- EMS sends too --")
co, r = call("GET", "/overview", HR)
check("an EMS administrator reads their overview", co == 200, f"({co} {r})")

co, r = call("GET", "/messages", HR)
check("the EMS outbox is separate from the SMS one",
      co == 200 and not any(m['destination'] == f"nia.{RUN}@e2e.test"
                            for m in r.get('messages', [])), f"({co})")

co, r = call("GET", "/inbox", EMP)
check("an employee reads their own inbox", co == 200, f"({co} {r})")
co, r = call("GET", "/channels", EMP)
check("an employee cannot read channel configuration", co == 403, f"({co} {r})")

# ------------------------------------------------------------- dispatcher
print("-- the dispatcher --")
co, r = call("POST", "/dispatch", AT, {})
check("run the dispatcher on demand", co == 200, f"({co} {r})")
swept = r.get('swept', {}) if co == 200 else {}
check("the sweep reports what it did",
      all(k in swept for k in ('claimed', 'sent', 'simulated', 'failed')), f"({swept})")

co, r = call("POST", "/dispatch", FA, {})
check("faculty cannot run the dispatcher", co == 403, f"({co} {r})")

# The SMS channel still points at a plaintext relay, so its messages have been
# correctly parked rather than destroyed — a misconfiguration is retryable
# because fixing it releases everything queued behind it.
co, r = call("GET", "/messages?status=pending&channel=sms", AT)
parked = r.get('messages', []) if co == 200 else []
check("messages on a misconfigured channel wait rather than fail",
      len(parked) >= 1, f"({parked})")
check("and the outbox says exactly what is wrong",
      all('https' in str(m.get('last_error')) for m in parked), f"({parked})")
check("without having burned all their attempts",
      all(m['attempts'] < m['max_attempts'] for m in parked), f"({parked})")

# Repointing the channel should release them.
co, r = call("PUT", "/channels/sms", AT, {"provider": "log"})
check("repoint the SMS channel at something that works", co == 200, f"({co} {r})")

# next_attempt_at is in the future after the backoff, so the retry is what
# makes them due now; this is the same button an administrator would press.
for m in parked:
    call("POST", f"/messages/{m['id']}/retry", AT, {})
co, r = call("POST", "/dispatch", AT, {})
check("a second sweep after the fix", co == 200, f"({co} {r})")

co, r = call("GET", "/messages?status=pending", AT)
check("nothing is left pending once every channel works",
      co == 200 and len(r.get('messages', [])) == 0, f"({r.get('messages')})")

co, r = call("GET", "/messages?channel=sms", AT)
check("the previously parked messages went out",
      co == 200 and all(m['status'] in ('sent', 'simulated')
                        for m in r.get('messages', [])), f"({r.get('messages')})")

co, r = call("GET", "/overview", AT)
check("read the overview", co == 200, f"({co} {r})")
check("the overview separates simulated from sent",
      co == 200 and 'simulated' in r.get('byStatus', {}), f"({r.get('byStatus')})")
check("the overview reports channel readiness",
      co == 200 and len(r.get('channels', [])) == 4, f"({r.get('channels')})")

co, r = call("GET", f"/messages/{GHOST}", AT)
check("an unknown message is 404", co == 404, f"({co})")
co, r = call("GET", "/messages/not-a-uuid", AT)
check("a malformed message id is 404 rather than a 500", co == 404, f"({co})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
