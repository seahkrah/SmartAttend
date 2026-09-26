/**
 * Face matching — administration.
 *
 * One page for both platforms: a school administrator manages students, HR
 * manages employees. Everything shown comes from /api/biometrics; the page
 * never sees a face template.
 *
 * The order of work is the order the server enforces: turn it on, record
 * consent, enrol (a supervised three-pose capture), and — whenever asked —
 * withdraw consent, which deletes the template.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ScanFace, Search, ShieldCheck, ShieldOff, Trash2, UserCheck } from 'lucide-react';
import FaceChallengeCapture from '../components/face/FaceChallengeCapture';
import { ConfirmDialog } from '../components/states/ConfirmDialog';
import { EmptyState, ErrorState, LoadingState, NoAccessState } from '../components/states/PageStates';
import {
  biometricsService, BiometricRefusal,
  type BiometricEvent, type BiometricSettings, type SubjectType,
} from '../services/biometricsService';
import { axiosClient } from '../utils/axiosClient';

interface Person {
  id: string;
  code: string;
  first_name: string;
  last_name: string;
  consent_granted_at: string | null;
  enrolled_at: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  consent_granted: 'Consent recorded',
  consent_withdrawn: 'Consent withdrawn',
  enrolled: 'Enrolment',
  template_deleted: 'Enrolment deleted',
  verified: 'Check-in match',
  identified: 'Class identification',
  settings_changed: 'Settings changed',
};

export const FaceMatchingAdminPage: React.FC<{ subjectType: SubjectType }> = ({ subjectType }) => {
  const noun = subjectType === 'student' ? 'student' : 'employee';
  const [settings, setSettings] = useState<BiometricSettings | null>(null);
  const [draftThreshold, setDraftThreshold] = useState(0.5);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [total, setTotal] = useState(0);
  const [events, setEvents] = useState<BiometricEvent[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [consentFor, setConsentFor] = useState<Person | null>(null);
  const [basis, setBasis] = useState('');
  const [enrolFor, setEnrolFor] = useState<Person | null>(null);
  const [withdrawFor, setWithdrawFor] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, list, log] = await Promise.all([
        biometricsService.settings(),
        axiosClient.get('/biometrics/subjects', { params: { type: subjectType, search: search || undefined, limit: 100 } }),
        biometricsService.events({ limit: 30 }),
      ]);
      setSettings(s);
      setDraftThreshold(s.threshold);
      setPeople(list.data.people);
      setTotal(list.data.total);
      setEvents(log);
    } catch (e: any) {
      if (e?.response?.status === 403) setForbidden(true);
      else setError(e?.response?.data?.error ?? 'Face matching could not be loaded');
    }
  }, [subjectType, search]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice({ tone: 'ok', text: ok });
      await load();
    } catch (e) {
      setNotice({ tone: 'bad', text: (e as BiometricRefusal).message });
    } finally {
      setBusy(false);
    }
  };

  if (forbidden) {
    return <div className="p-6"><NoAccessState /></div>;
  }
  if (error) {
    return <div className="p-6"><ErrorState title="Face matching could not be loaded" description={error} onRetry={load} /></div>;
  }
  if (!settings || !people) {
    return <div className="p-6"><LoadingState label="Loading face matching" /></div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold text-primary flex items-center gap-2">
          <ScanFace className="w-6 h-6" /> Face matching
        </h1>
        <p className="text-secondary mt-1 max-w-3xl text-sm">
          Photos are compared on the server with a face-recognition network. A match means the face in front of
          the camera is close to the one enrolled, and that the head turned as instructed. It is not proof against
          a prepared video or a synthetic camera feed, so it records who was matched, not that fraud was impossible.
          Manual marking always remains available.
        </p>
      </header>

      {notice && (
        <div role="status" className={`card text-sm ${notice.tone === 'ok' ? 'text-success-700 dark:text-success-300' : 'text-danger-600 dark:text-danger-400'}`}>
          {notice.text}
        </div>
      )}

      <section className="card space-y-3" aria-labelledby="fm-settings">
        <h2 id="fm-settings" className="font-semibold text-primary">Settings</h2>
        {!settings.configured ? (
          <p className="text-sm text-danger-600 dark:text-danger-400">
            This server has no template encryption key, so face matching cannot run. The operator must set
            BIOMETRIC_TEMPLATE_KEY.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-6">
            <label className="flex items-center gap-2 text-sm text-primary">
              <input
                type="checkbox"
                checked={settings.enabled}
                disabled={busy}
                onChange={(e) => act(() => biometricsService.saveSettings(e.target.checked, draftThreshold).then(() => {}),
                  e.target.checked ? 'Face matching is on.' : 'Face matching is off.')}
              />
              Face matching {settings.enabled ? 'on' : 'off'}
            </label>
            <label className="text-sm text-secondary">
              Strictness (match distance, lower is stricter): <strong className="text-primary">{draftThreshold.toFixed(2)}</strong>
              <input
                type="range" min={0.35} max={0.6} step={0.01} value={draftThreshold}
                onChange={(e) => setDraftThreshold(Number(e.target.value))}
                className="block w-64 mt-1" aria-label="Match distance threshold"
              />
            </label>
            <button
              className="btn btn-secondary"
              disabled={busy || draftThreshold === settings.threshold}
              onClick={() => act(() => biometricsService.saveSettings(settings.enabled, draftThreshold).then(() => {}),
                'Strictness saved.')}
            >
              Save strictness
            </button>
          </div>
        )}
      </section>

      <section className="card space-y-3" aria-labelledby="fm-people">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="fm-people" className="font-semibold text-primary">{noun === 'student' ? 'Students' : 'Employees'} ({total})</h2>
          <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex items-center gap-2">
            <Search className="w-4 h-4 text-muted" />
            <input
              className="input-field" placeholder={`Search ${noun}s`} value={search}
              onChange={(e) => setSearch(e.target.value)} aria-label={`Search ${noun}s`}
            />
          </form>
        </div>

        {people.length === 0 ? (
          <EmptyState title={`No ${noun}s found`} description={search ? 'Try a different search.' : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-subtle">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Consent</th>
                  <th className="py-2 pr-4">Enrolled</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-b border-subtle">
                    <td className="py-2 pr-4 text-primary">
                      {p.first_name} {p.last_name} <span className="text-muted">({p.code})</span>
                    </td>
                    <td className="py-2 pr-4">
                      {p.consent_granted_at
                        ? <span className="badge badge-success">Since {new Date(p.consent_granted_at).toLocaleDateString()}</span>
                        : <span className="badge badge-neutral">None</span>}
                    </td>
                    <td className="py-2 pr-4">
                      {p.enrolled_at
                        ? <span className="badge badge-brand">{new Date(p.enrolled_at).toLocaleDateString()}</span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="py-2 flex flex-wrap gap-2">
                      {!p.consent_granted_at && (
                        <button className="btn btn-secondary text-xs" onClick={() => { setConsentFor(p); setBasis(''); }}>
                          <ShieldCheck className="w-3.5 h-3.5 inline mr-1" />Record consent
                        </button>
                      )}
                      {p.consent_granted_at && (
                        <button className="btn btn-primary text-xs" disabled={!settings.enabled} onClick={() => setEnrolFor(p)}
                                title={settings.enabled ? undefined : 'Turn face matching on first'}>
                          <UserCheck className="w-3.5 h-3.5 inline mr-1" />{p.enrolled_at ? 'Re-enrol' : 'Enrol'}
                        </button>
                      )}
                      {p.enrolled_at && (
                        <button className="btn btn-ghost text-xs" disabled={busy}
                                onClick={() => act(() => biometricsService.deleteTemplate(subjectType, p.id), 'Enrolment deleted.')}>
                          <Trash2 className="w-3.5 h-3.5 inline mr-1" />Delete enrolment
                        </button>
                      )}
                      {p.consent_granted_at && (
                        <button className="btn btn-ghost text-xs text-danger-600 dark:text-danger-400" onClick={() => setWithdrawFor(p)}>
                          <ShieldOff className="w-3.5 h-3.5 inline mr-1" />Withdraw consent
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card space-y-2" aria-labelledby="fm-log">
        <h2 id="fm-log" className="font-semibold text-primary">Recent activity</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="text-sm divide-y divide-[rgb(var(--border-subtle))]">
            {events.map((e) => (
              <li key={e.id} className="py-1.5 flex flex-wrap gap-x-3">
                <span className="text-muted w-40">{new Date(e.created_at).toLocaleString()}</span>
                <span className="text-primary">{ACTION_LABELS[e.action] ?? e.action}</span>
                <span className={e.outcome === 'success' ? 'text-success-700 dark:text-success-300' : 'text-danger-600 dark:text-danger-400'}>
                  {e.outcome}{e.reason ? ` (${e.reason.replace(/_/g, ' ')})` : ''}
                </span>
                {e.distance !== null && <span className="text-muted">distance {e.distance.toFixed(2)} / {e.threshold?.toFixed(2)}</span>}
                <span className="text-muted">by {e.actor_name ?? 'unknown'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {consentFor && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true"
             aria-labelledby="consent-title">
          <form
            className="card w-full max-w-md space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const who = consentFor;
              setConsentFor(null);
              act(() => biometricsService.grantConsent(subjectType, who.id, basis), 'Consent recorded.');
            }}
          >
            <h3 id="consent-title" className="font-semibold text-primary">
              Record consent for {consentFor.first_name} {consentFor.last_name}
            </h3>
            <p className="text-sm text-secondary">
              Say how consent was obtained{subjectType === 'student' ? ' (for a minor, from the guardian)' : ''}.
              This is kept with the record.
            </p>
            <textarea className="input-field w-full" rows={3} required minLength={5} value={basis}
                      onChange={(e) => setBasis(e.target.value)}
                      placeholder="e.g. Signed consent form received 12 March, filed in the student record" />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setConsentFor(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={basis.trim().length < 5}>Record consent</button>
            </div>
          </form>
        </div>
      )}

      {enrolFor && (
        <FaceChallengeCapture
          purpose="enroll"
          title="Enrol a face"
          subtitle={`${enrolFor.first_name} ${enrolFor.last_name} (${enrolFor.code}). Supervise the capture in person.`}
          subjectType={subjectType}
          subjectId={enrolFor.id}
          onDone={() => { setEnrolFor(null); setNotice({ tone: 'ok', text: 'Enrolled.' }); load(); }}
          onClose={() => setEnrolFor(null)}
        />
      )}

      <ConfirmDialog
        open={!!withdrawFor}
        title="Withdraw consent"
        consequence={withdrawFor && (
          <>The face template for {withdrawFor.first_name} {withdrawFor.last_name} is deleted now. Past attendance keeps
            its record of how it was taken. Face matching can be used again only after new consent and a new enrolment.</>
        )}
        confirmLabel="Withdraw"
        busy={busy}
        onCancel={() => setWithdrawFor(null)}
        onConfirm={() => {
          const who = withdrawFor!;
          setWithdrawFor(null);
          act(() => biometricsService.withdrawConsent(subjectType, who.id, 'Withdrawn by an administrator'),
            'Consent withdrawn and the template deleted.');
        }}
      />
    </div>
  );
};

export default FaceMatchingAdminPage;
