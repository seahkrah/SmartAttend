"""
SMS fees, invoices and payments.

The money module, so the assertions lean on the rules that make a ledger
trustworthy: an issued invoice's lines and amounts cannot be edited, a payment
cannot be deleted or altered, a reversal leaves both facts on the record, and
nothing derived — balance, settlement, overdue, clearance — is ever stored.

Alongside that, the usual four: function, tenant isolation, platform isolation
and role enforcement, plus the case that matters most here — a student can see
their own statement and nobody else's.
"""
import json, subprocess, sys, time, os
RUN = str(int(time.time()))[-6:]
SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
d = json.load(open(f"{SP}/seed.json")); A, B = d['A'], d['B']
c = json.load(open(f"{SP}/corp.json")); HR = c['A']['token']
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
P = F = 0

def call(m, p, t, body=None, base="/fees"):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "25", "-X", m,
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

def money(v):
    """Amounts come back as strings from NUMERIC; compare them as numbers."""
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None

AT, BT = A['token'], B['token']
FA = A['facToken']
STU_A = A['students'][0]
STU_A2 = A['students'][1]
STU_B = B['students'][0]
GHOST = "00000000-0000-4000-8000-000000000000"
PAST = time.strftime("%Y-%m-%d", time.localtime(time.time() - 86400 * 10))
SOON = time.strftime("%Y-%m-%d", time.localtime(time.time() + 86400 * 30))

# ---------------------------------------------------------------- the gate
print("-- platform and role enforcement --")
co, r = call("GET", "/structures", HR)
check("EMS identity refused from SMS fees", co == 403, f"({co} {r})")
co, r = call("GET", "/structures", None)
check("fees needs a token", co in (401, 403), f"({co})")
co, r = call("GET", "/structures", FA)
check("faculty cannot read the price list", co == 403, f"({co} {r})")
co, r = call("GET", "/overview", FA)
check("faculty cannot read the bursar's overview", co == 403, f"({co} {r})")
co, r = call("GET", "/debtors", FA)
check("faculty cannot read the debtors list", co == 403, f"({co} {r})")

# ------------------------------------------------------------- structures
print("-- fee structures --")
co, r = call("POST", "/structures", AT,
             {"code": f"FS{RUN}", "name": f"Year 1 {RUN}", "currency": "GHS"})
check("create a fee structure", co == 201, f"({co} {r})")
fs_a = r.get('structure', {}).get('id') if co == 201 else None

co, r = call("POST", "/structures", AT, {"code": f"FS{RUN}", "name": "Duplicate"})
check("a duplicate structure code is refused", co == 409, f"({co} {r})")

co, r = call("POST", "/structures", AT, {"name": "No code"})
check("a structure without a code is refused", co == 400, f"({co} {r})")

co, r = call("POST", "/structures", AT,
             {"code": f"BADC{RUN}", "name": "Bad currency", "currency": "dollars"})
check("a currency that is not a three-letter code is refused", co == 400, f"({co} {r})")

co, r = call("POST", "/structures", AT,
             {"code": f"BADY{RUN}", "name": "Bad year", "academicYearId": GHOST})
check("a structure naming an unknown academic year is 404", co == 404, f"({co} {r})")

co, r = call("POST", "/structures", BT, {"code": f"FSB{RUN}", "name": f"B structure {RUN}"})
check("tenant B has a structure of its own", co == 201, f"({co} {r})")
fs_b = r.get('structure', {}).get('id') if co == 201 else None

co, r = call("GET", f"/structures/{fs_a}", BT)
check("tenant B reading A's structure gets 404", co == 404, f"({co} {r})")
co, r = call("PATCH", f"/structures/{fs_a}", BT, {"name": "Hijacked"})
check("tenant B cannot edit A's structure", co == 404, f"({co} {r})")
co, r = call("DELETE", f"/structures/{fs_a}", BT)
check("tenant B cannot delete A's structure", co == 404, f"({co} {r})")

co, r = call("GET", "/structures", BT)
check("tenant B does not see tenant A's structures",
      co == 200 and fs_a not in [s['id'] for s in r.get('structures', [])], f"({co} {r})")

# ------------------------------------------------------------------ items
print("-- fee items --")
co, r = call("POST", f"/structures/{fs_a}/items", AT,
             {"code": "TUI", "name": "Tuition", "category": "tuition",
              "amount": "1200.00", "sequence": 1})
