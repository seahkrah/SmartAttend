/**
 * Toast Notification System
 * 
 * Provides feedback for all state changes:
 * - Success (action completed)
 * - Error (action failed)
 * - Warning (unexpected behavior)
 * - Info (confirmation of async actions started)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  duration?: number; // ms, null = persistent
}

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearAll: () => void;
}

/**
 * Global toast store
 */
export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = Math.random().toString(36).substr(2, 9);
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));

    // Auto-dismiss after duration
    if (toast.duration !== null) {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, toast.duration ?? 4000);
    }
  },
  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
  clearAll: () => {
    set({ toasts: [] });
  }
}));

/**
 * Toast Item Component
 */
const ToastItem: React.FC<{ toast: Toast; onRemove: (id: string) => void }> = ({ toast, onRemove }) => {
  const iconMap = {
    success: <CheckCircle2 className="w-5 h-5 text-green-400" />,
    error: <AlertCircle className="w-5 h-5 text-red-400" />,
    warning: <AlertTriangle className="w-5 h-5 text-yellow-400" />,
    info: <Info className="w-5 h-5 text-blue-400" />
  };

  const bgColorMap = {
    success: 'bg-green-500/10 border-green-500/30',
    error: 'bg-red-500/10 border-red-500/30',
    warning: 'bg-yellow-500/10 border-yellow-500/30',
    info: 'bg-blue-500/10 border-blue-500/30'
  };

  const textColorMap = {
    success: 'text-green-300',
    error: 'text-red-300',
    warning: 'text-yellow-300',
    info: 'text-blue-300'
  };

  return (
    <div className={`flex items-start gap-4 p-4 rounded-lg border ${bgColorMap[toast.type]} animate-slide-in`}>
      {iconMap[toast.type]}

      <div className="flex-1">
        <p className={`font-semibold ${textColorMap[toast.type]}`}>{toast.title}</p>
        {toast.message && <p className="text-sm text-slate-400 mt-1">{toast.message}</p>}

        {toast.action && (
          <button
            onClick={() => {
              toast.action!.onClick();
              onRemove(toast.id);
            }}
            className={`text-sm font-medium mt-2 hover:underline ${textColorMap[toast.type]}`}
          >
            {toast.action.label}
          </button>
        )}
      </div>

      <button
        onClick={() => onRemove(toast.id)}
        className="mt-1 text-slate-500 hover:text-slate-300 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

/**
 * Toast Container (mount once in App.tsx)
 */
export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore();

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onRemove={removeToast} />
        </div>
      ))}
    </div>
  );
};

// ============================================================================
// CONVENIENCE HOOKS
// ============================================================================

/**
 * Hook to show success toast
 */
export function useSuccessToast() {
  const addToast = useToastStore((state) => state.addToast);
  return (title: string, message?: string) => {
    addToast({ type: 'success', title, message });
  };
}

/**
 * Hook to show error toast
 */
export function useErrorToast() {
  const addToast = useToastStore((state) => state.addToast);
  return (title: string, message?: string) => {
    addToast({ type: 'error', title, message, duration: null }); // Persistent
  };
}

/**
 * Hook to show warning toast
 */
export function useWarningToast() {
  const addToast = useToastStore((state) => state.addToast);
  return (title: string, message?: string) => {
    addToast({ type: 'warning', title, message, duration: 6000 });
  };
}

/**
 * Hook to show info toast
 */
export function useInfoToast() {
  const addToast = useToastStore((state) => state.addToast);
  return (title: string, message?: string) => {
    addToast({ type: 'info', title, message });
  };
}

// ============================================================================
// COMMON TOAST TEMPLATES
// ============================================================================

export const toastTemplates = {
  // Success
  userCreated: (name: string) => ({
    type: 'success' as ToastType,
    title: `${name} created`,
    message: 'The new user can now log in'
  }),

  attendanceMarked: (count: number) => ({
    type: 'success' as ToastType,
    title: `Attendance saved`,
    message: `${count} student(s) marked`
  }),

  attendanceSubmitted: () => ({
    type: 'success' as ToastType,
    title: 'Attendance submitted',
    message: 'You can still edit before finalizing'
  }),

  attendanceLockedSuccess: () => ({
    type: 'success' as ToastType,
    title: 'Attendance finalized',
    message: 'No further edits are allowed'
  }),

  // Warnings
  allPresentMarked: () => ({
    type: 'warning' as ToastType,
    title: 'Everyone marked present',
    message: 'Most real classes have at least some absences. Is this expected?',
    duration: 6000
  }),

  allAbsentMarked: () => ({
    type: 'warning' as ToastType,
    title: 'Everyone marked absent',
    message: 'Is this class fully canceled? This is unusual.',
    duration: 6000
  }),

  futureDate: () => ({
    type: 'warning' as ToastType,
    title: 'Future date selected',
    message: 'You are marking attendance for a date that hasn\'t occurred yet',
    duration: 5000
  }),

  partialSuccess: (success: number, failed: number) => ({
    type: 'warning' as ToastType,
    title: `${success} succeeded, ${failed} failed`,
    message: 'Review the errors and try again',
    duration: null // Persistent
  }),

  // Errors
  networkError: () => ({
    type: 'error' as ToastType,
    title: 'Connection lost',
    message: 'Please check your internet connection',
    duration: null
  }),

  sessionExpired: () => ({
    type: 'error' as ToastType,
    title: 'Session expired',
    message: 'Your login has ended. Please log in again.',
    duration: null
  }),

  notAuthorized: () => ({
    type: 'error' as ToastType,
    title: 'Not authorized',
    message: 'You don\'t have permission for this action',
    duration: null
  }),

  // Info
  actionStarted: (action: string) => ({
    type: 'info' as ToastType,
    title: `${action}...`,
    message: 'Please wait while we process your request',
    duration: null
  }),

  importStarted: (count: number) => ({
    type: 'info' as ToastType,
    title: 'Import started',
    message: `Processing ${count} records...`,
    duration: null
  })
};

export default useToastStore;
