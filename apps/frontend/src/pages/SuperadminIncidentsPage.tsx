/**
 * Superadmin — incidents.
 *
 * Replaces three components (a list, a detail modal and a creation modal)
 * written against an API that never existed: lower-case statuses, and fields
 * such as "affected entities" and "users impacted" that the incidents table
 * does not hold. This reads GET /api/superadmin/incidents and raises new ones
 * through POST /api/superadmin/incidents.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { axiosClient } from '../utils/axiosClient';
import { EmptyState, ErrorState, LoadingState } from '../components/states/PageStates';

const STATUSES = ['OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

interface Row {
  id: string;
  incident_number: number;
  title: string;
  incident_type: string;
  severity: string;
  status: string;
  affected_tenant_name: string | null;
  created_at: string;
  detected_by_name: string | null;
}

interface Tenant { id: string; name: string; kind: string }

const SEVERITY_BADGE: Record<string, string> = {
  CRITICAL: 'badge badge-danger', HIGH: 'badge badge-danger', MEDIUM: 'badge badge-warning', LOW: 'badge badge-neutral',
};

const SuperadminIncidentsPage: React.FC = () => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [creating, setCreating] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [form, setForm] = useState({ title: '', description: '', severity: 'MEDIUM', affectedTenantId: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const { data } = await axiosClient.get('/superadmin/incidents', { params: { status: status || undefined } });
      setRows(data.incidents);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Incidents could not be loaded');
    }
  };

  useEffect(() => { void load(); }, [status]);

  const openForm = async () => {
    setCreating(true);
    setFormError(null);
    if (tenants.length === 0) {
      try {
        const { data } = await axiosClient.get('/superadmin/tenants');
        setTenants(data.tenants);
      } catch {
        /* the organisation list is optional; platform-wide still works */
      }
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await axiosClient.post('/superadmin/incidents', {
        title: form.title.trim(),
        description: form.description.trim(),
        severity: form.severity,
        affectedTenantId: form.affectedTenantId || undefined,
      });
      setCreating(false);
      setForm({ title: '', description: '', severity: 'MEDIUM', affectedTenantId: '' });
      await load();
    } catch (err: any) {
      setFormError(err?.response?.data?.error ?? 'The incident was not raised');
    } finally {
      setSaving(false);
    }
  };

  const shown = useMemo(() => (rows ?? []).filter((r) => !severity || r.severity === severity), [rows, severity]);

  if (error) return <div className="p-6"><ErrorState title="Could not load incidents" description={error} onRetry={load} /></div>;
  if (!rows) return <div className="p-6"><LoadingState label="Loading incidents" /></div>;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Incidents</h1>
          <p className="text-sm text-secondary mt-1">Raised by the system when errors cross a threshold, or by a superadmin.</p>
        </div>
        <button className="btn btn-primary flex items-center gap-1" onClick={() => void openForm()}>
          <Plus className="w-4 h-4" /> Report an incident
        </button>
      </header>

      <div className="flex flex-wrap gap-3">
        <label className="text-sm text-secondary">Status{' '}
          <select className="input-field" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-sm text-secondary">Severity{' '}
          <select className="input-field" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      {shown.length === 0 ? (
        <EmptyState title="No incidents" description={status || severity ? 'None match these filters.' : 'Nothing has been raised.'} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-subtle">
                <th className="py-2 pr-4">#</th>
                <th className="py-2 pr-4">Title</th>
                <th className="py-2 pr-4">Organisation</th>
                <th className="py-2 pr-4">Severity</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Raised</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-subtle">
                  <td className="py-2 pr-4 text-muted">{r.incident_number}</td>
                  <td className="py-2 pr-4">
                    <Link className="text-brand-600 dark:text-brand-300 hover:underline" to={`/superadmin/incident/${r.id}`}>{r.title}</Link>
                    <div className="text-xs text-muted">{r.incident_type}</div>
                  </td>
                  <td className="py-2 pr-4 text-secondary">{r.affected_tenant_name ?? 'Platform-wide'}</td>
                  <td className="py-2 pr-4"><span className={SEVERITY_BADGE[r.severity] ?? 'badge badge-neutral'}>{r.severity}</span></td>
                  <td className="py-2 pr-4"><span className="badge badge-brand">{r.status}</span></td>
                  <td className="py-2 text-secondary">{new Date(r.created_at).toLocaleString()}{r.detected_by_name ? ` · ${r.detected_by_name}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="new-incident">
          <form className="card w-full max-w-lg space-y-3" onSubmit={submit}>
            <h2 id="new-incident" className="font-semibold text-primary">Report an incident</h2>
            {formError && <p role="alert" className="text-sm text-danger-600 dark:text-danger-400">{formError}</p>}
            <label className="block text-sm text-secondary">Title
              <input className="input-field w-full mt-1" required value={form.title}
                     onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label className="block text-sm text-secondary">What is happening
              <textarea className="input-field w-full mt-1" rows={4} value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm text-secondary">Severity
                <select className="input-field w-full mt-1" value={form.severity}
                        onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="block text-sm text-secondary">Organisation affected
                <select className="input-field w-full mt-1" value={form.affectedTenantId}
                        onChange={(e) => setForm({ ...form, affectedTenantId: e.target.value })}>
                  <option value="">Platform-wide</option>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.kind})</option>)}
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving || !form.title.trim()}>{saving ? 'Raising…' : 'Raise incident'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default SuperadminIncidentsPage;
