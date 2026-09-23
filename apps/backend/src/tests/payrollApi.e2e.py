"""
EMS payroll — the largest gap the platform had.

An employee record carried a designation and a joining date and no indication
of what the person is paid. This covers the whole chain: the pay structure,
effective-dated compensation, the tax table, a period, a run, the arithmetic
that comes out of it, and the payslip an employee reads.

The assertions fall into four groups, and every endpoint is checked against
all four:

  function     the numbers are right, and right for the reason claimed
  tenant       one employer can never see, touch or infer another's payroll
  platform     a school identity cannot reach EMS payroll at all
  role         an employee cannot set salaries; nobody approves their own work

Salary is the most sensitive figure this system holds, so the isolation
assertions here are deliberately heavier than elsewhere: a foreign payslip
reads as 404, never 403, because a 403 confirms it exists.
"""
import json, subprocess, sys, time, os
from datetime import date, timedelta

RUN = str(int(time.time()))[-6:]
SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
c = json.load(open(f"{SP}/corp.json")); A, B = c['A'], c['B']
s = json.load(open(f"{SP}/seed.json")); SCHOOL = s['A']['token']
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
P = F = 0

def call(m, p, t, body=None, base="/payroll"):
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
    """A NUMERIC column as a float, for comparison only."""
    try:
        return round(float(v), 2)
    except Exception:
        return None

HR_A, HR_B = A['token'], B['token']
DIR_A, DIR_B = A['dirToken'], B['dirToken']
EMP_A, EMP_B = A['empToken'], B['empToken']
E_A1, E_A2, E_A3 = A['employees'][0], A['employees'][1], A['employees'][2]
E_B1 = B['employees'][0]
HR_EMP_A = A['hrEmpId']
GHOST = "00000000-0000-4000-8000-000000000000"

# A whole month, well clear of any other suite's dates and of the overlap
# constraint on periods. The month is picked from the run id so repeated runs
# of the suite do not collide with each other.
offset = int(RUN) % 720
year = 2030 + offset // 12
month = offset % 12 + 1
start = date(year, month, 1)
end = date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)
DAYS_IN_PERIOD = (end - start).days + 1
S, E = start.isoformat(), end.isoformat()
PAY = (end).isoformat()
# Every date this suite writes hangs off its own period, so running it twice
# against one fixture supersedes the earlier run rather than stacking on top
# of it. A fixed date like 2020-01-01 would be refused the second time by the
# one-salary-per-effective-date rule, and bounded component assignments keep
# an earlier run's allowances out of this run's month.
PRIOR = date(year - 1, 1, 1).isoformat()

print(f"-- period {S} .. {E} ({DAYS_IN_PERIOD} days) --")

print("-- platform and authentication isolation --")
co, r = call("GET", "/components", SCHOOL)
check("an SMS identity is refused from EMS payroll", co == 403, f"({co} {r})")
co, r = call("GET", "/components", None)
check("payroll needs a token", co in (401, 403), f"({co})")
co, r = call("GET", "/periods", SCHOOL)
check("an SMS identity cannot list payroll periods", co == 403, f"({co} {r})")
co, r = call("GET", "/my/payslips", SCHOOL)
check("an SMS identity cannot read EMS payslips", co == 403, f"({co} {r})")

print("-- salary components --")
co, r = call("POST", "/components", HR_A, {
    "code": f"HOUSE{RUN}", "name": "Housing allowance", "kind": "earning",
    "calculation": "percent_of_basic", "defaultRate": 20, "sequence": 1})
check("HR defines a percentage earning", co == 201, f"({co} {r})")
house = r.get('component', {}).get('id') if co == 201 else None

co, r = call("POST", "/components", HR_A, {
    "code": f"TRANS{RUN}", "name": "Transport", "kind": "earning",
    "calculation": "fixed", "defaultAmount": 100, "isTaxable": False, "sequence": 2})
check("a non-taxable fixed earning is allowed", co == 201, f"({co} {r})")
transport = r.get('component', {}).get('id') if co == 201 else None

co, r = call("POST", "/components", HR_A, {
    "code": f"PENS{RUN}", "name": "Pension", "kind": "deduction",
    "calculation": "percent_of_basic", "defaultRate": 5,
    "reducesTaxable": True, "isStatutory": True, "sequence": 3})
