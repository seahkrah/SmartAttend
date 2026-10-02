import { create } from 'zustand';
import { User } from '@jjelotech/types';
import { apiClient } from '../services/api';
import { seemsSignedIn, clearStoredSession } from '../utils/sessionRefresh';
import { getUserFriendlyError } from '../utils/errorMessages';
import { useToastStore } from '../components/Toast';

// Prevent concurrent loadUserFromToken calls
let loadUserInProgress = false;

interface AuthState {
  user: User | null;
  /** Whether this browser seems to have a session (its cookies cannot be read to tell). */
  hasSession: boolean;
  isLoading: boolean;
  error: string | null;
  /** Resolves with `mfaToken` when the account uses two-factor sign-in: pass it to verifyMfa with a code. */
  login: (email: string, password: string, platform: 'school' | 'corporate') => Promise<SignInStep>;
  superadminLogin: (email: string, password: string) => Promise<SignInStep>;
  verifyMfa: (mfaToken: string, answer: { code?: string; recoveryCode?: string }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  clearError: () => void;
  loadUserFromToken: () => Promise<void>;
}

export type SignInStep = { mfaToken?: string };

/**
 * Records a finished sign-in. The session itself is in httpOnly cookies the
 * API set; what the page keeps is the user and, in memory, the CSRF token.
 */
function signedIn(set: (s: Partial<AuthState>) => void, response: any) {
  apiClient.signedIn(response);
  set({
    hasSession: true,
    user: {
      id: response.user.id,
      email: response.user.email,
      fullName: response.user.fullName,
      role: response.user.role,
      platform: response.user.platform || 'school',
      mustResetPassword: response.user.mustResetPassword || false,
    },
    isLoading: false,
  });
  if (typeof response.recoveryCodesLeft === 'number' && response.recoveryCodesLeft <= 3) {
    useToastStore.getState().addToast({
      type: 'warning',
      title: 'Recovery codes running low',
      message: `${response.recoveryCodesLeft} left. Create a new set under Account security.`,
      duration: 8000,
    });
  }
}

export const useAuthStore = create<AuthState>((set) => {
  const initialSession = seemsSignedIn();

  return {
    user: null,
    hasSession: initialSession,
    isLoading: initialSession, // true while /auth/me says who is signed in
    error: null,

    login: async (email: string, password: string, platform: 'school' | 'corporate') => {
      set({ isLoading: true, error: null });
      try {
        const response: any = await apiClient.login(platform, email, password);
        if (response.mfaRequired) {
          set({ isLoading: false });
          return { mfaToken: response.mfaToken };
        }
        signedIn(set, response);
        useToastStore.getState().addToast({
          type: 'success',
          title: 'Login successful',
          message: `Welcome back, ${response.user.fullName}!`,
          duration: 4000,
        });
        return {};
      } catch (error: any) {
        const errorMessage = getUserFriendlyError(error);
        set({ error: errorMessage, isLoading: false });
        useToastStore.getState().addToast({
          type: 'error',
          title: 'Login Failed',
          message: errorMessage,
          duration: undefined,
        });
        throw error;
      }
    },

    superadminLogin: async (email: string, password: string) => {
      set({ isLoading: true, error: null });
      try {
        const response: any = await apiClient
          .post('/auth/login-superadmin', { email, password })
          .then((res) => res.data)
          .catch((e: any) => { throw new Error(e?.response?.data?.error || 'Superadmin login failed'); });

        if (response.mfaRequired) {
          set({ isLoading: false });
          return { mfaToken: response.mfaToken };
        }
        signedIn(set, response);
        useToastStore.getState().addToast({
          type: 'success',
          title: 'Superadmin login successful',
          message: `Welcome, ${response.user.fullName}!`,
          duration: 4000,
        });
        return {};
      } catch (error: any) {
        const errorMessage = error.message || 'Superadmin login failed';
        set({ error: errorMessage, isLoading: false });
        useToastStore.getState().addToast({
          type: 'error',
          title: 'Superadmin Login Failed',
          message: errorMessage,
          duration: undefined,
        });
        throw error;
      }
    },

    verifyMfa: async (mfaToken, answer) => {
      set({ isLoading: true, error: null });
      try {
        const response: any = await apiClient.verifyMfa(mfaToken, answer);
        signedIn(set, response);
      } catch (error: any) {
        set({ error: getUserFriendlyError(error), isLoading: false });
        throw error;
      }
    },

    logout: async () => {
      set({ isLoading: true });
      try {
        await apiClient.logout();
        set({ user: null, hasSession: false, isLoading: false });
      } catch (error) {
        // Clear state even if logout fails
        set({ user: null, hasSession: false, isLoading: false });
      }
    },

    setUser: (user) => set({ user }),

    clearError: () => set({ error: null }),

    loadUserFromToken: async () => {
      // Log call stack to see where this is being called from
      console.log('[authStore] 🔄 loadUserFromToken called from:');
      console.trace();

      // Prevent concurrent calls to loadUserFromToken
      if (loadUserInProgress) {
        console.log('[authStore] ⚠️ Already loading user from token, skipping concurrent call');
        return;
      }

      if (!seemsSignedIn()) {
        console.log('[authStore] ❌ No session, clearing user');
        set({ user: null, hasSession: false });
        return;
      }

      console.log('[authStore] 🔄 Session found, loading user from /auth/me');
      loadUserInProgress = true;
      set({ isLoading: true });

      try {
        const user = await apiClient.getCurrentUser();
        console.log('[authStore] ✅ User loaded from /auth/me:', {
          id: user.id,
          email: user.email,
          role: user.role,
          platform: user.platform,
        });
        set({
          hasSession: true,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            role: user.role,
            platform: user.platform,
            mustResetPassword: user.mustResetPassword || false,
          },
          isLoading: false,
        });
      } catch (error) {
        console.error('[authStore] ❌ Failed to load user from /auth/me:', error);
        // The session has ended
        clearStoredSession();
        set({ user: null, hasSession: false, isLoading: false, error: 'Session expired' });
        // Only worth saying where the person was actually using their session.
        // A stale token left in the browser from weeks ago would otherwise
        // greet a visitor to the home page or the access-request form with
        // "Session expired, please log in".
        const PUBLIC = ['/', '/login', '/login-superadmin', '/register', '/register-superadmin',
          '/forgot-password', '/reset-password', '/activate'];
        if (!PUBLIC.includes(window.location.pathname)) {
          useToastStore.getState().addToast({
            type: 'warning',
            title: 'Session Expired',
            message: 'Please log in again to continue',
            duration: 5000,
          });
        }
      } finally {
        loadUserInProgress = false;
        console.log('[authStore] 🔓 Finished loading user, lock released');
      }
    },
  };
});
