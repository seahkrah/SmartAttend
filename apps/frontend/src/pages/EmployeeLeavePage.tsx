import React, { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, CalendarDays, Ban, Clock } from 'lucide-react';
import { useToastStore } from '../components/Toast';
import { useConfirmDialog } from '../components/useConfirmDialog';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState, ErrorAlert } from '../components/ErrorDisplay';
import {
  leaveService,
  type LeaveType,
  type LeaveBalance,
  type LeaveRequest,
} from '../services/leaveService';

/**
 * An employee's own leave: what they have left, what they have asked for,
 * and a form to ask for more.
 *
 * The form previews before it commits. A request's cost in days is not
 * obvious — weekends do not count, half-days count as 0.5 — so the page shows
 * what will be deducted before the employee submits rather than after.
 */

const STATUS_STYLES: Record<LeaveRequest['status'], string> = {
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  approved: 'bg-success-500/15 text-success-700 dark:text-success-300',
  rejected: 'bg-danger-500/15 text-danger-700 dark:text-danger-400',
  cancelled: 'bg-sunken text-secondary',
};

const EmployeeLeavePage: React.FC = () => {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({ leaveTypeId: '', startDate: '', endDate: '', reason: '' });
  const [preview, setPreview] = useState<{ totalDays: number; available: number | null } | null>(null);

  const { addToast } = useToastStore();
  const { showConfirmDialog, ConfirmDialog } = useConfirmDialog();

  const year = new Date().getFullYear();

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [typeList, balanceData, requestList] = await Promise.all([
        leaveService.listTypes(),
        leaveService.balances(year),
        leaveService.listRequests(),
      ]);
      setTypes(typeList.filter((t) => t.is_active));
      setBalances(balanceData.balances);
      setRequests(requestList);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  // Previewing on every change keeps the day count honest as the dates move.
  useEffect(() => {
    if (!form.startDate || !form.endDate) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await leaveService.preview({
          startDate: form.startDate,
          endDate: form.endDate,
          leaveTypeId: form.leaveTypeId || undefined,
        });
        if (!cancelled) setPreview({ totalDays: result.totalDays, available: result.available });
      } catch {
        if (!cancelled) setPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.startDate, form.endDate, form.leaveTypeId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.leaveTypeId || !form.startDate || !form.endDate) {
      addToast({ type: 'error', title: 'Missing details', message: 'Choose a leave type and the dates.' });
      return;
    }
    try {
      setBusy(true);
      const { totalDays } = await leaveService.submit({
        leaveTypeId: form.leaveTypeId,
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason.trim() || undefined,
      });
      setShowForm(false);
      setForm({ leaveTypeId: '', startDate: '', endDate: '', reason: '' });
      setPreview(null);
      await load();
      addToast({
        type: 'success',
        title: 'Request submitted',
        message: `${totalDays} day(s) awaiting approval.`,
      });
    } catch (err) {
      addToast({ type: 'error', title: 'Could not submit', message: getErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (request: LeaveRequest) => {
    const confirmed = await showConfirmDialog({
      title: 'Cancel leave',
      message: `Cancel your ${request.type_name} from ${request.start_date} to ${request.end_date}?`,
      confirmText: 'Cancel leave',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await leaveService.cancel(request.id);
      await load();
      addToast({ type: 'success', title: 'Leave cancelled' });
    } catch (err) {
      addToast({ type: 'error', title: 'Could not cancel', message: getErrorMessage(err) });
    }
  };

  const selectedType = useMemo(
    () => types.find((t) => t.id === form.leaveTypeId) ?? null,
    [types, form.leaveTypeId]
  );

  if (loading) return <LoadingOverlay message="Loading your leave…" />;

  return (
    <div className="p-6 space-y-6">
      <ConfirmDialog />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Leave</h1>
          <p className="mt-1 text-sm text-secondary">
            Your entitlement for {year}, and the requests you have made.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          disabled={types.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          <CalendarPlus className="h-4 w-4" />
          Request leave
        </button>
      </div>

      {error && <ErrorAlert title="Could not load your leave" message={error} onDismiss={() => setError(null)} />}

      {balances.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-8 w-8" />}
          title="No leave types yet"
          message="Your HR team has not set up any leave types. Once they do, your entitlement appears here."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {balances.map((b) => (
            <div key={b.leaveTypeId} className="rounded-xl border border-subtle bg-card p-5">
              <div className="text-xs uppercase tracking-wider text-muted">{b.name}</div>
              <div className="mt-2 text-3xl font-bold text-primary">{b.available}</div>
              <div className="mt-1 text-xs text-muted">
                days available
                {b.pending > 0 ? ` · ${b.pending} pending` : ''}
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken">
                <div
                  className="h-full bg-brand-500"
                  style={{
                    width: `${
                      b.entitled + b.carriedOver > 0
                        ? Math.min(100, (b.taken / (b.entitled + b.carriedOver)) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
              <div className="mt-1 text-xs text-muted">
                {b.taken} of {b.entitled + b.carriedOver} taken
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-subtle bg-card">
        <div className="border-b border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary">
            Your requests
          </h2>
        </div>
        {requests.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Clock className="h-8 w-8" />}
              title="No leave requested yet"
              message="When you request leave it appears here with its approval status."
            />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted">
              <tr className="border-b border-subtle">
                <th className="px-5 py-2">Type</th>
                <th className="px-5 py-2">Dates</th>
                <th className="px-5 py-2">Days</th>
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-2 text-primary">{r.type_name}</td>
                  <td className="px-5 py-2 text-secondary">
                    {r.start_date} → {r.end_date}
                  </td>
                  <td className="px-5 py-2 text-secondary">{r.total_days}</td>
                  <td className="px-5 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}>
                      {r.status}
                    </span>
                    {r.decision_note && (
                      <div className="mt-1 text-xs text-muted">{r.decision_note}</div>
                    )}
                  </td>
                  <td className="px-5 py-2 text-right">
                    {(r.status === 'pending' || r.status === 'approved') && (
                      <button
                        onClick={() => void cancel(r)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-secondary hover:bg-sunken hover:text-danger-700 dark:hover:text-danger-400"
                      >
                        <Ban className="h-3 w-3" />
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={submit}
            className="w-full max-w-md rounded-xl border border-subtle bg-card p-6"
          >
            <h2 className="mb-4 text-lg font-semibold text-primary">Request leave</h2>

            <div className="grid gap-3">
              <label className="text-sm text-secondary">
                Type
                <select
                  value={form.leaveTypeId}
                  onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}
                  required
                  className="mt-1 w-full rounded-lg border border-subtle bg-card px-3 py-2 text-primary"
                >
                  <option value="">Choose…</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>

              {selectedType && selectedType.min_notice_days > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {selectedType.name} needs {selectedType.min_notice_days} day(s) notice.
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-secondary">
                  From
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    required
                    className="mt-1 w-full rounded-lg border border-subtle bg-card px-3 py-2 text-primary"
                  />
                </label>
                <label className="text-sm text-secondary">
                  To
                  <input
                    type="date"
                    value={form.endDate}
                    min={form.startDate || undefined}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    required
                    className="mt-1 w-full rounded-lg border border-subtle bg-card px-3 py-2 text-primary"
                  />
                </label>
              </div>

              {preview && (
                <div className="rounded-lg border border-subtle bg-sunken px-3 py-2 text-sm">
                  <span className="text-primary">{preview.totalDays} working day(s)</span>
                  {preview.available !== null && (
                    <span
                      className={
                        preview.totalDays > preview.available
                          ? ' text-danger-700 dark:text-danger-400'
                          : ' text-muted'
                      }
                    >
                      {' '}· {preview.available} available
                      {preview.totalDays > preview.available ? ' — not enough' : ''}
                    </span>
                  )}
                  <div className="mt-0.5 text-xs text-muted">
                    Weekends in the range are not deducted.
                  </div>
                </div>
              )}

              <label className="text-sm text-secondary">
                Reason
                <textarea
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-subtle bg-card px-3 py-2 text-primary"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-subtle px-4 py-2 text-sm text-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || (preview?.available !== null && preview !== null && preview.totalDays > (preview.available ?? 0))}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? 'Submitting…' : 'Submit request'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default EmployeeLeavePage;
