/**
 * "Sign in with your school's or company's account": the person gives their
 * organisation's code, sees the identity providers it offers, and is sent to
 * the one they pick (the API redirects onwards). Shown under the sign-in form.
 */
import React, { useState } from 'react';
import { Building2 } from 'lucide-react';
import { apiClient } from '../../services/api';
import { frontendConfig } from '../../config/environment';

interface Provider { id: string; name: string; kind: string }

export const SsoSignIn: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState('');

  const look = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const r = await apiClient.get<{ providers: Provider[] }>(`/auth/sso/providers?tenant=${encodeURIComponent(code.trim())}`);
      setProviders(r.data.providers);
      if (!r.data.providers.length) setError('That organisation has no single sign-on set up. Use your email and password.');
    } catch {
      setError('Could not look that up. Try again.');
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
              className="btn-ghost w-full justify-center inline-flex items-center gap-2 text-sm">
        <Building2 className="w-4 h-4" aria-hidden /> Sign in with your organisation's account
      </button>
    );
  }
  return (
    <div className="space-y-3 border-t border-subtle pt-4">
      <form onSubmit={look} className="flex gap-2 items-end">
        <label className="flex-1 text-sm text-secondary">
          Your school's or company's code
          <input className="input mt-1 w-full" value={code} onChange={(e) => setCode(e.target.value)} maxLength={60} autoFocus />
        </label>
        <button type="submit" className="btn-secondary" disabled={!code.trim()}>Find</button>
      </form>
      {error && <p className="text-sm text-amber-600 dark:text-amber-300" role="status">{error}</p>}
      {providers?.map((p) => (
        // A full navigation: the API sends the browser on to the provider.
        <a key={p.id} className="btn-primary w-full justify-center inline-flex"
           href={`${frontendConfig.apiBaseUrl}/auth/sso/${p.id}/start`}>
          Continue with {p.name}
        </a>
      ))}
    </div>
  );
};

/** What a sign-in that came back with ?sso_error= means, for the sign-in page. */
export function ssoErrorMessage(code: string | null): string {
  switch (code) {
    case null: return '';
    case 'no_account': return 'There is no account for that address here. Ask your administrator to add you.';
    case 'wrong_domain': return 'That sign-in option is not for that email address.';
    case 'unverified_email': return 'Your identity provider has not verified your email address.';
    case 'expired': return 'That sign-in took too long or was already used. Start again.';
    case 'unknown_provider': return 'That sign-in option is no longer available.';
    case 'provider_refused': return 'Your identity provider did not confirm who you are. Try again, or use your password.';
    default: return 'Single sign-on did not work. Try again, or use your password.';
  }
}
