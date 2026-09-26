import React, { useEffect, useState } from 'react';
import { FileText, Receipt } from 'lucide-react';
import { useToastStore } from '../components/Toast';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState, ErrorAlert } from '../components/ErrorDisplay';
import {
  payrollService,
  formatMoney,
  isoDay,
  type Payslip,
  type PayslipLine,
  type PayrollRun,
} from '../services/payrollService';

/**
 * An employee's own payslips.
 *
 * Only from approved and paid runs, because that is all the API returns: a
 * calculated run is a draft that may still be recalculated, and telling
 * somebody what they are being paid and then changing it is worse than
 * telling them a day later.
 *
 * The breakdown is the point of the page. "Your net pay is 3,421.50" with
 * nothing behind it is unanswerable when challenged, and payroll gets
 * challenged.
 */

const EmployeePayslipsPage: React.FC = () => {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    payslip: Payslip; run: PayrollRun; lines: PayslipLine[];
  } | null>(null);

  const { addToast } = useToastStore();

  useEffect(() => { void load(); }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await payrollService.myPayslips();
      setPayslips(list);
      if (list.length > 0) await open(list[0].id);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const open = async (id: string) => {
    try {
      setOpenId(id);
      const d = await payrollService.payslip(id);
      setDetail({ payslip: d.payslip, run: d.run, lines: d.lines });
    } catch (e) {
      setDetail(null);
      addToast({ type: 'error', title: 'Could not open that payslip', message: getErrorMessage(e) });
    }
  };

  if (loading) return <LoadingOverlay message="Loading your payslips…" />;

  const card = 'rounded-xl border border-subtle bg-card';

  const earnings = detail?.lines.filter((l) => l.kind === 'earning') ?? [];
  // A zero-amount line explains a prorated basic rather than deducting
  // anything; it belongs with the explanation, not among the deductions.
  const deductions = detail?.lines.filter((l) => l.kind === 'deduction' && Number(l.amount) > 0) ?? [];
  const notes = detail?.lines.filter((l) => l.kind === 'deduction' && Number(l.amount) === 0) ?? [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">My payslips</h1>
        <p className="mt-1 text-sm text-secondary">
          What you were paid, and what it was made up of.
        </p>
      </div>

      {error && <ErrorAlert title="Could not load your payslips" message={error} onDismiss={() => setError(null)} />}

      {payslips.length === 0 ? (
        <div className={`${card} p-6`}>
          <EmptyState
            icon={<Receipt className="h-8 w-8" />}
            title="No payslips yet"
            message="A payslip appears here once the payroll run covering it has been approved."
          />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className={`${card} lg:col-span-1`}>
            <div className="border-b border-subtle px-5 py-3 text-sm font-semibold uppercase tracking-wider text-secondary">
              Periods
            </div>
            <ul className="divide-y divide-subtle">
              {payslips.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => void open(s.id)}
                    className={`w-full px-5 py-3 text-left transition ${
                      openId === s.id ? 'bg-sunken' : 'hover:bg-sunken'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-primary">{s.period_name}</span>
                      <span className="text-sm font-medium text-primary">
                        {formatMoney(s.net, s.currency)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-xs text-muted">
                      <span>paid {isoDay(s.pay_date)}</span>
                      <span className={
                        s.run_status === 'paid' ? 'text-success-700 dark:text-success-400' : 'text-amber-700 dark:text-amber-400'
                      }>
                        {s.run_status === 'paid' ? 'paid' : 'approved'}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-2">
            {!detail ? (
              <div className={`${card} p-6`}>
                <EmptyState
                  icon={<FileText className="h-8 w-8" />}
                  title="Pick a period"
                  message="Its full breakdown appears here."
                />
              </div>
            ) : (
              <div className={card}>
                <div className="border-b border-subtle px-5 py-4">
                  <div className="text-sm font-semibold text-primary">
                    {detail.run.period_name}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {isoDay(detail.run.start_date)} → {isoDay(detail.run.end_date)}
                    {' · paid '}{isoDay(detail.run.pay_date)}
                  </div>
                </div>

                {notes.length > 0 && (
                  <div className="border-b border-subtle bg-card px-5 py-3 text-sm text-secondary">
                    {notes.map((n, i) => <div key={i}>{n.name}</div>)}
                  </div>
                )}

                <div className="border-b border-subtle px-5 py-3 text-xs uppercase tracking-wider text-muted">
                  Earnings
                </div>
                <ul className="divide-y divide-subtle">
                  {earnings.map((l, i) => (
                    <li key={`e-${i}`} className="flex items-center justify-between px-5 py-2.5 text-sm">
                      <span className="text-primary">
                        {l.name}
                        {!l.is_taxable && (
                          <span className="ml-2 text-xs text-muted">not taxed</span>
                        )}
                      </span>
                      <span className="text-primary">
                        {formatMoney(l.amount, detail.payslip.currency)}
                      </span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between bg-card px-5 py-2.5 text-sm font-medium">
                    <span className="text-secondary">Gross pay</span>
                    <span className="text-primary">
                      {formatMoney(detail.payslip.gross, detail.payslip.currency)}
                    </span>
                  </li>
                </ul>

                {deductions.length > 0 && (
                  <>
                    <div className="border-y border-subtle px-5 py-3 text-xs uppercase tracking-wider text-muted">
                      Deductions
                    </div>
                    <ul className="divide-y divide-subtle">
                      {deductions.map((l, i) => (
                        <li key={`d-${i}`} className="flex items-center justify-between px-5 py-2.5 text-sm">
                          <span className="text-secondary">
                            {l.name}
                            {l.reduces_taxable && (
                              <span className="ml-2 text-xs text-muted">before tax</span>
                            )}
                          </span>
                          <span className="text-rose-700 dark:text-rose-300">
                            −{formatMoney(l.amount, detail.payslip.currency)}
                          </span>
                        </li>
                      ))}
                      <li className="flex items-center justify-between bg-card px-5 py-2.5 text-sm font-medium">
                        <span className="text-secondary">Total deductions</span>
                        <span className="text-rose-700 dark:text-rose-300">
                          −{formatMoney(detail.payslip.total_deductions, detail.payslip.currency)}
                        </span>
                      </li>
                    </ul>
                  </>
                )}

                <div className="flex items-center justify-between border-t border-subtle px-5 py-4">
                  <span className="text-sm font-semibold text-primary">Net pay</span>
                  <span className="text-xl font-semibold text-primary">
                    {formatMoney(detail.payslip.net, detail.payslip.currency)}
                  </span>
                </div>

                {!detail.run.tax_table_applied && (
                  <div className="border-t border-subtle px-5 py-3 text-xs text-muted">
                    No income tax table was in force for this period, so no tax was
                    deducted.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeePayslipsPage;
