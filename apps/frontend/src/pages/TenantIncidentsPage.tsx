/**
 * Incidents affecting this school or company, for the people who run it.
 *
 * Reads and acts through /api/incidents, which scopes everything to the
 * caller's own tenant (auth/incidentVisibility.ts). The lifecycle it offers
 * is the one the incidents table allows:
 *
 *   open → investigating → contained → resolved → closed
 *
 * with acknowledgement recorded once, alongside the status.
 */
import React, { useEffect, useState } from 'react';
import { axiosClient } from '../utils/axiosClient';
import { EmptyState, ErrorState, LoadingState } from '../components/states/PageStates';

interface Incident {
  id: string;
  incident_number: number;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  category: string | null;
  created_at: string;
  acknowledged_at: string | null;
  contained_at: string | null;
  resolved_at: string | null;
  root_cause: string | null;
}

interface TimelineEvent {
  id: string;
  event_type: string;
  description: string;
  created_at: string;
}

const SEVERITY_BADGE: Record<string, string> = {
  CRITICAL: 'badge badge-danger', HIGH: 'badge badge-danger', MEDIUM: 'badge badge-warning', LOW: 'badge badge-neutral',
};
const ACTIVE = ['OPEN', 'INVESTIGATING', 'CONTAINED'];

const errorOf = (e: any, fallback: string) => e?.response?.data?.error ?? fallback;

const TenantIncidentsPage: React.FC = () => {
  const [tab, setTab] = useState<'active' | 'resolved'>('active');
  const [rows, setRows] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Incident | null>(null);

  const load = async () => {
    setError(null);
    try {
      const { data } = await axiosClient.get('/incidents', { params: { status: tab } });
      setRows(data.data.incidents);
    } catch (e: any) {
      setError(errorOf(e, 'Incidents could not be loaded'));
    }
  };

  useEffect(() => { setRows(null); void load(); }, [tab]);

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold text-primary">Incidents</h1>
        <p className="text-sm text-secondary mt-1">
          Problems affecting your organisation, raised automatically when errors recur or by the platform team.
        </p>
      </header>

      <div className="flex gap-2" role="tablist">
        {(['active', 'resolved'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={tab === t ? 'btn btn-primary' : 'btn btn-ghost'}>
            {t === 'active' ? 'Active' : 'Resolved'}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState title="Incidents could not be loaded" description={error} onRetry={() => void load()} />
      ) : rows === null ? (
        <LoadingState label="Loading incidents…" />
      ) : rows.length === 0 ? (
        <EmptyState title={tab === 'active' ? 'No active incidents' : 'No resolved incidents'}
          description={tab === 'active' ? 'Nothing is currently affecting your organisation.' : 'Nothing has been resolved yet.'} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-subtle">
                <th className="py-2 pr-4">#</th>
                <th className="py-2 pr-4">Title</th>
                <th className="py-2 pr-4">Severity</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Raised</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-subtle">
                  <td className="py-2 pr-4 text-muted">{r.incident_number}</td>
                  <td className="py-2 pr-4">
                    <button className="text-brand-600 dark:text-brand-300 hover:underline text-left" onClick={() => setSelected(r)}>{r.title}</button>
                    {!r.acknowledged_at && ACTIVE.includes(r.status) && (
                      <span className="ml-2 badge badge-warning">Not acknowledged</span>
                    )}
                  </td>
                  <td className="py-2 pr-4"><span className={SEVERITY_BADGE[r.severity] ?? 'badge badge-neutral'}>{r.severity}</span></td>
                  <td className="py-2 pr-4"><span className="badge badge-brand">{r.status}</span></td>
                  <td className="py-2 text-secondary">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <IncidentPanel incidentId={selected.id} onClose={() => setSelected(null)} onChanged={() => void load()} />
      )}
    </div>
  );
};