check("a pre-tax statutory deduction is allowed", co == 201, f"({co} {r})")
pension = r.get('component', {}).get('id') if co == 201 else None

co, r = call("POST", "/components", HR_A, {
    "code": f"LOAN{RUN}", "name": "Staff loan", "kind": "deduction",
    "calculation": "fixed", "defaultAmount": 50, "sequence": 4})
check("a post-tax deduction is allowed", co == 201, f"({co} {r})")
loan = r.get('component', {}).get('id') if co == 201 else None

co, r = call("POST", "/components", HR_A, {
    "code": f"OT{RUN}", "name": "Overtime", "kind": "earning",
    "calculation": "fixed", "defaultAmount": 0, "sequence": 5})
check("an overtime component is allowed", co == 201, f"({co} {r})")
overtime = r.get('component', {}).get('id') if co == 201 else None

co, r = call("POST", "/components", HR_A, {
    "code": f"BAD{RUN}", "name": "No basis", "kind": "earning", "calculation": "fixed"})
check("a fixed component with no amount is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/components", HR_A, {
    "code": f"BAD2{RUN}", "name": "No rate", "kind": "earning",
    "calculation": "percent_of_basic"})
check("a percentage component with no rate is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/components", HR_A, {
    "code": f"BAD3{RUN}", "name": "Neither", "kind": "stipend", "defaultAmount": 5})
check("an unknown kind is refused", co == 400, f"({co} {r})")

co, r = call("POST", "/components", EMP_A, {
    "code": f"SELF{RUN}", "name": "Self award", "kind": "earning",
    "calculation": "fixed", "defaultAmount": 9999})
check("an employee cannot define pay components", co == 403, f"({co} {r})")

co, r = call("POST", "/components", HR_B, {
    "code": f"HOUSE{RUN}", "name": "Housing", "kind": "earning",
    "calculation": "percent_of_basic", "defaultRate": 30})
check("B may reuse A's component code", co == 201, f"({co} {r})")
house_b = r.get('component', {}).get('id') if co == 201 else None
co, r = call("POST", "/components", HR_A, {
    "code": f"HOUSE{RUN}", "name": "Duplicate", "kind": "earning",
    "calculation": "fixed", "defaultAmount": 1})
check("still unique within A", co == 409, f"({co} {r})")

co, r = call("GET", "/components", HR_A)
a_ids = [x['id'] for x in r.get('components', [])] if co == 200 else []
check("A's components do not include B's", house_b not in a_ids, f"({len(a_ids)})")
co, r = call("PATCH", f"/components/{house_b}", HR_A, {"name": "hijacked"})
check("A cannot edit B's component", co == 404, f"({co} {r})")
co, r = call("DELETE", f"/components/{house_b}", HR_A)
check("A cannot delete B's component", co == 404, f"({co} {r})")
co, r = call("GET", "/components", HR_B)
b_names = {x['id']: x['name'] for x in r.get('components', [])} if co == 200 else {}
check("B's component is untouched", b_names.get(house_b) == "Housing", f"({b_names})")

print("-- compensation --")
co, r = call("POST", f"/employees/{E_A1}/compensation", HR_A, {
    "basicSalary": 1000, "effectiveFrom": PRIOR, "currency": "USD"})
check("HR records a salary", co == 201, f"({co} {r})")
co, r = call("POST", f"/employees/{E_A1}/compensation", HR_A, {
    "basicSalary": 2000, "effectiveFrom": S, "reason": "Promotion"})
check("a raise is a new record, not an edit", co == 201, f"({co} {r})")
co, r = call("POST", f"/employees/{E_A1}/compensation", HR_A, {
    "basicSalary": 3000, "effectiveFrom": S})
check("two salaries the same day are refused", co == 409, f"({co} {r})")

co, r = call("GET", f"/employees/{E_A1}/compensation", HR_A)
check("the history keeps the superseded record as well as the new one",
      co == 200 and len(r.get('compensation', [])) >= 2, f"({co} {r})")
