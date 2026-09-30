import React, { useEffect, useState } from 'react';
import { BadgeCheck, FileSignature, FileText, Plus, Trash2, X } from 'lucide-react';
import { useToastStore } from '../components/Toast';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState, ErrorAlert } from '../components/ErrorDisplay';
import hrService, { type MemberAttendanceSummary } from '../services/hrService';
import {
  workforceService,
  CONTRACT_TYPE_LABEL,
  formatHours,
  isoDay,
  type Contract,
  type ContractStatus,
  type ContractType,
} from '../services/workforceService';

/**
 * Roles and contracts.
 *
 * The terms somebody is engaged on: what they do, who they report to, how many
 * hours a week, and from when until when. Everything downstream measures
 * against the hours — a timesheet's overtime is what it exceeded.
 *
 * Two rules from the API shape what this page offers rather than leaving them
 * to a refusal. A draft is freely editable and an active contract is not,
 * because its terms are what somebody agreed to; the edit controls disappear
 * on activation rather than erroring. And ending a contract needs a director,
 * so the button is absent for anybody else.
 */

type Tab = ContractStatus | 'all';

const TODAY = new Date().toISOString().slice(0, 10);

const STATUS_STYLE: Record<ContractStatus, string> = {
  draft: 'bg-sunken text-secondary',
  active: 'bg-success-600/20 text-success-700 dark:text-success-300',
  ended: 'bg-sunken text-muted',
  cancelled: 'bg-sunken text-muted',
};

interface Props {
  /** Whether the reader may end a contract. The API refuses otherwise. */
  canEnd?: boolean;
}

