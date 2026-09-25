import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, Clock, LogIn, LogOut, MapPin, ShieldAlert, UserX,
  ScanFace,
} from 'lucide-react';
import { useToastStore } from '../components/Toast';
import FaceChallengeCapture from '../components/face/FaceChallengeCapture';
import { biometricsService, type VerifyResult } from '../services/biometricsService';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState, ErrorAlert } from '../components/ErrorDisplay';
import {
  workforceService,
  CHECKIN_STATE_LABEL,
  formatHours,
  type CheckIn,
  type CheckInType,
  type MyAttendance,
} from '../services/workforceService';

/**
 * An employee checking in and out of work.
 *
 * This replaced a page of the same name that was mock data from top to
 * bottom: hardcoded "Database Systems" sessions, a hardcoded history, and a
 * mark-attendance button that showed a success screen and added a PRESENT row
 * whether or not anything was recorded — nothing was ever saved. It was also
 * a school page in all but name, built around courses and seat capacity. An
 * employee who used it would have been told they had checked in while their
 * timesheet stayed at zero.
 *
 * Everything here comes from /workforce/my/*, and the three things that
 * matter are decided by the server, not this page: who is checking in, when,
 * and whether a face was verified. The weekly figure comes from the same
 * function timesheets are built from, so it is the number the employee's
 * timesheet will show.
 */

const STATE_STYLE: Record<string, string> = {
  VERIFIED: 'bg-success-600/20 text-success-300',
  MANUAL_OVERRIDE: 'bg-brand-500/20 text-brand-300',
  FLAGGED: 'bg-amber-500/20 text-amber-300',
  REVOKED: 'bg-rose-600/20 text-rose-300',
};

