/**
 * Access requests: organisations that asked, through the public form, to use
 * the platform. The operator reads them here, contacts each one, and marks
 * where the conversation stands.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Inbox, Mail, Phone, MessageCircle, Building2 } from 'lucide-react';
import { apiClient } from '../services/api';
import { EmptyState, ErrorState, LoadingState } from '../components/states/PageStates';

type Status = 'new' | 'contacted' | 'closed';

interface AccessRequest {
  id: string;
  organisation_name: string;
  organisation_type: 'school' | 'employer' | 'both';
  country_code: string;
  size_band: string | null;
  contact_name: string;
  job_title: string | null;
  email: string;
  phone: string | null;
  preferred_contact: 'email' | 'phone' | 'whatsapp';
  message: string | null;
  status: Status;
  internal_notes: string | null;
  handled_by_name: string | null;
  handled_at: string | null;
  created_at: string;
}

const TYPE: Record<AccessRequest['organisation_type'], string> = {
  school: 'School system (SMS)', employer: 'Employee system (EMS)', both: 'SMS + EMS',
};
const STATUS: Record<Status, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'badge badge-warning' },
  contacted: { label: 'Contacted', cls: 'badge badge-brand' },
  closed: { label: 'Closed', cls: 'badge badge-neutral' },
};

const SuperadminAccessRequestsPage: React.FC = () => {
  const [rows, setRows] = useState<AccessRequest[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const region = useMemo(() => {
    try { return new Intl.DisplayNames([navigator.language, 'en'], { type: 'region' }); } catch { return null; }
  }, []);

  const load = async () => {
    setError(null);
    try {
      const { data } = await apiClient.get('/access-requests', { params: filter === 'all' ? {} : { status: filter } });
      setRows(data.requests);
      setCounts(data.counts ?? {});
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Access requests could not be loaded');
    }
  };
  useEffect(() => { void load(); }, [filter]);

  const update = async (r: AccessRequest, body: { status?: Status; internalNotes?: string }) => {
    setNotice(null);
    try {
      await apiClient.patch(`/access-requests/${r.id}`, body);
      await load();
    } catch (e: any) {
      setNotice(e?.response?.data?.error ?? 'The request could not be updated');
    }
  };

  const tabs: Array<Status | 'all'> = ['all', 'new', 'contacted', 'closed'];
  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
      <header>
        <h1 className="text-2xl font-semibold text-primary">Access requests</h1>
        <p className="text-sm text-secondary mt-1">
          Schools and employers who asked to use the platform. Contact each one, then mark where it stands.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        {tabs.map((t) => (
          <button key={t} onClick={() => setFilter(t)} aria-pressed={filter === t}
            className={`btn ${filter === t ? 'btn-primary' : 'btn-ghost'} text-sm`}>
            {t === 'all' ? 'All' : STATUS[t].label} <span className="opacity-70 ml-1">{t === 'all' ? total : counts[t] ?? 0}</span>
          </button>
        ))}
      </nav>

      {notice && <p role="alert" className="text-sm text-danger-600 dark:text-danger-400">{notice}</p>}

      {error ? (
        <ErrorState title="Access requests could not be loaded" description={error} onRetry={() => void load()} />
      ) : rows === null ? (
        <LoadingState label="Loading access requests…" />
      ) : rows.length === 0 ? (
        <EmptyState icon={Inbox} title="No requests here" description="Requests sent from the public “Request access” form appear here." />
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => (
            <li key={r.id} className="card space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-primary flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-muted" aria-hidden /> {r.organisation_name}
                  </p>
                  <p className="text-sm text-secondary">
                    {TYPE[r.organisation_type]} · {region?.of(r.country_code) ?? r.country_code}
                    {r.size_band ? ` · ${r.size_band.replace('-', '–')} people` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <span className={STATUS[r.status].cls}>{STATUS[r.status].label}</span>
                  <p className="text-xs text-muted mt-1">{new Date(r.created_at).toLocaleString()}</p>
                </div>
              </div>

              <div className="text-sm text-secondary space-y-1">
                <p className="text-primary">{r.contact_name}{r.job_title ? `, ${r.job_title}` : ''}</p>
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                  <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 hover:underline"><Mail className="w-3.5 h-3.5" aria-hidden />{r.email}</a>
                  {r.phone && <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 hover:underline"><Phone className="w-3.5 h-3.5" aria-hidden />{r.phone}</a>}
                  {r.phone && r.preferred_contact === 'whatsapp' && (
                    <a href={`https://wa.me/${r.phone.slice(1)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                      <MessageCircle className="w-3.5 h-3.5" aria-hidden />WhatsApp
                    </a>
                  )}
                </p>
                <p className="text-xs text-muted">Prefers {r.preferred_contact === 'whatsapp' ? 'WhatsApp' : r.preferred_contact}</p>
              </div>

              {r.message && <p className="text-sm text-primary whitespace-pre-line border-l-2 border-subtle pl-3">{r.message}</p>}

              <div className="space-y-2">
                <label className="block text-xs text-muted" htmlFor={`notes-${r.id}`}>Internal notes</label>
                <textarea id={`notes-${r.id}`} className="input-field w-full" rows={2} maxLength={4000}
                  value={notes[r.id] ?? r.internal_notes ?? ''}
                  onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                <div className="flex flex-wrap items-center gap-2">
                  {notes[r.id] !== undefined && notes[r.id] !== (r.internal_notes ?? '') && (
                    <button className="btn btn-secondary text-sm" onClick={() => void update(r, { internalNotes: notes[r.id] })}>Save notes</button>
                  )}
                  {r.status !== 'contacted' && <button className="btn btn-ghost text-sm" onClick={() => void update(r, { status: 'contacted' })}>Mark contacted</button>}
                  {r.status !== 'closed' && <button className="btn btn-ghost text-sm" onClick={() => void update(r, { status: 'closed' })}>Close</button>}
                  {r.status === 'closed' && <button className="btn btn-ghost text-sm" onClick={() => void update(r, { status: 'new' })}>Reopen</button>}
                  {r.handled_by_name && (
                    <span className="text-xs text-muted ml-auto">Last updated by {r.handled_by_name}{r.handled_at ? `, ${new Date(r.handled_at).toLocaleDateString()}` : ''}</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default SuperadminAccessRequestsPage;