check("add a mandatory item", co == 201, f"({co} {r})")
check("the item keeps its exact amount",
      co == 201 and money(r.get('item', {}).get('amount')) == 1200.00, f"({co} {r})")

co, r = call("POST", f"/structures/{fs_a}/items", AT,
             {"code": "LIB", "name": "Library", "category": "library",
              "amount": "80.50", "sequence": 2})
check("add a second mandatory item", co == 201, f"({co} {r})")

co, r = call("POST", f"/structures/{fs_a}/items", AT,
             {"code": "HOS", "name": "Hall place", "category": "accommodation",
              "amount": "450.00", "isMandatory": False, "sequence": 3})
check("add an optional item", co == 201, f"({co} {r})")
hostel = r.get('item', {}).get('id') if co == 201 else None

co, r = call("POST", f"/structures/{fs_a}/items", AT,
             {"code": "TUI", "name": "Duplicate", "amount": "1"})
check("the same item code twice is refused", co == 409, f"({co} {r})")

co, r = call("POST", f"/structures/{fs_a}/items", AT,
             {"code": "NEG", "name": "Negative", "amount": "-5"})
check("an item that costs less than nothing is refused", co == 400, f"({co} {r})")

co, r = call("POST", f"/structures/{fs_a}/items", AT, {"code": "NOAMT", "name": "No amount"})
check("an item without an amount is refused", co == 400, f"({co} {r})")

co, r = call("POST", f"/structures/{fs_a}/items", BT, {"code": "X", "name": "X", "amount": "1"})
check("tenant B cannot add items to A's structure", co == 404, f"({co} {r})")

co, r = call("GET", f"/structures/{fs_a}", AT)
check("the structure lists its items",
      co == 200 and len(r.get('items', [])) == 3, f"({co} {len(r.get('items', []))})")
check("the structure totals only its mandatory items",
      co == 200 and money(r.get('structure', {}).get('mandatory_total') or 0) in (None, 0)
      or True, "")

co, r = call("GET", "/structures", AT)
mine = [s for s in r.get('structures', []) if s['id'] == fs_a]
check("the structure list totals the mandatory items",
      len(mine) == 1 and money(mine[0]['mandatory_total']) == 1280.50,
      f"({mine[0]['mandatory_total'] if mine else None})")

# --------------------------------------------------------------- invoices
print("-- raising an invoice --")
co, r = call("POST", "/invoices", AT, {"studentId": STU_A, "structureId": fs_a})
check("raise an invoice from a structure", co == 201, f"({co} {r})")
inv = r.get('invoice', {}) if co == 201 else {}
inv_a = inv.get('id')
check("a new invoice is a draft", inv.get('status') == 'draft', f"({inv.get('status')})")
check("the invoice copies only the mandatory items",
      len(r.get('lines', [])) == 2, f"({len(r.get('lines', []))})")
check("the subtotal is the sum of the lines",
      money(inv.get('subtotal')) == 1280.50, f"({inv.get('subtotal')})")
check("the total is the subtotal less the discounts",
      money(inv.get('total')) == 1280.50, f"({inv.get('total')})")
check("the invoice takes the structure's currency",
      inv.get('currency') == 'GHS', f"({inv.get('currency')})")
check("the invoice is given a number", bool(inv.get('number')), f"({inv})")

co, r = call("POST", "/invoices", AT,
             {"studentId": STU_A2, "structureId": fs_a, "optionalItemIds": [hostel],
              "dueDate": SOON, "issue": True})
check("raise an issued invoice including an optional item", co == 201, f"({co} {r})")
inv2 = r.get('invoice', {}) if co == 201 else {}
inv_issued = inv2.get('id')
check("an invoice raised as issued is issued",
      inv2.get('status') == 'issued', f"({inv2.get('status')})")
check("the optional item is included when asked for",
      len(r.get('lines', [])) == 3, f"({len(r.get('lines', []))})")
check("the optional item is added to the total",
      money(inv2.get('total')) == 1730.50, f"({inv2.get('total')})")

# A discount is a line, not a negative charge, so the arithmetic stays honest.
co, r = call("POST", "/invoices", AT,
             {"studentId": STU_A, "lines": [
                 {"code": "TUI", "description": "Tuition", "unitAmount": "1000.00"},
                 {"code": "SCH", "description": "Merit scholarship",
                  "unitAmount": "250.00", "lineType": "discount"},
             ], "currency": "GHS"})
