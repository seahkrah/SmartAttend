/**
 * HR — who is at work today.
 *
 * Replaces a page that showed six invented employees in invented offices. This
 * one reads GET /api/hr/today: every current employee (or, for a manager, their
 * direct reports) with today's published shift, first check-in, and a status
 * derived on the server from those facts.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Clock, RefreshCw, ScanFace, Search } from 'lucide-react';
import { axiosClient } from '../utils/axiosClient';
import { EmptyState, ErrorState, LoadingState } from '../components/states/PageStates';

type Status = 'on_clock' | 'checked_out' | 'absent' | 'expected' | 'off';

interface Person {
  employeeId: string;
  code: string;
  name: string;
  department: string | null;
  status: Status;
  late: boolean;
  shift: { name: string; startsAt: string; endsAt: string } | null;
  firstCheckIn: string | null;
  checkedOutAt: string | null;
  state: string | null;
  faceMatched: boolean;
  checkInType: string | null;
  site: string | null;
}

interface Today {
  date: string | null;
  graceMinutes: number;
  scope: 'organisation' | 'direct_reports';
  summary: Record<string, number>;
  people: Person[];
}

const LABEL: Record<Status, string> = {
  on_clock: 'On the clock',
  checked_out: 'Checked out',
  absent: 'Absent',
  expected: 'Expected',
  off: 'Not rostered',
};

const BADGE: Record<Status, string> = {
  on_clock: 'badge badge-success',
  checked_out: 'badge badge-brand',
  absent: 'badge badge-danger',
  expected: 'badge badge-warning',
  off: 'badge badge-neutral',
};

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

export const HRTodayPage: React.FC = () => {
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | 'late' | 'all'>('all');
  const [search, setSearch] = useState('');

  const load = async () => {
    setError(null);
    try {
      const { data } = await axiosClient.get<Today>('/hr/today');
      setData(data);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Today\'s attendance could not be loaded');
    }
  };

  useEffect(() => { void load(); }, []);

  const shown = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.people.filter((p) =>
      (filter === 'all' || (filter === 'late' ? p.late : p.status === filter)) &&
      (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
        || (p.department ?? '').toLowerCase().includes(q)));
  }, [data, filter, search]);

  if (error) return <div className="p-6"><ErrorState title="Could not load today" description={error} onRetry={load} /></div>;
  if (!data) return <div className="p-6"><LoadingState label="Loading today" /></div>;

  const s = data.summary;
  const tiles: Array<{ key: Status | 'late'; label: string; value: number }> = [
    { key: 'on_clock', label: 'On the clock', value: s.onClock ?? 0 },
    { key: 'checked_out', label: 'Checked out', value: s.checkedOut ?? 0 },
    { key: 'absent', label: 'Absent', value: s.absent ?? 0 },
    { key: 'late', label: 'Late', value: s.late ?? 0 },
    { key: 'expected', label: 'Expected later', value: s.expected ?? 0 },
    { key: 'off', label: 'Not rostered', value: s.off ?? 0 },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Today</h1>
          <p className="text-sm text-secondary mt-1">
            {data.date ? new Date(data.date).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) : ''}
            {' · '}{data.scope === 'direct_reports' ? 'your direct reports' : 'everyone employed'}
            {' · '}late means more than {data.graceMinutes} minutes after the published shift start
          </p>
        </div>
        <button className="btn btn-secondary flex items-center gap-1" onClick={() => void load()}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {tiles.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(filter === t.key ? 'all' : t.key)}
            aria-pressed={filter === t.key}
            className={`card text-left ${filter === t.key ? 'ring-2 ring-brand-500' : ''}`}
          >
            <div className="text-xs uppercase tracking-wider text-muted">{t.label}</div>
            <div className="text-2xl font-semibold text-primary mt-1">{t.value}</div>
          </button>
        ))}
      </div>

      {(s.flagged ?? 0) > 0 && (
        <p className="text-sm text-amber-600">
          {s.flagged} of today's check-ins are flagged for review and do not count towards hours until resolved.
        </p>
      )}

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-primary">
            {filter === 'all' ? 'Everyone' : filter === 'late' ? 'Late' : LABEL[filter]} ({shown.length})
          </h2>
          <label className="flex items-center gap-2">
            <Search className="w-4 h-4 text-muted" />
            <input className="input-field" placeholder="Search name, number or department" value={search}
                   onChange={(e) => setSearch(e.target.value)} aria-label="Search people" />
          </label>
        </div>

        {data.people.length === 0 ? (
          <EmptyState title="Nobody to show"
                      description={data.scope === 'direct_reports' ? 'No employees report to you.' : 'No current employees.'} />
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted">No one matches.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-subtle">
                  <th className="py-2 pr-4">Employee</th>
                  <th className="py-2 pr-4">Department</th>
                  <th className="py-2 pr-4">Shift</th>
                  <th className="py-2 pr-4">In</th>
                  <th className="py-2 pr-4">Out</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.employeeId} className="border-b border-subtle">
                    <td className="py-2 pr-4 text-primary">{p.name} <span className="text-muted">({p.code})</span></td>
                    <td className="py-2 pr-4 text-secondary">{p.department ?? '—'}</td>
                    <td className="py-2 pr-4 text-secondary">
                      {p.shift ? `${time(p.shift.startsAt)}–${time(p.shift.endsAt)}` : '—'}
                    </td>
                    <td className="py-2 pr-4 text-secondary">
                      {time(p.firstCheckIn)}
                      {p.faceMatched && <ScanFace className="w-3.5 h-3.5 inline ml-1 text-success-600" aria-label="face matched" />}
                      {p.checkInType === 'field' && <span className="text-muted"> · field{p.site ? `, ${p.site}` : ''}</span>}
                    </td>
                    <td className="py-2 pr-4 text-secondary">{time(p.checkedOutAt)}</td>
                    <td className="py-2 flex flex-wrap items-center gap-1">
                      <span className={BADGE[p.status]}>{LABEL[p.status]}</span>
                      {p.late && <span className="badge badge-warning flex items-center gap-1"><Clock className="w-3 h-3" />Late</span>}
                      {p.state === 'FLAGGED' && <span className="badge badge-warning">Flagged</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default HRTodayPage;