if co == 200 and r.get('compensation'):
    check("the latest record is first",
          money(r['compensation'][0]['basic_salary']) == 2000.0
          and r['compensation'][0]['reason'] == 'Promotion', f"({r['compensation'][0]})")
    check("the earlier salary is still on the record",
          any(money(x['basic_salary']) == 1000.0 for x in r['compensation']),
          f"({r['compensation']})")

co, r = call("POST", f"/employees/{E_A2}/compensation", HR_A, {
    "basicSalary": 1200, "effectiveFrom": S})
check("a second employee is paid", co == 201, f"({co} {r})")
co, r = call("POST", f"/employees/{HR_EMP_A}/compensation", HR_A, {
    "basicSalary": 5000, "effectiveFrom": S})
check("HR cannot set their own compensation", co == 403, f"({co} {r})")

co, r = call("POST", f"/employees/{E_A1}/compensation", HR_A, {
    "basicSalary": 100, "effectiveFrom": "not-a-date"})
check("a malformed effective date is refused", co == 400, f"({co} {r})")
co, r = call("POST", f"/employees/{E_A1}/compensation", HR_A, {
    "basicSalary": -100, "effectiveFrom": PRIOR})
check("a negative salary is refused", co == 400, f"({co} {r})")
co, r = call("POST", f"/employees/{E_A1}/compensation", HR_A, {
    "basicSalary": 100, "effectiveFrom": PRIOR, "payFrequency": "hourly"})
check("an unknown pay frequency is refused", co == 400, f"({co} {r})")

co, r = call("POST", f"/employees/{E_B1}/compensation", HR_A, {
    "basicSalary": 1, "effectiveFrom": S})
check("A cannot set a salary in B", co == 404, f"({co} {r})")
co, r = call("GET", f"/employees/{E_B1}/compensation", HR_A)
check("A cannot read B's compensation", co == 404, f"({co} {r})")
co, r = call("POST", f"/employees/{E_A1}/compensation", EMP_A, {
    "basicSalary": 99999, "effectiveFrom": PRIOR})
check("an employee cannot set a salary", co == 403, f"({co} {r})")
co, r = call("GET", f"/employees/{E_A2}/compensation", EMP_A)
check("an employee cannot read a colleague's pay", co == 404, f"({co} {r})")
co, r = call("GET", f"/employees/{A['employees'][0]}/compensation", EMP_A)
check("an employee reads their own pay", co == 200, f"({co} {r})")

print("-- recurring components --")
for cid in (house, transport, pension, loan):
    co, r = call("POST", f"/employees/{E_A1}/components", HR_A, {
        "componentId": cid, "effectiveFrom": PRIOR, "effectiveTo": E})
    check(f"component {cid and cid[:8]} assigned", co == 201, f"({co} {r})")

co, r = call("POST", f"/employees/{E_A1}/components", HR_A, {
    "componentId": house, "effectiveFrom": S})
check("an overlapping assignment of the same component is refused", co == 409, f"({co} {r})")

co, r = call("POST", f"/employees/{E_A1}/components", HR_A, {
    "componentId": house_b, "effectiveFrom": PRIOR})
check("A cannot assign B's component", co == 404, f"({co} {r})")
co, r = call("POST", f"/employees/{E_B1}/components", HR_A, {
    "componentId": house, "effectiveFrom": PRIOR})
check("A cannot assign a component in B", co == 404, f"({co} {r})")
co, r = call("POST", f"/employees/{E_A1}/components", HR_A, {
    "componentId": house, "effectiveFrom": E, "effectiveTo": S})
check("a range that ends before it starts is refused", co == 400, f"({co} {r})")

co, r = call("DELETE", f"/components/{house}", HR_A)
check("a component somebody is assigned cannot be deleted", co == 409, f"({co} {r})")

print("-- tax brackets --")
co, r = call("PUT", "/tax-brackets", HR_A, {"effectiveFrom": S, "brackets": [
    {"lowerBound": 0, "upperBound": 12000, "rate": 0},
    {"lowerBound": 12000, "upperBound": 30000, "rate": 10},
    {"lowerBound": 30000, "rate": 25}]})
check("HR configures a progressive table", co == 201, f"({co} {r})")
check("the bands come back in order",
      co == 201 and [b['sequence'] for b in r.get('brackets', [])] == [1, 2, 3], f"({r})")

