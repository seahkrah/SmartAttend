import { create } from 'zustand';
import { User } from '@jjelotech/types';
import { apiClient } from '../services/api';
import { frontendConfig } from '../config/environment';
import { getUserFriendlyError } from '../utils/errorMessages';
import { useToastStore } from '../components/Toast';

// Prevent concurrent loadUserFromToken calls
let loadUserInProgress = false;

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  /** Resolves with `mfaToken` when the account uses two-factor sign-in: pass it to verifyMfa with a code. */
  login: (email: string, password: string, platform: 'school' | 'corporate') => Promise<SignInStep>;
  superadminLogin: (email: string, password: string) => Promise<SignInStep>;
  verifyMfa: (mfaToken: string, answer: { code?: string; recoveryCode?: string }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  setToken: (token: string) => void;
  clearError: () => void;
  loadUserFromToken: () => Promise<void>;
}

export type SignInStep = { mfaToken?: string };

/** Stores a finished sign-in's tokens and user. */
function signedIn(set: (s: Partial<AuthState>) => void, response: any) {
  localStorage.setItem('accessToken', response.accessToken);
  if (response.refreshToken) localStorage.setItem('refreshToken', response.refreshToken);
  apiClient.setToken(response.accessToken);
  set({
    token: response.accessToken,
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
  const initialToken = localStorage.getItem('accessToken');

  return {
    user: null,
    token: initialToken,
    isLoading: !!initialToken, // Set to true if we have a token to load
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
        const response = await fetch(`${frontendConfig.apiBaseUrl}/auth/login-superadmin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        }).then((res) => res.json());

        if (response.error) {
          throw new Error(response.error);
        }

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
        set({ user: null, token: null, isLoading: false });
      } catch (error) {
        // Clear state even if logout fails
        set({ user: null, token: null, isLoading: false });
      }
    },

    setUser: (user) => set({ user }),

    setToken: (token: string) => {
      localStorage.setItem('accessToken', token);
      set({ token });
    },

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

      const token = localStorage.getItem('accessToken');
      if (!token) {
        console.log('[authStore] ❌ No token found, clearing user');
        set({ user: null, token: null });
        return;
      }

      console.log('[authStore] 🔄 Token found, loading user from /auth/me');
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
          token: token,
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
        // Token is invalid
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        set({ user: null, token: null, isLoading: false, error: 'Session expired' });
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
