import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, ClipboardList, FileText, Send,
} from 'lucide-react';
import { useToastStore } from '../components/Toast';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState, ErrorAlert } from '../components/ErrorDisplay';
import {
  workforceService,
  CONTRACT_TYPE_LABEL,
  TIMESHEET_STATUS_LABEL,
  formatHours,
  isoDay,
  shortTime,
  sumHours,
  type Contract,
  type RosterShift,
  type Timesheet,
  type TimesheetStatus,
} from '../services/workforceService';

/**
 * An employee's own working life: their contract, their shifts and their
 * timesheets.
 *
 * Only published shifts appear, because that is all the API returns — a draft
 * roster is a plan somebody is still moving around, and showing it as though
 * it were settled is worse than showing nothing. Colleagues' shifts never
 * appear: a full rota is a map of who is in the building when.
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

type Tab = 'shifts' | 'timesheets' | 'contract';

const EmployeeWorkPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('shifts');
  const [anchor, setAnchor] = useState(() => mondayOf(new Date()));
  const [shifts, setShifts] = useState<RosterShift[]>([]);
  const [sheets, setSheets] = useState<Timesheet[]>([]);
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { addToast } = useToastStore();

  const from = iso(anchor);
  const to = iso(new Date(anchor.getTime() + 13 * DAY_MS));
  const days = useMemo(
    () => Array.from({ length: 14 }, (_, i) => iso(new Date(anchor.getTime() + i * DAY_MS))),
    [anchor]
  );

  useEffect(() => { void load(); }, [from]);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [r, ts, ct] = await Promise.all([
        workforceService.roster(from, to),
        workforceService.myTimesheets(),
        workforceService.myContract().catch(() => null),
      ]);
      setShifts(r.shifts);
      setSheets(ts);
      setContract(ct);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const submit = async (id: string) => {
    try {
      setBusy(true);
      await workforceService.submitTimesheet(id);
      addToast({
        type: 'success', title: 'Submitted',
        message: 'Somebody else will review it.',
      });
      setSheets(await workforceService.myTimesheets());
    } catch (e) {
      addToast({ type: 'error', title: 'Could not submit it', message: getErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingOverlay message="Loading your shifts…" />;

  const byDay = new Map<string, RosterShift[]>();
  for (const s of shifts) {
    const d = isoDay(s.work_date);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(s);
  }

  const card = 'rounded-xl border border-subtle bg-card';
  const ghost = 'inline-flex items-center gap-1.5 rounded-lg border border-subtle px-3 py-1.5 text-sm text-secondary hover:bg-sunken disabled:opacity-50';
  const primary = 'inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-500 disabled:opacity-50';

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'shifts', label: 'My shifts', icon: <CalendarDays className="h-4 w-4" /> },
    { id: 'timesheets', label: 'My timesheets', icon: <ClipboardList className="h-4 w-4" /> },
    { id: 'contract', label: 'My contract', icon: <FileText className="h-4 w-4" /> },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">My work</h1>
        <p className="mt-1 text-sm text-secondary">
          Your shifts, your hours and the terms you are engaged on.
        </p>
      </div>

      {error && <ErrorAlert title="Could not load your work" message={error} onDismiss={() => setError(null)} />}

      <div className="flex gap-1 border-b border-subtle">
        {tabs.map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm transition ${
              tab === x.id
                ? 'border-brand-500 text-primary'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            {x.icon}
            {x.label}
          </button>
        ))}
      </div>

      {tab === 'shifts' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button className={ghost} onClick={() => setAnchor(new Date(anchor.getTime() - 14 * DAY_MS))}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <span className="text-sm text-secondary">{from} → {to}</span>
            <button className={ghost} onClick={() => setAnchor(new Date(anchor.getTime() + 14 * DAY_MS))}>
              Next <ChevronRight className="h-4 w-4" />
            </button>
            <button className={ghost} onClick={() => setAnchor(mondayOf(new Date()))}>This fortnight</button>
            <span className="ml-auto text-sm text-secondary">
              {formatHours(sumHours(
                shifts.filter((s) => s.status !== 'cancelled').map((s) => s.paid_hours)
              ))} hours
            </span>
          </div>

          {shifts.length === 0 ? (
            <div className={`${card} p-6`}>
              <EmptyState
                icon={<CalendarDays className="h-8 w-8" />}
                title="No shifts this fortnight"
                message="A shift appears here once the rota covering it has been published."
              />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
              {days.map((d) => {
                const cell = byDay.get(d) ?? [];
                const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
                return (
                  <div key={d} className={`${card} p-3 ${cell.length === 0 ? 'opacity-60' : ''}`}>
                    <div className="text-xs text-muted">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd]} {d.slice(8)}/{d.slice(5, 7)}
                    </div>
                    {cell.length === 0 ? (
                      <div className="mt-2 text-xs text-muted">Off</div>
                    ) : cell.map((s) => (
                      <div key={s.id} className="mt-2">
                        <div className={`text-sm ${
                          s.status === 'cancelled' ? 'text-muted line-through' : 'text-primary'
                        }`}>
                          {shortTime(s.start_time)}–{shortTime(s.end_time)}
                        </div>
                        <div className="text-xs text-muted">
                          {s.name} · {formatHours(s.paid_hours)} h
                        </div>
                        {s.status === 'cancelled' && (
                          <div className="text-xs text-rose-700 dark:text-rose-400">Cancelled: {s.cancel_reason}</div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'timesheets' && (
        <div className={card}>
          {sheets.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<ClipboardList className="h-8 w-8" />}
                title="No timesheets yet"
                message="One appears here once a period has been made up from your check-ins."
              />
            </div>
          ) : (
            <ul className="divide-y divide-subtle">
              {sheets.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-primary">
                        {isoDay(s.period_start)} → {isoDay(s.period_end)}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[s.status]}`}>
                        {TIMESHEET_STATUS_LABEL[s.status]}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {formatHours(s.approved_hours)} h approved of {formatHours(s.contracted_hours)} h contracted
                      {Number(s.overtime_hours) > 0 && (
                        <span className="text-amber-700 dark:text-amber-400">
                          {' · '}{formatHours(s.overtime_hours)} h overtime
                        </span>
                      )}
                    </div>
                    {s.status === 'rejected' && s.decision_note && (
                      <div className="mt-1 text-xs text-rose-700 dark:text-rose-400">Rejected: {s.decision_note}</div>
                    )}
                    {s.status === 'exported' && (
                      <div className="mt-1 text-xs text-success-700 dark:text-success-400">
                        The overtime has gone to payroll.
                      </div>
                    )}
                  </div>
                  {['draft', 'rejected'].includes(s.status) && (
                    <button className={primary} disabled={busy} onClick={() => void submit(s.id)}>
                      <Send className="h-4 w-4" /> Submit
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'contract' && (
        <div className={card}>
          {!contract ? (
            <div className="p-6">
              <EmptyState
                icon={<FileText className="h-8 w-8" />}
                title="No contract on file"
                message="Ask HR if you think this is wrong."
              />
            </div>
          ) : (
            <div className="divide-y divide-subtle">
              <div className="px-5 py-4">
                <div className="text-lg font-semibold text-primary">{contract.job_title}</div>
                <div className="mt-0.5 text-sm text-muted">
                  {CONTRACT_TYPE_LABEL[contract.contract_type]} · {contract.reference}
                </div>
              </div>
              {[
                ['Started', isoDay(contract.start_date)],
                ['Until', contract.end_date ? isoDay(contract.end_date) : 'Open-ended'],
                ['Hours a week', `${formatHours(contract.weekly_hours)} over ${formatHours(contract.working_days)} days`],
                ['Notice period', `${contract.notice_period_days} days`],
                ['Probation ends', contract.probation_end_date ? isoDay(contract.probation_end_date) : '—'],
                ['Department', contract.department_name ?? '—'],
                ['Reports to', contract.manager_first_name
                  ? `${contract.manager_first_name} ${contract.manager_last_name}` : '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="text-muted">{k}</span>
                  <span className="text-primary">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EmployeeWorkPage;
