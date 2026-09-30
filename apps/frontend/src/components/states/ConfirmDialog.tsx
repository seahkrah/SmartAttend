import React from 'react';
import { Trash2 } from 'lucide-react';

/**
 * Destructive confirmation — screen 6c.
 *
 * The mockup requires the word DELETE to be typed before the action is
 * available, and states plainly what happens to the data ("Attendance history
 * will be archived, not deleted"). Both matter: the typed confirmation stops
 * reflexive clicks, and naming the consequence is what makes the choice
 * informed.
 */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What is affected and what becomes of it. Be specific — counts help. */
  consequence: React.ReactNode;
  /** Word the user must type. Omit for a dialog with no typed confirmation. */
  confirmWord?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  consequence,
  confirmWord,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
  busy = false,
}) => {
  const [typed, setTyped] = React.useState('');

  // Clear the box whenever the dialog opens, so a previous attempt does not
  // leave it pre-confirmed.
  React.useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const satisfied = !confirmWord || typed.trim().toUpperCase() === confirmWord.toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-950/60" onClick={onCancel} aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="relative bg-card border border-subtle rounded-xl shadow-modal w-full max-w-md p-5"
      >
        <div className="flex gap-3">
          <span className="w-10 h-10 rounded-lg bg-danger-50 dark:bg-danger-600/15 text-danger-600 dark:text-danger-400 flex items-center justify-center flex-shrink-0">
            <Trash2 className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h2 id="confirm-title" className="font-semibold text-primary">
              {title}
            </h2>
            <div className="text-sm text-secondary mt-1">{consequence}</div>
          </div>
        </div>

        {confirmWord && (
          <div className="mt-4">
            <div className="rounded-lg bg-danger-50 dark:bg-danger-600/10 px-3 py-2 text-sm text-danger-600 dark:text-danger-400">
              Type <strong className="font-bold">{confirmWord}</strong> to confirm this action.
            </div>
            <input
              className="input-field mt-2"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={confirmWord}
              aria-label={`Type ${confirmWord} to confirm`}
              autoFocus
            />
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} className="btn-secondary" disabled={busy}>
            Cancel
          </button>
          <button onClick={onConfirm} className="btn-danger" disabled={!satisfied || busy}>
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
