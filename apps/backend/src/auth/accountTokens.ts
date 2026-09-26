/**
 * Invitations and password resets.
 *
 * Nobody chooses another person's password. A new account is created with a
 * password nobody knows and an invitation: a single-use link, valid for seven
 * days, emailed to the person, where they choose their own. A forgotten
 * password works the same way with a link valid for thirty minutes.
 *
 * Tokens are 256 random bits; only their SHA-256 is stored. Issuing a new one
 * cancels any unused one of the same kind. Using one ends every session the
 * account had, since whoever knew the old password may still be signed in.
 *
 * The emails go through the tenant's outbox with the 'account' category,
 * which recipients cannot opt out of, and their bodies are withheld from the
 * outbox views administrators can read (routes/notifications.ts).
 */
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { query } from '../db/connection.js'
import { hashToken, revokeUserSessions } from './sessions.js'
import { checkPassword } from './passwordPolicy.js'
import { notify, channelConfig } from '../notifications/service.js'
import { clearMfa } from './mfaService.js'

type Runner = { query: (text: string, params?: any[]) => Promise<any> }
export type TokenPurpose = 'account_activation' | 'password_reset'

const TTL_MINUTES: Record<TokenPurpose, number> = {
  account_activation: 7 * 24 * 60,
  password_reset: 30,
}

export { SENSITIVE_EVENTS } from '../notifications/templates.js'

export class AccountTokenError extends Error {
  constructor(readonly status: number, message: string, readonly problems: string[] = []) {
    super(message)
  }
}

export function appUrl(): string {
  return (process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/$/, '')
}

/** A bcrypt hash of 32 random bytes: a password no one knows or can guess. */
export async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 12)
}

async function issue(runner: Runner, userId: string, purpose: TokenPurpose, createdBy: string | null,
                     ttlMinutes: number = TTL_MINUTES[purpose]) {
  const token = crypto.randomBytes(32).toString('base64url')
  await runner.query(
    `UPDATE auth_tokens SET used_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
    [userId, purpose]
  )
  await runner.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, created_by, expires_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + ($5 || ' minutes')::interval)`,
    [userId, purpose, hashToken(token), createdBy, String(ttlMinutes)]
  )
  return token
}

async function recipientOf(runner: Runner, userId: string) {
  const r = await runner.query(`SELECT id, full_name, email FROM users WHERE id = $1`, [userId])
  const u = r.rows[0]
  if (!u) throw new AccountTokenError(404, 'No such account')
  return { userId: u.id, name: u.full_name, email: u.email, firstName: String(u.full_name ?? '').split(' ')[0] || 'there' }
}

export type InvitationDelivery = 'email' | 'simulated' | 'unavailable' | 'handover'

export interface InvitationResult {
  /** How the invitation reaches the person. */
  delivery: InvitationDelivery
  /** Why it will not arrive by email, when it will not. */
  reason?: string
  /** Only for delivery 'handover': the link to give the person directly. */
  link?: string
  expiresInDays: number
}

/**
 * Invites the owner of an account to set their password.
 *
 * By default the link is emailed and nobody else sees it. When the tenant has
 * no working email (common for a school without a mail provider), the
 * administrator can instead ask for the link itself (`handover`), to give to
 * the person face to face. That is audited by the caller, works only for an
 * account nobody has signed in to yet, and like the emailed link works once.
 */
export async function sendInvitation(
  runner: Runner,
  opts: { userId: string; tenantId: string; invitedBy: string; handover?: boolean }
): Promise<InvitationResult> {
  const expiresInDays = TTL_MINUTES.account_activation / (24 * 60)
  const state = await runner.query(
    `SELECT last_login FROM users WHERE id = $1`,
    [opts.userId]
  )
  if (state.rows.length === 0) throw new AccountTokenError(404, 'No such account')
  if (state.rows[0].last_login) {
    throw new AccountTokenError(409,
      'This person has already signed in. If they have forgotten their password they can reset it from the sign-in page.')
  }

  // An account that has never been signed in to is not usable until the
  // invitation is: its password is whatever the invitation sets.
  await runner.query(`UPDATE users SET activated_at = NULL WHERE id = $1`, [opts.userId])
  const token = await issue(runner, opts.userId, 'account_activation', opts.invitedBy)
  const link = `${appUrl()}/activate?token=${token}`

  if (opts.handover) return { delivery: 'handover', link, expiresInDays }

  const r = await recipientOf(runner, opts.userId)
  const summary = await notify(runner, { tenantId: opts.tenantId, userId: opts.invitedBy }, {
    eventKey: 'account.invitation',
    channels: ['email'],
    recipients: [{ userId: r.userId, name: r.name, email: r.email }],
    data: { firstName: r.firstName, link, validFor: `${expiresInDays} days` },
    priority: 1,
  })
  return { ...(await deliveryOf(runner, opts.tenantId, summary)), expiresInDays }
}

/** What happened to an account email: really sent, only recorded, or not queued at all. */
async function deliveryOf(
  runner: Runner,
  tenantId: string,
  summary: { queued: unknown[]; skipped: Array<{ reason?: string }> }
): Promise<{ delivery: InvitationDelivery; reason?: string }> {
  if (summary.queued.length === 0) {
    return { delivery: 'unavailable', reason: summary.skipped[0]?.reason ?? 'The email could not be queued' }
  }
  const channel = await channelConfig(runner, tenantId, 'email')
  if (channel.provider === 'log') {
    return {
      delivery: 'simulated',
      reason: 'Email is not set up for this organisation, so the message was recorded but not sent. '
        + 'Set up email, or give the person the link directly.',
    }
  }
  if (!channel.isEnabled) return { delivery: 'unavailable', reason: 'Email is switched off for this organisation' }
  return { delivery: 'email' }
}

