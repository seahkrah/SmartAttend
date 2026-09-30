import React from 'react';
import { AlertTriangle, Inbox, Lock, type LucideIcon } from 'lucide-react';

/**
 * Page states — screen 6c, "the kit every page reuses".
 *
 * Four states, one shape: empty, loading, error and no-access. Every list and
 * detail page is expected to use these rather than inventing its own, so the
 * product reads as one system.
 */

const Frame: React.FC<{
  icon: LucideIcon;
  tone: 'neutral' | 'danger' | 'warning';
  title: string;
  body?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ icon: Icon, tone, title, body, children }) => {
  const tones = {
    neutral: 'bg-sunken text-muted',
    danger: 'bg-danger-50 text-danger-600 dark:bg-danger-600/15 dark:text-danger-400',
    warning: 'bg-accent-50 text-accent-800 dark:bg-accent-500/15 dark:text-accent-300',
  };

  return (
    <div className="card flex flex-col items-start gap-3 max-w-sm">
      <span className={`w-10 h-10 rounded-lg flex items-center justify-center ${tones[tone]}`}>
        <Icon className="w-5 h-5" />
      </span>
      <div>
        <h3 className="font-semibold text-primary">{title}</h3>
        {body && <div className="text-sm text-secondary mt-1">{body}</div>}
      </div>
      {children && <div className="flex flex-wrap gap-2 pt-1">{children}</div>}
    </div>
  );
};

export const EmptyState: React.FC<{
  title: string;
  description?: React.ReactNode;
  icon?: LucideIcon;
  children?: React.ReactNode;
}> = ({ title, description, icon = Inbox, children }) => (
  <Frame icon={icon} tone="neutral" title={title} body={description}>
    {children}
  </Frame>
);

/** Skeleton rows. Matches the mockup's loading card. */
export const LoadingState: React.FC<{ label?: string; rows?: number }> = ({
  label = 'Loading...',
  rows = 3,
}) => (
  <div className="card max-w-sm" role="status" aria-live="polite">
    <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-3">Loading</p>
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-sunken animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 rounded bg-sunken animate-pulse" style={{ width: `${70 - i * 12}%` }} />
            <div className="h-2.5 rounded bg-sunken animate-pulse" style={{ width: `${45 - i * 8}%` }} />
          </div>
        </div>
      ))}
    </div>
    <p className="text-sm text-muted mt-4">{label}</p>
  </div>
);

/**
 * An error the user can retry.
 *
 * `reference` is the support code the mockup shows ("Ref ERR/26/8841") — worth
 * surfacing so a report can be traced to a specific failure.
 */
export const ErrorState: React.FC<{
  title?: string;
  description?: React.ReactNode;
  reference?: string;
  onRetry?: () => void;
  onReport?: () => void;
}> = ({
  title = "Couldn't load this",
  description = "The server didn't respond in time. Any unsaved work is kept locally.",
  reference,
  onRetry,
  onReport,
}) => (
  <Frame icon={AlertTriangle} tone="danger" title={title} body={description}>
    {onRetry && (
      <button onClick={onRetry} className="btn-danger">
        Retry
      </button>
    )}
    {onReport && (
      <button onClick={onReport} className="btn-secondary">
        Report issue
      </button>
    )}
    {reference && <p className="w-full text-xs text-muted pt-1">Ref {reference}</p>}
  </Frame>
);

export const NoAccessState: React.FC<{
  title?: string;
  description?: React.ReactNode;
  onRequestAccess?: () => void;
}> = ({
  title = "You don't have access",
  description = 'This area is restricted to another role at this institution.',
  onRequestAccess,
}) => (
  <Frame icon={Lock} tone="neutral" title={title} body={description}>
    {onRequestAccess && (
      <button onClick={onRequestAccess} className="btn-secondary">
        Request access
      </button>
    )}
  </Frame>
);
