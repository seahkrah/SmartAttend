/**
 * Asks the person to confirm who they are before a sensitive action
 * (utils/stepUp.ts). Mounted once, in App.
 */
import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import axiosClient from '../../utils/axiosClient';
import { useStepUpStore } from '../../utils/stepUp';
import { passkeysService, passkeysSupported } from '../../services/passkeysService';

export const StepUpDialog: React.FC = () => {
  const open = useStepUpStore((s) => s.open);
  const settle = useStepUpStore((s) => s.settle);
  const [mode, setMode] = useState<'password' | 'code'>('password');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const close = (ok: boolean) => {
    setValue('');
    setError('');
    setBusy(false);
    settle(ok);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await axiosClient.post('/auth/step-up', mode === 'password' ? { password: value } : { code: value });
      close(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'That did not work. Try again.');
      setValue('');
      setBusy(false);
    }
  };

  const withPasskey = async () => {
    setBusy(true);
    setError('');
    try {
      await passkeysService.stepUp();
      close(true);
    } catch (err: any) {
      if (err?.name !== 'NotAllowedError') setError(err?.response?.data?.error || 'The passkey was not accepted.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[95]" role="dialog" aria-modal="true"
         aria-labelledby="step-up-title">
      <form onSubmit={submit} className="bg-sunken rounded-lg border border-subtle shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center gap-3 p-6 border-b border-subtle">
          <ShieldCheck className="w-6 h-6 text-blue-500 flex-shrink-0" aria-hidden="true" />
          <h2 id="step-up-title" className="text-lg font-bold text-primary">Confirm it is you</h2>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-secondary leading-relaxed">
            This action needs you to confirm who you are, because it is sensitive and you signed in a while ago.
          </p>
          <label className="block text-sm text-secondary" htmlFor="step-up-value">
            {mode === 'password' ? 'Your password' : 'Code from your authenticator app'}
          </label>
          <input
            id="step-up-value"
            type={mode === 'password' ? 'password' : 'text'}
            inputMode={mode === 'code' ? 'numeric' : undefined}
            autoComplete={mode === 'password' ? 'current-password' : 'one-time-code'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full px-3 py-2 bg-sunken border border-strong rounded text-primary"
            autoFocus
            disabled={busy}
          />
          {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
          <button type="button" className="text-sm text-blue-500 underline"
                  onClick={() => { setMode(mode === 'password' ? 'code' : 'password'); setValue(''); setError(''); }}>
            {mode === 'password' ? 'Use an authenticator code instead' : 'Use your password instead'}
          </button>
          {passkeysSupported() && (
            <button type="button" className="block text-sm text-blue-500 underline" onClick={() => void withPasskey()} disabled={busy}>
              Use a passkey
            </button>
          )}
        </div>
        <div className="flex gap-2 p-6 border-t border-subtle bg-card">
          <button type="button" onClick={() => close(false)} disabled={busy}
                  className="flex-1 px-4 py-2 bg-raised text-primary rounded font-medium disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={busy || !value}
                  className="flex-1 px-4 py-2 rounded font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  );
};
