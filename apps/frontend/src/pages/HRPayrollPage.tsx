import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BadgeCheck, Banknote, Calculator, CalendarRange,
  CheckCircle2, Layers, Percent, Plus, Receipt, Users, X,
} from 'lucide-react';
import { useToastStore } from '../components/Toast';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState, ErrorAlert } from '../components/ErrorDisplay';
import hrService, { type MemberAttendanceSummary } from '../services/hrService';
import {
  payrollService,
  formatMoney,
  formatRate,
  isoDay,
  RUN_STATUS_LABEL,
  type ComponentKind,
  type PayrollPeriod,
  type PayrollRun,
  type Payslip,
  type PayslipPreview,
  type SalaryComponent,
  type SkippedEmployee,
  type TaxBracket,
  type Compensation,
  type ComponentAssignment,
} from '../services/payrollService';

/**
 * HR's payroll desk.
 *
 * Four things, in the order they have to happen: the pay structure, what each
 * person is paid, the tax table, and then the runs that turn all of it into
 * payslips.
 *
 * Two rules from the API are mirrored in what this page offers rather than
 * left to a refusal:
 *
 *   - A run is approved by somebody other than whoever calculated it. The
 *     approve button is not shown to the person whose click produced the
 *     figures; showing a control that will be refused is worse than not
 *     showing one.
 *   - An approved run is frozen. Recalculate and cancel disappear at that
 *     point rather than erroring.
 *
 * Money is never parsed into a number for display. It arrives as the string
 * the database holds and is formatted as one.
 */

type Tab = 'runs' | 'people' | 'structure' | 'tax';

const TODAY = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The calendar month containing a date, as a period's shape. */
function monthOf(d: Date) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  const name = start.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return {
    code: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
    name,
    startDate: iso(start),
    endDate: iso(end),
    payDate: iso(end),
  };
}

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-700/40 text-slate-300',
  calculated: 'bg-amber-500/20 text-amber-300',
  approved: 'bg-brand-500/20 text-brand-300',
  paid: 'bg-success-600/20 text-success-300',
  cancelled: 'bg-slate-800 text-slate-500',
};

const HRPayrollPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('runs');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [brackets, setBrackets] = useState<TaxBracket[]>([]);
  const [taxConfigured, setTaxConfigured] = useState(false);
  const [members, setMembers] = useState<MemberAttendanceSummary[]>([]);

  // The run the reader has open, and what came back when it was calculated.
  const [openRun, setOpenRun] = useState<PayrollRun | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [skipped, setSkipped] = useState<SkippedEmployee[]>([]);
  // Runs this session calculated. The API refuses an approval from whoever
  // calculated it, so the button is withheld rather than offered and refused.
  const [calculatedHere, setCalculatedHere] = useState<Set<string>>(new Set());

  /**
   * The breakdown panel.
   *
   * For a draft the lines are recomputed, because a draft can still change and
   * what it would pay right now is the useful answer. For an approved or paid
   * run they come from the payslip itself: those lines are copies taken when
   * the run was calculated, and recomputing them against today's components
   * would quietly show a figure nobody was ever paid.
   */
  const [breakdown, setBreakdown] = useState<{
    employee: string;
    live: boolean;
    currency: string;
    net: string;
    lines: Array<{
      code: string; name: string; kind: ComponentKind; amount: string;
      isTaxable: boolean; reducesTaxable: boolean;
    }>;
  } | null>(null);

  const [showPeriodForm, setShowPeriodForm] = useState(false);
  const [periodForm, setPeriodForm] = useState(monthOf(TODAY));

  const [showComponentForm, setShowComponentForm] = useState(false);
  const [componentForm, setComponentForm] = useState({
    code: '', name: '', kind: 'earning' as ComponentKind,
    calculation: 'fixed' as 'fixed' | 'percent_of_basic',
    defaultAmount: '', defaultRate: '',
    isTaxable: true, reducesTaxable: false, isStatutory: false,
  });

  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [empPay, setEmpPay] = useState<{
    employee: { id: string; name: string; employeeNumber: string };
    compensation: Compensation[];
    components: ComponentAssignment[];
  } | null>(null);
  const [payForm, setPayForm] = useState({
    basicSalary: '', effectiveFrom: iso(TODAY), currency: 'USD',
    payFrequency: 'monthly', reason: '',
  });
  const [assignForm, setAssignForm] = useState({
    componentId: '', amount: '', rate: '', effectiveFrom: iso(TODAY),
  });

  const [taxForm, setTaxForm] = useState({
    effectiveFrom: `${TODAY.getUTCFullYear()}-01-01`,
    bands: [{ lowerBound: '0', upperBound: '', rate: '0' }],
  });

  const { addToast } = useToastStore();

  useEffect(() => { void load(); }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [p, r, c, t, m] = await Promise.all([
        payrollService.listPeriods(),
        payrollService.listRuns(),
        payrollService.listComponents(),
        payrollService.taxBrackets(),
        hrService.listMembers(1, 200).catch(() => ({ members: [], page: 1, pageSize: 200, total: 0 })),
      ]);
      setPeriods(p);
      setRuns(r);
      setComponents(c);
      setBrackets(t.brackets);
      setTaxConfigured(t.configured);
      setMembers(m.members.filter((x: MemberAttendanceSummary) => x.role === 'EMPLOYEE'));
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const fail = (title: string, e: unknown) =>
    addToast({ type: 'error', title, message: getErrorMessage(e) });

  // ---------------------------------------------------------------- periods

  const createPeriod = async () => {
    try {
      setBusy(true);
      await payrollService.createPeriod({ ...periodForm, frequency: 'monthly' });
      setShowPeriodForm(false);
      addToast({ type: 'success', title: 'Period opened' });
      await load();
    } catch (e) {
      fail('Could not open the period', e);
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------------- runs

  const openRunFor = async (runId: string) => {
    try {
      setBusy(true);
      const detail = await payrollService.run(runId);
      setOpenRun(detail.run);
      setPayslips(detail.payslips);
      setSkipped([]);
      setBreakdown(null);
    } catch (e) {
      fail('Could not load the run', e);
    } finally {
      setBusy(false);
    }
  };

  const startRun = async (periodId: string) => {
    try {
      setBusy(true);
      const run = await payrollService.openRun(periodId);
      addToast({ type: 'success', title: 'Run opened' });
      await load();
      await openRunFor(run.id);
    } catch (e) {
      fail('Could not open the run', e);
    } finally {
      setBusy(false);
    }
  };

  const calculate = async (runId: string) => {
    try {
      setBusy(true);
      const result = await payrollService.calculate(runId);
      setCalculatedHere((s) => new Set(s).add(runId));
      setSkipped(result.skipped);
      addToast({
        type: result.skipped.length ? 'warning' : 'success',
        title: `${result.payslipCount} payslip(s) calculated`,
        message: result.skipped.length
          ? `${result.skipped.length} employee(s) could not be included.`
          : undefined,
      });
      const detail = await payrollService.run(runId);
      setOpenRun(detail.run);
      setPayslips(detail.payslips);
      setRuns(await payrollService.listRuns());
    } catch (e) {
      fail('Could not calculate the run', e);
    } finally {
      setBusy(false);
    }
  };

  const approve = async (runId: string) => {
    try {
      setBusy(true);
      const run = await payrollService.approve(runId);
      setOpenRun(run);
      addToast({ type: 'success', title: 'Run approved', message: 'Everyone in it has been told their payslip is ready.' });
      await load();
    } catch (e) {
      fail('Could not approve the run', e);
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async (runId: string) => {
    try {
      setBusy(true);
      const run = await payrollService.markPaid(runId);
      setOpenRun(run);
      addToast({ type: 'success', title: 'Run marked paid' });
      await load();
    } catch (e) {
      fail('Could not mark the run paid', e);
    } finally {
      setBusy(false);
    }
  };

  const cancelRun = async (runId: string) => {
    const reason = window.prompt('Why is this run being cancelled?');
    if (!reason) return;
    try {
      setBusy(true);
      await payrollService.cancel(runId, reason);
      setOpenRun(null);
      setPayslips([]);
      addToast({ type: 'success', title: 'Run cancelled' });
      await load();
    } catch (e) {
      fail('Could not cancel the run', e);
    } finally {
      setBusy(false);
    }
  };

  const showBreakdown = async (run: PayrollRun, slip: Payslip, name: string) => {
    try {
      setBusy(true);
      if (run.status === 'approved' || run.status === 'paid') {
        const d = await payrollService.payslip(slip.id);
        setBreakdown({
          employee: name, live: false, currency: d.payslip.currency, net: d.payslip.net,
          lines: d.lines.map((l) => ({
            code: l.code, name: l.name, kind: l.kind, amount: l.amount,
            isTaxable: l.is_taxable, reducesTaxable: l.reduces_taxable,
          })),
        });
        return;
      }
      const p: PayslipPreview = await payrollService.preview(run.id, slip.employee_id);
      setBreakdown({
        employee: name, live: true, currency: p.currency, net: p.net,
        lines: p.lines.map((l) => ({
          code: l.code, name: l.name, kind: l.kind, amount: l.amount,
          isTaxable: l.isTaxable, reducesTaxable: l.reducesTaxable,
        })),
      });
    } catch (e) {
      fail('Could not load that breakdown', e);
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------- structure

  const createComponent = async () => {
    try {
      setBusy(true);
      await payrollService.createComponent({
        code: componentForm.code.trim(),
        name: componentForm.name.trim(),
        kind: componentForm.kind,
        calculation: componentForm.calculation,
        defaultAmount: componentForm.calculation === 'fixed' ? componentForm.defaultAmount : undefined,
        defaultRate: componentForm.calculation === 'percent_of_basic' ? componentForm.defaultRate : undefined,
        isTaxable: componentForm.kind === 'earning' ? componentForm.isTaxable : undefined,
        reducesTaxable: componentForm.kind === 'deduction' ? componentForm.reducesTaxable : undefined,
        isStatutory: componentForm.isStatutory,
      });
      setShowComponentForm(false);
      setComponentForm({
        code: '', name: '', kind: 'earning', calculation: 'fixed',
        defaultAmount: '', defaultRate: '', isTaxable: true,
        reducesTaxable: false, isStatutory: false,
      });
      addToast({ type: 'success', title: 'Component added' });
      setComponents(await payrollService.listComponents());
    } catch (e) {
      fail('Could not add the component', e);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (c: SalaryComponent) => {
    try {
      setBusy(true);
      await payrollService.updateComponent(c.id, { isActive: !c.is_active });
      setComponents(await payrollService.listComponents());
    } catch (e) {
      fail('Could not change the component', e);
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------------ people

  const selectEmployee = async (employeeId: string) => {
    try {
      setBusy(true);
      setSelectedEmployee(employeeId);
      setEmpPay(await payrollService.compensation(employeeId));
    } catch (e) {
      setEmpPay(null);
      fail('Could not load that employee', e);
    } finally {
      setBusy(false);
    }
  };

  const saveCompensation = async () => {
    if (!selectedEmployee) return;
    try {
      setBusy(true);
      await payrollService.recordCompensation(selectedEmployee, {
        basicSalary: payForm.basicSalary,
        effectiveFrom: payForm.effectiveFrom,
        currency: payForm.currency,
        payFrequency: payForm.payFrequency,
        reason: payForm.reason || undefined,
      });
      addToast({ type: 'success', title: 'Salary recorded', message: 'Earlier payslips are unchanged.' });
      setPayForm((f) => ({ ...f, basicSalary: '', reason: '' }));
      await selectEmployee(selectedEmployee);
    } catch (e) {
      fail('Could not record the salary', e);
    } finally {
      setBusy(false);
    }
  };

  const assign = async () => {
    if (!selectedEmployee || !assignForm.componentId) return;
    try {
      setBusy(true);
      await payrollService.assignComponent(selectedEmployee, {
        componentId: assignForm.componentId,
        amount: assignForm.amount || undefined,
        rate: assignForm.rate || undefined,
        effectiveFrom: assignForm.effectiveFrom,
      });
      setAssignForm({ componentId: '', amount: '', rate: '', effectiveFrom: iso(TODAY) });
      addToast({ type: 'success', title: 'Component assigned' });
      await selectEmployee(selectedEmployee);
    } catch (e) {
      fail('Could not assign the component', e);
    } finally {
      setBusy(false);
    }
  };

  const endAssignment = async (assignmentId: string) => {
    if (!selectedEmployee) return;
    const endDate = window.prompt('End it from which date? (YYYY-MM-DD, blank to remove it entirely)', iso(TODAY));
    if (endDate === null) return;
    try {
      setBusy(true);
      await payrollService.endAssignment(selectedEmployee, assignmentId, endDate || undefined);
      await selectEmployee(selectedEmployee);
    } catch (e) {
      fail('Could not end the assignment', e);
    } finally {
      setBusy(false);
    }
  };

  // --------------------------------------------------------------------- tax

  const saveTax = async () => {
    try {
      setBusy(true);
      await payrollService.saveTaxBrackets({
        effectiveFrom: taxForm.effectiveFrom,
        brackets: taxForm.bands.map((b) => ({
          lowerBound: b.lowerBound,
          upperBound: b.upperBound === '' ? null : b.upperBound,
          rate: b.rate,
        })),
      });
      addToast({ type: 'success', title: 'Tax table saved' });
      const t = await payrollService.taxBrackets();
      setBrackets(t.brackets);
      setTaxConfigured(t.configured);
    } catch (e) {
      fail('Could not save the tax table', e);
    } finally {
      setBusy(false);
    }
  };

  // -------------------------------------------------------------------------

  const periodsWithoutRun = useMemo(
    () => periods.filter((p) => !p.run_id && p.status !== 'closed'),
    [periods]
  );
  const liveRuns = useMemo(() => runs.filter((r) => r.status !== 'cancelled'), [runs]);

  if (loading) return <LoadingOverlay message="Loading payroll…" />;

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'runs', label: 'Runs', icon: <Calculator className="h-4 w-4" /> },
    { id: 'people', label: 'Who is paid what', icon: <Users className="h-4 w-4" /> },
    { id: 'structure', label: 'Pay structure', icon: <Layers className="h-4 w-4" /> },
    { id: 'tax', label: 'Tax', icon: <Percent className="h-4 w-4" /> },
  ];

  const field = 'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600';
  const label = 'mb-1 block text-xs uppercase tracking-wider text-slate-500';
  const primary = 'inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-500 disabled:opacity-50';
  const ghost = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50';
  const card = 'rounded-xl border border-slate-800 bg-slate-900/60';

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Payroll</h1>
        <p className="mt-1 text-sm text-slate-400">
          Compensation, deductions, tax and the runs that turn them into payslips.
        </p>
      </div>

      {error && <ErrorAlert title="Could not load payroll" message={error} onDismiss={() => setError(null)} />}

      {!taxConfigured && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="text-sm text-amber-200">
            <div className="font-medium">No tax table is configured.</div>
            <div className="mt-1 text-amber-200/80">
              Runs will charge no tax, and each payslip will record that there was no
              table to apply. No default is shipped: rates and bands differ by country
              and change yearly, and a default would be wrong almost everywhere.
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm transition ${
              tab === t.id
                ? 'border-brand-500 text-slate-100'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------ runs */}
      {tab === 'runs' && (
        <div className="space-y-6">
          <div className={card}>
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <span className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                Pay periods
              </span>
              <button className={ghost} onClick={() => { setPeriodForm(monthOf(TODAY)); setShowPeriodForm(true); }}>
                <Plus className="h-4 w-4" /> Open a period
              </button>
            </div>

            {showPeriodForm && (
              <div className="grid gap-3 border-b border-slate-800 p-5 sm:grid-cols-5">
                <div>
                  <label className={label}>Code</label>
                  <input className={field} value={periodForm.code}
                    onChange={(e) => setPeriodForm({ ...periodForm, code: e.target.value })} />
                </div>
                <div>
                  <label className={label}>Name</label>
                  <input className={field} value={periodForm.name}
                    onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })} />
                </div>
                <div>
                  <label className={label}>From</label>
                  <input type="date" className={field} value={periodForm.startDate}
                    onChange={(e) => setPeriodForm({ ...periodForm, startDate: e.target.value })} />
                </div>
                <div>
                  <label className={label}>To</label>
                  <input type="date" className={field} value={periodForm.endDate}
                    onChange={(e) => setPeriodForm({ ...periodForm, endDate: e.target.value })} />
                </div>
                <div>
                  <label className={label}>Pay date</label>
                  <input type="date" className={field} value={periodForm.payDate}
                    onChange={(e) => setPeriodForm({ ...periodForm, payDate: e.target.value })} />
                </div>
                <div className="sm:col-span-5 flex gap-2">
                  <button className={primary} disabled={busy} onClick={() => void createPeriod()}>Open</button>
                  <button className={ghost} onClick={() => setShowPeriodForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            {periods.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={<CalendarRange className="h-8 w-8" />}
                  title="No pay periods yet"
                  message="A period is the span of time a run pays for. Open one to begin."
                />
              </div>
            ) : (
              <ul className="divide-y divide-slate-800">
                {periods.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div>
                      <div className="text-sm font-medium text-slate-100">
                        {p.name}
                        <span className="ml-2 text-xs text-slate-500">{p.code}</span>
                      </div>
                      <div className="text-sm text-slate-400">
                        {isoDay(p.start_date)} → {isoDay(p.end_date)} · paid {isoDay(p.pay_date)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        p.status === 'closed' ? 'bg-slate-800 text-slate-500' : 'bg-slate-700/40 text-slate-300'
                      }`}>
                        {p.status}
                      </span>
                      {p.run_id ? (
                        <button className={ghost} disabled={busy} onClick={() => void openRunFor(p.run_id!)}>
                          Open run
                        </button>
                      ) : p.status !== 'closed' ? (
                        <button className={primary} disabled={busy} onClick={() => void startRun(p.id)}>
                          Start a run
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {periodsWithoutRun.length > 0 && liveRuns.length === 0 && (
            <p className="text-sm text-slate-500">
              Nothing has been run yet. Start a run on a period above; it is calculated as
              a draft first, so the figures can be checked before anybody is told them.
            </p>
          )}

          {openRun && (
            <div className={card}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                    {openRun.period_name ?? 'Run'}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[openRun.status]}`}>
                    {RUN_STATUS_LABEL[openRun.status]}
                  </span>
                  {!openRun.tax_table_applied && openRun.status !== 'draft' && (
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                      no tax table applied
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(openRun.status === 'draft' || openRun.status === 'calculated') && (
                    <button className={primary} disabled={busy} onClick={() => void calculate(openRun.id)}>
                      <Calculator className="h-4 w-4" />
                      {openRun.status === 'draft' ? 'Calculate' : 'Recalculate'}
                    </button>
                  )}
                  {openRun.status === 'calculated' && !calculatedHere.has(openRun.id) && (
                    <button className={primary} disabled={busy} onClick={() => void approve(openRun.id)}>
                      <BadgeCheck className="h-4 w-4" /> Approve
                    </button>
                  )}
                  {openRun.status === 'approved' && (
                    <button className={primary} disabled={busy} onClick={() => void markPaid(openRun.id)}>
                      <Banknote className="h-4 w-4" /> Mark paid
                    </button>
                  )}
                  {(openRun.status === 'draft' || openRun.status === 'calculated') && (
                    <button className={ghost} disabled={busy} onClick={() => void cancelRun(openRun.id)}>
                      <X className="h-4 w-4" /> Cancel
                    </button>
                  )}
                  <button className={ghost} onClick={() => { setOpenRun(null); setPayslips([]); setSkipped([]); setBreakdown(null); }}>
                    Close
                  </button>
                </div>
              </div>

              {openRun.status === 'calculated' && calculatedHere.has(openRun.id) && (
                <div className="border-b border-slate-800 bg-slate-900/40 px-5 py-3 text-sm text-slate-400">
                  This run is waiting for approval by somebody else. A run is signed off by
                  a second pair of eyes; whoever calculated it cannot approve it.
                </div>
              )}

              <div className="grid grid-cols-2 gap-px border-b border-slate-800 bg-slate-800 sm:grid-cols-5">
                {[
                  ['Employees', String(openRun.employee_count)],
                  ['Gross', formatMoney(openRun.gross_total, openRun.currency)],
                  ['Tax', formatMoney(openRun.tax_total, openRun.currency)],
                  ['Deductions', formatMoney(openRun.deduction_total, openRun.currency)],
                  ['Net', formatMoney(openRun.net_total, openRun.currency)],
                ].map(([k, v]) => (
                  <div key={k} className="bg-slate-900/60 px-5 py-4">
                    <div className="text-xs uppercase tracking-wider text-slate-500">{k}</div>
                    <div className="mt-1 text-lg font-semibold text-slate-100">{v}</div>
                  </div>
                ))}
              </div>

              {skipped.length > 0 && (
                <div className="border-b border-slate-800 bg-amber-500/5 px-5 py-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-300">
                    <AlertTriangle className="h-4 w-4" />
                    {skipped.length} employee(s) were not included
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-amber-200/80">
                    {skipped.map((s) => (
                      <li key={s.employeeId}>{s.name} — {s.reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              {payslips.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={<Receipt className="h-8 w-8" />}
                    title="Nothing calculated yet"
                    message="Calculate the run to produce its payslips."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                      <tr className="border-b border-slate-800">
                        <th className="px-5 py-3">Employee</th>
                        <th className="px-5 py-3 text-right">Basic</th>
                        <th className="px-5 py-3 text-right">Gross</th>
                        <th className="px-5 py-3 text-right">Tax</th>
                        <th className="px-5 py-3 text-right">Deductions</th>
                        <th className="px-5 py-3 text-right">Net</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {payslips.map((s) => (
                        <tr key={s.id} className="text-slate-300">
                          <td className="px-5 py-3">
                            <div className="text-slate-100">{s.first_name} {s.last_name}</div>
                            <div className="text-xs text-slate-500">
                              {s.employee_number}
                              {Number(s.unpaid_days) > 0 && ` · ${s.unpaid_days} unpaid day(s)`}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-right">{formatMoney(s.basic, s.currency)}</td>
                          <td className="px-5 py-3 text-right">{formatMoney(s.gross, s.currency)}</td>
                          <td className="px-5 py-3 text-right">{formatMoney(s.tax, s.currency)}</td>
                          <td className="px-5 py-3 text-right">{formatMoney(s.total_deductions, s.currency)}</td>
                          <td className="px-5 py-3 text-right font-medium text-slate-100">
                            {formatMoney(s.net, s.currency)}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <button
                              className="text-xs text-brand-400 hover:text-brand-300"
                              disabled={busy}
                              onClick={() => void showBreakdown(openRun, s, `${s.first_name} ${s.last_name}`)}
                            >
                              Breakdown
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {breakdown && (
            <div className={card}>
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
                <span className="text-sm font-semibold text-slate-200">
                  {breakdown.employee} — breakdown
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {breakdown.live
                      ? 'as it would be paid today'
                      : 'as issued'}
                  </span>
                </span>
                <button className={ghost} onClick={() => setBreakdown(null)}>Close</button>
              </div>
              <ul className="divide-y divide-slate-800">
                {breakdown.lines.map((l, i) => (
                  <li key={`${l.code}-${i}`} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <div>
                      <span className={l.kind === 'earning' ? 'text-slate-200' : 'text-slate-400'}>
                        {l.name}
                      </span>
                      <span className="ml-2 text-xs text-slate-600">{l.code}</span>
                      {l.kind === 'earning' && !l.isTaxable && (
                        <span className="ml-2 text-xs text-slate-500">not taxed</span>
                      )}
                      {l.kind === 'deduction' && l.reducesTaxable && (
                        <span className="ml-2 text-xs text-slate-500">before tax</span>
                      )}
                    </div>
                    <span className={l.kind === 'earning' ? 'text-slate-100' : 'text-rose-300'}>
                      {l.kind === 'deduction' && Number(l.amount) > 0 ? '−' : ''}
                      {formatMoney(l.amount, breakdown.currency)}
                    </span>
                  </li>
                ))}
                <li className="flex items-center justify-between bg-slate-900/40 px-5 py-3 text-sm font-semibold">
                  <span className="text-slate-200">Net pay</span>
                  <span className="text-slate-100">
                    {formatMoney(breakdown.net, breakdown.currency)}
                  </span>
                </li>
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- people */}
      {tab === 'people' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className={`${card} lg:col-span-1`}>
            <div className="border-b border-slate-800 px-5 py-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
              Employees
            </div>
            {members.length === 0 ? (
              <div className="p-6">
                <EmptyState icon={<Users className="h-8 w-8" />} title="No employees" message="Nobody to pay yet." />
              </div>
            ) : (
              <ul className="max-h-[32rem] divide-y divide-slate-800 overflow-y-auto">
                {members.map((m) => (
                  <li key={m.id}>
                    <button
                      onClick={() => void selectEmployee(m.id)}
                      className={`w-full px-5 py-3 text-left text-sm transition ${
                        selectedEmployee === m.id ? 'bg-slate-800/60 text-slate-100' : 'text-slate-300 hover:bg-slate-800/30'
                      }`}
                    >
                      <div>{m.name}</div>
                      <div className="text-xs text-slate-500">{m.email}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-6 lg:col-span-2">
            {!empPay ? (
              <div className={`${card} p-6`}>
                <EmptyState
                  icon={<Banknote className="h-8 w-8" />}
                  title="Pick somebody"
                  message="Their salary history and recurring components appear here."
                />
              </div>
            ) : (
              <>
                <div className={card}>
                  <div className="border-b border-slate-800 px-5 py-3">
                    <div className="text-sm font-semibold text-slate-200">{empPay.employee.name}</div>
                    <div className="text-xs text-slate-500">{empPay.employee.employeeNumber}</div>
                  </div>

                  <div className="grid gap-3 border-b border-slate-800 p-5 sm:grid-cols-4">
                    <div>
                      <label className={label}>Basic salary</label>
                      <input className={field} inputMode="decimal" placeholder="0.00"
                        value={payForm.basicSalary}
                        onChange={(e) => setPayForm({ ...payForm, basicSalary: e.target.value })} />
                    </div>
                    <div>
                      <label className={label}>From</label>
                      <input type="date" className={field} value={payForm.effectiveFrom}
                        onChange={(e) => setPayForm({ ...payForm, effectiveFrom: e.target.value })} />
                    </div>
                    <div>
                      <label className={label}>Frequency</label>
                      <select className={field} value={payForm.payFrequency}
                        onChange={(e) => setPayForm({ ...payForm, payFrequency: e.target.value })}>
                        <option value="monthly">Monthly</option>
                        <option value="biweekly">Fortnightly</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    </div>
                    <div>
                      <label className={label}>Reason</label>
                      <input className={field} placeholder="Promotion" value={payForm.reason}
                        onChange={(e) => setPayForm({ ...payForm, reason: e.target.value })} />
                    </div>
                    <div className="sm:col-span-4 flex items-center gap-3">
                      <button className={primary} disabled={busy || !payForm.basicSalary}
                        onClick={() => void saveCompensation()}>
                        Record
                      </button>
                      <span className="text-xs text-slate-500">
                        A raise is a new record, not an edit. What earlier payslips say does not move.
                      </span>
                    </div>
                  </div>

                  <ul className="divide-y divide-slate-800">
                    {empPay.compensation.map((c, i) => (
                      <li key={c.id} className="flex items-center justify-between px-5 py-3 text-sm">
                        <div>
                          <span className="text-slate-100">{formatMoney(c.basic_salary, c.currency)}</span>
                          <span className="ml-2 text-slate-500">{c.pay_frequency}</span>
                          {i === 0 && (
                            <span className="ml-2 rounded-full bg-success-600/20 px-2 py-0.5 text-xs text-success-300">
                              in force
                            </span>
                          )}
                        </div>
                        <div className="text-slate-400">
                          from {isoDay(c.effective_from)}
                          {c.reason && <span className="ml-2 text-xs text-slate-600">{c.reason}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className={card}>
                  <div className="border-b border-slate-800 px-5 py-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
                    Recurring components
                  </div>
                  <div className="grid gap-3 border-b border-slate-800 p-5 sm:grid-cols-4">
                    <div>
                      <label className={label}>Component</label>
                      <select className={field} value={assignForm.componentId}
                        onChange={(e) => setAssignForm({ ...assignForm, componentId: e.target.value })}>
                        <option value="">Choose…</option>
                        {components.filter((c) => c.is_active).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.kind === 'earning' ? '+' : '−'})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={label}>Amount override</label>
                      <input className={field} inputMode="decimal" placeholder="default"
                        value={assignForm.amount}
                        onChange={(e) => setAssignForm({ ...assignForm, amount: e.target.value })} />
                    </div>
                    <div>
                      <label className={label}>Rate override %</label>
                      <input className={field} inputMode="decimal" placeholder="default"
                        value={assignForm.rate}
                        onChange={(e) => setAssignForm({ ...assignForm, rate: e.target.value })} />
                    </div>
                    <div>
                      <label className={label}>From</label>
                      <input type="date" className={field} value={assignForm.effectiveFrom}
                        onChange={(e) => setAssignForm({ ...assignForm, effectiveFrom: e.target.value })} />
                    </div>
                    <div className="sm:col-span-4">
                      <button className={primary} disabled={busy || !assignForm.componentId}
                        onClick={() => void assign()}>
                        Assign
                      </button>
                    </div>
                  </div>

                  {empPay.components.length === 0 ? (
                    <div className="px-5 py-4 text-sm text-slate-500">
                      Nothing beyond the basic salary.
                    </div>
                  ) : (
                    <ul className="divide-y divide-slate-800">
                      {empPay.components.map((a) => (
                        <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
                          <div>
                            <span className={a.kind === 'earning' ? 'text-slate-100' : 'text-slate-300'}>
                              {a.name}
                            </span>
                            <span className="ml-2 text-xs text-slate-500">
                              {a.calculation === 'percent_of_basic'
                                ? `${a.rate === null ? '—' : formatRate(a.rate)}% of basic`
                                : formatMoney(a.amount, 'USD')}
                            </span>
                            {a.is_statutory && (
                              <span className="ml-2 rounded-full bg-slate-700/40 px-2 py-0.5 text-xs text-slate-400">
                                statutory
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            <span>
                              {isoDay(a.effective_from)} → {a.effective_to ? isoDay(a.effective_to) : 'open'}
                            </span>
                            <button className="text-rose-400 hover:text-rose-300"
                              disabled={busy} onClick={() => void endAssignment(a.id)}>
                              End
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- structure */}
      {tab === 'structure' && (
        <div className={card}>
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
            <span className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Pay components
            </span>
            <button className={ghost} onClick={() => setShowComponentForm((v) => !v)}>
              <Plus className="h-4 w-4" /> Add a component
            </button>
          </div>

          {showComponentForm && (
            <div className="grid gap-3 border-b border-slate-800 p-5 sm:grid-cols-3">
              <div>
                <label className={label}>Code</label>
                <input className={field} placeholder="HOUSING" value={componentForm.code}
                  onChange={(e) => setComponentForm({ ...componentForm, code: e.target.value })} />
              </div>
              <div>
                <label className={label}>Name</label>
                <input className={field} placeholder="Housing allowance" value={componentForm.name}
                  onChange={(e) => setComponentForm({ ...componentForm, name: e.target.value })} />
              </div>
              <div>
                <label className={label}>Kind</label>
                <select className={field} value={componentForm.kind}
                  onChange={(e) => setComponentForm({ ...componentForm, kind: e.target.value as ComponentKind })}>
                  <option value="earning">Earning</option>
                  <option value="deduction">Deduction</option>
                </select>
              </div>
              <div>
                <label className={label}>Worked out as</label>
                <select className={field} value={componentForm.calculation}
                  onChange={(e) => setComponentForm({
                    ...componentForm, calculation: e.target.value as 'fixed' | 'percent_of_basic',
                  })}>
                  <option value="fixed">A fixed amount</option>
                  <option value="percent_of_basic">A percentage of basic</option>
                </select>
              </div>
              {componentForm.calculation === 'fixed' ? (
                <div>
                  <label className={label}>Default amount</label>
                  <input className={field} inputMode="decimal" placeholder="0.00"
                    value={componentForm.defaultAmount}
                    onChange={(e) => setComponentForm({ ...componentForm, defaultAmount: e.target.value })} />
                </div>
              ) : (
                <div>
                  <label className={label}>Default rate %</label>
                  <input className={field} inputMode="decimal" placeholder="10"
                    value={componentForm.defaultRate}
                    onChange={(e) => setComponentForm({ ...componentForm, defaultRate: e.target.value })} />
                </div>
              )}
              <div className="flex items-end gap-4 text-sm text-slate-300">
                {componentForm.kind === 'earning' ? (
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={componentForm.isTaxable}
                      onChange={(e) => setComponentForm({ ...componentForm, isTaxable: e.target.checked })} />
                    Taxable
                  </label>
                ) : (
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={componentForm.reducesTaxable}
                      onChange={(e) => setComponentForm({ ...componentForm, reducesTaxable: e.target.checked })} />
                    Comes off before tax
                  </label>
                )}
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={componentForm.isStatutory}
                    onChange={(e) => setComponentForm({ ...componentForm, isStatutory: e.target.checked })} />
                  Statutory
                </label>
              </div>
              <div className="sm:col-span-3 flex gap-2">
                <button className={primary} disabled={busy || !componentForm.code || !componentForm.name}
                  onClick={() => void createComponent()}>
                  Add
                </button>
                <button className={ghost} onClick={() => setShowComponentForm(false)}>Cancel</button>
              </div>
            </div>
          )}

          {components.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Layers className="h-8 w-8" />}
                title="No components yet"
                message="Allowances, pension, loan repayments — anything beyond the basic salary."
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {components.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <span className={c.is_active ? 'text-slate-100' : 'text-slate-500 line-through'}>
                      {c.name}
                    </span>
                    <span className="ml-2 text-xs text-slate-600">{c.code}</span>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {c.kind === 'earning' ? 'Earning' : 'Deduction'}
                      {' · '}
                      {c.calculation === 'percent_of_basic'
                        ? `${formatRate(c.default_rate)}% of basic`
                        : formatMoney(c.default_amount, 'USD')}
                      {c.kind === 'earning' && !c.is_taxable && ' · not taxed'}
                      {c.kind === 'deduction' && c.reduces_taxable && ' · before tax'}
                      {c.is_statutory && ' · statutory'}
                      {c.assignment_count ? ` · ${c.assignment_count} assigned` : ''}
                    </div>
                  </div>
                  <button className={ghost} disabled={busy} onClick={() => void deactivate(c)}>
                    {c.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------- tax */}
      {tab === 'tax' && (
        <div className="space-y-6">
          <div className={card}>
            <div className="border-b border-slate-800 px-5 py-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
              Bands in force
            </div>
            {brackets.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={<Percent className="h-8 w-8" />}
                  title="No tax table"
                  message="Until one is set, runs charge no tax and say so on each payslip."
                />
              </div>
            ) : (
              <ul className="divide-y divide-slate-800">
                {brackets.map((b) => (
                  <li key={b.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <span className="text-slate-300">
                      {formatMoney(b.lower_bound, '')}
                      {' → '}
                      {b.upper_bound === null ? 'and above' : formatMoney(b.upper_bound, '')}
                    </span>
                    <span className="text-slate-100">
                      {formatRate(b.rate)}% <span className="ml-2 text-xs text-slate-600">from {isoDay(b.effective_from)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={card}>
            <div className="border-b border-slate-800 px-5 py-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
              Set a table
            </div>
            <div className="space-y-3 p-5">
              <p className="text-sm text-slate-500">
                A whole table at a time. The bands have to start at zero, meet exactly, and
                end open — a gap between two bands would leave part of everybody's income
                silently untaxed. Bounds are annual; the run applies them to an annualised
                figure and divides the result back down.
              </p>
              <div>
                <label className={label}>Effective from</label>
                <input type="date" className={`${field} max-w-xs`} value={taxForm.effectiveFrom}
                  onChange={(e) => setTaxForm({ ...taxForm, effectiveFrom: e.target.value })} />
              </div>
              {taxForm.bands.map((b, i) => (
                <div key={i} className="grid gap-3 sm:grid-cols-4">
                  <div>
                    <label className={label}>From</label>
                    <input className={field} inputMode="decimal" value={b.lowerBound}
                      onChange={(e) => {
                        const bands = [...taxForm.bands];
                        bands[i] = { ...bands[i], lowerBound: e.target.value };
                        setTaxForm({ ...taxForm, bands });
                      }} />
                  </div>
                  <div>
                    <label className={label}>To (blank = top band)</label>
                    <input className={field} inputMode="decimal" value={b.upperBound}
                      onChange={(e) => {
                        const bands = [...taxForm.bands];
                        bands[i] = { ...bands[i], upperBound: e.target.value };
                        setTaxForm({ ...taxForm, bands });
                      }} />
                  </div>
                  <div>
                    <label className={label}>Rate %</label>
                    <input className={field} inputMode="decimal" value={b.rate}
                      onChange={(e) => {
                        const bands = [...taxForm.bands];
                        bands[i] = { ...bands[i], rate: e.target.value };
                        setTaxForm({ ...taxForm, bands });
                      }} />
                  </div>
                  <div className="flex items-end">
                    {taxForm.bands.length > 1 && (
                      <button className={ghost}
                        onClick={() => setTaxForm({
                          ...taxForm, bands: taxForm.bands.filter((_, j) => j !== i),
                        })}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <button className={ghost}
                  onClick={() => setTaxForm({
                    ...taxForm,
                    bands: [...taxForm.bands, {
                      lowerBound: taxForm.bands[taxForm.bands.length - 1]?.upperBound || '',
                      upperBound: '', rate: '',
                    }],
                  })}>
                  <Plus className="h-4 w-4" /> Add a band
                </button>
                <button className={primary} disabled={busy} onClick={() => void saveTax()}>
                  <CheckCircle2 className="h-4 w-4" /> Save the table
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HRPayrollPage;
