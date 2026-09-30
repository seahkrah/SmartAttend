/**
 * Account security: two-factor sign-in with an authenticator app, and a way
 * to the password change. Reached from the shield in the account area of the
 * sidebar, and, for a role that must use two-factor, straight after signing
 * in until it is set up.
 */
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Copy, Download, KeyRound, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { ErrorState, LoadingState } from '../components/states/PageStates';
import { mfaService, type MfaStatus, type Reauth } from '../services/mfaService';
import { useAuthStore } from '../store/authStore';
import { apiClient } from '../services/api';

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';

const errorOf = (e: any, fallback: string) => e?.response?.data?.error ?? fallback;

/** The secret in groups of four, as people type it into an app by hand. */
const grouped = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();

const CodeInput: React.FC<{ id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }> = ({
  id, value, onChange, autoFocus,
}) => (
  <input
    id={id}
    className="input-field font-mono text-center text-xl tracking-[0.4em] max-w-[14rem]"
    placeholder="000000"
    inputMode="numeric"
    autoComplete="one-time-code"
    maxLength={6}
    autoFocus={autoFocus}
    value={value}
    onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
  />
);

/** Shown once, right after they are made: the person must keep them now. */
const RecoveryCodes: React.FC<{ codes: string[]; onDone: () => void }> = ({ codes, onDone }) => {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = `JJELOTECH SYSTEMS recovery codes\nEach works once, in place of an authenticator code.\n\n${codes.join('\n')}\n`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* the codes are on screen */ }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'jjelotech-recovery-codes.txt' });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="card space-y-4" aria-labelledby="codes-heading">
      <h2 id="codes-heading" className="text-lg font-semibold text-primary">Save your recovery codes</h2>
      <p className="text-sm text-secondary">
        If you lose your phone, each of these signs you in once instead of a code. Keep them somewhere safe, apart
        from your phone: a password manager, or printed. <strong className="text-primary">They will not be shown again.</strong>
      </p>
      <ol className="grid grid-cols-2 gap-2 font-mono text-base bg-sunken rounded-lg p-4 max-w-sm">
        {codes.map((c) => <li key={c} className="text-primary tracking-wider">{c}</li>)}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={copy}>
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={download}>
          <Download className="w-4 h-4" /> Download
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm text-secondary">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="w-4 h-4" />
        I have saved these codes
      </label>
      <button type="button" className="btn-primary" disabled={!saved} onClick={onDone}>Done</button>
    </section>
  );
};

