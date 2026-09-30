import React, { useEffect, useState } from 'react';
import { Receipt, Wallet, AlertTriangle, CheckCircle2, ChevronDown } from 'lucide-react';
import { useToastStore } from '../components/Toast';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState } from '../components/ErrorDisplay';
import {
  feesService, formatMoney,
  type Statement, type InvoiceDetail, type Settlement,
} from '../services/feesService';

/**
 * A student's own fee statement.
 *
 * Their invoices, their payments and what is still owed. The API resolves
 * which student this is from the authenticated identity, so there is no
 * student id anywhere on this page to get wrong or to tamper with.
 *
 * Drafts are shown as such rather than hidden: a student who can see an
 * invoice is entitled to know it has not been issued yet and is not owed.
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
  draft: 'Not yet issued',
  unpaid: 'Unpaid',
  part_paid: 'Part paid',
  paid: 'Paid',
  overpaid: 'Overpaid',
  void: 'Cancelled',
};

const StudentFeesPage: React.FC = () => {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const { addToast } = useToastStore();

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      setStatement(await feesService.statement());
    } catch (error) {
      addToast({ type: 'error', title: 'Could not load your fees', message: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  const toggle = async (invoiceId: string) => {
    if (expanded === invoiceId) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(invoiceId);
    setDetail(null);
    try {
      setDetail(await feesService.getInvoice(invoiceId));
    } catch (error) {
      addToast({ type: 'error', title: 'Could not open that invoice', message: getErrorMessage(error) });
    }
  };

  if (loading) return <LoadingOverlay message="Loading your fees…" />;

  if (!statement) {
    return (
      <EmptyState
        icon={<Receipt className="h-8 w-8" />}
        title="No fee record"
        message="Nothing has been billed to your account."
      />
    );
  }

  const { summary, invoices, payments } = statement;
  const currency = summary.currency ?? undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Fees</h1>
        <p className="text-sm text-secondary mt-1">
          What has been billed to you, what you have paid, and what is left.
        </p>
      </div>

      <div
        className={`rounded-xl border p-5 ${
          summary.cleared
            ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30'
            : 'border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/20'
        }`}
      >
        <div className="flex items-start gap-3">
          {summary.cleared ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-700 dark:text-emerald-400" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700 dark:text-amber-400" />
          )}
          <div>
            <p className={`font-semibold ${summary.cleared ? 'text-emerald-700 dark:text-emerald-200' : 'text-amber-700 dark:text-amber-200'}`}>
              {summary.cleared
                ? 'Your account is clear'
                : `${formatMoney(summary.balance, currency)} outstanding`}
            </p>
            <p className="mt-1 text-sm text-secondary">
              {summary.cleared
                ? 'Nothing issued to you is outstanding.'
                : summary.overdueCount > 0
                ? `${summary.overdueCount} invoice${summary.overdueCount === 1 ? '' : 's'} past the due date.`
                : 'Nothing is past its due date yet.'}
            </p>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-white/5 pt-4 text-sm">
          <div>
            <dt className="text-xs text-muted">Billed</dt>
            <dd className="text-primary">{formatMoney(summary.billed, currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Paid</dt>
            <dd className="text-primary">{formatMoney(summary.paid)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Outstanding</dt>
            <dd className={summary.cleared ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>
              {formatMoney(summary.balance)}
            </dd>
          </div>
        </dl>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
          Invoices
        </h2>
        {invoices.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-8 w-8" />}
            title="No invoices"
            message="Nothing has been billed to you yet."
          />
        ) : (
          <ul className="space-y-2">
            {invoices.map((i) => (
              <li key={i.id} className="overflow-hidden rounded-xl border border-subtle">
                <button
                  onClick={() => void toggle(i.id)}
                  className="flex w-full items-center justify-between gap-3 bg-card p-4 text-left hover:bg-sunken"
                >
                  <div>
                    <p className="font-mono text-xs text-muted">{i.number}</p>
                    <p className="text-primary">{formatMoney(i.total, i.currency)}</p>
                    {i.due_date && (
                      <p className="text-xs text-muted">
                        Due {new Date(i.due_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SETTLEMENT_STYLE[i.settlement]}`}>
                        {SETTLEMENT_LABEL[i.settlement]}
                      </span>
                      {Number(i.balance) > 0 && i.status === 'issued' && (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                          {formatMoney(i.balance)} left
                        </p>
                      )}
                    </div>
                    <ChevronDown
                      className={`h-4 w-4 text-muted transition-transform ${
                        expanded === i.id ? 'rotate-180' : ''
                      }`}
                    />
                  </div>
                </button>

                {expanded === i.id && (
                  <div className="border-t border-subtle bg-page p-4">
                    {!detail ? (
                      <p className="text-sm text-muted">Loading…</p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-subtle">
                          {detail.lines.map((l) => (
                            <tr key={l.id}>
                              <td className="py-2">
                                <p className={l.line_type === 'discount' ? 'text-emerald-700 dark:text-emerald-300' : 'text-secondary'}>
                                  {l.description}
                                </p>
                                {Number(l.quantity) !== 1 && (
                                  <p className="text-xs text-muted">
                                    {l.quantity} × {formatMoney(l.unit_amount)}
                                  </p>
                                )}
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
                        </tfoot>
                      </table>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
          Payments received
        </h2>
        {payments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-subtle p-6 text-center text-sm text-muted">
            No payments have been recorded against your account.
          </p>
        ) : (
          <ul className="divide-y divide-subtle overflow-hidden rounded-xl border border-subtle">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 bg-card p-4">
                <div>
                  <p className={`text-sm ${p.reversed_at ? 'text-muted line-through' : 'text-primary'}`}>
                    {formatMoney(p.amount, p.currency)}
                  </p>
                  <p className="text-xs text-muted">
                    {new Date(p.paid_at).toLocaleDateString()} · {p.method.replace('_', ' ')}
                    {p.invoice_number ? ` · ${p.invoice_number}` : ''}
                  </p>
                </div>
                {p.reversed_at ? (
                  <span className="text-xs text-rose-700 dark:text-rose-300">Reversed</span>
                ) : (
                  <Wallet className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default StudentFeesPage;
