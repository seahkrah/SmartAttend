/**
 * The parent portal's home: each child the school has linked to this
 * guardian, with the figures the school shares about them.
 *
 * A figure appears only when the school shares that area with this guardian
 * for that child; the server leaves the rest out, and this page says so
 * rather than showing an empty zero that reads as "no absences".
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, GraduationCap, Users, Lock } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '../components/states/PageStates';
import { guardianPortalService, type ChildrenResponse, type Child } from '../services/guardianService';
import { formatMoney } from '../services/feesService';

const errorOf = (e: any, fallback: string) => e?.response?.data?.error ?? fallback;

export const rateTone = (rate: number | null | undefined) =>
  rate === null || rate === undefined ? 'text-muted'
    : rate >= 90 ? 'text-success-600 dark:text-success-400'
    : rate >= 75 ? 'text-accent-800 dark:text-accent-300'
    : 'text-danger-600 dark:text-danger-400';

export const Initials: React.FC<{ first: string; last: string; photo?: string | null; size?: string }> = ({
  first, last, photo, size = 'w-12 h-12',
}) => photo ? (
  <img src={photo} alt="" className={`${size} rounded-full object-cover`} />
) : (
  <span className={`${size} rounded-full bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 flex items-center justify-center font-semibold`} aria-hidden>
    {first.charAt(0)}{last.charAt(0)}
  </span>
);

const Withheld: React.FC<{ what: string }> = ({ what }) => (
  <span className="inline-flex items-center gap-1 text-xs text-muted" title={`The school has not shared ${what} with you`}>
    <Lock className="w-3 h-3" /> Not shared
  </span>
);

const ChildCard: React.FC<{ child: Child }> = ({ child }) => {
  const att = child.summary.attendance;
  const fees = child.summary.fees;
  return (
    <Link
      to={`/guardian/children/${child.id}`}
      className="card block hover:border-brand-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <div className="flex items-center gap-3">
        <Initials first={child.firstName} last={child.lastName} photo={child.photoUrl} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-primary truncate">{child.firstName} {child.lastName}</p>
          <p className="text-xs text-muted">
            {child.studentNumber ?? 'No student number'}
            {child.isPrimary && ' · You are the primary contact'}
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted shrink-0" aria-hidden />
      </div>

      <dl className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-subtle text-sm">
        <div>
          <dt className="text-xs text-muted">Attendance</dt>
          <dd className="mt-0.5">
            {!child.permissions.attendance ? <Withheld what="attendance" /> : att?.rate === null || !att ? (
              <span className="text-muted">Nothing marked yet</span>
            ) : (
              <span className={`font-semibold ${rateTone(att.rate)}`}>
                {att.rate}%<span className="font-normal text-muted"> · {att.absent} absent</span>
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Fees</dt>
          <dd className="mt-0.5">
            {!child.permissions.fees ? <Withheld what="fees" /> : !fees ? (
              <span className="text-muted">—</span>
            ) : fees.cleared ? (
              <span className="font-semibold text-success-600 dark:text-success-400">Cleared</span>
            ) : (
              <span className="font-semibold text-accent-800 dark:text-accent-300">
                {formatMoney(fees.balance, fees.currency ?? undefined)} due
                {fees.overdueCount > 0 && <span className="text-danger-600 dark:text-danger-400"> · overdue</span>}
              </span>
            )}
          </dd>
        </div>
      </dl>
    </Link>
  );
};

const GuardianHomePage: React.FC = () => {
  const [data, setData] = useState<ChildrenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setData(await guardianPortalService.children());
    } catch (e) {
      setError(errorOf(e, 'Your children could not be loaded'));
    }
  };

  useEffect(() => { void load(); }, []);

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState title="Something went wrong" description={error} onRetry={() => void load()} />
      </div>
    );
  }
  if (!data) return <div className="p-4 sm:p-6"><LoadingState label="Loading your children…" /></div>;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
      <header>
        <h1 className="text-2xl font-semibold text-primary">
          Welcome, {data.guardian.firstName}
        </h1>
        <p className="text-sm text-secondary mt-1">
          {data.school ? `${data.school} · ` : ''}What the school shares with you about your children.
        </p>
      </header>

      {data.children.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No children linked yet"
          description="The school has not linked any students to your account. Please contact the school office."
        />
      ) : (
        <section aria-label="Your children" className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.children.map((c) => <ChildCard key={c.id} child={c} />)}
        </section>
      )}

      <p className="text-xs text-muted flex items-center gap-1">
        <GraduationCap className="w-3 h-3" />
        Something wrong or missing? The school office manages what appears here.
      </p>
    </div>
  );
};

export default GuardianHomePage;