/** Scan, confirm with a code, then save the recovery codes. */
const Setup: React.FC<{ onEnabled: (codes: string[]) => void; onCancel: () => void }> = ({ onEnabled, onCancel }) => {
  const setToken = useAuthStore((s) => s.setToken);
  const [secret, setSecret] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const s = await mfaService.setup();
        setSecret(s);
        // Loaded only here: nobody else needs a QR encoder.
        const QRCode = await import('qrcode');
        setQr(await QRCode.toDataURL(s.otpauthUri, { margin: 1, width: 220, errorCorrectionLevel: 'M' }));
      } catch (e) {
        setError(errorOf(e, 'Could not start setup.'));
      }
    })();
  }, []);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await mfaService.enable(code);
      // This session's token may have said "set up two-factor first".
      apiClient.setToken(r.accessToken);
      setToken(r.accessToken);
      onEnabled(r.recoveryCodes);
    } catch (e) {
      setError(errorOf(e, 'That code is not correct.'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-5" aria-labelledby="setup-heading">
      <h2 id="setup-heading" className="text-lg font-semibold text-primary">Set up two-factor sign-in</h2>
      <ol className="space-y-5 text-sm text-secondary list-decimal pl-5">
        <li>
          Install an authenticator app on your phone if you do not have one: Google Authenticator, Microsoft
          Authenticator, 1Password, Bitwarden or any other that supports time-based codes.
        </li>
        <li>
          <p className="mb-3">In the app, add an account and scan this code.</p>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <div className="w-[220px] h-[220px] rounded-lg bg-white p-1 flex items-center justify-center border border-subtle">
              {qr ? <img src={qr} alt="QR code to add JJELOTECH SYSTEMS to your authenticator app" width={220} height={220} />
                  : <span className="text-xs text-slate-500">Preparing…</span>}
            </div>
            {secret && (
              <div className="text-sm">
                <p className="text-muted">Cannot scan? Enter this key instead:</p>
                <p className="font-mono text-primary tracking-wider mt-1 break-all select-all">{grouped(secret.secret)}</p>
                <p className="text-muted mt-1">Time-based, 6 digits.</p>
              </div>
            )}
          </div>
        </li>
        <li>
          <form onSubmit={confirm} className="space-y-3">
            <label htmlFor="setup-code" className="block">Enter the 6-digit code the app now shows.</label>
            <CodeInput id="setup-code" value={code} onChange={setCode} />
            {error && <p role="alert" className="text-danger-600 dark:text-danger-400">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={busy || code.length !== 6 || !secret}>
                {busy ? 'Checking…' : 'Turn on'}
              </button>
              <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
            </div>
          </form>
        </li>
      </ol>
    </section>
  );
};

/** Password plus a code, for turning it off or replacing the recovery codes. */
const ReauthForm: React.FC<{
  title: string; action: string; danger?: boolean;
  onSubmit: (proof: Reauth) => Promise<void>; onCancel: () => void;
}> = ({ title, action, danger, onSubmit, onCancel }) => {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(recovery ? { password, recoveryCode: code } : { password, code });
    } catch (err) {
      setError(errorOf(err, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="card space-y-4" aria-label={title}>
      <h2 className="text-lg font-semibold text-primary">{title}</h2>
      <div>
        <label htmlFor="reauth-password" className="block text-sm text-secondary mb-1">Your password</label>
        <input id="reauth-password" type="password" className="input-field max-w-sm" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <div>
        <label htmlFor="reauth-code" className="block text-sm text-secondary mb-1">
          {recovery ? 'A recovery code' : 'A code from your authenticator app'}
        </label>
        {recovery
          ? <input id="reauth-code" className="input-field font-mono uppercase max-w-[14rem]" value={code}
              onChange={(e) => setCode(e.target.value)} autoComplete="off" required />
          : <CodeInput id="reauth-code" value={code} onChange={setCode} />}
        <button type="button" className="block text-sm text-primary-700 dark:text-primary-400 hover:underline mt-1"
          onClick={() => { setRecovery(!recovery); setCode(''); }}>
          {recovery ? 'Use the authenticator app' : 'Use a recovery code instead'}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-danger-600 dark:text-danger-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy || !password || !code}>
          {busy ? 'Working…' : action}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
};

type Mode = 'view' | 'setup' | 'codes' | 'disable' | 'regenerate';

export const AccountSecurityPage: React.FC = () => {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('view');
  const [codes, setCodes] = useState<string[]>([]);

  const load = async () => {
    setError('');
    try { setStatus(await mfaService.status()); } catch (e) { setError(errorOf(e, 'Could not load your security settings.')); }
  };
  useEffect(() => { document.title = 'Account security · JJELOTECH SYSTEMS'; void load(); }, []);

  if (error) return <div className="p-4 sm:p-6"><ErrorState description={error} onRetry={() => void load()} /></div>;
  if (!status) return <div className="p-4 sm:p-6"><LoadingState label="Loading…" /></div>;

  const mustSetUp = status.required && !status.enabled;
  const showCodes = (c: string[]) => { setCodes(c); setMode('codes'); };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold text-primary">Account security</h1>
        <p className="text-sm text-secondary mt-1">How you sign in, and what protects your account if your password is stolen.</p>
      </header>

      {mustSetUp && mode === 'view' && (
        <div role="alert" className="flex gap-3 p-4 rounded-lg border border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-200 text-sm">
          <ShieldAlert className="w-5 h-5 shrink-0" aria-hidden />
          <p>
            Your role requires two-factor sign-in. {params.get('required') ? 'Set it up to continue using the system.' : 'Set it up below.'}
          </p>
        </div>
      )}

      {mode === 'setup' && <Setup onEnabled={showCodes} onCancel={() => setMode('view')} />}
      {mode === 'codes' && <RecoveryCodes codes={codes} onDone={() => { setMode('view'); void load(); }} />}
      {mode === 'disable' && (
        <ReauthForm title="Turn off two-factor sign-in" action="Turn off" danger onCancel={() => setMode('view')}
          onSubmit={async (p) => { await mfaService.disable(p); setMode('view'); await load(); }} />
      )}
      {mode === 'regenerate' && (
        <ReauthForm title="Create new recovery codes" action="Create new codes" onCancel={() => setMode('view')}
          onSubmit={async (p) => showCodes(await mfaService.newRecoveryCodes(p))} />
      )}

      {mode === 'view' && (
        <section className="card space-y-4" aria-labelledby="mfa-heading">
          <div className="flex items-start gap-3">
            {status.enabled
              ? <ShieldCheck className="w-6 h-6 text-success-600 dark:text-success-400 shrink-0" aria-hidden />
              : <ShieldOff className="w-6 h-6 text-muted shrink-0" aria-hidden />}
            <div className="flex-1">
              <h2 id="mfa-heading" className="text-lg font-semibold text-primary">
                Two-factor sign-in{' '}
                <span className={status.enabled ? 'badge-success' : 'badge-neutral'}>{status.enabled ? 'On' : 'Off'}</span>
              </h2>
              <p className="text-sm text-secondary mt-1">
                {status.enabled
                  ? `Signing in asks for a code from your authenticator app as well as your password. On since ${formatDate(status.enabledAt)}.`
                  : 'Add a second step to signing in: a code from an app on your phone, which changes every 30 seconds. A stolen password is then not enough to get in.'}
              </p>
              {status.enabled && (
                <p className={`text-sm mt-2 ${status.recoveryCodesLeft <= 3 ? 'text-danger-600 dark:text-danger-400' : 'text-muted'}`}>
                  {status.recoveryCodesLeft} of 10 recovery codes left.
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!status.enabled && (
              <button className="btn-primary inline-flex items-center gap-2" onClick={() => setMode('setup')}>
                <ShieldCheck className="w-4 h-4" /> Set up
              </button>
            )}
            {status.enabled && (
              <button className="btn-secondary inline-flex items-center gap-2" onClick={() => setMode('regenerate')}>
                <KeyRound className="w-4 h-4" /> New recovery codes
              </button>
            )}
            {status.enabled && !status.required && (
              <button className="btn-ghost text-danger-600 dark:text-danger-400" onClick={() => setMode('disable')}>Turn off</button>
            )}
          </div>
          {status.enabled && status.required && (
            <p className="text-xs text-muted">
              Your role requires two-factor sign-in, so it cannot be turned off. For a new phone, ask a superadmin to reset it.
            </p>
          )}
        </section>
      )}

      {mode === 'view' && (
        <section className="card flex items-center justify-between gap-4" aria-labelledby="pw-heading">
          <div>
            <h2 id="pw-heading" className="text-lg font-semibold text-primary">Password</h2>
            <p className="text-sm text-secondary mt-1">Changing it signs you out everywhere else.</p>
          </div>
          <Link to="/change-password" className="btn-secondary whitespace-nowrap">Change password</Link>
        </section>
      )}
    </div>
  );
};

export default AccountSecurityPage;