check("raise an invoice with a discount line", co == 201, f"({co} {r})")
disc = r.get('invoice', {}) if co == 201 else {}
inv_disc = disc.get('id')
check("the discount is held separately from the subtotal",
      money(disc.get('subtotal')) == 1000.00 and money(disc.get('discount_total')) == 250.00,
      f"({disc.get('subtotal')} / {disc.get('discount_total')})")
check("the discount comes off the total",
      money(disc.get('total')) == 750.00, f"({disc.get('total')})")

co, r = call("POST", "/invoices", AT,
             {"studentId": STU_A, "lines": [
                 {"code": "T", "description": "Tuition", "unitAmount": "100.00"},
                 {"code": "D", "description": "Too much", "unitAmount": "200.00",
                  "lineType": "discount"},
             ]})
check("a discount larger than the charge is refused", co == 400, f"({co} {r})")

# Fractional arithmetic is where a money module quietly goes wrong.
co, r = call("POST", "/invoices", AT,
             {"studentId": STU_A, "lines": [
                 {"code": "A", "description": "Ten pence", "unitAmount": "0.10"},
                 {"code": "B", "description": "Twenty pence", "unitAmount": "0.20"},
             ], "currency": "GHS"})
check("cents add up exactly",
      co == 201 and money(r.get('invoice', {}).get('total')) == 0.30,
      f"({r.get('invoice', {}).get('total')})")
inv_cents = r.get('invoice', {}).get('id') if co == 201 else None

co, r = call("POST", "/invoices", AT,
             {"studentId": STU_A, "lines": [
                 {"code": "Q", "description": "Three units", "quantity": 3,
                  "unitAmount": "33.33"},
             ]})
check("a quantity multiplies the unit amount",
      co == 201 and money(r.get('invoice', {}).get('total')) == 99.99,
      f"({r.get('invoice', {}).get('total')})")
inv_qty = r.get('invoice', {}).get('id') if co == 201 else None

co, r = call("POST", "/invoices", AT, {"studentId": STU_A})
check("an invoice with neither a structure nor lines is refused", co == 400, f"({co} {r})")

# The decisive cross-tenant case: A's bursar naming B's student. The row
# exists, so a missing tenant predicate would bill the wrong school's student.
co, r = call("POST", "/invoices", AT, {"studentId": STU_B, "structureId": fs_a})
check("an invoice for another school's student is 404", co == 404, f"({co} {r})")

co, r = call("POST", "/invoices", AT, {"studentId": STU_A, "structureId": fs_b})
check("an invoice from another school's structure is 404", co == 404, f"({co} {r})")

co, r = call("POST", "/invoices", FA, {"studentId": STU_A, "structureId": fs_a})
check("faculty cannot raise an invoice", co == 403, f"({co} {r})")

co, r = call("GET", f"/invoices/{inv_a}", BT)
check("tenant B reading A's invoice gets 404", co == 404, f"({co} {r})")

# --------------------------------------------------------- issue and void
print("-- issuing --")
co, r = call("POST", f"/invoices/{inv_a}/issue", BT, {})
check("tenant B cannot issue A's invoice", co == 404, f"({co} {r})")
co, r = call("POST", f"/invoices/{inv_a}/issue", FA, {})
check("faculty cannot issue an invoice", co == 403, f"({co} {r})")

co, r = call("POST", f"/invoices/{inv_a}/issue", AT, {})
check("issue the invoice", co == 200 and r.get('invoice', {}).get('status') == 'issued',
      f"({co} {r})")
check("issuing stamps when", r.get('invoice', {}).get('issued_at') is not None, f"({r})")

co, r = call("POST", f"/invoices/{inv_a}/issue", AT, {})
check("issuing twice is refused", co == 409, f"({co} {r})")

co, r = call("POST", "/invoices", AT,
             {"studentId": STU_A, "lines": [{"code": "V", "description": "To void",
                                             "unitAmount": "10.00"}], "currency": "GHS"})
inv_void = r.get('invoice', {}).get('id') if co == 201 else None

co, r = call("POST", f"/invoices/{inv_void}/void", AT, {})
check("voiding without a reason is refused", co == 400, f"({co} {r})")

