import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, BadgeCheck, Banknote, CalendarRange, CheckCircle2,
  ClipboardList, Hammer, Send, X,
} from 'lucide-react';
import { useToastStore } from '../components/Toast';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState, ErrorAlert } from '../components/ErrorDisplay';
import hrService, { type MemberAttendanceSummary } from '../services/hrService';
import { payrollService, type SalaryComponent } from '../services/payrollService';
import {
  workforceService,
  TIMESHEET_STATUS_LABEL,
  formatHours,
  isoDay,
  type Timesheet,
  type TimesheetEntry,
  type TimesheetPreview,
  type TimesheetStatus,
} from '../services/workforceService';

/**
 * Timesheets.
 *
 * Hours are evidence, so the page shows where each figure came from and never
 * lets the worked column be edited: it is what the check-ins say. The approved
 * column is the one a human owns, and the two being visibly different is the
 * point — an adjustment should read as an adjustment.
 *
 * The three things the API refuses are reflected in what is offered rather
 * than left to an error: a sheet is decided by somebody other than whoever
 * submitted it, an approved sheet's days are frozen, and only a director sends
 * hours to payroll.
 */

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function mondayOf(d: Date): Date {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return new Date(copy.getTime() - ((copy.getUTCDay() + 6) % 7) * DAY_MS);
}

const STATUS_STYLE: Record<TimesheetStatus, string> = {
  draft: 'bg-sunken text-secondary',
  submitted: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  approved: 'bg-brand-500/20 text-brand-700 dark:text-brand-300',
  rejected: 'bg-rose-600/20 text-rose-700 dark:text-rose-300',
  exported: 'bg-success-600/20 text-success-700 dark:text-success-300',
};

const SOURCE_LABEL: Record<string, string> = {
  checkin: 'from check-ins',
  roster: 'rostered',
  manual: 'adjusted',
  leave: 'on leave',
};

interface Props {
  /** Whether the reader may send hours to payroll. The API refuses otherwise. */
  canExport?: boolean;
}

