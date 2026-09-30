import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { apiClient } from '../services/api';
import { PasswordInput } from '../components/PasswordInput';
import { AuthShell, FormProblems, PasswordRules } from '../components/auth/AuthShell';

/**
 * Where an emailed link lands: an invitation to set up a new account, or a
 * password reset. The link's token is taken out of the address bar at once,
 * so it does not linger in history or get copied along with the URL.
 */
export const SetPasswordPage: React.FC<{ mode: 'activate' | 'reset' }> = ({ mode }) => {
  const [params] = useSearchParams();
  const [token] = React.useState(() => params.get('token') ?? '');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [problems, setProblems] = React.useState<string[]>([]);
  const [done, setDone] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (params.get('token')) window.history.replaceState(null, '', window.location.pathname);
  }, [params]);

  const title = mode === 'activate' ? 'Set up your account' : 'Choose a new password';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setProblems([]);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiClient.post(mode === 'activate' ? '/auth/activate' : '/auth/password/reset',
        { token, password, confirmPassword: confirm });
      setDone(res.data.message);
    } catch (err: any) {
      const data = err?.response?.data;
      setError(data?.error ?? 'Something went wrong. Please try again.');
      setProblems(Array.isArray(data?.problems) ? data.problems : []);
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthShell subtitle={title}>
        <div className="space-y-4">
          <p className="text-primary">This page needs the link from your email. Open the link again, or ask for a new one.</p>
          <Link to={mode === 'activate' ? '/login' : '/forgot-password'} className="btn-primary w-full justify-center inline-flex">
            {mode === 'activate' ? 'Back to sign in' : 'Request a new link'}
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell subtitle={title}>
        <div className="space-y-4">
          <p className="text-primary" role="status">{done}</p>
          <Link to="/login" className="btn-primary w-full justify-center inline-flex">Sign in</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell subtitle={title}>
      <form onSubmit={submit} className="space-y-5">
        <PasswordInput id="password" name="password" label="New password" value={password}
          onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" />
        <PasswordInput id="confirm" name="confirm" label="Type it again" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} placeholder="The same password" />
        <PasswordRules />
        <FormProblems error={error} problems={problems} />
        {mode === 'reset' && (
          <p className="text-xs text-secondary">Changing your password signs you out on every device.</p>
        )}
        <button type="submit" disabled={busy || !password || !confirm}
          className="btn-primary w-full justify-center inline-flex items-center gap-2 disabled:opacity-50">
          <KeyRound className="w-4 h-4" />{busy ? 'Saving…' : mode === 'activate' ? 'Set password' : 'Change password'}
        </button>
      </form>
    </AuthShell>
  );
};

export default SetPasswordPage;
