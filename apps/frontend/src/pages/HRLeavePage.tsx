import React, { useEffect, useState } from 'react';
import { Check, X, CalendarDays, Settings2, Inbox } from 'lucide-react';
import { useToastStore } from '../components/Toast';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState, ErrorAlert } from '../components/ErrorDisplay';
import {
  leaveService,
  type LeaveType,
  type LeaveRequest,
  type CalendarDay,
} from '../services/leaveService';

/**
 * HR's view of leave: the approval queue, who is away, and the leave types
 * that define the company's policy.
 *
 * The queue never offers an approve button on the reader's own request — the
 * API refuses it, and showing a control that will be refused is worse than
 * not showing one.
 */

type Tab = 'queue' | 'calendar' | 'types';

const HRLeavePage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('queue');
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [calendar, setCalendar] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTypeForm, setShowTypeForm] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const monthOut = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const [range, setRange] = useState({ from: today, to: monthOut });

  const [typeForm, setTypeForm] = useState({
    code: '', name: '', daysPerYear: '20', minNoticeDays: '0', isPaid: true,
  });

  const { addToast } = useToastStore();

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (tab !== 'calendar') return;
    void (async () => {
      try {
        setCalendar(await leaveService.calendar(range.from, range.to));
      } catch (e) {
        addToast({ type: 'error', title: 'Could not load the calendar', message: getErrorMessage(e) });
      }
    })();
  }, [tab, range.from, range.to]);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [reqs, typeList] = await Promise.all([
        leaveService.listRequests({ scope: 'all' }),
        leaveService.listTypes(),
      ]);
      setRequests(reqs);
      setTypes(typeList);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const decide = async (request: LeaveRequest, decision: 'approved' | 'rejected') => {
    try {
      setBusy(true);
      await leaveService.decide(request.id, decision);
      await load();
      addToast({
        type: 'success',
        title: decision === 'approved' ? 'Leave approved' : 'Leave rejected',
        message: `${request.first_name} ${request.last_name} · ${request.total_days} day(s)`,
      });
    } catch (e) {
      addToast({ type: 'error', title: 'Could not record the decision', message: getErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const createType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typeForm.code.trim() || !typeForm.name.trim()) return;
    try {
      setBusy(true);
      await leaveService.createType({
        code: typeForm.code.trim(),
        name: typeForm.name.trim(),
        daysPerYear: Number(typeForm.daysPerYear) || 0,
        minNoticeDays: Number(typeForm.minNoticeDays) || 0,
        isPaid: typeForm.isPaid,
      });
      setShowTypeForm(false);
      setTypeForm({ code: '', name: '', daysPerYear: '20', minNoticeDays: '0', isPaid: true });
      await load();
      addToast({ type: 'success', title: 'Leave type created' });
    } catch (err) {
      addToast({ type: 'error', title: 'Could not create leave type', message: getErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const pending = requests.filter((r) => r.status === 'pending');
  const decided = requests.filter((r) => r.status !== 'pending');

  if (loading) return <LoadingOverlay message="Loading leave…" />;

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'queue', label: 'Approvals', icon: <Inbox className="h-4 w-4" />, count: pending.length },
    { id: 'calendar', label: 'Who is away', icon: <CalendarDays className="h-4 w-4" /> },
    { id: 'types', label: 'Leave types', icon: <Settings2 className="h-4 w-4" /> },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Leave management</h1>
        <p className="mt-1 text-sm text-secondary">
          Approvals, absence cover and the company's leave policy.
        </p>
      </div>

      {error && <ErrorAlert title="Could not load leave" message={error} onDismiss={() => setError(null)} />}

      <div className="flex gap-1 border-b border-subtle">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm transition ${
              tab === t.id
                ? 'border-brand-500 text-primary'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'queue' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-subtle bg-card">
            <div className="border-b border-subtle px-5 py-3 text-sm font-semibold uppercase tracking-wider text-secondary">
              Awaiting a decision
            </div>
            {pending.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={<Inbox className="h-8 w-8" />}
                  title="Nothing waiting"
                  message="Every leave request has been decided."
                />
              </div>
            ) : (
              <ul className="divide-y divide-subtle">
                {pending.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div>
                      <div className="text-sm font-medium text-primary">
                        {r.first_name} {r.last_name}
                        <span className="ml-2 text-xs text-muted">{r.employee_number}</span>
                      </div>
                      <div className="text-sm text-secondary">
                        {r.type_name} · {r.start_date} → {r.end_date} · {r.total_days} day(s)
                      </div>
                      {r.reason && <div className="mt-1 text-xs text-muted">{r.reason}</div>}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void decide(r, 'approved')}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-success-600/20 px-3 py-1.5 text-sm text-success-700 dark:text-success-300 hover:bg-success-600/30 disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" />
                        Approve
                      </button>
                      <button
                        onClick={() => void decide(r, 'rejected')}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-danger-600/20 px-3 py-1.5 text-sm text-danger-700 dark:text-danger-400 hover:bg-danger-600/30 disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                        Reject
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {decided.length > 0 && (
            <div className="rounded-xl border border-subtle bg-card">
              <div className="border-b border-subtle px-5 py-3 text-sm font-semibold uppercase tracking-wider text-secondary">
                Recently decided
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-subtle">
                  {decided.slice(0, 20).map((r) => (
                    <tr key={r.id}>
                      <td className="px-5 py-2 text-primary">
                        {r.first_name} {r.last_name}
                      </td>
                      <td className="px-5 py-2 text-secondary">{r.type_name}</td>
                      <td className="px-5 py-2 text-secondary">
                        {r.start_date} → {r.end_date}
                      </td>
                      <td className="px-5 py-2 text-secondary">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'calendar' && (
        <div className="rounded-xl border border-subtle bg-card">
          <div className="flex flex-wrap items-center gap-3 border-b border-subtle px-5 py-3">
            <label className="text-sm text-secondary">
              From
              <input
                type="date"
                value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
                className="ml-2 rounded-lg border border-subtle bg-card px-2 py-1 text-primary"
              />
            </label>
            <label className="text-sm text-secondary">
              To
              <input
                type="date"
                value={range.to}
                min={range.from}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
                className="ml-2 rounded-lg border border-subtle bg-card px-2 py-1 text-primary"
              />
            </label>
          </div>
          {calendar.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<CalendarDays className="h-8 w-8" />}
                title="Nobody is away"
                message="No approved or pending leave falls in this range."
              />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted">
                <tr className="border-b border-subtle">
                  <th className="px-5 py-2">Date</th>
                  <th className="px-5 py-2">Who</th>
                  <th className="px-5 py-2">Type</th>
                  <th className="px-5 py-2">Portion</th>
                  <th className="px-5 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {calendar.map((day, i) => (
                  <tr key={`${day.employee_id}-${day.leave_date}-${i}`}>
                    <td className="px-5 py-2 text-secondary">{day.leave_date}</td>
                    <td className="px-5 py-2 text-primary">
                      {day.first_name} {day.last_name}
                    </td>
                    <td className="px-5 py-2 text-secondary">{day.type_name}</td>
                    <td className="px-5 py-2 text-secondary">
                      {Number(day.portion) === 0.5 ? 'Half day' : 'Full day'}
                    </td>
                    <td className="px-5 py-2 text-secondary">{day.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'types' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowTypeForm(true)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
            >
              New leave type
            </button>
          </div>

          {types.length === 0 ? (
            <EmptyState
              icon={<Settings2 className="h-8 w-8" />}
              title="No leave types"
              message="Define the kinds of leave your company grants, and how many days each carries."
            />
          ) : (
            <div className="rounded-xl border border-subtle bg-card">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted">
                  <tr className="border-b border-subtle">
                    <th className="px-5 py-2">Type</th>
                    <th className="px-5 py-2">Days / year</th>
                    <th className="px-5 py-2">Notice</th>
                    <th className="px-5 py-2">Paid</th>
                    <th className="px-5 py-2">Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {types.map((t) => (
                    <tr key={t.id}>
                      <td className="px-5 py-2">
                        <div className="text-primary">{t.name}</div>
                        <div className="text-xs text-muted">{t.code}</div>
                      </td>
                      <td className="px-5 py-2 text-secondary">
                        {Number(t.days_per_year) > 0 ? t.days_per_year : 'Uncapped'}
                      </td>
                      <td className="px-5 py-2 text-secondary">{t.min_notice_days} day(s)</td>
                      <td className="px-5 py-2 text-secondary">{t.is_paid ? 'Yes' : 'No'}</td>
                      <td className="px-5 py-2 text-secondary">{t.is_active ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showTypeForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={createType}
            className="w-full max-w-md rounded-xl border border-subtle bg-card p-6"
          >
            <h2 className="mb-4 text-lg font-semibold text-primary">New leave type</h2>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-secondary">
                  Code
                  <input
                    value={typeForm.code}
                    onChange={(e) => setTypeForm({ ...typeForm, code: e.target.value })}
                    required
                    className="mt-1 w-full rounded-lg border border-subtle bg-card px-3 py-2 text-primary"
                  />
                </label>
                <label className="text-sm text-secondary">
                  Days per year
                  <input
                    type="number"
                    min={0}
                    value={typeForm.daysPerYear}
                    onChange={(e) => setTypeForm({ ...typeForm, daysPerYear: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-subtle bg-card px-3 py-2 text-primary"
                  />
                </label>
              </div>
              <label className="text-sm text-secondary">
                Name
                <input
                  value={typeForm.name}
                  onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })}
                  required
                  className="mt-1 w-full rounded-lg border border-subtle bg-card px-3 py-2 text-primary"
                />
              </label>
              <label className="text-sm text-secondary">
                Minimum notice (days)
                <input
                  type="number"
                  min={0}
                  value={typeForm.minNoticeDays}
                  onChange={(e) => setTypeForm({ ...typeForm, minNoticeDays: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-subtle bg-card px-3 py-2 text-primary"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-secondary">
                <input
                  type="checkbox"
                  checked={typeForm.isPaid}
                  onChange={(e) => setTypeForm({ ...typeForm, isPaid: e.target.checked })}
                />
                Paid leave
              </label>
              <p className="text-xs text-muted">
                Zero days per year means uncapped — unpaid leave, typically.
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowTypeForm(false)}
                className="rounded-lg border border-subtle px-4 py-2 text-sm text-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default HRLeavePage;
