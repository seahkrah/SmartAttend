/**
 * Superadmin — one incident.
 *
 * Rewritten against the API that exists. The previous page read an endpoint
 * the server did not have, displayed fields the incidents table does not hold
 * (affected entity lists, users impacted), and its status dropdown changed
 * only the screen: nothing was saved. Now:
 *
 *   GET /api/superadmin/incidents/:id   the incident and its timeline
 *   PUT /api/superadmin/incidents/:id   status, severity, root cause, notes;
 *                                       every change lands on the timeline
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageSquarePlus } from 'lucide-react';
import { axiosClient } from '../utils/axiosClient';
import { ErrorState, LoadingState, EmptyState } from '../components/states/PageStates';

const STATUSES = ['OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED'] as const;
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

interface Incident {
  id: string;
  incident_number: number;
  title: string;
  description: string;
  incident_type: string;
  severity: (typeof SEVERITIES)[number];
  status: (typeof STATUSES)[number];
  affected_tenant_name: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  root_cause: string | null;
  resolution_notes: string | null;
  detected_by_name: string | null;
  acknowledged_by_name: string | null;
  resolved_by_name: string | null;
  assigned_to_name: string | null;
  error_count: number | null;
}

interface TimelineEntry {
  id: string;
  event_type: string;
  description: string | null;
  created_at: string;
  performed_by_name: string | null;
}

const SEVERITY_BADGE: Record<string, string> = {
  CRITICAL: 'badge badge-danger', HIGH: 'badge badge-danger', MEDIUM: 'badge badge-warning', LOW: 'badge badge-neutral',
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

const IncidentDetailPage: React.FC = () => {
  const { incidentId } = useParams<{ incidentId: string }>();
  const navigate = useNavigate();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [rootCause, setRootCause] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const apply = (data: { incident: Incident; timeline: TimelineEntry[] }) => {
    setIncident(data.incident);
    setTimeline(data.timeline);
    setStatus(data.incident.status);
    setRootCause(data.incident.root_cause ?? '');
  };

  const load = async () => {
    setLoadError(null);
    try {
      const { data } = await axiosClient.get(`/superadmin/incidents/${incidentId}`);
      apply(data);
    } catch (e: any) {
      if (e?.response?.status === 404) setNotFound(true);
      else setLoadError(e?.response?.data?.error ?? 'The incident could not be loaded');
    }
  };

  useEffect(() => { void load(); }, [incidentId]);

  const save = async (body: Record<string, unknown>) => {
    setSaving(true);
    setSaveError(null);
    try {
      const { data } = await axiosClient.put(`/superadmin/incidents/${incidentId}`, body);
      apply(data);
      return true;
    } catch (e: any) {
      setSaveError(e?.response?.data?.error ?? 'The change was not saved');
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (notFound) {
    return <div className="p-6"><EmptyState title="No such incident" description="It may have been removed, or the link is wrong." /></div>;
  }
  if (loadError) return <div className="p-6"><ErrorState title="Could not load the incident" description={loadError} onRetry={load} /></div>;
  if (!incident) return <div className="p-6"><LoadingState label="Loading incident" /></div>;

  const resolving = status === 'RESOLVED' && incident.status !== 'RESOLVED';
  const statusChanged = status !== incident.status;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <button className="btn btn-ghost flex items-center gap-1" onClick={() => navigate('/superadmin/incidents')}>
        <ArrowLeft className="w-4 h-4" /> Incidents
      </button>

      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={SEVERITY_BADGE[incident.severity] ?? 'badge badge-neutral'}>{incident.severity}</span>
          <span className="badge badge-brand">{incident.status}</span>
          <span className="text-sm text-muted">#{incident.incident_number} · {incident.incident_type}</span>
        </div>
        <h1 className="text-2xl font-semibold text-primary">{incident.title}</h1>
        <p className="text-secondary whitespace-pre-line">{incident.description}</p>
      </header>

      {saveError && <div role="alert" className="card text-sm text-danger-600 dark:text-danger-400">{saveError}</div>}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-2 text-sm">
          <h2 className="font-semibold text-primary">Details</h2>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">Organisation</dt><dd className="text-primary">{incident.affected_tenant_name ?? 'Platform-wide'}</dd>
            <dt className="text-muted">Detected</dt><dd className="text-primary">{when(incident.created_at)}{incident.detected_by_name ? ` by ${incident.detected_by_name}` : ''}</dd>
            <dt className="text-muted">Assigned to</dt><dd className="text-primary">{incident.assigned_to_name ?? '—'}</dd>
            <dt className="text-muted">Acknowledged</dt><dd className="text-primary">{when(incident.acknowledged_at)}{incident.acknowledged_by_name ? ` by ${incident.acknowledged_by_name}` : ''}</dd>
            <dt className="text-muted">Resolved</dt><dd className="text-primary">{when(incident.resolved_at)}{incident.resolved_by_name ? ` by ${incident.resolved_by_name}` : ''}</dd>
            {incident.error_count !== null && (<><dt className="text-muted">Errors seen</dt><dd className="text-primary">{incident.error_count}</dd></>)}
            {incident.root_cause && (<><dt className="text-muted">Root cause</dt><dd className="text-primary whitespace-pre-line">{incident.root_cause}</dd></>)}
          </dl>
        </section>

        <section className="card space-y-3 text-sm">
          <h2 className="font-semibold text-primary">Change status</h2>
          <label className="block">
            <span className="text-muted">Status</span>
            <select className="input-field w-full mt-1" value={status} onChange={(e) => setStatus(e.target.value)} disabled={saving}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {resolving && (
            <label className="block">
              <span className="text-muted">Root cause (required to resolve)</span>
              <textarea className="input-field w-full mt-1" rows={3} value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
            </label>
          )}
          <button
            className="btn btn-primary"
            disabled={saving || !statusChanged || (resolving && rootCause.trim().length === 0)}
            onClick={() => void save({ status, ...(resolving ? { rootCause: rootCause.trim() } : {}) })}
          >
            {saving ? 'Saving…' : 'Save status'}
          </button>
        </section>
      </div>

      <section className="card space-y-3">
        <h2 className="font-semibold text-primary">Timeline</h2>
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await save({ notes: note })) setNote('');
          }}
        >
          <textarea className="input-field w-full" rows={2} placeholder="Add a note to the timeline"
                    value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
          <div>
            <button className="btn btn-secondary flex items-center gap-1" disabled={saving || note.trim().length === 0}>
              <MessageSquarePlus className="w-4 h-4" /> Add note
            </button>
          </div>
        </form>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted">Nothing recorded yet.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {timeline.map((t) => (
              <li key={t.id} className="border-l-2 border-subtle pl-3">
                <div className="text-muted">{when(t.created_at)} · {t.event_type.replace(/_/g, ' ')}{t.performed_by_name ? ` · ${t.performed_by_name}` : ''}</div>
                {t.description && <div className="text-primary whitespace-pre-line">{t.description}</div>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
};

export default IncidentDetailPage;
