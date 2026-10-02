/**
 * Where the identity provider's sign-in comes back to (/sso/complete#code=…).
 * The one-time code is in the fragment, which no server sees; this page
 * trades it for the session (the API sets the cookies) and goes on, or asks
 * for the authenticator code when the account uses one.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { MfaCodeStep } from '../components/auth/MfaCodeStep';
import { LoadingState } from '../components/states/PageStates';

export const SsoCompletePage: React.FC = () => {
  const navigate = useNavigate();
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const code = new URLSearchParams(window.location.hash.slice(1)).get('code') ?? '';
    // Out of the address bar and the history at once.
    window.history.replaceState(null, '', '/sso/complete');
    apiClient.post('/auth/sso/complete', { code })
      .then(async (r) => {
        if (r.data.mfaRequired) { setMfaToken(r.data.mfaToken); return; }
        apiClient.signedIn(r.data);
        await useAuthStore.getState().loadUserFromToken();
        navigate('/dashboard', { replace: true });
      })
      .catch((e) => setError(e?.response?.data?.error || 'Single sign-on did not work. Try again, or use your password.'));
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-md">
        {mfaToken ? (
          <MfaCodeStep mfaToken={mfaToken} onDone={() => navigate('/dashboard', { replace: true })}
                       onRestart={() => navigate('/login', { replace: true })} />
        ) : error ? (
          <div className="space-y-4">
            <p role="alert" className="text-danger-600 dark:text-danger-400">{error}</p>
            <button className="btn-primary" onClick={() => navigate('/login', { replace: true })}>Back to sign-in</button>
          </div>
        ) : (
          <LoadingState label="Signing you in…" />
        )}
      </div>
    </div>
  );
};

export default SsoCompletePage;
