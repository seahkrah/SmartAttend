/**
 * In-App Confirmation Dialog
 * 
 * A light-themed confirmation modal to replace browser's native confirm().
 * Usage:
 * 
 *   const { showConfirmDialog, ConfirmDialog } = useConfirmDialog();
 * 
 *   const handleDelete = async (item) => {
 *     const confirmed = await showConfirmDialog({
 *       title: 'Delete Item?',
 *       message: `Are you sure you want to delete "${item.name}"?`,
 *       confirmText: 'Delete',
 *       danger: true,
 *     });
 *     if (!confirmed) return;
 *     // proceed with delete...
 *   };
 * 
 *   return <>{/* page content *\/}<ConfirmDialog /></>;
 */

import React, { useState, useCallback, useRef } from 'react';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const showConfirmDialog = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setOptions(opts);
    });
  }, []);

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    resolveRef.current = null;
    setOptions(null);
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    resolveRef.current = null;
    setOptions(null);
  }, []);

  const ConfirmDialog: React.FC = () => {
    if (!options) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
        <div className="bg-card rounded-lg shadow-xl max-w-md w-full">
          {/* Header */}
          <div className={`px-6 py-4 border-b ${options.danger ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-500/15' : 'border-subtle bg-sunken'} rounded-t-lg`}>
            <h3 className={`text-lg font-semibold ${options.danger ? 'text-red-900 dark:text-red-300' : 'text-primary'}`}>
              {options.title}
            </h3>
          </div>

          {/* Body */}
          <div className="px-6 py-4">
            <p className="text-sm text-secondary leading-relaxed">{options.message}</p>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-subtle flex justify-end gap-3 bg-sunken rounded-b-lg">
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm font-medium text-secondary bg-card border border-subtle rounded-lg hover:bg-sunken focus:outline-none focus:ring-2 focus:ring-gray-300"
              autoFocus
            >
              {options.cancelText || 'Cancel'}
            </button>
            <button
              onClick={handleConfirm}
              className={`px-4 py-2 text-sm font-medium text-primary rounded-lg focus:outline-none focus:ring-2 ${
                options.danger
                  ? 'bg-red-600 hover:bg-red-700 focus:ring-red-300'
                  : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-300'
              }`}
            >
              {options.confirmText || 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return { showConfirmDialog, ConfirmDialog };
}
