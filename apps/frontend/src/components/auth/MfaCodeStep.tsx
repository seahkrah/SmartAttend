import React from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

/**
 * The second step of signing in when the account uses two-factor: the
 * 6-digit code from the person's authenticator app, or one of their recovery
 * codes if the phone is lost.
 */
export const MfaCodeStep: React.FC<{
  mfaToken: string;
  onDone: () => void;
  /** Back to the password step, with a reason when the challenge has ended. */
  onRestart: (reason?: string) => void;
}> = ({ mfaToken, onDone, onRestart }) => {
  const verifyMfa = useAuthStore((s) => s.verifyMfa);
  const [useRecovery, setUseRecovery] = React.useState(false);
  const [value, setValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { inputRef.current?.focus(); }, [useRecovery]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError('');
    try {
      await verifyMfa(mfaToken, useRecovery ? { recoveryCode: value } : { code: value });
      onDone();
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.code === 'MFA_EXPIRED') {
        onRestart(data.error);
        return;
      }
      const left = typeof data?.attemptsLeft === 'number' ? ` ${data.attemptsLeft} ${data.attemptsLeft === 1 ? 'try' : 'tries'} left.` : '';
      setError((data?.error || 'That code is not correct.') + left);
      setValue('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" aria-labelledby="mfa-heading">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-6 h-6 text-primary-600 dark:text-primary-400 shrink-0 mt-0.5" aria-hidden />
        <div>
          <h2 id="mfa-heading" className="text-lg font-semibold text-primary">Two-factor sign-in</h2>
          <p className="text-sm text-secondary mt-1">
            {useRecovery
              ? 'Enter one of the recovery codes you saved when you set up two-factor sign-in. Each works once.'
              : 'Enter the 6-digit code shown in your authenticator app.'}
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="mfa-code" className="block text-sm font-medium text-secondary mb-2">
          {useRecovery ? 'Recovery code' : 'Authentication code'}
        </label>
        {useRecovery ? (
          <input
            ref={inputRef}
            id="mfa-code"
            className="input-field font-mono tracking-widest uppercase"
            placeholder="XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            maxLength={12}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        ) : (
          <input
            ref={inputRef}
            id="mfa-code"
            className="input-field font-mono text-center text-2xl tracking-[0.5em]"
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
            required
          />
        )}
      </div>

      {error && (
        <div role="alert" className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={busy || (!useRecovery && value.length !== 6)}
        className="btn-primary w-full justify-center inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <KeyRound className="w-4 h-4" />
        {busy ? 'Checking...' : 'Verify and sign in'}
      </button>

      <div className="flex justify-between text-sm">
        <button type="button" className="text-muted hover:text-secondary" onClick={() => onRestart()}>
          Back
        </button>
        <button
          type="button"
          className="text-primary-700 dark:text-primary-400 hover:underline font-medium"
          onClick={() => { setUseRecovery(!useRecovery); setValue(''); setError(''); }}
        >
          {useRecovery ? 'Use the authenticator app' : 'Lost your phone? Use a recovery code'}
        </button>
      </div>
    </form>
  );
};