const IncidentPanel: React.FC<{ incidentId: string; onClose: () => void; onChanged: () => void }> = ({
  incidentId, onClose, onChanged,
}) => {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState({ rootCause: '', remediationSteps: '', preventionMeasures: '' });

  const load = async () => {
    try {
      const [d, t] = await Promise.all([
        axiosClient.get(`/incidents/${incidentId}`),
        axiosClient.get(`/incidents/${incidentId}/timeline`),
      ]);
      setIncident(d.data.data);
      setTimeline(t.data.data.timeline);
    } catch (e: any) {
      setError(errorOf(e, 'This incident could not be loaded'));
    }
  };

  useEffect(() => { void load(); }, [incidentId]);

  const act = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await axiosClient.post(`/incidents/${incidentId}/${path}`, body);
      setNote('');
      setResolving(false);
      await load();
      onChanged();
    } catch (e: any) {
      setError(errorOf(e, 'That did not work'));
    } finally {
      setBusy(false);
    }
  };

  const active = incident ? ACTIVE.includes(incident.status) : false;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="incident-title">
      <div className="card w-full max-w-xl h-full overflow-y-auto rounded-none space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id="incident-title" className="font-semibold text-primary text-lg">
            {incident ? `#${incident.incident_number} ${incident.title}` : 'Incident'}
          </h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error && <p role="alert" className="text-sm text-danger-600 dark:text-danger-400">{error}</p>}
        {!incident ? (
          !error && <LoadingState label="Loading…" />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <span className={SEVERITY_BADGE[incident.severity] ?? 'badge badge-neutral'}>{incident.severity}</span>
              <span className="badge badge-brand">{incident.status}</span>
              {incident.acknowledged_at && <span className="badge badge-neutral">Acknowledged {new Date(incident.acknowledged_at).toLocaleString()}</span>}
            </div>
            {incident.description && <p className="text-sm text-secondary whitespace-pre-wrap">{incident.description}</p>}
            {incident.root_cause && <p className="text-sm"><span className="font-medium">Root cause:</span> {incident.root_cause}</p>}

            {active && !resolving && (
              <div className="space-y-2">
                <label className="block text-sm text-secondary">Note (optional)
                  <input className="input-field w-full mt-1" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
                </label>
                <div className="flex flex-wrap gap-2">
                  {!incident.acknowledged_at && (
                    <button className="btn btn-primary" disabled={busy} onClick={() => act('acknowledge', { acknowledgementNote: note || undefined })}>Acknowledge</button>
                  )}
                  {incident.status === 'OPEN' && (
                    <button className="btn btn-ghost" disabled={busy} onClick={() => act('investigate', { investigationNote: note || undefined })}>Start investigating</button>
                  )}
                  {incident.status === 'INVESTIGATING' && (
                    <button className="btn btn-ghost" disabled={busy} onClick={() => act('mitigate', { mitigationPlan: note || undefined })}>Mark contained</button>
                  )}
                  <button className="btn btn-ghost" disabled={busy} onClick={() => setResolving(true)}>Resolve…</button>
                </div>
              </div>
            )}

            {active && resolving && (
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void act('resolve', resolution); }}>
                <p className="text-sm text-secondary">A resolution records what went wrong and what changes so it does not happen again.</p>
                {([
                  ['rootCause', 'What caused it'],
                  ['remediationSteps', 'What was done to fix it'],
                  ['preventionMeasures', 'What will stop it happening again'],
                ] as const).map(([k, label]) => (
                  <label key={k} className="block text-sm text-secondary">{label}
                    <textarea className="input-field w-full mt-1" rows={2} required value={resolution[k]}
                      onChange={(e) => setResolution({ ...resolution, [k]: e.target.value })} />
                  </label>
                ))}
                <div className="flex gap-2 justify-end">
                  <button type="button" className="btn btn-ghost" onClick={() => setResolving(false)}>Cancel</button>
                  <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Resolve incident'}</button>
                </div>
              </form>
            )}

            {incident.status === 'RESOLVED' && (
              <button className="btn btn-ghost" disabled={busy} onClick={() => act('close', { closureNote: note || undefined })}>Close incident</button>
            )}

            <section>
              <h3 className="font-medium text-primary mb-2">Timeline</h3>
              {timeline.length === 0 ? (
                <p className="text-sm text-muted">Nothing recorded yet.</p>
              ) : (
                <ol className="space-y-2">
                  {timeline.map((ev) => (
                    <li key={ev.id} className="text-sm border-l-2 border-subtle pl-3">
                      <div className="text-muted text-xs">{new Date(ev.created_at).toLocaleString()} · {ev.event_type.replace(/_/g, ' ')}</div>
                      <div className="text-secondary">{ev.description}</div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default TenantIncidentsPage;
