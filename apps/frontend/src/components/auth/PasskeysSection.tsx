/**
 * The signed-in person's passkeys, on the Account security page: add one,
 * see when each was last used, remove one. Adding and removing are
 * sensitive, so the API may ask for step-up first (the dialog handles it).
 */
import React, { useEffect, useState } from 'react';
import { Fingerprint, Plus, Trash2 } from 'lucide-react';
import { passkeysService, passkeysSupported, type Passkey } from '../../services/passkeysService';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'never');

export const PasskeysSection: React.FC = () => {
  const [items, setItems] = useState<Passkey[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try { setItems(await passkeysService.list()); } catch { setError('Could not load your passkeys.'); }
  };
  useEffect(() => { void load(); }, []);

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      await passkeysService.add(name.trim() || 'Passkey');
      setName('');
      await load();
    } catch (e: any) {
      // The person closing the device's prompt is not an error worth showing.
      if (e?.name !== 'NotAllowedError') setError(e?.response?.data?.error || 'The passkey was not added.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Passkey) => {
    if (!window.confirm(`Remove the passkey "${p.name}"? It will no longer sign you in.`)) return;
    setError('');
    try { await passkeysService.remove(p.id); await load(); } catch (e: any) {
      setError(e?.response?.data?.error || 'The passkey was not removed.');
    }
  };

  return (
    <section className="card space-y-4" aria-labelledby="passkeys-heading">
      <div className="flex items-start gap-3">
        <Fingerprint className="w-6 h-6 text-primary-600 dark:text-primary-400 shrink-0" aria-hidden />
        <div className="flex-1">
          <h2 id="passkeys-heading" className="text-lg font-semibold text-primary">Passkeys</h2>
          <p className="text-sm text-secondary mt-1">
            Sign in with your phone or computer's fingerprint, face or PIN instead of a password. A passkey only works on
            this site, so a fake sign-in page cannot use it.
          </p>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-danger-600 dark:text-danger-400">{error}</p>}

      {items && items.length > 0 && (
        <ul className="divide-y divide-subtle">
          {items.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <p className="text-primary font-medium">{p.name}</p>
                <p className="text-xs text-muted">
                  Added {when(p.createdAt)} · last used {when(p.lastUsedAt)}{p.synced ? ' · synced across devices' : ''}
                </p>
              </div>
              <button className="btn-ghost text-danger-600 dark:text-danger-400 inline-flex items-center gap-1"
                      onClick={() => void remove(p)} aria-label={`Remove passkey ${p.name}`}>
                <Trash2 className="w-4 h-4" aria-hidden /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {items && items.length === 0 && <p className="text-sm text-muted">You have no passkeys yet.</p>}

      {passkeysSupported() ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm text-secondary">
            Name
            <input className="input mt-1 block" value={name} maxLength={60} placeholder="e.g. My phone"
                   onChange={(e) => setName(e.target.value)} disabled={busy} />
          </label>
          <button className="btn-primary inline-flex items-center gap-2" onClick={() => void add()} disabled={busy}>
            <Plus className="w-4 h-4" aria-hidden /> {busy ? 'Waiting for your device…' : 'Add a passkey'}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted">This browser cannot use passkeys.</p>
      )}
    </section>
  );
};