/** How long an administrator's reset link lasts: long enough to hand over in person. */
const ADMIN_RESET_TTL_MINUTES = 24 * 60

/**
 * An administrator restores access for someone who has lost it.
 *
 * The old password stops working at once and every session ends, so this is
 * also what to do with an account that may be compromised. The person then
 * chooses a new password from a single-use link, valid for 24 hours, that is
 * emailed to them or, with `handover`, given to the administrator to pass on.
 * The administrator never learns or sets the password. The caller audits it
 * and must refuse administrators' accounts.
 */
export async function resetAccessByAdmin(
  runner: Runner,
  opts: { userId: string; tenantId: string; actorId: string; handover?: boolean }
): Promise<InvitationResult> {
  const u = await runner.query(`SELECT activated_at FROM users WHERE id = $1`, [opts.userId])
  if (u.rows.length === 0) throw new AccountTokenError(404, 'No such account')
  if (!u.rows[0].activated_at) {
    throw new AccountTokenError(409, 'This person has not set up their account yet; send them a new invitation instead.')
  }
  await runner.query(
    `UPDATE users SET password_hash = $2, password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [opts.userId, await unusablePasswordHash()]
  )
  await revokeUserSessions(opts.userId, 'access_reset_by_admin')
  // A lost phone is the usual reason for a reset: two-factor goes too, and the
  // person sets it up again after choosing their password.
  await clearMfa(runner, opts.userId)
  const token = await issue(runner, opts.userId, 'password_reset', opts.actorId, ADMIN_RESET_TTL_MINUTES)
  const link = `${appUrl()}/reset-password?token=${token}`
  const expiresInDays = 1
  if (opts.handover) return { delivery: 'handover', link, expiresInDays }

  const r = await recipientOf(runner, opts.userId)
  const summary = await notify(runner, { tenantId: opts.tenantId, userId: opts.actorId }, {
    eventKey: 'account.access_reset',
    channels: ['email'],
    recipients: [{ userId: r.userId, name: r.name, email: r.email }],
    data: { firstName: r.firstName, link, validFor: '24 hours' },
    priority: 1,
  })
  return { ...(await deliveryOf(runner, opts.tenantId, summary)), expiresInDays }
}

/**
 * Starts a password reset for whoever owns this address on this platform.
 * Says nothing about whether the account exists: the caller always answers
 * the same way. A superadmin has no tenant outbox; their reset is issued by
 * another superadmin.
 */
export async function requestPasswordReset(email: string, platformId: string): Promise<void> {
  const u = await query(
    `SELECT u.id FROM users u
      WHERE LOWER(u.email) = LOWER($1) AND u.platform_id = $2
        AND u.is_active = TRUE AND u.activated_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.id = u.role_id AND r.name = 'superadmin')`,
    [String(email ?? '').trim(), platformId]
  )
  if (u.rows.length === 0) return
  const userId = u.rows[0].id
  // One email per account every two minutes, however often it is asked for.
  const recent = await query(
    `SELECT 1 FROM auth_tokens WHERE user_id = $1 AND purpose = 'password_reset'
        AND created_at > CURRENT_TIMESTAMP - INTERVAL '2 minutes'`,
    [userId]
  )
  if (recent.rows.length > 0) return
  const m = await query(
    `SELECT tenant_id FROM user_tenant_memberships WHERE user_id = $1 AND status = 'active' LIMIT 1`,
    [userId]
  )
  if (m.rows.length === 0) return
  const token = await issue({ query }, userId, 'password_reset', null)
  const r = await recipientOf({ query }, userId)
  await notify({ query }, { tenantId: m.rows[0].tenant_id, userId: null }, {
    eventKey: 'account.password_reset',
    channels: ['email'],
    recipients: [{ userId: r.userId, name: r.name, email: r.email }],
    data: { firstName: r.firstName, link: `${appUrl()}/reset-password?token=${token}`, validFor: '30 minutes' },
    priority: 1,
  })
}

/**
 * Spends a token and sets the password it was issued for. Atomic: the token
 * is marked used in the same statement that finds it, so it works once.
 */
export async function redeemToken(purpose: TokenPurpose, token: string, password: string): Promise<{ userId: string }> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
    throw new AccountTokenError(400, 'This link is not valid')
  }
  const owner = await query(
    `SELECT u.id, u.email, u.full_name FROM auth_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.purpose = $2`,
    [hashToken(token), purpose]
  )
  if (owner.rows.length === 0) throw new AccountTokenError(400, 'This link is not valid')
  const problems = checkPassword(password, { email: owner.rows[0].email, name: owner.rows[0].full_name })
  if (problems.length > 0) throw new AccountTokenError(400, 'Choose a stronger password', problems)

  const spent = await query(
    `UPDATE auth_tokens SET used_at = CURRENT_TIMESTAMP
      WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
      RETURNING user_id`,
    [hashToken(token), purpose]
  )
  if (spent.rows.length === 0) {
    throw new AccountTokenError(410, 'This link has expired or has already been used. Ask for a new one.')
  }
  const userId = spent.rows[0].user_id
  const hash = await bcrypt.hash(password, 12)
  await query(
    `UPDATE users
        SET password_hash = $2, must_reset_password = FALSE, password_changed_at = CURRENT_TIMESTAMP,
            activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [userId, hash]
  )
  await revokeUserSessions(userId, purpose === 'password_reset' ? 'password_reset' : 'account_activated')
  return { userId }
}
