import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Mail, Send } from 'lucide-react';
import { apiClient } from '../services/api';
import { AuthShell, FormProblems } from '../components/auth/AuthShell';

/**
 * Asks for a reset link. The answer is the same whether or not the address
 * has an account, so this page says the same thing either way.
 */
export const ForgotPasswordPage: React.FC = () => {
  const [params] = useSearchParams();
  const [email, setEmail] = React.useState('');
  const [platform, setPlatform] = React.useState<'school' | 'corporate'>(
    params.get('platform') === 'corporate' ? 'corporate' : 'school'
  );
  const [sent, setSent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiClient.post('/auth/password/forgot', { email: email.trim(), platform });
      setSent(res.data.message);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Could not send the request. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell subtitle="Reset your password">
      {sent ? (
        <div className="space-y-4">
          <p className="text-primary" role="status">{sent}</p>
          <p className="text-sm text-secondary">
            Check your inbox and spam folder. If nothing arrives, your organisation may not have email set up;
            ask your administrator to reset access for you.
          </p>
          <Link to="/login" className="btn-primary w-full justify-center inline-flex">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Platform">
            {(['school', 'corporate'] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={platform === p}
                onClick={() => setPlatform(p)}
                className={`py-2 rounded-lg border text-sm font-medium ${platform === p
                  ? 'border-primary-500 bg-primary-500/20 text-primary' : 'border-subtle text-secondary'}`}>
                {p === 'school' ? 'School' : 'Employer'}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-secondary mb-2">Email address</label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 w-5 h-5 text-muted" />
              <input id="email" type="email" required autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)} className="input-field pl-10" placeholder="you@example.com" />
            </div>
          </div>
          <FormProblems error={error} />
          <button type="submit" disabled={busy || !email}
            className="btn-primary w-full justify-center inline-flex items-center gap-2 disabled:opacity-50">
            <Send className="w-4 h-4" />{busy ? 'Sending…' : 'Send reset link'}
          </button>
          <p className="text-center text-sm text-secondary">
            <Link to="/login" className="text-primary-700 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">Back to sign in</Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
};

export default ForgotPasswordPage;
