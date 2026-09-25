import React from 'react';
import { Copy, Check, Mail, Link2, X } from 'lucide-react';

export interface InvitationResult {
  delivery: 'email' | 'simulated' | 'unavailable' | 'handover';
  reason?: string;
  link?: string;
  expiresInDays: number;
}

interface Props {
  personName: string;
  /** What happened when the account was created; null when opened from a list. */
  invitation: InvitationResult | null;
  /** Issues a new invitation; `handover` asks for the link instead of an email. */
  issue: (handover: boolean) => Promise<InvitationResult>;
  onClose: () => void;
}

/**
 * Tells an administrator how a new person will get into their account, and
 * lets them hand over a one-time setup link when email is not available.
 * The administrator never sees or chooses the person's password.
 */
export const InvitationDialog: React.FC<Props> = ({ personName, invitation, issue, onClose }) => {
  const [current, setCurrent] = React.useState<InvitationResult | null>(invitation);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const run = async (handover: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setCurrent(await issue(handover));
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not issue the invitation.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!current?.link) return;
    try {
      await navigator.clipboard.writeText(current.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed; select the link and copy it by hand.');
    }
  };

  const days = current?.expiresInDays ?? 7;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4" role="dialog"
      aria-modal="true" aria-labelledby="invitation-title">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 space-y-4">
        <div className="flex items-start justify-between">
          <h2 id="invitation-title" className="text-lg font-semibold text-white">Account access for {personName}</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {current?.delivery === 'email' && (
          <p className="text-slate-200 text-sm">
            <Mail className="inline w-4 h-4 mr-1" />
            We have emailed {personName} a link to choose their password. It works once and expires in {days} days.
          </p>
        )}

        {(current?.delivery === 'simulated' || current?.delivery === 'unavailable') && (
          <div className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            {current.reason ?? 'The invitation email could not be sent.'}
          </div>
        )}

        {current?.delivery === 'handover' && current.link && (
          <div className="space-y-2">
            <p className="text-sm text-slate-200">
              Give this link to {personName} in person or through a channel you trust. It lets whoever opens it
              set the password, works once, and expires in {days} days. Any earlier link has stopped working.
            </p>
            <div className="flex gap-2">
              <input readOnly value={current.link} aria-label="Setup link"
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 text-xs font-mono"
                onFocus={(e) => e.currentTarget.select()} />
              <button onClick={copy} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm inline-flex items-center gap-1">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {!current && (
          <p className="text-sm text-slate-300">
            {personName} has not set up their account yet. Send a new invitation; any earlier link stops working.
          </p>
        )}

        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

        <div className="flex flex-wrap gap-2 justify-end pt-2">
          {current?.delivery !== 'handover' && (
            <button disabled={busy} onClick={() => run(true)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-sm inline-flex items-center gap-2 disabled:opacity-50">
              <Link2 className="w-4 h-4" />Get a one-time setup link
            </button>
          )}
          {(!current || current.delivery !== 'email') && (
            <button disabled={busy} onClick={() => run(false)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-sm inline-flex items-center gap-2 disabled:opacity-50">
              <Mail className="w-4 h-4" />Email a new invitation
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm">Done</button>
        </div>
      </div>
    </div>
  );
};

export default InvitationDialog;
