import { create } from 'zustand';
import { User } from '@smartattend/types';
import { apiClient } from '../services/api';
import { getUserFriendlyError } from '../utils/errorMessages';
import { useToastStore } from '../components/Toast';

// Prevent concurrent loadUserFromToken calls
let loadUserInProgress = false;

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string, platform: 'school' | 'corporate') => Promise<void>;
  superadminLogin: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string, platform: 'school' | 'corporate', phone?: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  setToken: (token: string) => void;
  clearError: () => void;
  loadUserFromToken: () => Promise<void>;
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
        const response = await apiClient.login(platform, email, password);
        console.log('[authStore] Login success, setting user and token');
        set({
          token: response.accessToken,
          user: {
            id: response.user.id,
            email: response.user.email,
            fullName: response.user.fullName,
            role: response.user.role,
            platform: response.user.platform,
          },
          isLoading: false,
        });
        useToastStore.getState().addToast({
          type: 'success',
          title: 'Login successful',
          message: `Welcome back, ${response.user.fullName}!`,
          duration: 4000,
        });
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
        const response = await fetch('http://localhost:5000/api/auth/login-superadmin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        }).then((res) => res.json());

        if (response.error) {
          throw new Error(response.error);
        }

        localStorage.setItem('accessToken', response.accessToken);
        localStorage.setItem('refreshToken', response.refreshToken);

        // CRITICAL: Update apiClient's internal token so subsequent requests include Authorization header
        apiClient.setToken(response.accessToken);

        console.log('[authStore] Superadmin login success, setting user and token');
        set({
          token: response.accessToken,
          user: {
            id: response.user.id,
            email: response.user.email,
            fullName: response.user.fullName,
            role: response.user.role,
            platform: response.user.platform || 'school',
          },
          isLoading: false,
        });
        useToastStore.getState().addToast({
          type: 'success',
          title: 'Superadmin login successful',
          message: `Welcome, ${response.user.fullName}!`,
          duration: 4000,
        });
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

    register: async (email: string, password: string, fullName: string, platform: 'school' | 'corporate', phone?: string) => {
      set({ isLoading: true, error: null });
      try {
        const response = await apiClient.register({
          platform,
          email,
          password,
          confirmPassword: password,
          fullName,
          phone,
        });
        set({
          token: response.accessToken,
          user: {
            id: response.user.id,
            email: response.user.email,
            fullName: response.user.fullName,
            role: response.user.role || 'user',
            platform: response.user.platform,
          },
          isLoading: false,
        });
        useToastStore.getState().addToast({
          type: 'success',
          title: 'Registration successful',
          message: 'Your account has been created. Welcome!',
          duration: 4000,
        });
      } catch (error: any) {
        const errorMessage = getUserFriendlyError(error);
        set({ error: errorMessage, isLoading: false });
        useToastStore.getState().addToast({
          type: 'error',
          title: 'Registration Failed',
          message: errorMessage,
          duration: undefined,
        });
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
          },
          isLoading: false,
        });
      } catch (error) {
        console.error('[authStore] ❌ Failed to load user from /auth/me:', error);
        // Token is invalid
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        set({ user: null, token: null, isLoading: false, error: 'Session expired' });
        useToastStore.getState().addToast({
          type: 'warning',
          title: 'Session Expired',
          message: 'Please log in again to continue',
          duration: 5000,
        });
      } finally {
        loadUserInProgress = false;
        console.log('[authStore] 🔓 Finished loading user, lock released');
      }
    },
  };
});