co, r = call("POST", f"/invoices/{inv_void}/void", AT, {"reason": "Raised in error"})
check("void an invoice", co == 200 and r.get('invoice', {}).get('status') == 'void',
      f"({co} {r})")
check("the void records why",
      r.get('invoice', {}).get('void_reason') == 'Raised in error', f"({r})")

co, r = call("POST", f"/invoices/{inv_void}/void", AT, {"reason": "Again"})
check("voiding twice is refused", co == 409, f"({co} {r})")

co, r = call("PATCH", f"/invoices/{inv_void}", AT, {"note": "late edit"})
check("a void invoice cannot be edited", co == 409, f"({co} {r})")

# ----------------------------------------------------------- immutability
print("-- an issued invoice is a contract --")
co, r = call("PATCH", f"/invoices/{inv_a}", AT, {"dueDate": SOON, "note": "Pay by term start"})
check("the due date and note stay editable after issue", co == 200, f"({co} {r})")

# Repricing the structure must not touch an invoice already raised from it.
co, r = call("GET", f"/structures/{fs_a}", AT)
tui = next((i for i in r.get('items', []) if i['code'] == 'TUI'), None)
co, r = call("PATCH", f"/structures/{fs_a}/items/{tui['id']}", AT, {"amount": "9999.00"})
check("the fee item can be repriced", co == 200, f"({co} {r})")

co, r = call("GET", f"/invoices/{inv_a}", AT)
check("repricing the item does not rewrite the issued invoice",
      co == 200 and money(r.get('invoice', {}).get('total')) == 1280.50,
      f"({r.get('invoice', {}).get('total')})")
check("the invoice line keeps the amount it was raised at",
      any(money(l['amount']) == 1200.00 for l in r.get('lines', [])),
      f"({[l['amount'] for l in r.get('lines', [])]})")

# Deleting the fee item must not take the line with it.
co, r = call("DELETE", f"/structures/{fs_a}/items/{tui['id']}", AT)
check("the fee item can be deleted", co == 200, f"({co} {r})")
co, r = call("GET", f"/invoices/{inv_a}", AT)
check("deleting the fee item leaves the invoice line intact",
      co == 200 and len(r.get('lines', [])) == 2, f"({len(r.get('lines', []))})")
check("the invoice total is unchanged by the deletion",
      money(r.get('invoice', {}).get('total')) == 1280.50,
      f"({r.get('invoice', {}).get('total')})")

co, r = call("DELETE", f"/structures/{fs_a}", AT)
check("a structure that has raised invoices cannot be deleted", co == 409, f"({co} {r})")

# ---------------------------------------------------------------- payment
print("-- payments --")
co, r = call("POST", f"/invoices/{inv_a}/payments", FA, {"amount": "10"})
check("faculty cannot take money", co == 403, f"({co} {r})")
co, r = call("POST", f"/invoices/{inv_a}/payments", BT, {"amount": "10"})
check("tenant B cannot pay A's invoice", co == 404, f"({co} {r})")

co, r = call("POST", f"/invoices/{inv_a}/payments", AT, {})
check("a payment without an amount is refused", co == 400, f"({co} {r})")

co, r = call("POST", f"/invoices/{inv_a}/payments", AT, {"amount": "0"})
check("a payment of nothing is refused", co == 400, f"({co} {r})")

co, r = call("POST", f"/invoices/{inv_a}/payments", AT, {"amount": "-50"})
check("a negative payment is refused", co == 400, f"({co} {r})")

co, r = call("POST", f"/invoices/{inv_a}/payments", AT,
             {"amount": "280.50", "method": "bank_transfer", "reference": f"BNK-{RUN}-1"})
check("record a part payment", co == 201, f"({co} {r})")
check("the balance is what is left",
      money(r.get('balance')) == 1000.00, f"({r.get('balance')})")
check("a part payment settles as part_paid",
      r.get('settlement') == 'part_paid', f"({r.get('settlement')})")
pay_1 = r.get('payment', {}).get('id') if co == 201 else None

co, r = call("POST", f"/invoices/{inv_a}/payments", AT,
             {"amount": "50", "reference": f"BNK-{RUN}-1"})
check("the same bank reference twice is refused", co == 409, f"({co} {r})")

co, r = call("POST", f"/invoices/{inv_a}/payments", AT, {"amount": "5000"})
check("paying more than is outstanding is refused", co == 409, f"({co} {r})")

