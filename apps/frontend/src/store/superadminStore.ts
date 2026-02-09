/**
 * Superadmin Store
 * 
 * State:
 * - System diagnostics
 * - Tenant list
 * - Locked users
 * - Audit trail
 */

import { create } from 'zustand';
import { useToastStore } from '../components/Toast';
import superadminService, {
  SystemDiagnostics,
  TenantInfo,
  LockedUserInfo,
  AuditLogEntry
} from '../services/superadminService';

export interface SuperadminState {
  // Data
  diagnostics: SystemDiagnostics | null;
  tenants: TenantInfo[];
  lockedUsers: LockedUserInfo[];
  auditTrail: AuditLogEntry[];
  auditTotal: number;

  // Loading/Error
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchDiagnostics: () => Promise<void>;
  fetchTenants: () => Promise<void>;
  fetchLockedUsers: () => Promise<void>;
  fetchAuditTrail: (limit?: number, offset?: number) => Promise<void>;
  createTenant: (name: string, type: 'SCHOOL' | 'CORPORATE') => Promise<void>;
  suspendTenant: (tenantId: string, reason: string) => Promise<void>;
  restoreTenant: (tenantId: string) => Promise<void>;
  unlockUser: (userId: string, reason: string) => Promise<void>;
  clearError: () => void;
}

export const useSuperadminStore = create<SuperadminState>((set, get) => ({
  diagnostics: null,
  tenants: [],
  lockedUsers: [],
  auditTrail: [],
  auditTotal: 0,
  isLoading: false,
  error: null,

  fetchDiagnostics: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await superadminService.getSystemDiagnostics();
      set({ diagnostics: data, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  fetchTenants: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await superadminService.listTenants();
      set({ tenants: data, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  fetchLockedUsers: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await superadminService.getLockedUsers();
      set({ lockedUsers: data, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  fetchAuditTrail: async (limit = 100, offset = 0) => {
    set({ isLoading: true, error: null });
    try {
      const data = await superadminService.getAuditTrail(limit, offset);
      set({ auditTrail: data.entries, auditTotal: data.total, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  createTenant: async (name, type) => {
    set({ isLoading: true, error: null });
    try {
      await superadminService.createTenant({ name, type });
      get().fetchTenants();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'Organization created',
        message: `${name} has been added to the system`,
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to create organization',
        message: error.message,
        duration: null
      });
    }
  },

  suspendTenant: async (tenantId, reason) => {
    set({ isLoading: true, error: null });
    try {
      await superadminService.suspendTenant(tenantId, reason);
      get().fetchTenants();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'warning',
        title: 'Organization suspended',
        message: 'All users have been logged out. Activity is blocked.',
        duration: 5000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to suspend organization',
        message: error.message,
        duration: null
      });
    }
  },

  restoreTenant: async (tenantId) => {
    set({ isLoading: true, error: null });
    try {
      await superadminService.restoreTenant(tenantId);
      get().fetchTenants();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'Organization restored',
        message: 'Users can now log in again',
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to restore organization',
        message: error.message,
        duration: null
      });
    }
  },

  unlockUser: async (userId, reason) => {
    set({ isLoading: true, error: null });
    try {
      await superadminService.unlockUser(userId, reason);
      get().fetchLockedUsers();
      set({ isLoading: false });
      useToastStore.getState().addToast({
        type: 'success',
        title: 'User unlocked',
        message: 'User can now log in again',
        duration: 4000
      });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      useToastStore.getState().addToast({
        type: 'error',
        title: 'Failed to unlock user',
        message: error.message,
        duration: null
      });
    }
  },

  clearError: () => set({ error: null })
}));
