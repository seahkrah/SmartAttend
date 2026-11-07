/**
 * Kiosks, on the Check-in rules page: create one at a site with an attendant
 * PIN, show its pairing code once, issue a new code, revoke it. The code is
 * typed on the kiosk at /kiosk within 15 minutes.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { MonitorSmartphone, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../states/ConfirmDialog';
import { EmptyState } from '../states/PageStates';
import { axiosClient } from '../../utils/axiosClient';

interface KioskRow {
  id: string; label: string; siteName: string; paired: boolean; awaitingPairing: boolean; pinLocked: boolean;
  lastSeenAt: string | null; createdAt: string;
}

const errorOf = (e: any, fallback: string) => e?.response?.data?.error ?? fallback;

const KioskAdminSection: React.FC<{ canChange: boolean; sites: { id: string; name: string; isActive: boolean }[] }> = ({ canChange, sites }) => {
  const [kiosks, setKiosks] = useState<KioskRow[]>([]);
  const [form, setForm] = useState({ siteId: '', label: '', pin: '' });
  const [code, setCode] = useState<{ label: string; code: string; until: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoke, setRevoke] = useState<KioskRow | null>(null);

  const load = useCallback(async () => {
    try {
      setKiosks((await axiosClient.get('/kiosk/admin/devices')).data.kiosks);
    } catch (e) {
      setNotice({ tone: 'bad', text: errorOf(e, 'The kiosks could not be loaded') });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setNotice(null);
    try { await fn(); await load(); } catch (e) { setNotice({ tone: 'bad', text: errorOf(e, 'That did not work') }); } finally { setBusy(false); }
  };

  const field = 'w-full rounded-lg border border-subtle bg-card px-3 py-2 text-sm text-primary placeholder:text-muted';
  const active = sites.filter((s) => s.isActive);

  return (
    <section className="card space-y-3" aria-labelledby="cc-kiosks">
      <h2 id="cc-kiosks" className="font-semibold text-primary flex items-center gap-2"><MonitorSmartphone className="w-4 h-4" /> Kiosks ({kiosks.length})</h2>
      <p className="text-xs text-muted">
        A kiosk is a shared screen at a site. Open <span className="font-mono">/kiosk</span> on it and type the pairing code shown here once.
        Employees check in by face there, or the attendant checks them in with the PIN and a reason. The rules above apply to it, at its site.
      </p>
      {notice && <p role="status" className={`text-sm ${notice.tone === 'ok' ? 'text-success-700 dark:text-success-300' : 'text-danger-600 dark:text-danger-400'}`}>{notice.text}</p>}
      {code && (
        <div role="status" className="rounded-xl border-2 border-primary-500 p-4">
          <div className="text-sm text-secondary">Pairing code for {code.label}, shown once, valid until {new Date(code.until).toLocaleTimeString()}:</div>
          <div className="font-mono text-3xl tracking-widest text-primary" data-testid="pairing-code">{code.code}</div>
        </div>
      )}
      {kiosks.length === 0 ? <EmptyState title="No kiosks" description="Add one at a site below." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted"><th className="py-2 pr-3">Kiosk</th><th className="pr-3">Site</th><th className="pr-3">State</th><th className="pr-3">Last seen</th><th /></tr></thead>
            <tbody>
              {kiosks.map((k) => (
                <tr key={k.id} className="border-t border-subtle">
                  <td className="py-2 pr-3">{k.label}</td>
                  <td className="pr-3">{k.siteName}</td>
                  <td className="pr-3">{k.paired ? 'Paired' : k.awaitingPairing ? 'Waiting to pair' : 'Not paired'}{k.pinLocked ? ' · PIN locked' : ''}</td>
                  <td className="pr-3">{k.lastSeenAt ? new Date(k.lastSeenAt).toLocaleString() : '—'}</td>
                  <td className="text-right whitespace-nowrap">{canChange && (
                    <>
                      <button className="text-primary-600 mr-3" disabled={busy} onClick={() => void act(async () => {
                        const r = await axiosClient.post(`/kiosk/admin/devices/${k.id}/pairing-code`);
                        setCode({ label: k.label, code: r.data.pairingCode, until: r.data.pairingExpiresAt });
                      })}>New pairing code</button>
                      <button className="text-danger-600 dark:text-danger-400 inline-flex items-center gap-1" disabled={busy} onClick={() => setRevoke(k)}>
                        <Trash2 className="w-4 h-4" /> Revoke
                      </button>
                    </>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canChange && (
        <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 items-end" onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            const r = await axiosClient.post('/kiosk/admin/devices', form);
            setCode({ label: r.data.kiosk.label, code: r.data.pairingCode, until: r.data.pairingExpiresAt });
            setForm({ siteId: '', label: '', pin: '' });
          });
        }}>
          <select aria-label="Kiosk site" className={field} value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
            <option value="">Site…</option>
            {active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input aria-label="Kiosk label" placeholder="Label, e.g. Front door" className={field} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <input aria-label="Attendant PIN" placeholder="Attendant PIN (4–8 digits)" inputMode="numeric" type="password" className={field}
            value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} />
          <button type="submit" className="btn-primary" disabled={busy || !form.siteId || form.label.trim().length < 2 || !/^\d{4,8}$/.test(form.pin)}>Add kiosk</button>
        </form>
      )}
      <ConfirmDialog
        open={!!revoke}
        title={`Revoke ${revoke?.label ?? 'this kiosk'}?`}
        consequence="It stops working at once and cannot be paired again. Past check-ins made on it are kept."
        confirmLabel="Revoke"
        onCancel={() => setRevoke(null)}
        onConfirm={() => { const k = revoke; setRevoke(null); if (k) void act(async () => { await axiosClient.delete(`/kiosk/admin/devices/${k.id}`); setCode(null); }); }}
      />
    </section>
  );
};

export default KioskAdminSection;