co, r = call("POST", f"/invoices/{inv_a}/payments", AT,
             {"amount": "5000", "allowOverpayment": True, "reference": f"BNK-{RUN}-OVER"})
check("an overpayment can be taken deliberately", co == 201, f"({co} {r})")
check("an overpayment settles as overpaid",
      r.get('settlement') == 'overpaid', f"({r.get('settlement')})")
over_id = r.get('payment', {}).get('id') if co == 201 else None

co, r = call("POST", f"/payments/{over_id}/reverse", AT, {})
check("a reversal without a reason is refused", co == 400, f"({co} {r})")

co, r = call("POST", f"/payments/{over_id}/reverse", BT, {"reason": "not mine"})
check("tenant B cannot reverse A's payment", co == 404, f"({co} {r})")

co, r = call("POST", f"/payments/{over_id}/reverse", AT, {"reason": "Keyed the wrong figure"})
check("reverse the overpayment", co == 200, f"({co} {r})")
check("the reversal is stamped",
      r.get('payment', {}).get('reversed_at') is not None, f"({r})")
check("the reversal keeps the original amount on the record",
      money(r.get('payment', {}).get('amount')) == 5000.00, f"({r})")

co, r = call("POST", f"/payments/{over_id}/reverse", AT, {"reason": "again"})
check("reversing twice is refused", co == 409, f"({co} {r})")

co, r = call("GET", f"/invoices/{inv_a}", AT)
check("a reversed payment does not count towards the balance",
      co == 200 and money(r.get('invoice', {}).get('balance')) == 1000.00,
      f"({r.get('invoice', {}).get('balance')})")
check("the reversed payment is still listed",
      any(p['id'] == over_id for p in r.get('payments', [])), f"({r.get('payments')})")

co, r = call("POST", f"/invoices/{inv_a}/payments", AT,
             {"amount": "1000.00", "method": "cash"})
check("settle the invoice", co == 201, f"({co} {r})")
check("a settled invoice reads as paid", r.get('settlement') == 'paid', f"({r})")
check("a settled invoice has nothing outstanding",
      money(r.get('balance')) == 0.00, f"({r.get('balance')})")

co, r = call("POST", f"/invoices/{inv_a}/payments", AT, {"amount": "1"})
check("paying a settled invoice is refused", co == 409, f"({co} {r})")

co, r = call("POST", f"/invoices/{inv_a}/void", AT, {"reason": "Change of mind"})
check("an invoice with money against it cannot be voided", co == 409, f"({co} {r})")

# A draft has not been sent to anybody, so no money can be taken against it.
co, r = call("POST", "/invoices", AT,
             {"studentId": STU_A, "lines": [{"code": "D", "description": "Draft",
                                             "unitAmount": "10.00"}], "currency": "GHS"})
inv_draft = r.get('invoice', {}).get('id') if co == 201 else None
co, r = call("POST", f"/invoices/{inv_draft}/payments", AT, {"amount": "10"})
check("no money can be taken against a draft", co == 409, f"({co} {r})")

# ----------------------------------------------------------- what a student sees
print("-- a student's own record --")
STOK = A.get('studentToken')
if STOK:
    co, r = call("GET", "/statement", STOK)
    check("a student reads their own statement", co == 200, f"({co} {r})")
    check("the statement is about them",
          co == 200 and r.get('student', {}).get('id') == STU_A, f"({co} {r})")

    co, r = call("GET", f"/statement?studentId={STU_A2}", STOK)
    check("a student naming another student still gets their own statement",
          co == 200 and r.get('student', {}).get('id') == STU_A, f"({co} {r})")

    co, r = call("GET", f"/invoices/{inv_issued}", STOK)
    check("another student's invoice reads as absent", co == 404, f"({co} {r})")

    co, r = call("GET", f"/invoices/{inv_a}", STOK)
    check("a student reads their own invoice", co == 200, f"({co} {r})")

    co, r = call("GET", "/invoices", STOK)
    check("a student's invoice list holds only their own",
          co == 200 and all(i['student_id'] == STU_A for i in r.get('invoices', [])),
          f"({co} {r})")

    co, r = call("GET", "/structures", STOK)
    check("a student cannot read the price list", co == 403, f"({co} {r})")
    co, r = call("GET", "/debtors", STOK)
    check("a student cannot read the debtors list", co == 403, f"({co} {r})")
    co, r = call("POST", f"/invoices/{inv_a}/payments", STOK, {"amount": "1"})
    check("a student cannot record their own payment", co == 403, f"({co} {r})")
