import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Search, X, Receipt, Wallet, AlertTriangle, Undo2, Send,
  Ban, ListPlus, Trash2, TrendingUp,
} from 'lucide-react';
import { useToastStore } from '../components/Toast';
import { useConfirmDialog } from '../components/useConfirmDialog';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState, NoResults } from '../components/ErrorDisplay';
import {
  feesService, formatMoney, FEE_CATEGORIES, PAYMENT_METHODS,
  type FeeStructure, type FeeItem, type Invoice, type InvoiceDetail,
  type Debtor, type FeesOverview, type Settlement, type PaymentMethod,
} from '../services/feesService';
import { axiosClient } from '../utils/axiosClient';

/**
 * Fees, invoices and payments — the bursar's office.
 *
 * The page is arranged the way the work is: a price list that rarely changes,
 * invoices raised from it, money taken against those invoices, and a debtors
 * list that says who to chase.
 *
 * Two things it deliberately does not let you do, because the server does not
 * either: edit an issued invoice's amounts, and delete a payment. A mistake
 * on an issued invoice is a void and a re-raise; a mistake on a payment is a
 * reversal, which leaves both the error and the correction on the record.
 */

const SETTLEMENT_STYLE: Record<Settlement, string> = {
  draft: 'bg-sunken text-secondary',
  unpaid: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  part_paid: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  paid: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  overpaid: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  void: 'bg-raised text-muted line-through',
};

const SETTLEMENT_LABEL: Record<Settlement, string> = {
  draft: 'Draft',
  unpaid: 'Unpaid',
  part_paid: 'Part paid',
  paid: 'Paid',
  overpaid: 'Overpaid',
  void: 'Void',
};

interface StudentOption {
  id: string;
  student_id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
}

