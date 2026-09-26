import React, { useEffect, useRef, useState } from 'react';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { notificationsService, type InboxItem } from '../services/notificationsService';

/**
 * The notification bell.
 *
 * Every layout gets one, because the in-app channel is the only one that
 * works without a tenant configuring anything, and a notice nobody can see is
 * the same as no notice at all.
 *
 * It polls rather than holding a socket open. At a minute's interval that is
 * a handful of small queries per user per hour, which this does not need
 * websocket infrastructure to beat; the interval pauses while the tab is
 * hidden so a forgotten tab is not a background load forever.
 */

const POLL_MS = 60_000;

const NotificationBell: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = async () => {
    try {
      const { notifications, unread: count } = await notificationsService.inbox(false, 20);
      setItems(notifications);
      setUnread(count);
    } catch {
      // A failed poll is not worth a toast every minute; the bell simply does
      // not update until the next one works.
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    // A tab coming back to the foreground should not wait out the interval.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markRead = async (item: InboxItem) => {
    if (item.read_at) return;
    // Optimistic: the request is small and a failure is recoverable on the
    // next poll, so the tick should not lag behind the click.
    setItems((prev) => prev.map((i) =>
      i.id === item.id ? { ...i, read_at: new Date().toISOString() } : i));
    setUnread((n) => Math.max(0, n - 1));
    try {
      await notificationsService.markRead(item.id);
    } catch {
      void load();
    }
  };

  const markAll = async () => {
    try {
      setLoading(true);
      await notificationsService.markAllRead();
      await load();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative rounded-lg p-2 text-secondary transition-colors hover:bg-sunken hover:text-primary"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-96 overflow-hidden rounded-xl border border-subtle bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
            <p className="text-sm font-semibold text-primary">Notifications</p>
            {unread > 0 && (
              <button
                onClick={() => void markAll()}
                disabled={loading}
                className="inline-flex items-center gap-1 text-xs text-secondary hover:text-primary disabled:opacity-50"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                Nothing yet.
              </p>
            ) : (
              <ul className="divide-y divide-subtle">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => void markRead(item)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-sunken ${
                        item.read_at ? 'opacity-60' : ''
                      }`}
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          item.read_at ? 'bg-transparent' : 'bg-brand-500'
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-primary">
                          {item.subject}
                        </span>
                        <span className="mt-0.5 block text-xs text-secondary line-clamp-2">
                          {item.body}
                        </span>
                        <span className="mt-1 block text-[11px] text-muted">
                          {new Date(item.created_at).toLocaleString()} · {item.category}
                        </span>
                      </span>
                      {item.read_at && <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-muted" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-subtle px-4 py-2">
            <button
              onClick={() => { setOpen(false); navigate('/settings'); }}
              className="text-xs text-secondary hover:text-primary"
            >
              Notification settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