co, r = call("PUT", "/tax-brackets", HR_A, {"effectiveFrom": PRIOR, "brackets": [
    {"lowerBound": 0, "upperBound": 12000, "rate": 0},
    {"lowerBound": 15000, "rate": 20}]})
check("a table with a gap between bands is refused", co == 400, f"({co} {r})")
co, r = call("PUT", "/tax-brackets", HR_A, {"effectiveFrom": PRIOR, "brackets": [
    {"lowerBound": 0, "upperBound": 12000, "rate": 0},
    {"lowerBound": 10000, "upperBound": 30000, "rate": 10},
    {"lowerBound": 30000, "rate": 25}]})
check("overlapping bands are refused", co == 400, f"({co} {r})")
co, r = call("PUT", "/tax-brackets", HR_A, {"effectiveFrom": PRIOR, "brackets": [
    {"lowerBound": 1000, "rate": 10}]})
check("a table that does not start at zero is refused", co == 400, f"({co} {r})")
co, r = call("PUT", "/tax-brackets", HR_A, {"effectiveFrom": PRIOR, "brackets": [
    {"lowerBound": 0, "upperBound": 12000, "rate": 0}]})
check("a table whose top band is bounded is refused", co == 400, f"({co} {r})")
co, r = call("PUT", "/tax-brackets", HR_A, {"effectiveFrom": PRIOR, "brackets": [
    {"lowerBound": 0, "rate": 140}]})
check("a rate above 100 percent is refused", co == 400, f"({co} {r})")
co, r = call("PUT", "/tax-brackets", HR_A, {"effectiveFrom": PRIOR, "brackets": []})
check("an empty table is refused", co == 400, f"({co} {r})")
co, r = call("PUT", "/tax-brackets", EMP_A, {"effectiveFrom": PRIOR, "brackets": [
    {"lowerBound": 0, "rate": 0}]})
check("an employee cannot set tax rates", co == 403, f"({co} {r})")

co, r = call("GET", "/tax-brackets", HR_B)
check("B still has no tax table of its own",
      co == 200 and r.get('configured') is False, f"({co} {r})")

print("-- periods --")
co, r = call("POST", "/periods", HR_A, {
    "code": f"P{RUN}", "name": f"{start.strftime('%B %Y')}",
    "startDate": S, "endDate": E, "payDate": PAY})
check("HR opens a period", co == 201, f"({co} {r})")
period = r.get('period', {}).get('id') if co == 201 else None

co, r = call("POST", "/periods", HR_A, {
    "code": f"P{RUN}X", "name": "Overlapping", "startDate": S, "endDate": E, "payDate": PAY})
check("a second period over the same dates is refused", co == 409, f"({co} {r})")
co, r = call("POST", "/periods", HR_A, {
    "code": f"P{RUN}Y", "name": "Backwards", "startDate": E, "endDate": S, "payDate": PAY})
check("a period that ends before it starts is refused", co == 400, f"({co} {r})")
co, r = call("POST", "/periods", EMP_A, {
    "code": f"P{RUN}Z", "name": "Mine", "startDate": S, "endDate": E, "payDate": PAY})
check("an employee cannot open a period", co == 403, f"({co} {r})")

co, r = call("POST", "/periods", HR_B, {
    "code": f"P{RUN}", "name": "Same code in B", "startDate": S, "endDate": E, "payDate": PAY})
check("B may reuse A's period code and dates", co == 201, f"({co} {r})")
period_b = r.get('period', {}).get('id') if co == 201 else None

co, r = call("GET", "/periods", HR_A)
a_periods = [x['id'] for x in r.get('periods', [])] if co == 200 else []
check("A's periods do not include B's", period_b not in a_periods, f"({a_periods})")
co, r = call("GET", f"/periods/{period_b}/inputs", HR_A)
check("A cannot read B's period inputs", co == 404, f"({co} {r})")

print("-- period inputs --")
co, r = call("POST", f"/periods/{period}/inputs", HR_A, {
    "employeeId": E_A1, "componentId": overtime, "amount": 150, "note": "Weekend cover"})
check("HR stages overtime against the period", co == 201, f"({co} {r})")
co, r = call("POST", f"/periods/{period}/inputs", HR_A, {
    "employeeId": E_A1, "componentId": overtime, "amount": 200})