const HRTimesheetsPage: React.FC<Props> = ({ canExport = false }) => {
  const [sheets, setSheets] = useState<Timesheet[]>([]);
  const [members, setMembers] = useState<MemberAttendanceSummary[]>([]);
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastWeek = mondayOf(new Date(Date.now() - 7 * DAY_MS));
  const [build, setBuild] = useState({
    employeeId: '',
    periodStart: iso(lastWeek),
    periodEnd: iso(new Date(lastWeek.getTime() + 6 * DAY_MS)),
  });
  const [preview, setPreview] = useState<TimesheetPreview | null>(null);

  const [open, setOpen] = useState<{
    timesheet: Timesheet;
    entries: TimesheetEntry[];
    employee: { first_name: string; last_name: string; employee_id: string } | null;
    contract: { reference: string; job_title: string; weekly_hours: string } | null;
  } | null>(null);
  const [rate, setRate] = useState<{
    hourlyRate: string; currency: string; atMultiplierOne: string;
  } | null>(null);
  const [exportForm, setExportForm] = useState({ componentId: '', multiplier: '1.5' });

  // Sheets this session submitted. The API refuses a decision from whoever
  // submitted, so the buttons are withheld rather than offered and refused.
  const [submittedHere, setSubmittedHere] = useState<Set<string>>(new Set());

  const { addToast } = useToastStore();

  useEffect(() => { void load(); }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [list, m, comps] = await Promise.all([
        workforceService.listTimesheets(),
        hrService.listMembers(1, 200).catch(() => ({ members: [], page: 1, pageSize: 200, total: 0 })),
        // Only fetched by somebody who can actually spend the money. Payroll
        // components are HR's, so asking for them as a manager is a request
        // that can only ever be refused.
        canExport
          ? payrollService.listComponents().catch(() => [] as SalaryComponent[])
          : Promise.resolve([] as SalaryComponent[]),
      ]);
      setSheets(list);
      setMembers(m.members.filter((x: MemberAttendanceSummary) => x.role === 'EMPLOYEE'));
      setComponents(comps.filter((c) => c.kind === 'earning' && c.is_active));
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const fail = (title: string, e: unknown) =>
    addToast({ type: 'error', title, message: getErrorMessage(e) });

  const doPreview = async () => {
    if (!build.employeeId) return;
    try {
      setBusy(true);
      setPreview(await workforceService.previewTimesheet(
        build.employeeId, build.periodStart, build.periodEnd
      ));
    } catch (e) {
      setPreview(null);
      fail('Could not work that period out', e);
    } finally {
      setBusy(false);
    }
  };

  const doBuild = async () => {
    try {
      setBusy(true);
      const result = await workforceService.buildTimesheet(
        build.employeeId, build.periodStart, build.periodEnd
      );
      setPreview(null);
      addToast({ type: 'success', title: 'Timesheet built' });
      await load();
      await openSheet(result.timesheet.id);
    } catch (e) {
      fail('Could not build the timesheet', e);
    } finally {
      setBusy(false);
    }
  };

  const openSheet = async (id: string) => {
    try {
      setBusy(true);
      const d = await workforceService.timesheet(id);
      setOpen(d as any);
      setRate(null);
      if (d.timesheet.status === 'approved' && Number(d.timesheet.overtime_hours) > 0) {
        try {
          setRate(await workforceService.timesheetRate(id));
        } catch {
          // A rate needs a contract and a salary. Its absence is reported in
          // the panel rather than as a toast on a page that otherwise loaded.
          setRate(null);
        }
      }
    } catch (e) {
      fail('Could not open the timesheet', e);
    } finally {
      setBusy(false);
    }
  };

  const adjust = async (entry: TimesheetEntry) => {
    if (!open) return;
    const hours = window.prompt(
      `Approved hours for ${isoDay(entry.work_date)} (the check-ins say ${formatHours(entry.worked_hours)})`,
      String(Number(entry.approved_hours))
    );
    if (hours === null) return;
    const note = window.prompt('Why is it different from what the check-ins say?');
    if (!note) return;
    try {
      setBusy(true);
      await workforceService.adjustDay(open.timesheet.id, entry.id, Number(hours), note);
      addToast({ type: 'success', title: 'Day adjusted' });
      await openSheet(open.timesheet.id);
      await load();
    } catch (e) {
      fail('Could not adjust that day', e);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (id: string) => {
    try {
      setBusy(true);
      await workforceService.submitTimesheet(id);
      setSubmittedHere((s) => new Set(s).add(id));
      addToast({ type: 'success', title: 'Submitted for approval' });
      await openSheet(id);
      await load();
    } catch (e) {
      fail('Could not submit it', e);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    let note: string | null = null;
    if (decision === 'rejected') {
      note = window.prompt('Why is it being rejected?');
      if (!note) return;
    }
    try {
      setBusy(true);
      await workforceService.decideTimesheet(id, decision, note ?? undefined);
      addToast({ type: 'success', title: `Timesheet ${decision}` });
      await openSheet(id);
      await load();
    } catch (e) {
      fail('Could not decide it', e);
    } finally {
      setBusy(false);
    }
  };

  const doExport = async (id: string) => {
    try {
      setBusy(true);
      const result = await workforceService.exportTimesheet(
        id, exportForm.componentId, Number(exportForm.multiplier)
      );
      addToast({
        type: 'success',
        title: `${result.amount} staged for payroll`,
        message: `${formatHours(result.overtimeHours)} h at ${result.hourlyRate} an hour`
          + `${result.multiplier === 1 ? '' : `, times ${result.multiplier}`}.`,
      });
      await openSheet(id);
      await load();
    } catch (e) {
      fail('Could not send it to payroll', e);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingOverlay message="Loading timesheets…" />;

  const field = 'w-full rounded-lg border border-subtle bg-card px-3 py-2 text-sm text-primary placeholder:text-muted';
  const label = 'mb-1 block text-xs uppercase tracking-wider text-muted';
  const primary = 'inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-500 disabled:opacity-50';
  const ghost = 'inline-flex items-center gap-1.5 rounded-lg border border-subtle px-3 py-1.5 text-sm text-secondary hover:bg-sunken disabled:opacity-50';
  const card = 'rounded-xl border border-subtle bg-card';

  const t = open?.timesheet;
  const mine = t ? submittedHere.has(t.id) : false;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Timesheets</h1>
        <p className="mt-1 text-sm text-secondary">
          What the check-ins say, what was signed off, and what goes to payroll.
        </p>
      </div>

      {error && <ErrorAlert title="Could not load timesheets" message={error} onDismiss={() => setError(null)} />}

      <div className={card}>
        <div className="border-b border-subtle px-5 py-3 text-sm font-semibold uppercase tracking-wider text-secondary">
          Build a period
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-4">
          <div>
            <label className={label}>Employee</label>
            <select className={field} value={build.employeeId}
              onChange={(e) => { setBuild({ ...build, employeeId: e.target.value }); setPreview(null); }}>
              <option value="">Choose…</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>From</label>
            <input type="date" className={field} value={build.periodStart}
              onChange={(e) => { setBuild({ ...build, periodStart: e.target.value }); setPreview(null); }} />
          </div>
          <div>
            <label className={label}>To</label>
            <input type="date" className={field} value={build.periodEnd}
              onChange={(e) => { setBuild({ ...build, periodEnd: e.target.value }); setPreview(null); }} />
          </div>
          <div className="flex items-end gap-2">
            <button className={ghost} disabled={busy || !build.employeeId} onClick={() => void doPreview()}>
              Work it out
            </button>
            <button className={primary} disabled={busy || !build.employeeId} onClick={() => void doBuild()}>
              <Hammer className="h-4 w-4" /> Build
            </button>
          </div>
        </div>

        {preview && (
          <div className="border-t border-subtle p-5">
            <div className="grid grid-cols-2 gap-px bg-sunken sm:grid-cols-5">
              {[
                ['Contracted', formatHours(preview.contractedHours)],
                ['Rostered', formatHours(preview.rosteredHours)],
                ['Worked', formatHours(preview.workedHours)],
                ['Approved', formatHours(preview.approvedHours)],
                ['Overtime', formatHours(preview.overtimeHours)],
              ].map(([k, v]) => (
                <div key={k} className="bg-card px-4 py-3">
                  <div className="text-xs uppercase tracking-wider text-muted">{k}</div>
                  <div className="mt-1 text-lg font-semibold text-primary">{v} h</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
              {preview.contract ? (
                <span>
                  Measured against {preview.contract.reference} —
                  {' '}{preview.contract.weeklyHours} h over {preview.contract.workingDays} days
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-400">
                  No contract in force for this period, so nothing to measure overtime against.
                </span>
              )}
              {preview.leaveDays > 0 && (
                <span>{preview.leaveDays} day(s) of approved leave reduced the contracted hours</span>
              )}
              {Number(preview.flaggedHours) > 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  {formatHours(preview.flaggedHours)} h of flagged check-ins were not counted
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className={`${card} lg:col-span-1`}>
          <div className="border-b border-subtle px-5 py-3 text-sm font-semibold uppercase tracking-wider text-secondary">
            Timesheets
          </div>
          {sheets.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<ClipboardList className="h-8 w-8" />}
                title="None yet"
                message="Build a period above to produce one."
              />
            </div>
          ) : (
            <ul className="max-h-[36rem] divide-y divide-subtle overflow-y-auto">
              {sheets.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => void openSheet(s.id)}
                    className={`w-full px-5 py-3 text-left transition ${
                      t?.id === s.id ? 'bg-sunken' : 'hover:bg-sunken'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-primary">
                        {s.first_name} {s.last_name}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[s.status]}`}>
                        {TIMESHEET_STATUS_LABEL[s.status]}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {isoDay(s.period_start)} → {isoDay(s.period_end)}
                      {' · '}{formatHours(s.approved_hours)} h
                      {Number(s.overtime_hours) > 0 && (
                        <span className="text-amber-700 dark:text-amber-400">
                          {' '}(+{formatHours(s.overtime_hours)} OT)
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lg:col-span-2">
          {!open || !t ? (
            <div className={`${card} p-6`}>
              <EmptyState
                icon={<CalendarRange className="h-8 w-8" />}
                title="Pick a timesheet"
                message="Its days, and where each figure came from, appear here."
              />
            </div>
          ) : (
            <div className={card}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-5 py-3">
                <div>
                  <div className="text-sm font-semibold text-primary">
                    {open.employee?.first_name} {open.employee?.last_name}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[t.status]}`}>
                      {TIMESHEET_STATUS_LABEL[t.status]}
                    </span>
                  </div>
                  <div className="text-xs text-muted">
                    {isoDay(t.period_start)} → {isoDay(t.period_end)}
                    {open.contract && ` · ${open.contract.reference}, ${formatHours(open.contract.weekly_hours)} h/week`}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {['draft', 'rejected'].includes(t.status) && (
                    <button className={primary} disabled={busy} onClick={() => void submit(t.id)}>
                      <Send className="h-4 w-4" /> Submit
                    </button>
                  )}
                  {t.status === 'submitted' && !mine && (
                    <>
                      <button className={primary} disabled={busy} onClick={() => void decide(t.id, 'approved')}>
                        <BadgeCheck className="h-4 w-4" /> Approve
                      </button>
                      <button className={ghost} disabled={busy} onClick={() => void decide(t.id, 'rejected')}>
                        <X className="h-4 w-4" /> Reject
                      </button>
                    </>
                  )}
                  <button className={ghost} onClick={() => { setOpen(null); setRate(null); }}>Close</button>
                </div>
              </div>

              {t.status === 'submitted' && mine && (
                <div className="border-b border-subtle bg-card px-5 py-3 text-sm text-secondary">
                  Waiting for somebody else to decide it. A timesheet is signed off by a second
                  pair of eyes; whoever submitted it cannot approve it.
                </div>
              )}
              {t.status === 'rejected' && t.decision_note && (
                <div className="border-b border-subtle bg-rose-600/5 px-5 py-3 text-sm text-rose-700 dark:text-rose-200">
                  Rejected: {t.decision_note}
                </div>
              )}

              <div className="grid grid-cols-2 gap-px border-b border-subtle bg-sunken sm:grid-cols-5">
                {[
                  ['Contracted', formatHours(t.contracted_hours)],
                  ['Rostered', formatHours(t.rostered_hours)],
                  ['Worked', formatHours(t.worked_hours)],
                  ['Approved', formatHours(t.approved_hours)],
                  ['Overtime', formatHours(t.overtime_hours)],
                ].map(([k, v]) => (
                  <div key={k} className="bg-card px-4 py-3">
                    <div className="text-xs uppercase tracking-wider text-muted">{k}</div>
                    <div className="mt-1 text-lg font-semibold text-primary">{v} h</div>
                  </div>
                ))}
              </div>

              {Number(t.flagged_hours) > 0 && (
                <div className="flex items-start gap-3 border-b border-subtle bg-amber-500/5 px-5 py-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                  <div className="text-sm text-amber-700 dark:text-amber-200">
                    {formatHours(t.flagged_hours)} hours came from flagged check-ins and were not
                    counted. Adjust the days concerned if they should be paid.
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wider text-muted">
                    <tr className="border-b border-subtle">
                      <th className="px-5 py-3">Day</th>
                      <th className="px-5 py-3 text-right">Rostered</th>
                      <th className="px-5 py-3 text-right">Worked</th>
                      <th className="px-5 py-3 text-right">Approved</th>
                      <th className="px-5 py-3">Where from</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-subtle">
                    {open.entries.map((e) => {
                      const differs = Number(e.approved_hours) !== Number(e.worked_hours);
                      return (
                        <tr key={e.id} className="text-secondary">
                          <td className="px-5 py-2.5">{isoDay(e.work_date)}</td>
                          <td className="px-5 py-2.5 text-right">{formatHours(e.rostered_hours)}</td>
                          <td className="px-5 py-2.5 text-right">{formatHours(e.worked_hours)}</td>
                          <td className={`px-5 py-2.5 text-right ${
                            differs ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-primary'
                          }`}>
                            {formatHours(e.approved_hours)}
                          </td>
                          <td className="px-5 py-2.5 text-xs text-muted">
                            {SOURCE_LABEL[e.source] ?? e.source}
                            {Number(e.flagged_hours) > 0
                              && ` · ${formatHours(e.flagged_hours)} h flagged`}
                            {e.note && ` · ${e.note}`}
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            {['draft', 'submitted', 'rejected'].includes(t.status) && (
                              <button className="text-xs text-brand-700 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
                                disabled={busy} onClick={() => void adjust(e)}>
                                Adjust
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {open.entries.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-5 py-6 text-center text-sm text-muted">
                          Nothing happened in this period — no check-ins, no shifts, no leave.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {t.status === 'approved' && Number(t.overtime_hours) > 0 && (
                <div className="border-t border-subtle p-5">
                  <div className="mb-3 text-sm font-semibold text-primary">Send to payroll</div>
                  {rate ? (
                    <p className="mb-3 text-xs text-muted">
                      {formatHours(t.overtime_hours)} hours of overtime at {rate.hourlyRate}
                      {' '}{rate.currency} an hour — the salary over the contracted hours — is
                      {' '}{rate.atMultiplierOne} at plain time.
                    </p>
                  ) : (
                    <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
                      No hourly rate could be derived: this needs both a contract with hours on
                      it and a compensation record.
                    </p>
                  )}
                  {canExport ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className={label}>Pay it as</label>
                        <select className={field} value={exportForm.componentId}
                          onChange={(e) => setExportForm({ ...exportForm, componentId: e.target.value })}>
                          <option value="">Choose an earning…</option>
                          {components.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={label}>Multiplier</label>
                        <input className={field} inputMode="decimal" value={exportForm.multiplier}
                          onChange={(e) => setExportForm({ ...exportForm, multiplier: e.target.value })} />
                      </div>
                      <div className="flex items-end">
                        <button className={primary} disabled={busy || !exportForm.componentId || !rate}
                          onClick={() => void doExport(t.id)}>
                          <Banknote className="h-4 w-4" /> Send
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted">
                      Sending hours to payroll needs a director; it spends money.
                    </p>
                  )}
                </div>
              )}

              {t.status === 'exported' && (
                <div className="flex items-center gap-2 border-t border-subtle px-5 py-4 text-sm text-success-700 dark:text-success-300">
                  <CheckCircle2 className="h-4 w-4" />
                  Staged against the payroll period covering {isoDay(t.period_end)}. It will appear
                  on the next payslip for this employee.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HRTimesheetsPage;
