/**
 * Who reports to whom. A manager sees and decides leave, timesheets, rosters
 * and held check-ins only for the people below them here, so this page is
 * what gives a manager their team. The API refuses a line that would loop.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, NoAccessState } from '../components/states/PageStates';
import { axiosClient } from '../utils/axiosClient';

interface Person { id: string; name: string; code: string; managerId: string | null }

const ReportingLinesPage: React.FC = () => {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await axiosClient.get('/corporate/employees', { params: { limit: 200 } });
      setPeople((r.data.data ?? []).map((e: any) => ({
        id: e.id, name: `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim(), code: e.employee_id, managerId: e.manager_id ?? null,
      })));
    } catch (e: any) {
      if (e?.response?.status === 403) setForbidden(true);
      else setError(e?.response?.data?.error ?? 'Employees could not be loaded');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const byId = useMemo(() => new Map((people ?? []).map((p) => [p.id, p])), [people]);
  const teamSize = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of people ?? []) if (p.managerId) n.set(p.managerId, (n.get(p.managerId) ?? 0) + 1);
    return n;
  }, [people]);

  const change = async (p: Person, managerId: string) => {
    setBusy(p.id);
    setNotice(null);
    try {
      await axiosClient.put(`/hr/employees/${p.id}/manager`, { managerId: managerId || null });
      setNotice({ tone: 'ok', text: managerId ? `${p.name} now reports to ${byId.get(managerId)?.name}` : `${p.name} reports to nobody` });
      await load();
    } catch (e: any) {
      setNotice({ tone: 'bad', text: e?.response?.data?.error ?? 'That did not save' });
    } finally {
      setBusy(null);
    }
  };

  if (forbidden) return <div className="p-6"><NoAccessState /></div>;
  if (error) return <div className="p-6"><ErrorState title="Employees could not be loaded" description={error} onRetry={load} /></div>;
  if (!people) return <div className="p-6"><LoadingState label="Loading employees" /></div>;

  const shown = people.filter((p) => !search || `${p.name} ${p.code}`.toLowerCase().includes(search.toLowerCase()));
  const field = 'rounded-lg border border-subtle bg-card px-3 py-2 text-sm text-primary';

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <header>
        <h1 className="text-2xl font-semibold text-primary flex items-center gap-2"><GitBranch className="w-6 h-6" /> Reporting lines</h1>
        <p className="text-secondary mt-1 max-w-3xl text-sm">
          A manager sees and decides leave, timesheets, rosters and held check-ins for the people who report to them,
          directly or through another manager, and for nobody else. Someone who reports to nobody is HR's alone.
        </p>
      </header>
      {notice && (
        <div role="status" className={`card text-sm ${notice.tone === 'ok' ? 'text-success-700 dark:text-success-300' : 'text-danger-600 dark:text-danger-400'}`}>
          {notice.text}
        </div>
      )}
      <section className="card space-y-3">
        <input aria-label="Search employees" placeholder="Search by name or code" className={`${field} w-full max-w-sm`}
          value={search} onChange={(e) => setSearch(e.target.value)} />
        {shown.length === 0 ? <EmptyState title="Nobody found" description="No current employee matches." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted"><th className="py-2 pr-3">Employee</th><th className="pr-3">Reports to</th><th className="pr-3">Team</th></tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className="border-t border-subtle">
                    <td className="py-2 pr-3">{p.name}<span className="block text-xs text-muted">{p.code}</span></td>
                    <td className="pr-3">
                      <select aria-label={`${p.name} reports to`} className={field} value={p.managerId ?? ''} disabled={busy === p.id}
                        onChange={(e) => void change(p, e.target.value)}>
                        <option value="">Nobody</option>
                        {people.filter((m) => m.id !== p.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </td>
                    <td className="pr-3 tabular-nums">{teamSize.get(p.id) ?? 0}</td>
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

export default ReportingLinesPage;