check("staging it again corrects rather than duplicates", co == 201, f"({co} {r})")
input_id = r.get('input', {}).get('id') if co == 201 else None
co, r = call("GET", f"/periods/{period}/inputs", HR_A)
check("exactly one input is held",
      co == 200 and len(r.get('inputs', [])) == 1, f"({co} {r})")
check("the corrected amount is the one held",
      co == 200 and money(r['inputs'][0]['amount']) == 200.0, f"({r.get('inputs')})")

co, r = call("POST", f"/periods/{period}/inputs", HR_A, {
    "employeeId": E_B1, "componentId": overtime, "amount": 1})
check("A cannot stage an input for B's employee", co == 404, f"({co} {r})")
co, r = call("POST", f"/periods/{period}/inputs", EMP_A, {
    "employeeId": E_A1, "componentId": overtime, "amount": 5000})
check("an employee cannot stage their own overtime", co == 403, f"({co} {r})")
co, r = call("POST", f"/periods/{period}/inputs", HR_A, {
    "employeeId": E_A1, "componentId": overtime, "amount": -5})
check("a negative input is refused", co == 400, f"({co} {r})")

print("-- the run --")
co, r = call("POST", "/runs", HR_A, {"periodId": period})
check("HR opens a run", co == 201, f"({co} {r})")
run = r.get('run', {}).get('id') if co == 201 else None
check("a new run is a draft", co == 201 and r['run']['status'] == 'draft', f"({r})")

co, r = call("POST", "/runs", HR_A, {"periodId": period})
check("a second live run on the period is refused", co == 409, f"({co} {r})")
co, r = call("POST", "/runs", HR_A, {"periodId": period_b})
check("A cannot open a run on B's period", co == 404, f"({co} {r})")
co, r = call("POST", "/runs", EMP_A, {"periodId": period})
check("an employee cannot open a run", co == 403, f"({co} {r})")

print("-- preview before committing --")
co, r = call("GET", f"/runs/{run}/preview/{E_A1}", HR_A)
check("HR previews one employee", co == 200, f"({co} {r})")
if co == 200:
    p = r['preview']
    #  basic 2000 (the record effective at the period start, not the 1000)
    #  house 20% of 2000 = 400, transport 100 (not taxable), overtime 200
    #  gross = 2000 + 400 + 100 + 200 = 2700
    #  taxable gross = 2700 - 100 = 2600
    #  pension 5% of 2000 = 100, pre-tax, so tax base = 2500
    #  annual base 30000 -> 0% on 12000, 10% on 18000 = 1800/yr = 150/month
    #  loan 50, post-tax
    #  deductions = 100 + 150 + 50 = 300; net = 2700 - 300 = 2400
    check("the effective-dated salary is used", money(p['basic']) == 2000.0, f"({p})")
    check("gross adds up", money(p['gross']) == 2700.0, f"({p})")
    check("a non-taxable allowance is out of the tax base",
          money(p['taxableGross']) == 2600.0, f"({p})")
    check("a pre-tax deduction lowers the tax base",
          money(p['preTaxDeductions']) == 100.0, f"({p})")
    check("tax is progressive over the bands", money(p['tax']) == 150.0, f"({p})")
    check("post-tax deductions are separate",
          money(p['postTaxDeductions']) == 50.0, f"({p})")
    check("deductions add up", money(p['totalDeductions']) == 300.0, f"({p})")
    check("net is gross less deductions", money(p['net']) == 2400.0, f"({p})")
    check("the table is recorded as applied", p['taxTableApplied'] is True, f"({p})")
    check("the payslip carries its breakdown", len(p['lines']) >= 6, f"({p['lines']})")
    codes = [x['code'] for x in p['lines']]
    check("basic is a line", 'BASIC' in codes, f"({codes})")
    check("tax is a line", 'TAX' in codes, f"({codes})")
    lines_total = sum(money(x['amount']) for x in p['lines'] if x['kind'] == 'earning')
    check("the earning lines sum to gross", round(lines_total, 2) == 2700.0, f"({p['lines']})")

