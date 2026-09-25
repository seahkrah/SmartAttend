import React from 'react';
import { Monitor, LogOut } from 'lucide-react';
import { apiClient } from '../../services/api';
import { clearStoredSession } from '../../utils/sessionRefresh';

interface Session {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

function describe(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

/** Where the account is signed in, with a way to sign any of it out. */
export const SessionsPanel: React.FC = () => {
  const [sessions, setSessions] = React.useState<Session[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setError(null);
      const res = await apiClient.get('/auth/sessions');
      setSessions(res.data.sessions ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not load your signed-in devices');
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const signOut = async (id: string) => {
    setBusy(true);
    try {
      await apiClient.delete(`/auth/sessions/${id}`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not sign out that device');
    } finally {
      setBusy(false);
    }
  };

  const signOutEverywhere = async () => {
    if (!confirm('Sign out on every device, including this one?')) return;
    setBusy(true);
    try {
      await apiClient.post('/auth/logout-all');
    } finally {
      clearStoredSession();
      window.location.href = '/login';
    }
  };

  return (
    <section className="rounded-xl bg-slate-800/50 border border-slate-700 p-6 space-y-4" aria-labelledby="sessions-title">
      <div className="flex items-center justify-between">
        <h2 id="sessions-title" className="text-lg font-semibold text-white">Signed-in devices</h2>
        <button onClick={signOutEverywhere} disabled={busy}
          className="text-sm text-red-300 hover:text-red-200 inline-flex items-center gap-1 disabled:opacity-50">
          <LogOut className="w-4 h-4" />Sign out everywhere
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {sessions === null && !error && <p className="text-sm text-slate-400">Loading…</p>}
      {sessions && (
        <ul className="divide-y divide-slate-700">
          {sessions.map((s) => (
            <li key={s.id} className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Monitor className="w-5 h-5 text-slate-400" />
                <div>
                  <p className="text-sm text-white">
                    {describe(s.userAgent)}{s.current && <span className="ml-2 text-xs text-emerald-300">This device</span>}
                  </p>
                  <p className="text-xs text-slate-400">
                    {s.ip ? `${s.ip} · ` : ''}last active {new Date(s.lastUsedAt).toLocaleString()}
                  </p>
                </div>
              </div>
              {!s.current && (
                <button onClick={() => signOut(s.id)} disabled={busy}
                  className="text-xs text-slate-300 hover:text-white disabled:opacity-50">Sign out</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default SessionsPanel;
