/**
 * Confirmation Dialog Component
 * 
 * Single-step confirmation for destructive actions
 * - Clear warning message
 * - Yes/No buttons (no type-to-confirm for simplicity)
 * - Optional reason field
 * - Auto-focus "No" button (safe default)
 */

import React, { useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

export interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  danger?: boolean; // Red styling for destructive actions
  confirmText?: string;
  cancelText?: string;
  requiresReason?: boolean;
  onConfirm: (reason?: string) => void | Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

/**
 * ConfirmationDialog Component
 * 
 * Usage:
 * ```
 * const [confirmOpen, setConfirmOpen] = useState(false);
 * 
 * <ConfirmationDialog
 *   isOpen={confirmOpen}
 *   title="Delete User?"
 *   message="alice@example.com will be permanently deleted. This cannot be undone."
 *   danger
 *   requiresReason
 *   onConfirm={(reason) => handleDeleteUser(userId, reason)}
 *   onCancel={() => setConfirmOpen(false)}
 * />
 * ```
 */
export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  title,
  message,
  danger = false,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  requiresReason = false,
  onConfirm,
  onCancel,
  isLoading = false
}) => {
  const [reason, setReason] = useState('');

  if (!isOpen) return null;

  const canConfirm = !requiresReason || reason.trim().length > 0;

  const handleConfirm = async () => {
    try {
      await onConfirm(reason || undefined);
      setReason('');
    } catch (error) {
      // Error handled in parent
    }
  };

  const handleCancel = () => {
    setReason('');
    onCancel();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg border border-slate-700 shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className={`flex items-center gap-3 p-6 border-b ${
          danger ? 'border-red-500/30 bg-red-500/5' : 'border-slate-700'
        }`}>
          {danger && <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0" />}
          <h2 className="text-lg font-bold text-white">{title}</h2>
        </div>

        {/* Message */}
        <div className="p-6 space-y-4">
          <p className="text-slate-300 leading-relaxed">{message}</p>

          {/* Optional Reason Field */}
          {requiresReason && (
            <div>
              <label className="block text-sm text-slate-400 mb-2">
                Reason (required)
              </label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Explain why you are taking this action..."
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500 text-sm"
                rows={3}
                disabled={isLoading}
              />
              <p className="text-xs text-slate-500 mt-1">This will be recorded in audit logs.</p>
            </div>
          )}
        </div>

        {/* Footer - Buttons */}
        <div className="flex gap-2 p-6 border-t border-slate-700 bg-slate-900/50">
          <button
            onClick={handleCancel}
            disabled={isLoading}
            className="flex-1 px-4 py-2 bg-slate-600 hover:bg-slate-600/80 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            autoFocus // Safe default: focus Cancel button
          >
            <X className="w-4 h-4" />
            {cancelText}
          </button>

          <button
            onClick={handleConfirm}
            disabled={!canConfirm || isLoading}
            className={`flex-1 px-4 py-2 rounded font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              danger
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                {confirmText}...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                {confirmText}
              </>
            )}
          </button>
        </div>

        {/* Helper Text */}
        <div className="px-6 pb-4">
          <p className="text-xs text-slate-500">
            {danger ? '⚠️ This action cannot be undone' : 'Take your time to review the information above'}
          </p>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// COMMON CONFIRMATION TEMPLATES
// ============================================================================

/**
 * Delete User Confirmation
 */
export const DeleteUserConfirmation = (props: Omit<ConfirmationDialogProps, 'title' | 'message' | 'danger' | 'requiresReason'> & { userName: string }) => (
  <ConfirmationDialog
    {...props}
    title="Delete User?"
    message={`${props.userName} will be permanently deleted. All their records will be archived but inaccessible. This cannot be undone.`}
    danger
    requiresReason
    confirmText="Delete"
  />
);

/**
 * Suspend Tenant Confirmation
 */
export const SuspendTenantConfirmation = (props: Omit<ConfirmationDialogProps, 'title' | 'message' | 'danger' | 'requiresReason'> & { tenantName: string }) => (
  <ConfirmationDialog
    {...props}
    title="Suspend Organization?"
    message={`${props.tenantName} will be suspended. All users will be immediately logged out. New activity will be blocked until restoration. This action is reversible.`}
    danger
    requiresReason
    confirmText="Suspend"
  />
);

/**
 * Lock Attendance Confirmation
 */
export const LockAttendanceConfirmation = (props: Omit<ConfirmationDialogProps, 'title' | 'message'>) => (
  <ConfirmationDialog
    {...props}
    title="Finalize Attendance?"
    message="Once finalized, this attendance cannot be edited. Double-check that all absences and lates are correct."
    confirmText="Finalize"
  />
);

/**
 * Unlock User Confirmation
 */
export const UnlockUserConfirmation = (props: Omit<ConfirmationDialogProps, 'title' | 'message' | 'requiresReason'> & { userName: string }) => (
  <ConfirmationDialog
    {...props}
    title="Unlock User?"
    message={`${props.userName} will be able to log in again. Any security concerns should be addressed separately.`}
    requiresReason
    confirmText="Unlock"
  />
);

/**
 * Bulk Action Confirmation
 */
export const BulkActionConfirmation = (props: Omit<ConfirmationDialogProps, 'title' | 'message'> & { action: string; count: number }) => (
  <ConfirmationDialog
    {...props}
    title="Confirm Bulk Action?"
    message={`You are about to ${props.action} for ${props.count} record(s). Review this action carefully.`}
    confirmText="Proceed"
  />
);

export default ConfirmationDialog;