co, r = call("GET", f"/runs/{run}/preview/{E_A3}", HR_A)
check("an employee with no compensation cannot be computed", co == 409, f"({co} {r})")
co, r = call("GET", f"/runs/{run}/preview/{E_B1}", HR_A)
check("A cannot preview B's employee", co == 404, f"({co} {r})")
co, r = call("GET", f"/runs/{run}/preview/{E_A1}", EMP_A)
check("an employee cannot preview payroll", co == 403, f"({co} {r})")

print("-- calculating --")
co, r = call("POST", f"/runs/{run}/calculate", HR_A)
check("HR calculates the run", co == 200, f"({co} {r})")
check("the run moves to calculated",
      co == 200 and r['run']['status'] == 'calculated', f"({r})")
check("the two paid employees are in it",
      co == 200 and r['payslipCount'] == 2, f"({r})")
check("the unpaid employees are reported, not silently dropped",
      co == 200 and len(r.get('skipped', [])) >= 2, f"({r.get('skipped')})")
if co == 200:
    check("the run total is the sum of the payslips",
          money(r['run']['gross_total']) == 2700.0 + 1200.0, f"({r['run']})")
    check("net is gross less deductions at run level",
          money(r['run']['net_total'])
          == money(r['run']['gross_total']) - money(r['run']['deduction_total']),
          f"({r['run']})")
    check("the run records that a tax table was in force",
          r['run']['tax_table_applied'] is True, f"({r['run']})")

co, r = call("POST", f"/runs/{run}/calculate", HR_A)
check("recalculating a draft is allowed", co == 200, f"({co} {r})")
check("recalculating does not double the payslips",
      co == 200 and r['payslipCount'] == 2, f"({r})")

co, r = call("GET", f"/runs/{run}", HR_A)
check("the run lists its payslips",
      co == 200 and len(r.get('payslips', [])) == 2, f"({co} {r})")
slips = {x['employee_id']: x for x in r.get('payslips', [])} if co == 200 else {}
slip_a1 = slips.get(E_A1, {}).get('id')
co, r = call("GET", f"/runs/{run}", HR_B)
check("B cannot read A's run", co == 404, f"({co} {r})")
co, r = call("GET", f"/runs/{run}", EMP_A)
check("an employee cannot read a whole run", co == 403, f"({co} {r})")

print("-- payslip visibility before approval --")
co, r = call("GET", "/my/payslips", EMP_A)
mine = [x for x in r.get('payslips', []) if x['period_code'] == f"P{RUN}"] if co == 200 else []
check("a draft run's payslip is not shown to the employee",
      co == 200 and len(mine) == 0, f"({co} {r})")
co, r = call("GET", f"/payslips/{slip_a1}", EMP_A)
check("nor readable directly before approval", co == 404, f"({co} {r})")
co, r = call("GET", f"/payslips/{slip_a1}", HR_A)
check("HR can read it while it is still a draft", co == 200, f"({co} {r})")
co, r = call("GET", f"/payslips/{slip_a1}", HR_B)
check("B cannot read A's payslip", co == 404, f"({co} {r})")
co, r = call("GET", f"/payslips/{slip_a1}", EMP_B)
check("B's employee cannot read A's payslip", co == 404, f"({co} {r})")
co, r = call("GET", f"/payslips/{GHOST}", HR_A)
check("a payslip that does not exist is a 404", co == 404, f"({co} {r})")

print("-- approval --")
co, r = call("POST", f"/runs/{run}/approve", EMP_A)
check("an employee cannot approve payroll", co == 403, f"({co} {r})")
co, r = call("POST", f"/runs/{run}/approve", HR_A)
check("whoever calculated the run cannot approve it", co == 403, f"({co} {r})")
co, r = call("POST", f"/runs/{run}/approve", DIR_B)
check("B's director cannot approve A's run", co == 404, f"({co} {r})")
co, r = call("POST", f"/runs/{run}/approve", DIR_A)
check("the director approves it", co == 200, f"({co} {r})")
check("the run is approved", co == 200 and r['run']['status'] == 'approved', f"({r})")

co, r = call("POST", f"/runs/{run}/calculate", HR_A)
check("an approved run cannot be recalculated", co == 409, f"({co} {r})")
co, r = call("POST", f"/runs/{run}/cancel", HR_A, {"reason": "changed my mind"})
check("an approved run cannot be cancelled", co == 409, f"({co} {r})")
co, r = call("POST", f"/runs/{run}/approve", DIR_A)
check("approving twice is refused", co == 409, f"({co} {r})")

