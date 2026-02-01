import { create } from 'zustand';
import { User } from '@smartattend/types';
import { apiClient } from '../services/api';
import { getUserFriendlyError } from '../utils/errorMessages';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string, platform: 'school' | 'corporate') => Promise<void>;
  register: (email: string, password: string, fullName: string, platform: 'school' | 'corporate', phone?: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  clearError: () => void;
  loadUserFromToken: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('accessToken'),
  isLoading: false,
  error: null,

  login: async (email: string, password: string, platform: 'school' | 'corporate') => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.login(platform, email, password);
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
    } catch (error: any) {
      const errorMessage = getUserFriendlyError(error);
      set({ error: errorMessage, isLoading: false });
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
    } catch (error: any) {
      const errorMessage = getUserFriendlyError(error);
      set({ error: errorMessage, isLoading: false });
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

  clearError: () => set({ error: null }),

  loadUserFromToken: async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      set({ user: null, token: null });
      return;
    }

    set({ isLoading: true, token });
    try {
      const user = await apiClient.getCurrentUser();
      set({
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
      // Token is invalid
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      set({ user: null, token: null, isLoading: false, error: 'Session expired' });
    }
  },
}));