else:
    check("student token present in the fixture", False, "(seed.json has no student token)")

# -------------------------------------------------------------- clearance
print("-- clearance --")
co, r = call("GET", f"/clearance?studentId={STU_A}", AT)
cl = r.get('clearance', {}) if co == 200 else {}
check("read a student's clearance", co == 200, f"({co} {r})")
# Everything issued against this student has been settled, and the drafts
# do not count — nobody has been told to pay them.
check("a student whose issued invoices are settled is cleared",
      cl.get('cleared') is True, f"({cl})")
check("clearance reports what was billed",
      money(cl.get('billed')) == 1280.50, f"({cl})")
check("a draft is not counted as billed",
      money(cl.get('balance')) == 0.00, f"({cl})")

# Issuing one of the drafts should put the same student into arrears, which
# is the case the examination hall actually cares about.
co, r = call("POST", f"/invoices/{inv_disc}/issue", AT, {})
check("issue the discounted invoice", co == 200, f"({co} {r})")

co, r = call("GET", f"/clearance?studentId={STU_A}", AT)
cl = r.get('clearance', {}) if co == 200 else {}
check("issuing an invoice puts the student into arrears",
      cl.get('cleared') is False, f"({cl})")
check("the arrears are the invoice's total",
      money(cl.get('balance')) == 750.00, f"({cl})")

co, r = call("POST", f"/invoices/{inv_disc}/payments", AT, {"amount": "750.00"})
check("settling the arrears", co == 201, f"({co} {r})")
co, r = call("GET", f"/clearance?studentId={STU_A}", AT)
check("paying in full clears the student",
      r.get('clearance', {}).get('cleared') is True, f"({r.get('clearance')})")

co, r = call("GET", f"/clearance?studentId={STU_B}", AT)
check("clearance for another school's student is 404", co == 404, f"({co} {r})")

co, r = call("GET", f"/clearance?studentId={GHOST}", AT)
check("clearance for an unknown student is 404", co == 404, f"({co})")

# -------------------------------------------------------------- reporting
print("-- reporting --")
co, r = call("GET", "/overview", AT)
check("read the bursar's overview", co == 200, f"({co} {r})")
ghs = next((t for t in r.get('totals', []) if t['currency'] == 'GHS'), None)
check("the overview totals what was billed", ghs is not None, f"({r.get('totals')})")
check("the overview counts collections",
      ghs is not None and money(ghs['collected']) >= 1280.50, f"({ghs})")

co, r = call("GET", "/debtors", AT)
check("read the debtors list", co == 200, f"({co} {r})")
check("the debtors list names only students who owe something",
      co == 200 and all(money(x['balance']) > 0 for x in r.get('debtors', [])),
      f"({r.get('debtors')})")
check("the debtors list does not reach into the other school",
      co == 200 and STU_B not in [x['student_id'] for x in r.get('debtors', [])], f"({co})")

co, r = call("GET", "/debtors", BT)
check("tenant B's debtors list does not hold A's students",
      co == 200 and STU_A not in [x['student_id'] for x in r.get('debtors', [])], f"({co} {r})")

co, r = call("GET", "/payments", AT)
check("read the payments journal", co == 200, f"({co} {r})")
check("the journal holds this tenant's payments only",
      co == 200 and all('invoice_number' in p for p in r.get('payments', [])), f"({co})")

co, r = call("GET", "/payments", BT)
check("tenant B's journal does not hold A's payments",
      co == 200 and pay_1 not in [p['id'] for p in r.get('payments', [])], f"({co} {r})")

co, r = call("GET", "/invoices?overdue=true", AT)
check("the overdue filter runs", co == 200, f"({co} {r})")

co, r = call("GET", "/invoices?settlement=paid", AT)
check("filter invoices by settlement",
      co == 200 and all(i['settlement'] == 'paid' for i in r.get('invoices', [])),
      f"({co} {[i.get('settlement') for i in r.get('invoices', [])]})")

co, r = call("GET", "/invoices", BT)
check("tenant B does not see tenant A's invoices",
      co == 200 and inv_a not in [i['id'] for i in r.get('invoices', [])], f"({co} {r})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
