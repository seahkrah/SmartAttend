/**
 * One child, as their guardian sees them: overview, attendance, timetable,
 * results and fees.
 *
 * The child comes from the URL, but that is only a choice among the children
 * the school linked to this guardian: the server answers 404 for any other
 * id, and 403 for an area the school has not shared. Tabs for withheld areas
 * are shown locked, with the reason, rather than hidden, so a parent who
 * expects to see fees knows to ask the school instead of assuming a fault.
 */
import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarDays, ClipboardList, FileText, Lock, Receipt, LayoutDashboard,
} from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, NoAccessState } from '../components/states/PageStates';
import {
  guardianPortalService,
  type ChildOverview, type AttendanceRecord, type AttendanceSummary, type ScheduleSlot,
} from '../services/guardianService';
import type { Transcript } from '../services/gradebookService';
import { formatMoney, type Statement, type Settlement } from '../services/feesService';
import { Initials, rateTone } from './GuardianHomePage';

type Tab = 'overview' | 'attendance' | 'timetable' | 'results' | 'fees';

const TABS: Array<{ id: Tab; label: string; icon: React.ElementType; permission?: 'attendance' | 'results' | 'fees' }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'attendance', label: 'Attendance', icon: ClipboardList, permission: 'attendance' },
  { id: 'timetable', label: 'Timetable', icon: CalendarDays },
  { id: 'results', label: 'Results', icon: FileText, permission: 'results' },
  { id: 'fees', label: 'Fees', icon: Receipt, permission: 'fees' },
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const STATUS_BADGE: Record<AttendanceRecord['status'], string> = {
  present: 'badge badge-success',
  late: 'badge badge-warning',
  absent: 'badge badge-danger',
  excused: 'badge badge-neutral',
};

const SETTLEMENT: Record<Settlement, { label: string; cls: string }> = {
  draft: { label: 'Not issued', cls: 'badge badge-neutral' },
  unpaid: { label: 'Unpaid', cls: 'badge badge-danger' },
  part_paid: { label: 'Part paid', cls: 'badge badge-warning' },
  paid: { label: 'Paid', cls: 'badge badge-success' },
  overpaid: { label: 'Overpaid', cls: 'badge badge-brand' },
  void: { label: 'Cancelled', cls: 'badge badge-neutral line-through' },
};

const errorOf = (e: any, fallback: string) => e?.response?.data?.error ?? fallback;
const statusOf = (e: any): number | undefined => e?.response?.status;
const time = (t: string | null) => (t ? t.slice(0, 5) : '');
const day = (d: string) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** Loads one area, keeping its own loading, error and refusal apart. */
function useArea<T>(load: () => Promise<T>, active: boolean, key: string) {
  const [state, setState] = useState<{ data?: T; error?: string; forbidden?: boolean; loading: boolean }>({ loading: false });
  const run = () => {
    setState({ loading: true });
    load()
      .then((data) => setState({ data, loading: false }))
      .catch((e) => setState({ loading: false, error: errorOf(e, 'This could not be loaded'), forbidden: statusOf(e) === 403 }));
  };
  useEffect(() => { if (active && state.data === undefined && !state.loading) run(); }, [active, key]);
  return { ...state, retry: run };
}

const SummaryTiles: React.FC<{ s: AttendanceSummary }> = ({ s }) => (
  <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3">
    <div className="card py-3">
      <dt className="text-xs text-muted">Attendance rate</dt>
      <dd className={`text-2xl font-semibold ${rateTone(s.rate)}`}>{s.rate === null ? '—' : `${s.rate}%`}</dd>
    </div>
    {([['Present', s.present], ['Late', s.late], ['Absent', s.absent], ['Excused', s.excused]] as const).map(([k, v]) => (
      <div key={k} className="card py-3">
        <dt className="text-xs text-muted">{k}</dt>
        <dd className="text-2xl font-semibold text-primary">{v}</dd>
      </div>
    ))}
  </dl>
);