function timeOf(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "3 h 12 min" since a moment, for the on-the-clock card. */
function elapsedSince(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

const EmployeeSelfServiceAttendancePage: React.FC = () => {
  const [data, setData] = useState<MyAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkInType, setCheckInType] = useState<CheckInType>('office');
  const [site, setSite] = useState('');
  const [now, setNow] = useState(() => Date.now());
  // Face check-in: available when the organisation has it on and HR has
  // enrolled this employee. The match is made on the server; the check-in
  // then cites it.
  const [face, setFace] = useState<{ enabled: boolean; consent: boolean; enrolled: boolean } | null>(null);
  const [faceOpen, setFaceOpen] = useState(false);

  const { addToast } = useToastStore();

  useEffect(() => { void load(); }, []);

  // The elapsed time on the card moves while the page is open. Nothing is
  // computed from it — the recorded hours are the server's.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const d = await workforceService.myAttendance(30);
      setData(d);
      if (d.employee) {
        try {
          const [settings, status] = await Promise.all([
            biometricsService.settings(),
            biometricsService.status('employee', d.employee.id),
          ]);
          setFace({
            enabled: settings.enabled && settings.configured,
            consent: !!status.consent,
            enrolled: !!status.enrolment,
          });
        } catch {
          setFace(null); // face check-in simply is not offered
        }
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const doCheckIn = async (faceMatchId?: string) => {
    try {
      setBusy(true);
      const row = await workforceService.checkIn({
        checkInType,
        siteLocation: site.trim() || undefined,
        faceMatchId,
      });
      addToast({
        type: 'success',
        title: `Checked in at ${timeOf(row.checkInTime)}`,
        message: row.faceVerified ? 'Face matched.' : undefined,
      });
      setSite('');
      await load();
    } catch (e) {
      addToast({ type: 'error', title: 'Could not check you in', message: getErrorMessage(e) });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const doCheckOut = async () => {
    try {
      setBusy(true);
      const row = await workforceService.checkOut();
      addToast({
        type: 'success',
        title: `Checked out at ${timeOf(row.checkOutTime)}`,
        message: row.hours ? `${formatHours(row.hours)} hours recorded.` : undefined,
      });
      await load();
    } catch (e) {
      addToast({ type: 'error', title: 'Could not check you out', message: getErrorMessage(e) });
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingOverlay message="Loading your attendance…" />;

  const card = 'rounded-xl border border-slate-800 bg-slate-900/60';
  const field = 'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600';

  if (!error && data && !data.employee) {
    return (
      <div className="p-6">
        <div className={`${card} p-6`}>
          <EmptyState
            icon={<UserX className="h-8 w-8" />}
            title="No employee record"
            message="This account is not linked to an employee here, so there is nothing to check in to. Ask HR if that is wrong."
          />
        </div>
      </div>
    );
  }

  const open: CheckIn | null = data?.onTheClock ?? null;
  const stale = data?.needsAttention ?? [];
  const history = data?.history ?? [];
  const week = data?.week;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Check in</h1>
        <p className="mt-1 text-sm text-slate-400">
          Start and end your working day. These are the hours your timesheet is built from.
        </p>
      </div>

      {error && <ErrorAlert title="Could not load your attendance" message={error} onDismiss={() => setError(null)} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className={`${card} p-6 lg:col-span-2`}>
          {open ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-success-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-success-400" />
                  On the clock
                </div>
                <div className="mt-2 text-3xl font-semibold text-slate-100">
                  {elapsedSince(open.checkInTime, now)}
                </div>
                <div className="mt-1 text-sm text-slate-400">
                  since {timeOf(open.checkInTime)}
                  {' · '}{open.checkInType === 'field' ? 'in the field' : 'at the office'}
                  {open.siteLocation && ` · ${open.siteLocation}`}
                </div>
              </div>
              <button
                onClick={() => void doCheckOut()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-6 py-3 text-base font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                <LogOut className="h-5 w-5" /> Check out
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-400">
                <span className="h-2 w-2 rounded-full bg-slate-600" />
                Not checked in
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wider text-slate-500">Where</label>
                  <div className="flex gap-2">
                    {(['office', 'field'] as CheckInType[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => setCheckInType(t)}
                        className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                          checkInType === t
                            ? 'border-brand-500 bg-brand-600/20 text-brand-200'
                            : 'border-slate-700 text-slate-400 hover:bg-slate-800'
                        }`}
                      >
                        {t === 'office' ? 'Office' : 'Field'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs uppercase tracking-wider text-slate-500">
                    Site (optional)
                  </label>
                  <input className={field} placeholder="e.g. Depot 4" value={site} maxLength={255}
                    onChange={(e) => setSite(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => void doCheckIn()}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-xl bg-success-600 px-6 py-3 text-base font-semibold text-white hover:bg-success-500 disabled:opacity-50"
                >
                  <LogIn className="h-5 w-5" /> Check in now
                </button>
                {face?.enabled && face.enrolled && (
                  <button
                    onClick={() => setFaceOpen(true)}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-xl border border-brand-500 px-6 py-3 text-base font-semibold text-brand-200 hover:bg-brand-600/20 disabled:opacity-50"
                  >
                    <ScanFace className="h-5 w-5" /> Check in with face
                  </button>
                )}
              </div>
            </div>
          )}
          <p className="mt-5 flex items-start gap-2 text-xs text-slate-500">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            The time is taken from the server, not this device. A check-in is recorded as
            face-matched only when it follows a face match made on the server moments before.
          </p>
        </div>

        <div className={`${card} p-6`}>
          <div className="text-xs uppercase tracking-wider text-slate-500">This week</div>
          <div className="mt-2 text-3xl font-semibold text-slate-100">
            {formatHours(week?.verifiedHours ?? '0')} h
          </div>
          <div className="mt-1 text-sm text-slate-400">
            counted since {week?.from ?? '—'}
          </div>
          {week && Number(week.flaggedHours) > 0 && (
            <div className="mt-3 text-xs text-amber-300">
              {formatHours(week.flaggedHours)} h more are flagged for review and not counted yet.
            </div>
          )}
          <div className="mt-3 text-xs text-slate-500">
            Only completed check-ins count — a shift still in progress is added when you check out.
          </div>
        </div>
      </div>

      {stale.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            {stale.length} check-in{stale.length === 1 ? ' was' : 's were'} never checked out
          </div>
          <p className="mt-1 text-sm text-amber-200/80">
            A check-in left open for more than a day is not closed automatically, because that
            would record a shift of days. It counts for nothing until HR corrects it.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-200/80">
            {stale.map((c) => (
              <li key={c.id}>{dayOf(c.checkInTime)} from {timeOf(c.checkInTime)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={card}>
        <div className="border-b border-slate-800 px-5 py-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          The last 30 days
        </div>
        {history.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Clock className="h-8 w-8" />}
              title="Nothing yet"
              message="Your check-ins appear here as you make them."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                <tr className="border-b border-slate-800">
                  <th className="px-5 py-3">Day</th>
                  <th className="px-5 py-3">In</th>
                  <th className="px-5 py-3">Out</th>
                  <th className="px-5 py-3 text-right">Hours</th>
                  <th className="px-5 py-3">Where</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {history.map((c) => (
                  <tr key={c.id} className="text-slate-300">
                    <td className="px-5 py-2.5">{dayOf(c.checkInTime)}</td>
                    <td className="px-5 py-2.5">{timeOf(c.checkInTime)}</td>
                    <td className="px-5 py-2.5">
                      {c.checkOutTime ? timeOf(c.checkOutTime) : (
                        <span className="text-slate-500">open</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right text-slate-100">
                      {c.hours === null ? '—' : formatHours(c.hours)}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {c.checkInType === 'field' ? 'Field' : 'Office'}
                        {c.siteLocation && ` · ${c.siteLocation}`}
                      </span>
                    </td>
                    <td className="px-5 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATE_STYLE[c.state] ?? ''}`}>
                        {CHECKIN_STATE_LABEL[c.state] ?? c.state}
                      </span>
                      {c.faceVerified && (
                        <span className="ml-2 text-xs text-slate-500">face matched</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {face?.enabled && data?.employee && (
          <div className={`${card} p-6 space-y-2`}>
            <div className="text-xs uppercase tracking-wider text-slate-500">Face check-in</div>
            <p className="text-sm text-slate-300">
              {face.enrolled
                ? 'You can check in with your face. The photos are compared on the server and not kept.'
                : face.consent
                  ? 'You have agreed to face check-in. HR enrols your face in person before you can use it.'
                  : 'Face check-in is optional. If you agree, HR enrols your face in person; you can withdraw at any time, which deletes it.'}
            </p>
            <button
              className="text-sm text-brand-300 hover:underline disabled:opacity-50"
              disabled={busy}
              onClick={async () => {
                const id = data.employee!.id;
                try {
                  setBusy(true);
                  if (face.consent) {
                    await biometricsService.withdrawConsent('employee', id, 'Withdrawn by the employee');
                    addToast({ type: 'success', title: 'Face check-in withdrawn', message: 'Your enrolled face has been deleted.' });
                  } else {
                    await biometricsService.grantConsent('employee', id,
                      `Given by the employee in self-service on ${new Date().toISOString().slice(0, 10)}`);
                    addToast({ type: 'success', title: 'Consent recorded', message: 'Ask HR to enrol your face.' });
                  }
                } catch (e) {
                  addToast({ type: 'error', title: 'Not changed', message: getErrorMessage(e) });
                } finally {
                  setBusy(false);
                  await load();
                }
              }}
            >
              {face.consent ? 'Withdraw consent and delete my face' : 'I agree to face check-in'}
            </button>
          </div>
        )}
      </div>

      {faceOpen && (
        <FaceChallengeCapture<VerifyResult>
          purpose="verify"
          title="Check in with your face"
          subtitle="Follow each instruction; one photo is taken per step."
          onDone={(r) => { setFaceOpen(false); void doCheckIn(r.matchId); }}
          onClose={() => setFaceOpen(false)}
        />
      )}
    </div>
  );
};

export default EmployeeSelfServiceAttendancePage;