print("-- the employee's own payslip --")
co, r = call("GET", "/my/payslips", EMP_A)
mine = [x for x in r.get('payslips', []) if x['period_code'] == f"P{RUN}"] if co == 200 else []
check("the employee now sees their payslip", co == 200 and len(mine) == 1, f"({co} {r})")
if mine:
    check("it carries the net they will be paid", money(mine[0]['net']) == 2400.0, f"({mine[0]})")
co, r = call("GET", "/my/payslips", EMP_B)
check("B's employee sees none of A's",
      co == 200 and all(x['period_code'] != f"P{RUN}" for x in r.get('payslips', [])),
      f"({co} {r})")

co, r = call("GET", f"/payslips/{slip_a1}", EMP_A)
check("the employee reads their own breakdown", co == 200, f"({co} {r})")
if co == 200:
    check("every line is there", len(r.get('lines', [])) >= 6, f"({r.get('lines')})")
    check("the lines are ordered",
          [x['sequence'] for x in r['lines']] == sorted(x['sequence'] for x in r['lines']),
          f"({r.get('lines')})")

# The other paid employee's slip, to prove one employee cannot read another's.
slip_a2 = slips.get(E_A2, {}).get('id')
co, r = call("GET", f"/payslips/{slip_a2}", EMP_A)
check("an employee cannot read a colleague's payslip", co == 404, f"({co} {r})")

print("-- copies, not references --")
co, r = call("PATCH", f"/components/{transport}", HR_A, {"name": "Renamed allowance"})
check("a component can still be renamed after a run", co == 200, f"({co} {r})")
co, r = call("GET", f"/payslips/{slip_a1}", HR_A)
if co == 200:
    names = [x['name'] for x in r.get('lines', [])]
    check("the issued payslip keeps the old name",
          "Transport" in names and "Renamed allowance" not in names, f"({names})")

print("-- payment --")
co, r = call("POST", f"/runs/{run}/pay", HR_A)
check("HR cannot mark a run paid", co == 403, f"({co} {r})")
co, r = call("POST", f"/runs/{run}/pay", DIR_B)
check("B's director cannot pay A's run", co == 404, f"({co} {r})")
co, r = call("POST", f"/runs/{run}/pay", DIR_A)
check("the director marks it paid", co == 200, f"({co} {r})")
check("the run is paid", co == 200 and r['run']['status'] == 'paid', f"({r})")
co, r = call("POST", f"/runs/{run}/pay", DIR_A)
check("paying twice is refused", co == 409, f"({co} {r})")

co, r = call("GET", "/periods", HR_A)
paid_period = next((x for x in r.get('periods', []) if x['id'] == period), None) if co == 200 else None
check("the period closes with the run that paid it",
      paid_period is not None and paid_period['status'] == 'closed', f"({paid_period})")
co, r = call("POST", "/runs", HR_A, {"periodId": period})
check("a closed period takes no further run", co == 409, f"({co} {r})")

print("-- unpaid leave prorates the basic --")
# A second period, a month later, with a week of unpaid leave in it.
start2 = end + timedelta(days=1)
end2 = date(start2.year + (start2.month == 12), start2.month % 12 + 1, 1) - timedelta(days=1)
S2, E2 = start2.isoformat(), end2.isoformat()
DAYS2 = (end2 - start2).days + 1

co, r = call("POST", "/types", HR_A, {
    "code": f"UNP{RUN}", "name": "Unpaid leave", "daysPerYear": 0, "isPaid": False},
    base="/leave")
check("an unpaid leave type exists", co == 201, f"({co} {r})")
unpaid_type = r.get('type', {}).get('id') if co == 201 else None

leave_start = (start2 + timedelta(days=4)).isoformat()
leave_end = (start2 + timedelta(days=8)).isoformat()
co, r = call("POST", "/requests", HR_A, {
    "employeeId": E_A2, "leaveTypeId": unpaid_type,
    "startDate": leave_start, "endDate": leave_end, "reason": "Personal"},
    base="/leave")
