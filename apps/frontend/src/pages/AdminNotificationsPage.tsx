import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell, Send, AlertTriangle, CheckCircle2, Ban, RefreshCw, Play,
  FileText, Radio, ShieldOff, X, Undo2, Info,
} from 'lucide-react';
import { useToastStore } from '../components/Toast';
import { useConfirmDialog } from '../components/useConfirmDialog';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState } from '../components/ErrorDisplay';
import {
  notificationsService, CHANNELS, CHANNEL_LABEL,
  type Channel, type ChannelSetting, type OutboxMessage, type MessageStatus,
  type TemplateEvent, type TemplateChannel, type Suppression,
  type NotificationsOverview, type DeliveryAttempt, type ProviderName,
} from '../services/notificationsService';

/**
 * Notification delivery — the administrator's console.
 *
 * The thing this page exists to make unmistakable is the difference between
 * sent and simulated. A tenant with no transport configured still gets every
 * message rendered, addressed and recorded, and none of them go anywhere;
 * before the outbox existed that state looked identical to working. So a
 * simulated message is amber and says so in words, and a channel running on
 * the log provider carries a banner rather than a green tick.
 */

const STATUS_STYLE: Record<MessageStatus, string> = {
  pending: 'bg-sunken text-secondary',
  sending: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  sent: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  simulated: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  failed: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  cancelled: 'bg-raised text-muted line-through',
  suppressed: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
};

const STATUS_LABEL: Record<MessageStatus, string> = {
  pending: 'Waiting',
  sending: 'Sending',
  sent: 'Sent',
  simulated: 'Not sent (simulated)',
  failed: 'Failed',
  cancelled: 'Cancelled',
  suppressed: 'Suppressed',
};

const PROVIDER_LABEL: Record<ProviderName, string> = {
  smtp: 'SMTP',
  webhook: 'Relay (webhook)',
  in_app: 'In-app inbox',
  log: 'Log only — nothing is sent',
};

const PROVIDERS_FOR: Record<Channel, ProviderName[]> = {
  email: ['smtp', 'webhook', 'log'],
  sms: ['webhook', 'log'],
  push: ['webhook', 'log'],
  in_app: ['in_app', 'log'],
};