const Records: React.FC<{ rows: AttendanceRecord[] }> = ({ rows }) => rows.length === 0 ? (
  <p className="text-sm text-muted">No attendance has been marked yet.</p>
) : (
  <ul className="card p-0 overflow-hidden">
    {rows.map((r) => (
      <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-subtle last:border-0">
        <div className="min-w-0">
          <p className="text-sm text-primary truncate">{r.course_code} · {r.course_name}</p>
          <p className="text-xs text-muted">{day(r.attendance_date)}{r.start_time ? ` · ${time(r.start_time)}–${time(r.end_time)}` : ''}</p>
        </div>
        <span className={STATUS_BADGE[r.status]}>{r.status.charAt(0).toUpperCase() + r.status.slice(1)}</span>
      </li>
    ))}
  </ul>
);

const Area: React.FC<{
  state: { loading: boolean; error?: string; forbidden?: boolean; retry: () => void };
  what: string;
  children: React.ReactNode;
}> = ({ state, what, children }) => {
  if (state.loading) return <LoadingState label={`Loading ${what}…`} />;
  if (state.forbidden) return <NoAccessState title={`${what.charAt(0).toUpperCase() + what.slice(1)} not shared`} description={state.error} />;
  if (state.error) return <ErrorState title={`${what.charAt(0).toUpperCase() + what.slice(1)} could not be loaded`} description={state.error} onRetry={state.retry} />;
  return <>{children}</>;
};

