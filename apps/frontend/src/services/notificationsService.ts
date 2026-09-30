import { axiosClient } from '../utils/axiosClient';

/**
 * Notification delivery: inbox, preferences, channels, templates and the outbox.
 *
 * The tenant is never sent. It is resolved server-side from the authenticated
 * identity, so nothing here takes a tenant id and nothing here could send one.
 */

export type Channel = 'email' | 'sms' | 'push' | 'in_app';
export type ProviderName = 'smtp' | 'webhook' | 'in_app' | 'log';

/**
 * 'simulated' is its own outcome, not a kind of success.
 *
 * It means the message was rendered, addressed and recorded, and went
 * nowhere, because the tenant has no real transport configured on that
 * channel. The UI must never show it as sent.
 */
export type MessageStatus =
  | 'pending' | 'sending' | 'sent' | 'simulated' | 'failed' | 'cancelled' | 'suppressed';

export const CHANNELS: Channel[] = ['in_app', 'email', 'sms', 'push'];

export const CHANNEL_LABEL: Record<Channel, string> = {
  in_app: 'In app',
  email: 'Email',
  sms: 'SMS',
  push: 'Push',
};

export interface InboxItem {
  id: string;
  category: string;
  subject: string;
  body: string;
  status: string;
  read_at: string | null;
  created_at: string;
  message_id: string | null;
  event_key: string | null;
}

export interface Preference {
  category: string;
  channel: Channel;
  enabled: boolean;
  /** Account and system messages carry account recovery and cannot be off. */
  locked: boolean;
}

export interface ChannelSetting {
  channel: Channel;
  provider: ProviderName;
  isEnabled: boolean;
  config: Record<string, unknown>;
  /** The NAME of an environment variable. Never the secret itself. */
  secretEnvVar: string | null;
  secretIsSet: boolean | null;
  fromName: string | null;
  fromAddress: string | null;
  replyTo: string | null;
  hourlyLimit: number | null;
  ready: boolean;
  reason: string | null;
}

export interface TemplateChannel {
  channel: Channel;
  category: string;
  required: string[];
  variables: string[];
  source: 'tenant' | 'default';
  subject: string | null;
  body: string;
  templateId: string | null;
  isActive: boolean;
}

export interface TemplateEvent {
  eventKey: string;
  channels: TemplateChannel[];
}

export interface OutboxMessage {
  id: string;
  channel: Channel;
  category: string;
  event_key: string | null;
  destination: string;
  recipient_name: string | null;
  recipient_full_name: string | null;
  subject: string | null;
  /** Present on the detail endpoint; the list omits it to stay small. */
  body?: string;
  status: MessageStatus;
  attempts: number;
  max_attempts: number;
  provider: ProviderName | null;
  provider_message_id: string | null;
  last_error: string | null;
  next_attempt_at: string;
  sent_at: string | null;
  failed_at: string | null;
  created_at: string;
  related_type: string | null;
  related_id: string | null;
}

export interface DeliveryAttempt {
  id: string;
  attempt: number;
  status: 'sent' | 'simulated' | 'failed';
  provider: ProviderName;
  provider_message_id: string | null;
  provider_response: string | null;
  error: string | null;
  duration_ms: number | null;
  occurred_at: string;
}