check("five days of unpaid leave are requested", co == 201, f"({co} {r})")
leave_id = r.get('request', {}).get('id') if co == 201 else None
taken = money(r.get('request', {}).get('total_days')) if co == 201 else 0

co, r = call("POST", f"/requests/{leave_id}/decision", HR_A,
             {"decision": "approved"}, base="/leave")
check("the leave is approved", co == 200, f"({co} {r})")

co, r = call("POST", "/periods", HR_A, {
    "code": f"Q{RUN}", "name": "Next month", "startDate": S2, "endDate": E2,
    "payDate": E2})
check("a second period opens", co == 201, f"({co} {r})")
period2 = r.get('period', {}).get('id') if co == 201 else None
co, r = call("POST", "/runs", HR_A, {"periodId": period2})
run2 = r.get('run', {}).get('id') if co == 201 else None
check("a run opens on it", co == 201, f"({co} {r})")

co, r = call("GET", f"/runs/{run2}/preview/{E_A2}", HR_A)
check("the employee on unpaid leave is previewed", co == 200, f"({co} {r})")
if co == 200 and taken:
    p = r['preview']
    expected = round(1200.0 * (DAYS2 - taken) / DAYS2, 2)
    check("the basic is prorated by the unpaid days",
          abs(money(p['basic']) - expected) <= 0.01,
          f"(got {p['basic']}, expected {expected}, {taken} of {DAYS2} days)")
    check("the unpaid days are recorded on the payslip",
          money(p['unpaidDays']) == taken, f"({p})")
    check("the proration is explained on the payslip",
          any(x['source'] == 'leave' for x in p['lines']), f"({p['lines']})")
    check("a proration line adds nothing to the figures",
          all(money(x['amount']) == 0.0 for x in p['lines'] if x['source'] == 'leave'),
          f"({p['lines']})")

co, r = call("GET", f"/runs/{run2}/preview/{E_A1}", HR_A)
check("an employee with no leave is not prorated",
      co == 200 and money(r['preview']['basic']) == 2000.0, f"({co} {r})")

print("-- a tenant with no tax table --")
co, r = call("POST", f"/employees/{E_B1}/compensation", HR_B, {
    "basicSalary": 1500, "effectiveFrom": S})
check("B pays its employee", co == 201, f"({co} {r})")
co, r = call("POST", "/runs", HR_B, {"periodId": period_b})
run_b = r.get('run', {}).get('id') if co == 201 else None
check("B opens a run", co == 201, f"({co} {r})")
co, r = call("POST", f"/runs/{run_b}/calculate", HR_B)
check("B's run calculates with no tax table", co == 200, f"({co} {r})")
if co == 200:
    check("no tax is charged", money(r['run']['tax_total']) == 0.0, f"({r['run']})")
    check("the run says it had no table to apply",
          r['run']['tax_table_applied'] is False, f"({r['run']})")
    check("net equals gross when nothing is deducted",
          money(r['run']['net_total']) == money(r['run']['gross_total']), f"({r['run']})")

print("-- cancelling a draft --")
co, r = call("POST", f"/runs/{run2}/cancel", HR_A, {})
check("cancelling has to say why", co == 400, f"({co} {r})")
co, r = call("POST", f"/runs/{run2}/cancel", HR_B, {"reason": "not mine"})
check("B cannot cancel A's run", co == 404, f"({co} {r})")
co, r = call("POST", f"/runs/{run2}/cancel", HR_A, {"reason": "Opened in error"})
check("a draft run cancels", co == 200, f"({co} {r})")
co, r = call("POST", "/runs", HR_A, {"periodId": period2})
check("a cancelled run frees the period for another", co == 201, f"({co} {r})")
run3 = r.get('run', {}).get('id') if co == 201 else None
co, r = call("POST", f"/runs/{run3}/approve", DIR_A)
check("a run that was never calculated cannot be approved", co == 409, f"({co} {r})")

print("-- malformed ids --")
for path in (f"/runs/not-a-uuid", f"/payslips/not-a-uuid", f"/periods/not-a-uuid/inputs"):
    co, r = call("GET", path, HR_A)
    check(f"a malformed id on {path.split('/')[1]} is a 404", co == 404, f"({co} {r})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
