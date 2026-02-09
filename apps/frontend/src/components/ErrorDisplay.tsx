/**
 * PHASE 11: ERROR/WARNING DISPLAY COMPONENTS
 * 
 * Renders errors with:
 * - Clear messaging
 * - Action items
 * - Dismissible state
 * - Optional technical details (for debugging)
 */

import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, Info, X, ChevronDown } from 'lucide-react';

// ============================================================================
// ERROR ALERT
// ============================================================================

export interface ErrorAlertProps {
  title: string;
  message: string;
  details?: string; // Technical details (expandable)
  action?: {
    label: string;
    onClick: () => void;
  };
  onDismiss?: () => void;
  isDismissible?: boolean;
  severity?: 'error' | 'warning' | 'info';
}

/**
 * ErrorAlert Component
 * 
 * Usage:
 * ```
 * <ErrorAlert
 *   title="Could not create user"
 *   message="This email is already in use. Try a different email."
 *   action={{ label: 'Check existing users', onClick: () => setFilter('email') }}
 * />
 * ```
 */
export const ErrorAlert: React.FC<ErrorAlertProps> = ({
  title,
  message,
  details,
  action,
  onDismiss,
  isDismissible = true,
  severity = 'error'
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  const iconMap = {
    error: <AlertCircle className="w-5 h-5 text-red-400" />,
    warning: <AlertTriangle className="w-5 h-5 text-yellow-400" />,
    info: <Info className="w-5 h-5 text-blue-400" />
  };

  const bgColorMap = {
    error: 'bg-red-500/10 border-red-500/30',
    warning: 'bg-yellow-500/10 border-yellow-500/30',
    info: 'bg-blue-500/10 border-blue-500/30'
  };

  const textColorMap = {
    error: 'text-red-300',
    warning: 'text-yellow-300',
    info: 'text-blue-300'
  };

  return (
    <div className={`p-4 rounded-lg border ${bgColorMap[severity]}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          {iconMap[severity]}
          <div className="flex-1">
            <p className={`font-semibold ${textColorMap[severity]}`}>{title}</p>
            <p className="text-sm text-slate-300 mt-1">{message}</p>

            {/* Action */}
            {action && (
              <button
                onClick={action.onClick}
                className={`text-sm font-medium mt-3 hover:underline ${textColorMap[severity]}`}
              >
                {action.label}
              </button>
            )}
          </div>
        </div>

        {/* Dismiss */}
        {isDismissible && (
          <button
            onClick={() => {
              setIsDismissed(true);
              onDismiss?.();
            }}
            className="mt-1 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Technical Details (expandable) */}
      {details && (
        <div className="mt-4 border-t border-slate-700 pt-4">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-300 transition-colors"
          >
            <ChevronDown
              className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            />
            Technical details
          </button>

          {isExpanded && (
            <pre className="mt-2 p-2 bg-slate-900/50 rounded text-xs text-slate-400 overflow-auto max-h-32">
              {details}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// FIELD ERROR (FORM)
// ============================================================================

export interface FieldErrorProps {
  message?: string;
  touched?: boolean;
  className?: string;
}

/**
 * FieldError Component (for forms)
 * 
 * Usage:
 * ```
 * <input value={email} onChange={...} />
 * <FieldError message={errors.email} touched={touched.email} />
 * ```
 */
export const FieldError: React.FC<FieldErrorProps> = ({ message, touched, className }) => {
  if (!message || !touched) return null;

  return (
    <p className={`text-xs text-red-400 mt-1 flex items-center gap-1 ${className}`}>
      <AlertCircle className="w-3 h-3" />
      {message}
    </p>
  );
};

// ============================================================================
// EMPTY STATE
// ============================================================================

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * EmptyState Component
 * 
 * Usage:
 * ```
 * {courses.length === 0 && (
 *   <EmptyState
 *     title="No courses yet"
 *     message="Create your first course to get started"
 *     action={{ label: 'Create course', onClick: handleCreate }}
 *   />
 * )}
 * ```
 */
export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, message, action }) => (
  <div className="flex flex-col items-center justify-center p-12 text-center">
    {icon && <div className="mb-4 opacity-50">{icon}</div>}
    <p className="text-lg font-semibold text-white mb-2">{title}</p>
    <p className="text-slate-400 mb-6 max-w-md">{message}</p>

    {action && (
      <button
        onClick={action.onClick}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
      >
        {action.label}
      </button>
    )}
  </div>
);

// ============================================================================
// NO RESULTS
// ============================================================================

export interface NoResultsProps {
  searchTerm?: string;
  onClearSearch?: () => void;
}

/**
 * NoResults Component
 * 
 * Shows when search/filter returns zero items
 */
export const NoResults: React.FC<NoResultsProps> = ({ searchTerm, onClearSearch }) => (
  <div className="text-center py-12">
    <p className="text-slate-400 text-lg">
      {searchTerm ? `No results for "${searchTerm}"` : 'No items found'}
    </p>

    {searchTerm && onClearSearch && (
      <button
        onClick={onClearSearch}
        className="mt-4 text-blue-400 hover:text-blue-300 transition-colors underline"
      >
        Clear search
      </button>
    )}
  </div>
);

// ============================================================================
// SUCCESS STATE
// ============================================================================

export interface SuccessStateProps {
  title: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * SuccessState Component
 * 
 * Brief celebration of completed action
 */
export const SuccessState: React.FC<SuccessStateProps> = ({ title, message, action }) => (
  <div className="p-6 rounded-lg bg-green-500/10 border border-green-500/30 text-center">
    <div className="text-4xl mb-3">✓</div>
    <p className="font-semibold text-green-300 text-lg mb-1">{title}</p>
    <p className="text-sm text-slate-300 mb-4">{message}</p>

    {action && (
      <button
        onClick={action.onClick}
        className="text-green-400 hover:text-green-300 font-medium transition-colors"
      >
        {action.label}
      </button>
    )}
  </div>
);

// ============================================================================
// INLINE ERROR (MINIMAL)
// ============================================================================

export interface InlineErrorProps {
  message: string;
  icon?: boolean;
  className?: string;
}

/**
 * InlineError Component
 * 
 * Minimal error display (no dismiss, no details)
 */
export const InlineError: React.FC<InlineErrorProps> = ({ message, icon = true, className }) => (
  <div className={`flex items-center gap-2 p-2 rounded bg-red-500/10 border border-red-500/30 text-red-300 text-xs ${className}`}>
    {icon && <AlertCircle className="w-3 h-3 flex-shrink-0" />}
    {message}
  </div>
);

export default ErrorAlert;