export interface Suppression {
  id: string;
  channel: Channel;
  destination: string;
  reason: string;
  note: string | null;
  created_by_name: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface NotificationsOverview {
  byStatus: Record<string, number>;
  byChannel: Array<{
    channel: Channel;
    total: number;
    sent: number;
    simulated: number;
    failed: number;
    pending: number;
  }>;
  channels: Array<{ channel: Channel; provider: ProviderName; ready: boolean; reason: string | null }>;
  recentFailures: Array<{
    id: string;
    channel: Channel;
    event_key: string | null;
    destination: string;
    last_error: string | null;
    attempts: number;
    failed_at: string | null;
  }>;
  suppressed: number;
}

export interface SweepResult {
  claimed: number;
  sent: number;
  simulated: number;
  failed: number;
  requeued: number;
}

export const notificationsService = {
  // --------------------------------------------------------------- inbox
  async inbox(unreadOnly = false, limit = 50): Promise<{ notifications: InboxItem[]; unread: number }> {
    const { data } = await axiosClient.get('/notifications/inbox', {
      params: { unread: unreadOnly ? 'true' : undefined, limit },
    });
    return data;
  },

  async markRead(id: string): Promise<void> {
    await axiosClient.post(`/notifications/inbox/${id}/read`, {});
  },

  async markAllRead(): Promise<number> {
    const { data } = await axiosClient.post('/notifications/inbox/read-all', {});
    return data.marked;
  },

  // --------------------------------------------------------- preferences
  async preferences(): Promise<Preference[]> {
    const { data } = await axiosClient.get('/notifications/preferences');
    return data.preferences;
  },

  async setPreference(category: string, channel: Channel, enabled: boolean): Promise<void> {
    await axiosClient.put('/notifications/preferences', { category, channel, enabled });
  },

  // ------------------------------------------------------------ channels
  async channels(): Promise<ChannelSetting[]> {
    const { data } = await axiosClient.get('/notifications/channels');
    return data.channels;
  },

  async saveChannel(channel: Channel, input: {
    provider: ProviderName;
    isEnabled?: boolean;
    config?: Record<string, unknown>;
    /** The NAME of an environment variable; the server refuses a secret here. */
    secretEnvVar?: string | null;
    fromName?: string | null;
    fromAddress?: string | null;
    replyTo?: string | null;
    hourlyLimit?: number | null;
  }): Promise<{ ready: boolean; reason: string | null }> {
    const { data } = await axiosClient.put(`/notifications/channels/${channel}`, input);
    return { ready: data.ready, reason: data.reason };
  },

  /** Sends a test to the caller's own address. It cannot be redirected. */
  async testChannel(channel: Channel): Promise<{
    summary: { queued: unknown[]; skipped: Array<{ reason: string }> };
    result: { status: MessageStatus; provider: string; last_error: string | null;
              provider_response: string | null } | null;
  }> {
    const { data } = await axiosClient.post(`/notifications/channels/${channel}/test`, {});
    return data;
  },

  // ----------------------------------------------------------- templates
  async templates(): Promise<TemplateEvent[]> {
    const { data } = await axiosClient.get('/notifications/templates');
    return data.events;
  },

  async saveTemplate(input: {
    eventKey: string;
    channel: Channel;
    subject?: string | null;
    body: string;
    isActive?: boolean;
  }): Promise<void> {
    await axiosClient.put('/notifications/templates', input);
  },

  async deleteTemplate(templateId: string): Promise<void> {
    await axiosClient.delete(`/notifications/templates/${templateId}`);
  },

  async preview(input: {
    eventKey: string;
    channel: Channel;
    subject?: string | null;
    body?: string;
    data?: Record<string, unknown>;
  }): Promise<{ subject: string | null; body: string; missing: string[]; required: string[] }> {
    const { data } = await axiosClient.post('/notifications/templates/preview', input);
    return data;
  },

  // -------------------------------------------------------------- outbox
  async messages(filters?: {
    status?: MessageStatus;
    channel?: Channel;
    eventKey?: string;
    relatedId?: string;
  }): Promise<{ messages: OutboxMessage[]; byStatus: Record<string, number> }> {
    const { data } = await axiosClient.get('/notifications/messages', { params: filters });
    return data;
  },

  async message(id: string): Promise<{ message: OutboxMessage; attempts: DeliveryAttempt[] }> {
    const { data } = await axiosClient.get(`/notifications/messages/${id}`);
    return data;
  },

  async retry(id: string): Promise<void> {
    await axiosClient.post(`/notifications/messages/${id}/retry`, {});
  },

  async cancel(id: string): Promise<void> {
    await axiosClient.post(`/notifications/messages/${id}/cancel`, {});
  },

  async dispatch(): Promise<SweepResult> {
    const { data } = await axiosClient.post('/notifications/dispatch', {});
    return data.swept;
  },

  // -------------------------------------------------------- suppressions
  async suppressions(): Promise<Suppression[]> {
    const { data } = await axiosClient.get('/notifications/suppressions');
    return data.suppressions;
  },

  async suppress(channel: Channel, destination: string, reason = 'manual', note?: string): Promise<void> {
    await axiosClient.post('/notifications/suppressions', { channel, destination, reason, note });
  },

  async unsuppress(id: string): Promise<void> {
    await axiosClient.delete(`/notifications/suppressions/${id}`);
  },

  async overview(): Promise<NotificationsOverview> {
    const { data } = await axiosClient.get('/notifications/overview');
    return data;
  },
};