const GuardianChildPage: React.FC = () => {
  const { studentId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'overview') as Tab;
  const setTab = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });

  const [overview, setOverview] = useState<ChildOverview | null>(null);
  const [error, setError] = useState<{ text: string; status?: number } | null>(null);

  const loadOverview = async () => {
    setError(null);
    setOverview(null);
    try {
      setOverview(await guardianPortalService.overview(studentId));
    } catch (e) {
      setError({ text: errorOf(e, 'This student could not be loaded'), status: statusOf(e) });
    }
  };
  useEffect(() => { void loadOverview(); }, [studentId]);

  // An area the overview says is not shared is never requested: the answer is
  // already known, and asking anyway only produces a refusal to display.
  const shared = (p: 'attendance' | 'results' | 'fees') => !!overview?.permissions[p];
  const attendance = useArea(() => guardianPortalService.attendance(studentId), tab === 'attendance' && shared('attendance'), studentId);
  const schedule = useArea(() => guardianPortalService.schedule(studentId), tab === 'timetable' && !!overview, studentId);
  const results = useArea<Transcript>(() => guardianPortalService.results(studentId), tab === 'results' && shared('results'), studentId);
  const fees = useArea<Statement>(() => guardianPortalService.fees(studentId), tab === 'fees' && shared('fees'), studentId);

  const back = (
    <Link to="/guardian" className="inline-flex items-center gap-1 text-sm text-secondary hover:text-primary">
      <ArrowLeft className="w-4 h-4" /> My children
    </Link>
  );

  if (error) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        {back}
        {error.status === 404 ? (
          <EmptyState title="Student not found" description="This student is not linked to your account. If you think they should be, contact the school office." />
        ) : (
          <ErrorState title="Something went wrong" description={error.text} onRetry={() => void loadOverview()} />
        )}
      </div>
    );
  }
  if (!overview) return <div className="p-4 sm:p-6 space-y-4">{back}<LoadingState label="Loading…" /></div>;

  const s = overview.student;
  const perms = overview.permissions;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      {back}

      <header className="flex items-center gap-4">
        <Initials first={s.firstName} last={s.lastName} photo={s.photoUrl} size="w-14 h-14" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-primary truncate">
            {s.firstName} {s.middleName ? `${s.middleName} ` : ''}{s.lastName}
          </h1>
          <p className="text-sm text-secondary">
            {[s.studentNumber, overview.programme?.name, s.department].filter(Boolean).join(' · ') || 'Student'}
          </p>
        </div>
      </header>

      <nav aria-label="Sections" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-subtle -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => {
          const locked = t.permission ? !perms[t.permission] : false;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                tab === t.id ? 'border-brand-500 text-primary font-medium' : 'border-transparent text-secondary hover:text-primary'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden />
              {t.label}
              {locked && <Lock className="w-3 h-3 text-muted" aria-label="not shared" />}
            </button>
          );
        })}
      </nav>

      {tab === 'overview' && (
        <div className="space-y-5">
          {overview.attendance ? (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-primary">Attendance</h2>
              <SummaryTiles s={overview.attendance.overall} />
              {overview.attendance.last30Days.total > 0 && (
                <p className="text-sm text-secondary">
                  Last 30 days: <span className={rateTone(overview.attendance.last30Days.rate)}>{overview.attendance.last30Days.rate}%</span>
                  {' '}across {overview.attendance.last30Days.total} sessions, {overview.attendance.last30Days.absent} absent.
                </p>
              )}
              <Records rows={overview.attendance.recent} />
            </section>
          ) : (
            <NoAccessState title="Attendance not shared" description="The school has not shared this student's attendance with you." />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {overview.results ? (
              <section className="card space-y-2">
                <h2 className="text-sm font-medium text-primary">Results</h2>
                {overview.results.cgpa === null ? (
                  <p className="text-sm text-secondary">No results have been published yet.</p>
                ) : (
                  <>
                    <p className="text-3xl font-semibold text-primary">
                      {overview.results.cgpa.toFixed(2)}
                      <span className="text-sm font-normal text-muted"> CGPA{overview.results.creditWeighted ? '' : ' (unweighted)'}</span>
                    </p>
                    <p className="text-sm text-secondary">{overview.results.creditsEarned} of {overview.results.creditsAttempted} credits earned</p>
                    <button className="btn btn-ghost px-0" onClick={() => setTab('results')}>See all results</button>
                  </>
                )}
              </section>
            ) : (
              <NoAccessState title="Results not shared" description="The school has not shared this student's results with you." />
            )}
            {overview.fees ? (
              <section className="card space-y-2">
                <h2 className="text-sm font-medium text-primary">Fees</h2>
                <p className={`text-3xl font-semibold ${overview.fees.cleared ? 'text-success-600 dark:text-success-400' : 'text-accent-800 dark:text-accent-300'}`}>
                  {overview.fees.cleared ? 'Cleared' : formatMoney(overview.fees.balance, overview.fees.currency ?? undefined)}
                </p>
                <p className="text-sm text-secondary">
                  {overview.fees.cleared ? 'Nothing issued is outstanding.'
                    : overview.fees.overdueCount > 0 ? `${overview.fees.overdueCount} invoice(s) past the due date.`
                    : 'Outstanding, nothing overdue yet.'}
                </p>
                <button className="btn btn-ghost px-0" onClick={() => setTab('fees')}>See statement</button>
              </section>
            ) : (
              <NoAccessState title="Fees not shared" description="The school has not shared this student's fees with you." />
            )}
          </div>
        </div>
      )}

      {tab === 'attendance' && !perms.attendance && (
        <NoAccessState title="Attendance not shared" description="The school has not shared this student's attendance with you." />
      )}
      {tab === 'attendance' && perms.attendance && (
        <Area state={attendance} what="attendance">
          {attendance.data && (
            <div className="space-y-4">
              <SummaryTiles s={attendance.data.summary} />
              <Records rows={attendance.data.records} />
            </div>
          )}
        </Area>
      )}

      {tab === 'timetable' && (
        <Area state={schedule} what="the timetable">
          {schedule.data && (schedule.data.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No classes scheduled" description="This student is not enrolled in any scheduled classes yet." />
          ) : (
            <div className="space-y-4">
              {DAYS.map((d, i) => {
                const slots = (schedule.data as ScheduleSlot[]).filter((x) => x.day_of_week === i);
                if (slots.length === 0) return null;
                return (
                  <section key={d}>
                    <h2 className="text-xs font-medium uppercase tracking-wide text-muted mb-2">{d}</h2>
                    <ul className="card p-0 overflow-hidden">
                      {slots.map((x) => (
                        <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-subtle last:border-0">
                          <div className="min-w-0">
                            <p className="text-sm text-primary">{x.course_code} · {x.course_name}</p>
                            <p className="text-xs text-muted">
                              {[x.room_name, x.lecturer_name, x.section ? `Section ${x.section}` : null].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <span className="text-sm text-secondary tabular-nums">{time(x.start_time)}–{time(x.end_time)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          ))}
        </Area>
      )}

      {tab === 'results' && !perms.results && (
        <NoAccessState title="Results not shared" description="The school has not shared this student's results with you." />
      )}
      {tab === 'results' && perms.results && (
        <Area state={results} what="results">
          {results.data && (results.data.entries.length === 0 ? (
            <EmptyState icon={FileText} title="No published results yet" description="Results appear here once the school publishes them." />
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-secondary">
                CGPA <span className="font-semibold text-primary">{results.data.cgpa?.toFixed(2) ?? '—'}</span>
                {' '}· {results.data.creditsEarned} of {results.data.creditsAttempted} credits earned
                {!results.data.creditWeighted && ' · unweighted'}
              </p>
              <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted border-b border-subtle">
                      <th className="py-2 px-4">Course</th>
                      <th className="py-2 pr-4">Term</th>
                      <th className="py-2 pr-4 text-right">Score</th>
                      <th className="py-2 pr-4">Grade</th>
                      <th className="py-2 pr-4 text-right">Credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.data.entries.map((e, i) => (
                      <tr key={i} className="border-b border-subtle last:border-0">
                        <td className="py-2 px-4"><span className="text-primary">{e.course_code}</span> <span className="text-secondary">{e.course_name}</span></td>
                        <td className="py-2 pr-4 text-secondary">{[e.academic_year, e.semester_name].filter(Boolean).join(' ') || '—'}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{Number(e.total_score).toFixed(1)}</td>
                        <td className="py-2 pr-4">
                          <span className={e.is_pass ? 'badge badge-success' : 'badge badge-danger'}>{e.letter}</span>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">{e.credits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </Area>
      )}

      {tab === 'fees' && !perms.fees && (
        <NoAccessState title="Fees not shared" description="The school has not shared this student's fees with you." />
      )}
      {tab === 'fees' && perms.fees && (
        <Area state={fees} what="fees">
          {fees.data && (
            <div className="space-y-4">
              <dl className="grid grid-cols-3 gap-3">
                <div className="card py-3"><dt className="text-xs text-muted">Billed</dt><dd className="font-semibold text-primary">{formatMoney(fees.data.summary.billed, fees.data.summary.currency ?? undefined)}</dd></div>
                <div className="card py-3"><dt className="text-xs text-muted">Paid</dt><dd className="font-semibold text-primary">{formatMoney(fees.data.summary.paid)}</dd></div>
                <div className="card py-3"><dt className="text-xs text-muted">Outstanding</dt>
                  <dd className={`font-semibold ${fees.data.summary.cleared ? 'text-success-600 dark:text-success-400' : 'text-accent-800 dark:text-accent-300'}`}>{formatMoney(fees.data.summary.balance)}</dd></div>
              </dl>
              <section>
                <h2 className="text-xs font-medium uppercase tracking-wide text-muted mb-2">Invoices</h2>
                {fees.data.invoices.length === 0 ? (
                  <p className="text-sm text-muted">No invoices have been issued.</p>
                ) : (
                  <ul className="card p-0 overflow-hidden">
                    {fees.data.invoices.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-subtle last:border-0">
                        <div>
                          <p className="text-sm text-primary">{formatMoney(i.total, i.currency)} <span className="font-mono text-xs text-muted">{i.number}</span></p>
                          {i.due_date && <p className="text-xs text-muted">Due {new Date(i.due_date).toLocaleDateString()}</p>}
                        </div>
                        <div className="text-right">
                          <span className={SETTLEMENT[i.settlement].cls}>{SETTLEMENT[i.settlement].label}</span>
                          {Number(i.balance) > 0 && i.status === 'issued' && (
                            <p className="text-xs text-accent-800 dark:text-accent-300 mt-1">{formatMoney(i.balance)} left</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h2 className="text-xs font-medium uppercase tracking-wide text-muted mb-2">Payments received</h2>
                {fees.data.payments.length === 0 ? (
                  <p className="text-sm text-muted">No payments recorded.</p>
                ) : (
                  <ul className="card p-0 overflow-hidden">
                    {fees.data.payments.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-3 border-b border-subtle last:border-0">
                        <div>
                          <p className={`text-sm ${p.reversed_at ? 'line-through text-muted' : 'text-primary'}`}>{formatMoney(p.amount, p.currency)}</p>
                          <p className="text-xs text-muted">
                            {new Date(p.paid_at).toLocaleDateString()} · {p.method.replace('_', ' ')}{p.invoice_number ? ` · ${p.invoice_number}` : ''}
                          </p>
                        </div>
                        {p.reversed_at && <span className="badge badge-danger">Reversed</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </Area>
      )}
    </div>
  );
};

export default GuardianChildPage;
