import React, { useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { useToastStore } from './Toast';
import { getErrorMessage } from '../utils/errorHandler';
import {
  notificationsService, CHANNELS, CHANNEL_LABEL,
  type Channel, type Preference,
} from '../services/notificationsService';

/**
 * What a person receives, and where.
 *
 * Dropped into any settings page. Every category and channel is shown rather
 * than only the rows that exist, because no stored row means "yes" — a UI
 * listing only stored preferences would show an empty page to somebody
 * receiving everything.
 *
 * Account and system rows are shown locked rather than hidden. They carry
 * password resets and the administrator's own channel tests, so they cannot
 * be switched off, and saying so is better than quietly omitting them and
 * leaving somebody to wonder why they still get the emails.
 */

const CATEGORY_LABEL: Record<string, string> = {
  admissions: 'Admissions',
  fees: 'Fees and invoices',
  leave: 'Leave',
  academic: 'Results and academic',
  attendance: 'Attendance',
  account: 'Account and security',
  system: 'System',
  general: 'General',
};

const NotificationPreferences: React.FC = () => {
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const { addToast } = useToastStore();

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      setPreferences(await notificationsService.preferences());
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Could not load your preferences',
        message: getErrorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  };

  const toggle = async (pref: Preference) => {
    if (pref.locked) return;
    const key = `${pref.category}:${pref.channel}`;
    const next = !pref.enabled;

    // Optimistic, with a revert on failure: a checkbox that waits for a round
    // trip before moving feels broken.
    setPreferences((prev) => prev.map((p) =>
      p.category === pref.category && p.channel === pref.channel
        ? { ...p, enabled: next } : p));

    try {
      setSaving(key);
      await notificationsService.setPreference(pref.category, pref.channel, next);
    } catch (error) {
      setPreferences((prev) => prev.map((p) =>
        p.category === pref.category && p.channel === pref.channel
          ? { ...p, enabled: pref.enabled } : p));
      addToast({ type: 'error', title: 'Could not save', message: getErrorMessage(error) });
    } finally {
      setSaving(null);
    }
  };

  const byCategory = useMemo(() => {
    const groups = new Map<string, Map<Channel, Preference>>();
    for (const p of preferences) {
      const row = groups.get(p.category) ?? new Map<Channel, Preference>();
      row.set(p.channel, p);
      groups.set(p.category, row);
    }
    return [...groups.entries()];
  }, [preferences]);

  if (loading) {
    return <p className="text-sm text-muted">Loading your preferences…</p>;
  }

  if (byCategory.length === 0) {
    return <p className="text-sm text-muted">There is nothing to configure yet.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-3">What</th>
            {CHANNELS.map((c) => (
              <th key={c} className="px-4 py-3 text-center">{CHANNEL_LABEL[c]}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-subtle">
          {byCategory.map(([category, row]) => (
            <tr key={category} className="hover:bg-sunken">
              <td className="px-4 py-3 text-primary">
                {CATEGORY_LABEL[category] ?? category}
              </td>
              {CHANNELS.map((channel) => {
                const pref = row.get(channel);
                if (!pref) return <td key={channel} className="px-4 py-3 text-center text-muted">—</td>;
                const key = `${category}:${channel}`;
                return (
                  <td key={channel} className="px-4 py-3 text-center">
                    {pref.locked ? (
                      <span
                        title="Account and system messages carry account recovery and cannot be switched off"
                        className="inline-flex items-center gap-1 text-xs text-muted"
                      >
                        <Lock className="h-3 w-3" /> Always
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={pref.enabled}
                        disabled={saving === key}
                        onChange={() => void toggle(pref)}
                        aria-label={`${CATEGORY_LABEL[category] ?? category} on ${CHANNEL_LABEL[channel]}`}
                        className="h-4 w-4 cursor-pointer accent-brand-600 disabled:opacity-50"
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-subtle bg-card px-4 py-3 text-xs text-muted">
        A channel your institution has not configured will not reach you whatever is set here.
      </p>
    </div>
  );
};

export default NotificationPreferences;