const AdminNotificationsPage: React.FC = () => {
  const [tab, setTab] = useState<'outbox' | 'channels' | 'templates' | 'suppressions'>('outbox');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [overview, setOverview] = useState<NotificationsOverview | null>(null);
  const [channels, setChannels] = useState<ChannelSetting[]>([]);
  const [messages, setMessages] = useState<OutboxMessage[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [templates, setTemplates] = useState<TemplateEvent[]>([]);
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);

  const [statusFilter, setStatusFilter] = useState<'' | MessageStatus>('');
  const [channelFilter, setChannelFilter] = useState<'' | Channel>('');

  const [detail, setDetail] = useState<{ message: OutboxMessage; attempts: DeliveryAttempt[] } | null>(null);
  const [editingChannel, setEditingChannel] = useState<ChannelSetting | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<
    { eventKey: string; channel: TemplateChannel } | null
  >(null);
  const [preview, setPreview] = useState<{ subject: string | null; body: string; missing: string[] } | null>(null);
  const [showSuppressForm, setShowSuppressForm] = useState(false);

  const { addToast } = useToastStore();
  const { showConfirmDialog, ConfirmDialog } = useConfirmDialog();
  const [channelForm, setChannelForm] = useState({
    provider: 'log' as ProviderName,
    isEnabled: true,
    host: '', port: '587', username: '', url: '',
    secretEnvVar: '', fromName: '', fromAddress: '', replyTo: '', hourlyLimit: '',
  });

  const [templateForm, setTemplateForm] = useState({ subject: '', body: '' });
  const [suppressForm, setSuppressForm] = useState({
    channel: 'email' as Channel, destination: '', reason: 'manual', note: '',
  });

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void loadMessages();
  }, [statusFilter, channelFilter]);

  const load = async () => {
    try {
      setLoading(true);
      const [ov, ch, tpl, sup] = await Promise.all([
        notificationsService.overview(),
        notificationsService.channels(),
        notificationsService.templates().catch(() => [] as TemplateEvent[]),
        notificationsService.suppressions().catch(() => [] as Suppression[]),
      ]);
      setOverview(ov);
      setChannels(ch);
      setTemplates(tpl);
      setSuppressions(sup);
      await loadMessages();
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Could not load notifications',
        message: getErrorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async () => {
    try {
      const { messages: list, byStatus: counts } = await notificationsService.messages({
        status: statusFilter || undefined,
        channel: channelFilter || undefined,
      });
      setMessages(list);
      setByStatus(counts);
    } catch (error) {
      addToast({ type: 'error', title: 'Could not load the outbox', message: getErrorMessage(error) });
    }
  };

  const refresh = async () => {
    try {
      setOverview(await notificationsService.overview());
      setChannels(await notificationsService.channels());
    } catch {
      // Headline figures only; a stale count is not worth an error toast.
    }
  };

  const openChannel = (setting: ChannelSetting) => {
    const c = setting.config as Record<string, any>;
    setChannelForm({
      provider: setting.provider,
      isEnabled: setting.isEnabled,
      host: c.host ? String(c.host) : '',
      port: c.port ? String(c.port) : '587',
      username: c.username ? String(c.username) : '',
      url: c.url ? String(c.url) : '',
      secretEnvVar: setting.secretEnvVar ?? '',
      fromName: setting.fromName ?? '',
      fromAddress: setting.fromAddress ?? '',
      replyTo: setting.replyTo ?? '',
      hourlyLimit: setting.hourlyLimit != null ? String(setting.hourlyLimit) : '',
    });
    setEditingChannel(setting);
  };

  const saveChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChannel) return;
    try {
      setSaving(true);
      const config: Record<string, unknown> = {};
      if (channelForm.provider === 'smtp') {
        config.host = channelForm.host;
        config.port = Number(channelForm.port) || 587;
        if (channelForm.username) config.username = channelForm.username;
      }
      if (channelForm.provider === 'webhook') {
        config.url = channelForm.url;
      }

      const { ready, reason } = await notificationsService.saveChannel(editingChannel.channel, {
        provider: channelForm.provider,
        isEnabled: channelForm.isEnabled,
        config,
        secretEnvVar: channelForm.secretEnvVar || null,
        fromName: channelForm.fromName || null,
        fromAddress: channelForm.fromAddress || null,
        replyTo: channelForm.replyTo || null,
        hourlyLimit: channelForm.hourlyLimit ? Number(channelForm.hourlyLimit) : null,
      });

      setEditingChannel(null);
      setChannels(await notificationsService.channels());
      void refresh();
      addToast({
        type: ready ? 'success' : 'warning',
        title: ready ? 'Channel saved and ready' : 'Channel saved, but it cannot send yet',
        message: reason ?? undefined,
        duration: ready ? undefined : null,
      });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not save', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const testChannel = async (channel: Channel) => {
    try {
      setSaving(true);
      const { summary, result } = await notificationsService.testChannel(channel);

      if (!result) {
        const why = summary.skipped[0]?.reason ?? 'Nothing was queued';
        addToast({ type: 'warning', title: 'No test was sent', message: why, duration: null });
        return;
      }

      if (result.status === 'sent') {
        addToast({ type: 'success', title: `The ${CHANNEL_LABEL[channel]} channel works` });
      } else if (result.status === 'simulated') {
        addToast({
          type: 'warning',
          title: 'Nothing was actually sent',
          message: result.provider_response
            ?? 'This channel is on the log provider, which records messages without sending them.',
          duration: null,
        });
      } else {
        addToast({
          type: 'error',
          title: 'The test failed',
          message: result.last_error ?? 'No reason given',
          duration: null,
        });
      }
      await loadMessages();
      void refresh();
    } catch (error) {
      addToast({ type: 'error', title: 'Could not send a test', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const dispatch = async () => {
    try {
      setSaving(true);
      const swept = await notificationsService.dispatch();
      await loadMessages();
      void refresh();
      addToast({
        type: 'success',
        title: `${swept.claimed} taken from the queue`,
        message: `${swept.sent} sent, ${swept.simulated} simulated, ${swept.failed} failed`,
      });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not run the dispatcher', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const retry = async (id: string) => {
    try {
      await notificationsService.retry(id);
      await loadMessages();
      if (detail?.message.id === id) setDetail(await notificationsService.message(id));
      addToast({ type: 'success', title: 'Back in the queue' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not retry', message: getErrorMessage(error) });
    }
  };

  const cancel = async (id: string) => {
    try {
      await notificationsService.cancel(id);
      await loadMessages();
      addToast({ type: 'success', title: 'Cancelled' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not cancel', message: getErrorMessage(error) });
    }
  };

  const openTemplate = (eventKey: string, channel: TemplateChannel) => {
    setTemplateForm({ subject: channel.subject ?? '', body: channel.body });
    setPreview(null);
    setEditingTemplate({ eventKey, channel });
  };

  const runPreview = async () => {
    if (!editingTemplate) return;
    try {
      // Sample values for every variable the template can use, so the preview
      // shows a finished message rather than a form full of holes.
      const sample: Record<string, string> = {};
      for (const v of editingTemplate.channel.variables) sample[v] = `[${v}]`;
      setPreview(await notificationsService.preview({
        eventKey: editingTemplate.eventKey,
        channel: editingTemplate.channel.channel,
        subject: templateForm.subject || null,
        body: templateForm.body,
        data: sample,
      }));
    } catch (error) {
      addToast({ type: 'error', title: 'Could not preview', message: getErrorMessage(error) });
    }
  };

  const saveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate) return;
    try {
      setSaving(true);
      await notificationsService.saveTemplate({
        eventKey: editingTemplate.eventKey,
        channel: editingTemplate.channel.channel,
        subject: templateForm.subject || null,
        body: templateForm.body,
      });
      setEditingTemplate(null);
      setTemplates(await notificationsService.templates());
      addToast({ type: 'success', title: 'Template saved' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not save the template', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const revertTemplate = async (templateId: string) => {
    const confirmed = await showConfirmDialog({
      title: 'Revert to the standard wording',
      message: 'This removes your version and puts the platform default back. Your text is not kept.',
      confirmText: 'Revert',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await notificationsService.deleteTemplate(templateId);
      setEditingTemplate(null);
      setTemplates(await notificationsService.templates());
      addToast({ type: 'success', title: 'Reverted to the standard wording' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not revert', message: getErrorMessage(error) });
    }
  };

  const addSuppression = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suppressForm.destination) return;
    try {
      setSaving(true);
      await notificationsService.suppress(
        suppressForm.channel, suppressForm.destination,
        suppressForm.reason, suppressForm.note || undefined
      );
      setShowSuppressForm(false);
      setSuppressForm({ channel: 'email', destination: '', reason: 'manual', note: '' });
      setSuppressions(await notificationsService.suppressions());
      addToast({ type: 'success', title: 'Address suppressed' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not suppress', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const unsuppress = async (s: Suppression) => {
    const confirmed = await showConfirmDialog({
      title: 'Write to this address again?',
      message: `${s.destination} was suppressed (${s.reason}). Writing to a genuinely dead address again harms delivery for every other message from this institution.`,
      confirmText: 'Lift it',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await notificationsService.unsuppress(s.id);
      setSuppressions((prev) => prev.filter((x) => x.id !== s.id));
      addToast({ type: 'success', title: 'Suppression lifted' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not lift it', message: getErrorMessage(error) });
    }
  };

  const simulatedCount = byStatus.simulated ?? 0;
  const logChannels = useMemo(
    () => channels.filter((c) => c.provider === 'log' && c.isEnabled),
    [channels]
  );

  if (loading) {
    return (
      <>
        <LoadingOverlay message="Loading notifications…" />
      </>
    );
  }

  return (
    <>
      <ConfirmDialog />

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Notifications</h1>
          <p className="mt-1 text-sm text-secondary">
            How this institution reaches people, and what it has actually sent.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void loadMessages()}
            className="inline-flex items-center gap-2 rounded-lg border border-subtle px-3 py-2 text-sm text-primary hover:bg-sunken"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={() => void dispatch()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-40"
          >
            <Play className="h-4 w-4" />
            Send queued now
          </button>
        </div>
      </div>

      {/* The banner this whole module exists for. */}
      {logChannels.length > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/25 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div>
            <p className="font-medium text-amber-700 dark:text-amber-200">
              Nothing is actually being sent on{' '}
              {logChannels.map((c) => CHANNEL_LABEL[c.channel]).join(', ')}
            </p>
            <p className="mt-1 text-sm text-secondary">
              {simulatedCount > 0
                ? `${simulatedCount} message${simulatedCount === 1 ? ' has' : 's have'} been rendered and recorded without leaving the system. `
                : 'Messages on these channels are rendered and recorded without leaving the system. '}
              Configure a provider under Channels to start delivering them.
            </p>
          </div>
        </div>
      )}

      {overview && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Sent" value={overview.byStatus.sent ?? 0} icon={CheckCircle2} tone="emerald" />
          <Card label="Simulated — not sent" value={overview.byStatus.simulated ?? 0} icon={Info} tone="amber" />
          <Card label="Waiting" value={overview.byStatus.pending ?? 0} icon={Send} />
          <Card label="Failed" value={overview.byStatus.failed ?? 0} icon={AlertTriangle} tone="rose" />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-subtle pb-3">
        {([
          ['outbox', 'Outbox'], ['channels', 'Channels'],
          ['templates', 'Templates'], ['suppressions', 'Suppressed'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === key ? 'bg-sunken text-primary' : 'text-secondary hover:text-primary'
            }`}
          >
            {label}
          </button>
        ))}
        {tab === 'outbox' && (
          <div className="ml-auto flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as '' | MessageStatus)}
              className={inputClass}
            >
              <option value="">Any status</option>
              {(Object.keys(STATUS_LABEL) as MessageStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as '' | Channel)}
              className={inputClass}
            >
              <option value="">Any channel</option>
              {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------- outbox */}
      {tab === 'outbox' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
          <div>
            {messages.length === 0 ? (
              <EmptyState
                icon={<Bell className="h-8 w-8" />}
                title="Nothing has been sent yet"
                message="Messages queued by admissions, fees, leave and results appear here."
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-subtle">
                <table className="w-full text-sm">
                  <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-3">To</th>
                      <th className="px-4 py-3">About</th>
                      <th className="px-4 py-3">Channel</th>
                      <th className="px-4 py-3">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-subtle">
                    {messages.map((m) => (
                      <tr
                        key={m.id}
                        onClick={() => void notificationsService.message(m.id).then(setDetail)}
                        className={`cursor-pointer hover:bg-sunken ${
                          detail?.message.id === m.id ? 'bg-sunken' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <p className="text-primary">
                            {m.recipient_full_name ?? m.recipient_name ?? '—'}
                          </p>
                          <p className="truncate text-xs text-muted">{m.destination}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="truncate text-secondary">{m.subject ?? m.event_key ?? '—'}</p>
                          <p className="text-xs text-muted">{m.event_key}</p>
                        </td>
                        <td className="px-4 py-3 text-secondary">{CHANNEL_LABEL[m.channel]}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[m.status]}`}>
                            {STATUS_LABEL[m.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <aside>
            {!detail ? (
              <div className="rounded-xl border border-dashed border-subtle p-8 text-center text-sm text-muted">
                Select a message.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-subtle bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-primary">
                        {detail.message.subject ?? detail.message.event_key}
                      </p>
                      <p className="truncate text-xs text-muted">{detail.message.destination}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[detail.message.status]}`}>
                      {STATUS_LABEL[detail.message.status]}
                    </span>
                  </div>

                  {detail.message.status === 'simulated' && (
                    <p className="mt-3 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/25 p-3 text-xs text-amber-700 dark:text-amber-200">
                      This message was rendered and recorded but not transmitted. The{' '}
                      {CHANNEL_LABEL[detail.message.channel]} channel is on the log provider.
                    </p>
                  )}

                  <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-page p-3 text-xs text-secondary">
                    {detail.message.body ?? ''}
                  </pre>

                  {detail.message.last_error && (
                    <p className="mt-3 text-xs text-rose-700 dark:text-rose-300">{detail.message.last_error}</p>
                  )}

                  <div className="mt-4 flex gap-2">
                    {['failed', 'pending'].includes(detail.message.status) && (
                      <>
                        <button
                          onClick={() => void retry(detail.message.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-subtle px-3 py-1.5 text-xs text-primary hover:bg-sunken"
                        >
                          <Undo2 className="h-3.5 w-3.5" /> Try again
                        </button>
                        <button
                          onClick={() => void cancel(detail.message.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-subtle px-3 py-1.5 text-xs text-rose-700 dark:text-rose-300 hover:bg-sunken"
                        >
                          <Ban className="h-3.5 w-3.5" /> Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {detail.attempts.length > 0 && (
                  <div className="rounded-xl border border-subtle bg-card p-4">
                    <p className="text-xs uppercase tracking-wide text-muted">Attempts</p>
                    <ul className="mt-3 space-y-3">
                      {detail.attempts.map((a) => (
                        <li key={a.id} className="border-l border-subtle pl-3">
                          <p className="text-sm text-primary">
                            #{a.attempt} · {STATUS_LABEL[a.status as MessageStatus]} via{' '}
                            {PROVIDER_LABEL[a.provider]}
                          </p>
                          <p className="text-xs text-muted">
                            {new Date(a.occurred_at).toLocaleString()}
                            {a.duration_ms != null ? ` · ${a.duration_ms}ms` : ''}
                          </p>
                          {(a.error || a.provider_response) && (
                            <p className={`mt-1 text-xs ${a.error ? 'text-rose-700 dark:text-rose-300' : 'text-secondary'}`}>
                              {a.error ?? a.provider_response}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {/* --------------------------------------------------------- channels */}
      {tab === 'channels' && (
        <div className="grid gap-4 md:grid-cols-2">
          {channels.map((c) => (
            <div key={c.channel} className="rounded-xl border border-subtle bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-primary">{CHANNEL_LABEL[c.channel]}</h3>
                  <p className="text-xs text-muted">{PROVIDER_LABEL[c.provider]}</p>
                </div>
                {!c.isEnabled ? (
                  <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-secondary">Off</span>
                ) : c.provider === 'log' ? (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                    Not sending
                  </span>
                ) : c.ready ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                    Ready
                  </span>
                ) : (
                  <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs text-rose-700 dark:text-rose-300">
                    Not ready
                  </span>
                )}
              </div>

              {c.reason && <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{c.reason}</p>}

              {c.fromAddress && (
                <p className="mt-2 text-xs text-secondary">From {c.fromAddress}</p>
              )}

              {c.secretEnvVar && (
                <p className="mt-1 text-xs text-muted">
                  Credential from <code className="text-secondary">{c.secretEnvVar}</code>
                  {c.secretIsSet === false && (
                    <span className="text-rose-700 dark:text-rose-300"> — not set on this server</span>
                  )}
                </p>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => openChannel(c)}
                  className="rounded-lg border border-subtle px-3 py-1.5 text-xs text-primary hover:bg-sunken"
                >
                  Configure
                </button>
                <button
                  onClick={() => void testChannel(c.channel)}
                  disabled={saving || !c.isEnabled}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-subtle px-3 py-1.5 text-xs text-primary hover:bg-sunken disabled:opacity-40"
                >
                  <Radio className="h-3.5 w-3.5" /> Send me a test
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* -------------------------------------------------------- templates */}
      {tab === 'templates' && (
        <div className="space-y-4">
          {templates.map((event) => (
            <div key={event.eventKey} className="rounded-xl border border-subtle bg-card p-4">
              <p className="font-mono text-sm text-secondary">{event.eventKey}</p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {event.channels.map((ch) => (
                  <button
                    key={ch.channel}
                    onClick={() => openTemplate(event.eventKey, ch)}
                    className="rounded-lg border border-subtle p-3 text-left hover:bg-sunken"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-primary">{CHANNEL_LABEL[ch.channel]}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        ch.source === 'tenant'
                          ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300'
                          : 'bg-sunken text-secondary'
                      }`}>
                        {ch.source === 'tenant' ? 'Your wording' : 'Standard'}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted">
                      {ch.subject ? `${ch.subject} — ` : ''}{ch.body}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ----------------------------------------------------- suppressions */}
      {tab === 'suppressions' && (
        <div>
          <div className="mb-3 flex justify-end">
            <button
              onClick={() => setShowSuppressForm(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-subtle px-3 py-2 text-sm text-primary hover:bg-sunken"
            >
              <ShieldOff className="h-4 w-4" /> Suppress an address
            </button>
          </div>

          {suppressions.length === 0 ? (
            <EmptyState
              icon={<ShieldOff className="h-8 w-8" />}
              title="No suppressed addresses"
              message="An address that bounces permanently, or a person who asks not to be written to, appears here."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-subtle">
              <table className="w-full text-sm">
                <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">Address</th>
                    <th className="px-4 py-3">Channel</th>
                    <th className="px-4 py-3">Why</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {suppressions.map((s) => (
                    <tr key={s.id} className="hover:bg-sunken">
                      <td className="px-4 py-3 text-primary">{s.destination}</td>
                      <td className="px-4 py-3 text-secondary">{CHANNEL_LABEL[s.channel]}</td>
                      <td className="px-4 py-3">
                        <p className="text-secondary">{s.reason.replace('_', ' ')}</p>
                        {s.note && <p className="text-xs text-muted">{s.note}</p>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => void unsuppress(s)}
                          className="rounded-lg border border-subtle px-2.5 py-1 text-xs text-secondary hover:bg-sunken"
                        >
                          Lift
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------ modals */}
      {editingChannel && (
        <Modal
          title={`${CHANNEL_LABEL[editingChannel.channel]} channel`}
          onClose={() => setEditingChannel(null)}
        >
          <form onSubmit={saveChannel} className="space-y-3">
            <Field label="Provider">
              <select
                value={channelForm.provider}
                onChange={(e) => setChannelForm({
                  ...channelForm, provider: e.target.value as ProviderName,
                })}
                className={inputClass}
              >
                {PROVIDERS_FOR[editingChannel.channel].map((p) => (
                  <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
                ))}
              </select>
            </Field>

            {channelForm.provider === 'smtp' && (
              <>
                <div className="grid grid-cols-[1fr_100px] gap-3">
                  <Field label="Host">
                    <input required value={channelForm.host}
                      onChange={(e) => setChannelForm({ ...channelForm, host: e.target.value })}
                      placeholder="smtp.example.org" className={inputClass} />
                  </Field>
                  <Field label="Port">
                    <input type="number" value={channelForm.port}
                      onChange={(e) => setChannelForm({ ...channelForm, port: e.target.value })}
                      className={inputClass} />
                  </Field>
                </div>
                <Field label="Username">
                  <input value={channelForm.username}
                    onChange={(e) => setChannelForm({ ...channelForm, username: e.target.value })}
                    className={inputClass} />
                </Field>
              </>
            )}

            {channelForm.provider === 'webhook' && (
              <Field label="Relay URL (https only)">
                <input required type="url" value={channelForm.url}
                  onChange={(e) => setChannelForm({ ...channelForm, url: e.target.value })}
                  placeholder="https://relay.example.org/send" className={inputClass} />
              </Field>
            )}

            {channelForm.provider !== 'log' && channelForm.provider !== 'in_app' && (
              <Field label="Environment variable holding the credential">
                <input value={channelForm.secretEnvVar}
                  onChange={(e) => setChannelForm({ ...channelForm, secretEnvVar: e.target.value })}
                  placeholder="SMTP_PASSWORD" className={inputClass} />
                <p className="mt-1 text-xs text-muted">
                  The name of a variable set on the server — not the password itself. Credentials
                  are never stored in the database.
                </p>
              </Field>
            )}

            {editingChannel.channel === 'email' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From name">
                    <input value={channelForm.fromName}
                      onChange={(e) => setChannelForm({ ...channelForm, fromName: e.target.value })}
                      className={inputClass} />
                  </Field>
                  <Field label="From address">
                    <input type="email" value={channelForm.fromAddress}
                      onChange={(e) => setChannelForm({ ...channelForm, fromAddress: e.target.value })}
                      className={inputClass} />
                  </Field>
                </div>
                <Field label="Reply-to (optional)">
                  <input type="email" value={channelForm.replyTo}
                    onChange={(e) => setChannelForm({ ...channelForm, replyTo: e.target.value })}
                    className={inputClass} />
                </Field>
              </>
            )}

            <Field label="Most messages per hour (optional)">
              <input type="number" min="1" value={channelForm.hourlyLimit}
                onChange={(e) => setChannelForm({ ...channelForm, hourlyLimit: e.target.value })}
                className={inputClass} />
            </Field>

            <label className="flex items-center gap-2 text-sm text-secondary">
              <input type="checkbox" checked={channelForm.isEnabled}
                onChange={(e) => setChannelForm({ ...channelForm, isEnabled: e.target.checked })} />
              This channel is switched on
            </label>

            <FormActions saving={saving} onCancel={() => setEditingChannel(null)} submitLabel="Save" />
          </form>
        </Modal>
      )}

      {editingTemplate && (
        <Modal
          title={`${editingTemplate.eventKey} · ${CHANNEL_LABEL[editingTemplate.channel.channel]}`}
          onClose={() => setEditingTemplate(null)}
        >
          <form onSubmit={saveTemplate} className="space-y-3">
            <p className="text-xs text-muted">
              Available: {editingTemplate.channel.variables.map((v) => `{{ ${v} }}`).join(', ')}
            </p>

            {editingTemplate.channel.channel === 'email' && (
              <Field label="Subject">
                <input required value={templateForm.subject}
                  onChange={(e) => setTemplateForm({ ...templateForm, subject: e.target.value })}
                  className={inputClass} />
              </Field>
            )}

            <Field label="Body">
              <textarea required rows={8} value={templateForm.body}
                onChange={(e) => setTemplateForm({ ...templateForm, body: e.target.value })}
                className={`${inputClass} font-mono text-xs`} />
            </Field>

            <button type="button" onClick={() => void runPreview()}
              className="inline-flex items-center gap-2 rounded-lg border border-subtle px-3 py-1.5 text-xs text-primary hover:bg-sunken">
              <FileText className="h-3.5 w-3.5" /> Preview
            </button>

            {preview && (
              <div className="rounded-lg border border-subtle bg-page p-3">
                {preview.subject && (
                  <p className="mb-2 text-sm font-medium text-primary">{preview.subject}</p>
                )}
                <pre className="whitespace-pre-wrap text-xs text-secondary">{preview.body}</pre>
                {preview.missing.length > 0 && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    Nothing supplied for: {preview.missing.join(', ')}
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-between gap-2 pt-2">
              {editingTemplate.channel.templateId ? (
                <button type="button"
                  onClick={() => void revertTemplate(editingTemplate.channel.templateId!)}
                  className="rounded-lg border border-subtle px-3 py-2 text-sm text-secondary hover:bg-sunken">
                  Revert to standard
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditingTemplate(null)}
                  className="rounded-lg border border-subtle px-4 py-2 text-sm text-secondary hover:bg-sunken">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-40">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {showSuppressForm && (
        <Modal title="Suppress an address" onClose={() => setShowSuppressForm(false)}>
          <form onSubmit={addSuppression} className="space-y-3">
            <p className="text-sm text-secondary">
              Nothing further will be sent to this address on this channel.
            </p>
            <Field label="Channel">
              <select value={suppressForm.channel}
                onChange={(e) => setSuppressForm({
                  ...suppressForm, channel: e.target.value as Channel,
                })}
                className={inputClass}>
                {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
              </select>
            </Field>
            <Field label="Address">
              <input required value={suppressForm.destination}
                onChange={(e) => setSuppressForm({ ...suppressForm, destination: e.target.value })}
                className={inputClass} />
            </Field>
            <Field label="Why">
              <select value={suppressForm.reason}
                onChange={(e) => setSuppressForm({ ...suppressForm, reason: e.target.value })}
                className={inputClass}>
                <option value="manual">Decided here</option>
                <option value="hard_bounce">It bounced permanently</option>
                <option value="complaint">They complained</option>
                <option value="unsubscribed">They asked to stop</option>
                <option value="invalid">The address is not valid</option>
              </select>
            </Field>
            <Field label="Note (optional)">
              <input value={suppressForm.note}
                onChange={(e) => setSuppressForm({ ...suppressForm, note: e.target.value })}
                className={inputClass} />
            </Field>
            <FormActions saving={saving} onCancel={() => setShowSuppressForm(false)} submitLabel="Suppress" />
          </form>
        </Modal>
      )}
    </>
  );
};

const inputClass =
  'w-full rounded-lg border border-subtle bg-card px-3 py-2 text-sm text-primary placeholder:text-muted';

const Card: React.FC<{
  label: string; value: number; icon: React.ElementType; tone?: 'emerald' | 'amber' | 'rose';
}> = ({ label, value, icon: Icon, tone }) => (
  <div className="rounded-xl border border-subtle bg-card p-4">
    <div className="flex items-center justify-between">
      <p className="text-sm text-secondary">{label}</p>
      <Icon className="h-4 w-4 text-muted" />
    </div>
    <p className={`mt-2 text-2xl font-semibold ${
      tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'amber' ? 'text-amber-700 dark:text-amber-300'
      : tone === 'rose' ? 'text-rose-700 dark:text-rose-300'
      : 'text-primary'
    }`}>
      {value}
    </p>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-medium text-secondary">{label}</span>
    {children}
  </label>
);

const FormActions: React.FC<{ saving: boolean; onCancel: () => void; submitLabel: string }> = ({
  saving, onCancel, submitLabel,
}) => (
  <div className="flex justify-end gap-2 pt-2">
    <button type="button" onClick={onCancel}
      className="rounded-lg border border-subtle px-4 py-2 text-sm text-secondary hover:bg-sunken">
      Cancel
    </button>
    <button type="submit" disabled={saving}
      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-40">
      {saving ? 'Saving…' : submitLabel}
    </button>
  </div>
);

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title, onClose, children,
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-subtle bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="truncate text-lg font-semibold text-primary">{title}</h2>
        <button onClick={onClose} className="rounded-lg p-1 text-secondary hover:bg-sunken">
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

export default AdminNotificationsPage;