const HRContractsPage: React.FC<Props> = ({ canEnd = false }) => {
  const [tab, setTab] = useState<Tab>('active');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [members, setMembers] = useState<MemberAttendanceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);

  const [form, setForm] = useState({
    employeeId: '', reference: '', contractType: 'permanent' as ContractType,
    jobTitle: '', startDate: TODAY, endDate: '', probationEndDate: '',
    weeklyHours: '40', workingDays: '5', noticePeriodDays: '30', managerId: '',
  });

  const { addToast } = useToastStore();

  useEffect(() => { void load(); }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [list, m] = await Promise.all([
        workforceService.listContracts(),
        hrService.listMembers(1, 200).catch(() => ({ members: [], page: 1, pageSize: 200, total: 0 })),
      ]);
      setContracts(list);
      setMembers(m.members.filter((x: MemberAttendanceSummary) => x.role === 'EMPLOYEE'));
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const fail = (title: string, e: unknown) =>
    addToast({ type: 'error', title, message: getErrorMessage(e) });

  const blank = () => setForm({
    employeeId: '', reference: '', contractType: 'permanent', jobTitle: '',
    startDate: TODAY, endDate: '', probationEndDate: '', weeklyHours: '40',
    workingDays: '5', noticePeriodDays: '30', managerId: '',
  });

  const save = async () => {
    try {
      setBusy(true);
      const payload = {
        reference: form.reference.trim(),
        contractType: form.contractType,
        jobTitle: form.jobTitle.trim(),
        startDate: form.startDate,
        endDate: form.endDate || null,
        probationEndDate: form.probationEndDate || null,
        weeklyHours: Number(form.weeklyHours),
        workingDays: Number(form.workingDays),
        noticePeriodDays: Number(form.noticePeriodDays),
        managerId: form.managerId || undefined,
      };
      if (editing) {
        await workforceService.updateContract(editing.id, payload);
        addToast({ type: 'success', title: 'Draft revised' });
      } else {
        await workforceService.createContract({ ...payload, employeeId: form.employeeId });
        addToast({
          type: 'success', title: 'Contract drafted',
          message: 'It takes effect when you activate it.',
        });
      }
      setShowForm(false);
      setEditing(null);
      blank();
      await load();
    } catch (e) {
      fail(editing ? 'Could not revise the draft' : 'Could not draft the contract', e);
    } finally {
      setBusy(false);
    }
  };

  const activate = async (c: Contract) => {
    try {
      setBusy(true);
      await workforceService.activateContract(c.id);
      addToast({
        type: 'success', title: 'Contract active',
        message: 'Its terms are now fixed; different terms are a new contract.',
      });
      await load();
    } catch (e) {
      fail('Could not activate the contract', e);
    } finally {
      setBusy(false);
    }
  };

  const end = async (c: Contract) => {
    const endDate = window.prompt('Ending on which date? (YYYY-MM-DD)', TODAY);
    if (!endDate) return;
    const reason = window.prompt('Why is it ending?');
    if (!reason) return;
    try {
      setBusy(true);
      await workforceService.endContract(c.id, endDate, reason);
      addToast({ type: 'success', title: 'Contract ended' });
      await load();
    } catch (e) {
      fail('Could not end the contract', e);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (c: Contract) => {
    try {
      setBusy(true);
      await workforceService.withdrawContract(c.id);
      addToast({ type: 'success', title: 'Draft withdrawn' });
      await load();
    } catch (e) {
      fail('Could not withdraw the draft', e);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (c: Contract) => {
    setEditing(c);
    setForm({
      employeeId: c.employee_id,
      reference: c.reference,
      contractType: c.contract_type,
      jobTitle: c.job_title,
      startDate: isoDay(c.start_date),
      endDate: isoDay(c.end_date) || '',
      probationEndDate: isoDay(c.probation_end_date) || '',
      weeklyHours: String(Number(c.weekly_hours)),
      workingDays: String(Number(c.working_days)),
      noticePeriodDays: String(c.notice_period_days),
      managerId: c.manager_id || '',
    });
    setShowForm(true);
  };

  if (loading) return <LoadingOverlay message="Loading contracts…" />;

  const shown = tab === 'all' ? contracts : contracts.filter((c) => c.status === tab);
  const counts = (s: ContractStatus) => contracts.filter((c) => c.status === s).length;

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'active', label: 'Active', count: counts('active') },
    { id: 'draft', label: 'Drafts', count: counts('draft') },
    { id: 'ended', label: 'Ended', count: counts('ended') },
    { id: 'all', label: 'All' },
  ];

  const field = 'w-full rounded-lg border border-subtle bg-card px-3 py-2 text-sm text-primary placeholder:text-muted';
  const label = 'mb-1 block text-xs uppercase tracking-wider text-muted';
  const primary = 'inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-500 disabled:opacity-50';
  const ghost = 'inline-flex items-center gap-1.5 rounded-lg border border-subtle px-3 py-1.5 text-sm text-secondary hover:bg-sunken disabled:opacity-50';
  const card = 'rounded-xl border border-subtle bg-card';

  // A fixed term needs an end date; the form says so rather than letting the
  // API refuse it after the fact.
  const needsEnd = ['fixed_term', 'casual', 'contractor'].includes(form.contractType);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Roles &amp; contracts</h1>
        <p className="mt-1 text-sm text-secondary">
          What each person is engaged to do, for how many hours, and until when.
        </p>
      </div>

      {error && <ErrorAlert title="Could not load contracts" message={error} onDismiss={() => setError(null)} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
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
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-secondary">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <button className={primary} onClick={() => { setEditing(null); blank(); setShowForm(true); }}>
          <Plus className="h-4 w-4" /> Draft a contract
        </button>
      </div>

      {showForm && (
        <div className={card}>
          <div className="flex items-center justify-between border-b border-subtle px-5 py-3">
            <span className="text-sm font-semibold text-primary">
              {editing ? `Revising ${editing.reference}` : 'New contract'}
            </span>
            <button className={ghost} onClick={() => { setShowForm(false); setEditing(null); }}>
              <X className="h-4 w-4" /> Close
            </button>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-4">
            {!editing && (
              <div>
                <label className={label}>Employee</label>
                <select className={field} value={form.employeeId}
                  onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                  <option value="">Choose…</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={label}>Reference</label>
              <input className={field} placeholder="EMP-2026-014" value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </div>
            <div>
              <label className={label}>Job title</label>
              <input className={field} placeholder="Operations Analyst" value={form.jobTitle}
                onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
            </div>
            <div>
              <label className={label}>Type</label>
              <select className={field} value={form.contractType}
                onChange={(e) => setForm({ ...form, contractType: e.target.value as ContractType })}>
                {Object.entries(CONTRACT_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Reports to</label>
              <select className={field} value={form.managerId}
                onChange={(e) => setForm({ ...form, managerId: e.target.value })}>
                <option value="">Nobody</option>
                {members.filter((m) => m.id !== form.employeeId)
                  .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>From</label>
              <input type="date" className={field} value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div>
              <label className={label}>
                Until {needsEnd ? '(required)' : '(blank = open-ended)'}
              </label>
              <input type="date" className={field} value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
            <div>
              <label className={label}>Probation ends</label>
              <input type="date" className={field} value={form.probationEndDate}
                onChange={(e) => setForm({ ...form, probationEndDate: e.target.value })} />
            </div>
            <div>
              <label className={label}>Hours a week</label>
              <input className={field} inputMode="decimal" value={form.weeklyHours}
                onChange={(e) => setForm({ ...form, weeklyHours: e.target.value })} />
            </div>
            <div>
              <label className={label}>Days a week</label>
              <input className={field} inputMode="decimal" value={form.workingDays}
                onChange={(e) => setForm({ ...form, workingDays: e.target.value })} />
            </div>
            <div>
              <label className={label}>Notice (days)</label>
              <input className={field} inputMode="numeric" value={form.noticePeriodDays}
                onChange={(e) => setForm({ ...form, noticePeriodDays: e.target.value })} />
            </div>
            <div className="sm:col-span-4 flex items-center gap-3">
              <button className={primary} disabled={
                busy || !form.reference || !form.jobTitle || (!editing && !form.employeeId)
                || (needsEnd && !form.endDate)
              } onClick={() => void save()}>
                {editing ? 'Save the draft' : 'Draft it'}
              </button>
              <span className="text-xs text-muted">
                A contract is drafted first and takes effect when it is activated. After that
                its terms are fixed — different terms are a new contract.
              </span>
            </div>
          </div>
        </div>
      )}

      <div className={card}>
        {shown.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<FileText className="h-8 w-8" />}
              title={tab === 'all' ? 'No contracts yet' : `Nothing ${tab}`}
              message="A contract records what somebody is engaged to do and for how many hours."
            />
          </div>
        ) : (
          <ul className="divide-y divide-subtle">
            {shown.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-primary">
                      {c.first_name} {c.last_name}
                    </span>
                    <span className="text-xs text-muted">{c.employee_number}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[c.status]}`}>
                      {c.status}
                    </span>
                  </div>
                  <div className="mt-0.5 text-sm text-secondary">
                    {c.job_title}
                    <span className="ml-2 text-xs text-muted">
                      {CONTRACT_TYPE_LABEL[c.contract_type]} · {c.reference}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {isoDay(c.start_date)} → {c.end_date ? isoDay(c.end_date) : 'open-ended'}
                    {' · '}{formatHours(c.weekly_hours)} h over {formatHours(c.working_days)} days
                    {' · '}{c.notice_period_days} days' notice
                    {c.department_name && ` · ${c.department_name}`}
                    {c.manager_first_name && ` · reports to ${c.manager_first_name} ${c.manager_last_name}`}
                  </div>
                  {c.status === 'ended' && c.end_reason && (
                    <div className="mt-1 text-xs text-muted">Ended: {c.end_reason}</div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {c.status === 'draft' && (
                    <>
                      <button className={ghost} disabled={busy} onClick={() => openEdit(c)}>
                        Revise
                      </button>
                      <button className={primary} disabled={busy} onClick={() => void activate(c)}>
                        <BadgeCheck className="h-4 w-4" /> Activate
                      </button>
                      <button className={ghost} disabled={busy} onClick={() => void withdraw(c)}>
                        <Trash2 className="h-4 w-4" /> Withdraw
                      </button>
                    </>
                  )}
                  {c.status === 'active' && canEnd && (
                    <button className={ghost} disabled={busy} onClick={() => void end(c)}>
                      <FileSignature className="h-4 w-4" /> End it
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default HRContractsPage;