const SchoolAdminFinancePage: React.FC = () => {
  const [tab, setTab] = useState<'invoices' | 'structures' | 'debtors' | 'payments'>('invoices');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [overview, setOverview] = useState<FeesOverview | null>(null);
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);

  const [search, setSearch] = useState('');
  const [settlementFilter, setSettlementFilter] = useState<'' | Settlement>('');
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [structureDetail, setStructureDetail] = useState<{
    structure: FeeStructure; items: FeeItem[];
  } | null>(null);

  const [showStructureForm, setShowStructureForm] = useState(false);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  const { addToast } = useToastStore();
  const { showConfirmDialog, ConfirmDialog } = useConfirmDialog();

  const [structureForm, setStructureForm] = useState({
    code: '', name: '', description: '', currency: 'USD', studyYear: '',
  });

  const [itemForm, setItemForm] = useState({
    code: '', name: '', category: 'tuition', amount: '', isMandatory: true,
  });

  const [invoiceForm, setInvoiceForm] = useState({
    studentId: '', structureId: '', dueDate: '', note: '', issue: true,
    optionalItemIds: [] as string[],
  });

  const [paymentForm, setPaymentForm] = useState({
    amount: '', method: 'cash' as PaymentMethod, reference: '', note: '',
    allowOverpayment: false,
  });

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void loadInvoices();
  }, [settlementFilter, overdueOnly]);

  const load = async () => {
    try {
      setLoading(true);
      const [ov, structureList, debtorList, studentList] = await Promise.all([
        feesService.overview(),
        feesService.listStructures(),
        feesService.debtors(),
        // The school's students, for the invoice form's picker. A failure
        // here should not stop the rest of the page rendering.
        axiosClient
          .get('/auth/admin/school/students', { params: { fields: 'summary' } })
          .then((r) => (r.data.students ?? []) as StudentOption[])
          .catch(() => [] as StudentOption[]),
      ]);
      setOverview(ov);
      setStructures(structureList);
      setDebtors(debtorList);
      setStudents(studentList);
      await loadInvoices();
    } catch (error) {
      addToast({ type: 'error', title: 'Could not load fees', message: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  const loadInvoices = async () => {
    try {
      setInvoices(
        await feesService.listInvoices({
          settlement: settlementFilter || undefined,
          overdue: overdueOnly || undefined,
        })
      );
    } catch (error) {
      addToast({ type: 'error', title: 'Could not load invoices', message: getErrorMessage(error) });
    }
  };

  const refresh = async () => {
    try {
      const [ov, debtorList] = await Promise.all([feesService.overview(), feesService.debtors()]);
      setOverview(ov);
      setDebtors(debtorList);
    } catch {
      // The headline figures are a convenience; a stale total is not worth an
      // error over the top of whatever the bursar just did successfully.
    }
  };

  const openInvoice = async (id: string) => {
    try {
      setDetailLoading(true);
      setDetail(await feesService.getInvoice(id));
    } catch (error) {
      addToast({ type: 'error', title: 'Could not open invoice', message: getErrorMessage(error) });
    } finally {
      setDetailLoading(false);
    }
  };

  const openStructure = async (id: string) => {
    try {
      setStructureDetail(await feesService.getStructure(id));
    } catch (error) {
      addToast({ type: 'error', title: 'Could not open structure', message: getErrorMessage(error) });
    }
  };

  const createStructure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!structureForm.code || !structureForm.name) return;
    try {
      setSaving(true);
      const created = await feesService.createStructure({
        code: structureForm.code,
        name: structureForm.name,
        description: structureForm.description || undefined,
        currency: structureForm.currency || undefined,
        studyYear: structureForm.studyYear ? Number(structureForm.studyYear) : undefined,
      });
      setStructures((prev) => [...prev, created]);
      setShowStructureForm(false);
      setStructureForm({ code: '', name: '', description: '', currency: 'USD', studyYear: '' });
      addToast({ type: 'success', title: 'Fee structure created' });
      void openStructure(created.id);
    } catch (error) {
      addToast({ type: 'error', title: 'Could not create structure', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!structureDetail || !itemForm.code || !itemForm.name || !itemForm.amount) return;
    try {
      setSaving(true);
      const item = await feesService.addItem(structureDetail.structure.id, {
        code: itemForm.code,
        name: itemForm.name,
        category: itemForm.category,
        amount: itemForm.amount,
        isMandatory: itemForm.isMandatory,
        sequence: structureDetail.items.length,
      });
      setStructureDetail({ ...structureDetail, items: [...structureDetail.items, item] });
      setItemForm({ code: '', name: '', category: 'tuition', amount: '', isMandatory: true });
      setStructures(await feesService.listStructures());
      addToast({ type: 'success', title: 'Item added' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not add item', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (item: FeeItem) => {
    if (!structureDetail) return;
    try {
      await feesService.removeItem(structureDetail.structure.id, item.id);
      setStructureDetail({
        ...structureDetail,
        items: structureDetail.items.filter((i) => i.id !== item.id),
      });
      setStructures(await feesService.listStructures());
    } catch (error) {
      addToast({ type: 'error', title: 'Could not remove item', message: getErrorMessage(error) });
    }
  };

  const removeStructure = async (structure: FeeStructure) => {
    const confirmed = await showConfirmDialog({
      title: 'Delete fee structure',
      message: `Delete "${structure.name}"? A structure that has raised invoices cannot be deleted — deactivate it instead.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await feesService.deleteStructure(structure.id);
      setStructures((prev) => prev.filter((s) => s.id !== structure.id));
      if (structureDetail?.structure.id === structure.id) setStructureDetail(null);
      addToast({ type: 'success', title: 'Structure deleted' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not delete structure', message: getErrorMessage(error) });
    }
  };

  const raiseInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceForm.studentId || !invoiceForm.structureId) return;
    try {
      setSaving(true);
      const { invoice } = await feesService.raiseInvoice({
        studentId: invoiceForm.studentId,
        structureId: invoiceForm.structureId,
        optionalItemIds: invoiceForm.optionalItemIds.length
          ? invoiceForm.optionalItemIds : undefined,
        dueDate: invoiceForm.dueDate || undefined,
        note: invoiceForm.note || undefined,
        issue: invoiceForm.issue,
      });
      setShowInvoiceForm(false);
      setInvoiceForm({
        studentId: '', structureId: '', dueDate: '', note: '', issue: true, optionalItemIds: [],
      });
      await loadInvoices();
      void refresh();
      addToast({ type: 'success', title: `Invoice ${invoice.number} raised` });
      void openInvoice(invoice.id);
    } catch (error) {
      addToast({ type: 'error', title: 'Could not raise invoice', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const issue = async () => {
    if (!detail) return;
    try {
      await feesService.issueInvoice(detail.invoice.id);
      await openInvoice(detail.invoice.id);
      await loadInvoices();
      void refresh();
      addToast({
        type: 'success',
        title: 'Invoice issued',
        message: 'Its lines and amounts are now fixed.',
      });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not issue', message: getErrorMessage(error) });
    }
  };

  const voidInvoice = async () => {
    if (!detail) return;
    const reason = window.prompt('Why is this invoice being voided?');
    if (!reason) return;
    try {
      await feesService.voidInvoice(detail.invoice.id, reason);
      await openInvoice(detail.invoice.id);
      await loadInvoices();
      void refresh();
      addToast({ type: 'success', title: 'Invoice voided' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not void', message: getErrorMessage(error) });
    }
  };

  const takePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !paymentForm.amount) return;
    try {
      setSaving(true);
      const result = await feesService.recordPayment(detail.invoice.id, {
        amount: paymentForm.amount,
        method: paymentForm.method,
        reference: paymentForm.reference || undefined,
        note: paymentForm.note || undefined,
        allowOverpayment: paymentForm.allowOverpayment,
      });
      setShowPaymentForm(false);
      setPaymentForm({
        amount: '', method: 'cash', reference: '', note: '', allowOverpayment: false,
      });
      await openInvoice(detail.invoice.id);
      await loadInvoices();
      void refresh();
      addToast({
        type: 'success',
        title: 'Payment recorded',
        message: `${formatMoney(result.balance, detail.invoice.currency)} outstanding`,
      });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not record payment', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const reverse = async (paymentId: string) => {
    const reason = window.prompt('Why is this payment being reversed?');
    if (!reason) return;
    try {
      await feesService.reversePayment(paymentId, reason);
      if (detail) await openInvoice(detail.invoice.id);
      await loadInvoices();
      void refresh();
      addToast({
        type: 'success',
        title: 'Payment reversed',
        message: 'The original payment stays on the record alongside the reversal.',
      });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not reverse', message: getErrorMessage(error) });
    }
  };

  const selectedStructure = useMemo(
    () => structures.find((s) => s.id === invoiceForm.structureId) ?? null,
    [structures, invoiceForm.structureId]
  );

  const [optionalItems, setOptionalItems] = useState<FeeItem[]>([]);
  useEffect(() => {
    if (!invoiceForm.structureId) {
      setOptionalItems([]);
      return;
    }
    void feesService
      .getStructure(invoiceForm.structureId)
      .then((d) => setOptionalItems(d.items.filter((i) => !i.is_mandatory)))
      .catch(() => setOptionalItems([]));
  }, [invoiceForm.structureId]);

  const filteredInvoices = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return invoices;
    return invoices.filter((i) =>
      `${i.number} ${i.first_name ?? ''} ${i.last_name ?? ''} ${i.student_number ?? ''}`
        .toLowerCase()
        .includes(term)
    );
  }, [invoices, search]);

  if (loading) {
    return (
      <>
        <LoadingOverlay message="Loading fees…" />
      </>
    );
  }

  return (
    <>
      <ConfirmDialog />

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Fees &amp; Invoices</h1>
          <p className="text-sm text-secondary mt-1">
            What is charged, what has been billed, and what is still owed.
          </p>
        </div>
        <button
          onClick={() => setShowInvoiceForm(true)}
          disabled={structures.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          Raise invoice
        </button>
      </div>

      {overview && overview.totals.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          {overview.totals.slice(0, 1).map((t) => (
            <React.Fragment key={t.currency}>
              <Card label="Billed" value={formatMoney(t.billed, t.currency)} icon={Receipt} />
              <Card label="Collected" value={formatMoney(t.collected, t.currency)} icon={Wallet} tone="emerald" />
              <Card label="Outstanding" value={formatMoney(t.outstanding, t.currency)} icon={TrendingUp} tone="amber" />
              <Card
                label={`Overdue (${t.overdue_count})`}
                value={formatMoney(t.overdue_amount, t.currency)}
                icon={AlertTriangle}
                tone="rose"
              />
            </React.Fragment>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-subtle pb-3">
        {(['invoices', 'structures', 'debtors', 'payments'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${
              tab === t ? 'bg-sunken text-primary' : 'text-secondary hover:text-primary'
            }`}
          >
            {t}
          </button>
        ))}
        {tab === 'invoices' && (
          <div className="ml-auto flex items-center gap-2">
            <select
              value={settlementFilter}
              onChange={(e) => setSettlementFilter(e.target.value as '' | Settlement)}
              className="rounded-lg border border-subtle bg-card px-3 py-2 text-sm text-primary"
            >
              <option value="">Any settlement</option>
              {(Object.keys(SETTLEMENT_LABEL) as Settlement[]).map((s) => (
                <option key={s} value={s}>{SETTLEMENT_LABEL[s]}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-secondary">
              <input
                type="checkbox"
                checked={overdueOnly}
                onChange={(e) => setOverdueOnly(e.target.checked)}
              />
              Overdue only
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Number or student"
                className="w-56 rounded-lg border border-subtle bg-card py-2 pl-9 pr-3 text-sm text-primary placeholder:text-muted"
              />
            </div>
          </div>
        )}
      </div>

      {/* --------------------------------------------------------- invoices */}
      {tab === 'invoices' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_440px]">
          <div>
            {invoices.length === 0 ? (
              <EmptyState
                icon={<Receipt className="h-8 w-8" />}
                title="No invoices yet"
                message="Build a fee structure, then raise invoices from it."
              />
            ) : filteredInvoices.length === 0 ? (
              <NoResults searchTerm={search} />
            ) : (
              <div className="overflow-hidden rounded-xl border border-subtle">
                <table className="w-full text-sm">
                  <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-3">Invoice</th>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3 text-right">Balance</th>
                      <th className="px-4 py-3">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-subtle">
                    {filteredInvoices.map((i) => (
                      <tr
                        key={i.id}
                        onClick={() => void openInvoice(i.id)}
                        className={`cursor-pointer hover:bg-sunken ${
                          detail?.invoice.id === i.id ? 'bg-sunken' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-secondary">{i.number}</td>
                        <td className="px-4 py-3">
                          <p className="text-primary">{i.first_name} {i.last_name}</p>
                          <p className="font-mono text-xs text-muted">{i.student_number}</p>
                        </td>
                        <td className="px-4 py-3 text-right text-primary">
                          {formatMoney(i.total, i.currency)}
                        </td>
                        <td className={`px-4 py-3 text-right ${
                          Number(i.balance) > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-secondary'
                        }`}>
                          {formatMoney(i.balance)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SETTLEMENT_STYLE[i.settlement]}`}>
                            {SETTLEMENT_LABEL[i.settlement]}
                          </span>
                          {i.is_overdue && (
                            <span className="ml-1 inline-flex rounded-full bg-rose-500/15 px-2 py-0.5 text-xs text-rose-700 dark:text-rose-300">
                              overdue
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <aside>
            {detailLoading ? (
              <div className="rounded-xl border border-subtle p-8 text-center text-sm text-secondary">
                Loading…
              </div>
            ) : !detail ? (
              <div className="rounded-xl border border-dashed border-subtle p-8 text-center text-sm text-muted">
                Select an invoice.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-subtle bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm text-secondary">{detail.invoice.number}</p>
                      <p className="text-lg font-semibold text-primary">
                        {detail.invoice.first_name} {detail.invoice.last_name}
                      </p>
                      <p className="font-mono text-xs text-muted">{detail.invoice.student_number}</p>
                    </div>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SETTLEMENT_STYLE[detail.invoice.settlement]}`}>
                      {SETTLEMENT_LABEL[detail.invoice.settlement]}
                    </span>
                  </div>

                  <table className="mt-4 w-full text-sm">
                    <tbody className="divide-y divide-subtle">
                      {detail.lines.map((l) => (
                        <tr key={l.id}>
                          <td className="py-2">
                            <p className={l.line_type === 'discount' ? 'text-emerald-700 dark:text-emerald-300' : 'text-secondary'}>
                              {l.description}
                            </p>
                            <p className="text-xs text-muted">
                              {l.code}
                              {Number(l.quantity) !== 1 && ` · ${l.quantity} × ${formatMoney(l.unit_amount)}`}
                            </p>
                          </td>
                          <td className={`py-2 text-right ${
                            l.line_type === 'discount' ? 'text-emerald-700 dark:text-emerald-300' : 'text-primary'
                          }`}>
                            {l.line_type === 'discount' ? '−' : ''}{formatMoney(l.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-subtle">
                      <tr>
                        <td className="pt-2 text-secondary">Total</td>
                        <td className="pt-2 text-right font-semibold text-primary">
                          {formatMoney(detail.invoice.total, detail.invoice.currency)}
                        </td>
                      </tr>
                      <tr>
                        <td className="text-secondary">Paid</td>
                        <td className="text-right text-secondary">
                          {formatMoney(detail.invoice.amount_paid)}
                        </td>
                      </tr>
                      <tr>
                        <td className="text-secondary">Balance</td>
                        <td className={`text-right font-semibold ${
                          Number(detail.invoice.balance) > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'
                        }`}>
                          {formatMoney(detail.invoice.balance)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {detail.invoice.status === 'draft' && (
                      <button
                        onClick={() => void issue()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500"
                      >
                        <Send className="h-3.5 w-3.5" /> Issue
                      </button>
                    )}
                    {detail.invoice.status === 'issued'
                      && Number(detail.invoice.balance) !== 0 && (
                      <button
                        onClick={() => setShowPaymentForm(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                      >
                        <Wallet className="h-3.5 w-3.5" /> Take payment
                      </button>
                    )}
                    {detail.invoice.status !== 'void' && (
                      <button
                        onClick={() => void voidInvoice()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-subtle px-3 py-1.5 text-xs text-rose-700 dark:text-rose-300 hover:bg-sunken"
                      >
                        <Ban className="h-3.5 w-3.5" /> Void
                      </button>
                    )}
                  </div>

                  {detail.invoice.status === 'issued' && (
                    <p className="mt-3 text-xs text-muted">
                      Issued invoices are fixed. Correct a mistake by voiding this one and raising
                      another.
                    </p>
                  )}
                  {detail.invoice.void_reason && (
                    <p className="mt-3 text-xs text-rose-700 dark:text-rose-300">
                      Voided: {detail.invoice.void_reason}
                    </p>
                  )}
                </div>

                {detail.payments.length > 0 && (
                  <div className="rounded-xl border border-subtle bg-card p-4">
                    <p className="text-xs uppercase tracking-wide text-muted">Payments</p>
                    <ul className="mt-3 space-y-3">
                      {detail.payments.map((p) => (
                        <li key={p.id} className="flex items-start justify-between gap-3">
                          <div>
                            <p className={`text-sm ${p.reversed_at ? 'text-muted line-through' : 'text-primary'}`}>
                              {formatMoney(p.amount, p.currency)}
                            </p>
                            <p className="text-xs text-muted">
                              {new Date(p.paid_at).toLocaleDateString()} · {p.method.replace('_', ' ')}
                              {p.reference ? ` · ${p.reference}` : ''}
                            </p>
                            {p.reversal_reason && (
                              <p className="text-xs text-rose-700 dark:text-rose-300">Reversed: {p.reversal_reason}</p>
                            )}
                          </div>
                          {!p.reversed_at && (
                            <button
                              onClick={() => void reverse(p.id)}
                              title="Reverse this payment"
                              className="rounded-lg p-1.5 text-secondary hover:bg-sunken hover:text-rose-700 dark:hover:text-rose-300"
                            >
                              <Undo2 className="h-4 w-4" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {/* ------------------------------------------------------- structures */}
      {tab === 'structures' && (
        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          <div>
            <button
              onClick={() => setShowStructureForm(true)}
              className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-subtle px-3 py-2 text-sm text-primary hover:bg-sunken"
            >
              <Plus className="h-4 w-4" /> New fee structure
            </button>

            {structures.length === 0 ? (
              <EmptyState
                icon={<ListPlus className="h-8 w-8" />}
                title="No fee structures"
                message="A structure is the price list an invoice is raised from."
              />
            ) : (
              <ul className="space-y-2">
                {structures.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => void openStructure(s.id)}
                      className={`w-full rounded-lg border p-3 text-left ${
                        structureDetail?.structure.id === s.id
                          ? 'border-brand-600 bg-sunken'
                          : 'border-subtle hover:bg-sunken'
                      }`}
                    >
                      <p className="font-medium text-primary">{s.name}</p>
                      <p className="font-mono text-xs text-muted">{s.code}</p>
                      <p className="mt-1 text-xs text-secondary">
                        {s.item_count ?? 0} items ·{' '}
                        {formatMoney(s.mandatory_total ?? '0', s.currency)} mandatory
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            {!structureDetail ? (
              <div className="rounded-xl border border-dashed border-subtle p-8 text-center text-sm text-muted">
                Select a fee structure to see and edit its items.
              </div>
            ) : (
              <div className="rounded-xl border border-subtle bg-card p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-primary">
                      {structureDetail.structure.name}
                    </h2>
                    <p className="font-mono text-xs text-muted">
                      {structureDetail.structure.code} · {structureDetail.structure.currency}
                    </p>
                  </div>
                  <button
                    onClick={() => void removeStructure(structureDetail.structure)}
                    className="rounded-lg border border-subtle px-2.5 py-1 text-xs text-rose-700 dark:text-rose-300 hover:bg-sunken"
                  >
                    Delete
                  </button>
                </div>

                {structureDetail.items.length > 0 && (
                  <table className="mt-4 w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="pb-2">Item</th>
                        <th className="pb-2">Category</th>
                        <th className="pb-2 text-right">Amount</th>
                        <th className="pb-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                      {structureDetail.items.map((i) => (
                        <tr key={i.id}>
                          <td className="py-2">
                            <p className="text-primary">{i.name}</p>
                            <p className="font-mono text-xs text-muted">
                              {i.code}
                              {!i.is_mandatory && ' · optional'}
                            </p>
                          </td>
                          <td className="py-2 capitalize text-secondary">{i.category}</td>
                          <td className="py-2 text-right text-primary">
                            {formatMoney(i.amount)}
                          </td>
                          <td className="py-2 text-right">
                            <button
                              onClick={() => void removeItem(i)}
                              className="rounded-lg p-1 text-muted hover:bg-sunken hover:text-rose-700 dark:hover:text-rose-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <form onSubmit={addItem} className="mt-4 grid grid-cols-2 gap-2 border-t border-subtle pt-4">
                  <input required placeholder="Code" value={itemForm.code}
                    onChange={(e) => setItemForm({ ...itemForm, code: e.target.value })}
                    className={inputClass} />
                  <input required placeholder="Name" value={itemForm.name}
                    onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                    className={inputClass} />
                  <select value={itemForm.category}
                    onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                    className={inputClass}>
                    {FEE_CATEGORIES.map((c) => (
                      <option key={c} value={c} className="capitalize">{c}</option>
                    ))}
                  </select>
                  <input required placeholder="Amount" inputMode="decimal" value={itemForm.amount}
                    onChange={(e) => setItemForm({ ...itemForm, amount: e.target.value })}
                    className={inputClass} />
                  <label className="col-span-2 flex items-center gap-2 text-sm text-secondary">
                    <input type="checkbox" checked={itemForm.isMandatory}
                      onChange={(e) => setItemForm({ ...itemForm, isMandatory: e.target.checked })} />
                    Charged to everyone (uncheck for an optional extra)
                  </label>
                  <button type="submit" disabled={saving}
                    className="col-span-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-40">
                    Add item
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- debtors */}
      {tab === 'debtors' && (
        debtors.length === 0 ? (
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="Nobody owes anything"
            message="Every issued invoice has been settled."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-subtle">
            <table className="w-full text-sm">
              <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3 text-right">Billed</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Owing</th>
                  <th className="px-4 py-3">Overdue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {debtors.map((d) => (
                  <tr key={`${d.student_id}-${d.currency}`} className="hover:bg-sunken">
                    <td className="px-4 py-3">
                      <p className="text-primary">{d.first_name} {d.last_name}</p>
                      <p className="font-mono text-xs text-muted">{d.student_number}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-secondary">
                      {formatMoney(d.billed, d.currency)}
                    </td>
                    <td className="px-4 py-3 text-right text-secondary">{formatMoney(d.paid)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-amber-700 dark:text-amber-300">
                      {formatMoney(d.balance)}
                    </td>
                    <td className="px-4 py-3">
                      {d.overdue_count > 0 ? (
                        <span className="inline-flex rounded-full bg-rose-500/15 px-2 py-0.5 text-xs text-rose-700 dark:text-rose-300">
                          {d.overdue_count} overdue
                        </span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* --------------------------------------------------------- payments */}
      {tab === 'payments' && overview && (
        overview.recentPayments.length === 0 ? (
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="No payments recorded"
            message="Money taken against an issued invoice appears here."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-subtle">
            <table className="w-full text-sm">
              <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {overview.recentPayments.map((p) => (
                  <tr key={p.id} className="hover:bg-sunken">
                    <td className="px-4 py-3 text-secondary">
                      {new Date(p.paid_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-primary">{p.first_name} {p.last_name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-secondary">{p.invoice_number}</td>
                    <td className="px-4 py-3 capitalize text-secondary">
                      {p.method.replace('_', ' ')}
                    </td>
                    <td className="px-4 py-3 text-right text-primary">
                      {formatMoney(p.amount, p.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ----------------------------------------------------------- modals */}
      {showStructureForm && (
        <Modal title="New fee structure" onClose={() => setShowStructureForm(false)}>
          <form onSubmit={createStructure} className="space-y-3">
            <Field label="Code">
              <input required value={structureForm.code}
                onChange={(e) => setStructureForm({ ...structureForm, code: e.target.value })}
                placeholder="UG-Y1-2026" className={inputClass} />
            </Field>
            <Field label="Name">
              <input required value={structureForm.name}
                onChange={(e) => setStructureForm({ ...structureForm, name: e.target.value })}
                placeholder="Undergraduate Year 1, 2026/27" className={inputClass} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Currency">
                <input value={structureForm.currency} maxLength={3}
                  onChange={(e) => setStructureForm({
                    ...structureForm, currency: e.target.value.toUpperCase(),
                  })}
                  className={inputClass} />
              </Field>
              <Field label="Year of study (optional)">
                <input type="number" min="1" max="10" value={structureForm.studyYear}
                  onChange={(e) => setStructureForm({ ...structureForm, studyYear: e.target.value })}
                  className={inputClass} />
              </Field>
            </div>
            <FormActions saving={saving} onCancel={() => setShowStructureForm(false)} submitLabel="Create" />
          </form>
        </Modal>
      )}

      {showInvoiceForm && (
        <Modal title="Raise an invoice" onClose={() => setShowInvoiceForm(false)}>
          <form onSubmit={raiseInvoice} className="space-y-3">
            <Field label="Student">
              <select required value={invoiceForm.studentId}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, studentId: e.target.value })}
                className={inputClass}>
                <option value="">Choose a student</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.first_name ?? s.name} {s.last_name ?? ''} — {s.student_id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fee structure">
              <select required value={invoiceForm.structureId}
                onChange={(e) => setInvoiceForm({
                  ...invoiceForm, structureId: e.target.value, optionalItemIds: [],
                })}
                className={inputClass}>
                <option value="">Choose a structure</option>
                {structures.filter((s) => s.is_active).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {formatMoney(s.mandatory_total ?? '0', s.currency)}
                  </option>
                ))}
              </select>
            </Field>

            {optionalItems.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-secondary">Optional extras</p>
                <div className="space-y-1">
                  {optionalItems.map((i) => (
                    <label key={i.id} className="flex items-center gap-2 text-sm text-secondary">
                      <input
                        type="checkbox"
                        checked={invoiceForm.optionalItemIds.includes(i.id)}
                        onChange={(e) =>
                          setInvoiceForm({
                            ...invoiceForm,
                            optionalItemIds: e.target.checked
                              ? [...invoiceForm.optionalItemIds, i.id]
                              : invoiceForm.optionalItemIds.filter((x) => x !== i.id),
                          })
                        }
                      />
                      {i.name} — {formatMoney(i.amount, selectedStructure?.currency)}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <Field label="Due date (optional)">
              <input type="date" value={invoiceForm.dueDate}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })}
                className={inputClass} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-secondary">
              <input type="checkbox" checked={invoiceForm.issue}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, issue: e.target.checked })} />
              Issue it now — its amounts become fixed
            </label>
            <FormActions saving={saving} onCancel={() => setShowInvoiceForm(false)} submitLabel="Raise" />
          </form>
        </Modal>
      )}

      {showPaymentForm && detail && (
        <Modal title="Record a payment" onClose={() => setShowPaymentForm(false)}>
          <form onSubmit={takePayment} className="space-y-3">
            <p className="text-sm text-secondary">
              {formatMoney(detail.invoice.balance, detail.invoice.currency)} outstanding on{' '}
              <span className="font-mono text-secondary">{detail.invoice.number}</span>.
            </p>
            <Field label="Amount">
              <input required inputMode="decimal" value={paymentForm.amount}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                className={inputClass} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Method">
                <select value={paymentForm.method}
                  onChange={(e) => setPaymentForm({
                    ...paymentForm, method: e.target.value as PaymentMethod,
                  })}
                  className={inputClass}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m} className="capitalize">{m.replace('_', ' ')}</option>
                  ))}
                </select>
              </Field>
              <Field label="Reference">
                <input value={paymentForm.reference}
                  onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                  placeholder="Deposit slip or transaction id" className={inputClass} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-secondary">
              <input type="checkbox" checked={paymentForm.allowOverpayment}
                onChange={(e) => setPaymentForm({
                  ...paymentForm, allowOverpayment: e.target.checked,
                })} />
              Accept more than is outstanding
            </label>
            <FormActions saving={saving} onCancel={() => setShowPaymentForm(false)} submitLabel="Record" />
          </form>
        </Modal>
      )}
    </>
  );
};

const inputClass =
  'w-full rounded-lg border border-subtle bg-card px-3 py-2 text-sm text-primary placeholder:text-muted';

const Card: React.FC<{
  label: string; value: string; icon: React.ElementType; tone?: 'emerald' | 'amber' | 'rose';
}> = ({ label, value, icon: Icon, tone }) => (
  <div className="rounded-xl border border-subtle bg-card p-4">
    <div className="flex items-center justify-between">
      <p className="text-sm text-secondary">{label}</p>
      <Icon className="h-4 w-4 text-muted" />
    </div>
    <p className={`mt-2 text-xl font-semibold ${
      tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'amber' ? 'text-amber-700 dark:text-amber-300'
      : tone === 'rose' ? 'text-rose-700 dark:text-rose-300'
      : 'text-primary'
    }`}>
      {value}
    </p>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-medium text-secondary">{label}</span>
    {children}
  </label>
);

const FormActions: React.FC<{ saving: boolean; onCancel: () => void; submitLabel: string }> = ({
  saving, onCancel, submitLabel,
}) => (
  <div className="flex justify-end gap-2 pt-2">
    <button type="button" onClick={onCancel}
      className="rounded-lg border border-subtle px-4 py-2 text-sm text-secondary hover:bg-sunken">
      Cancel
    </button>
    <button type="submit" disabled={saving}
      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-40">
      {saving ? 'Saving…' : submitLabel}
    </button>
  </div>
);

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title, onClose, children,
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-subtle bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-primary">{title}</h2>
        <button onClick={onClose} className="rounded-lg p-1 text-secondary hover:bg-sunken">
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

export default SchoolAdminFinancePage;
