/**
 * Streaming each tenant's audit trail to a collector of its own (migration
 * 079, audit_stream_targets).
 *
 * Every few seconds the dispatcher sends each enabled target the rows of its
 * tenant after the last position it delivered, in chain order, at most 200
 * at a time, as JSON:
 *
 *   POST <url>
 *   X-Jjelo-Timestamp: <unix seconds>
 *   X-Jjelo-Signature: v1=<hex HMAC-SHA256 of "<timestamp>.<body>">
 *   { "tenantId": "...", "events": [ { "chainSeq": 41, "prevHash": "...", "rowHash": "...", ... } ] }
 *
 * The collector checks the signature with the secret it was given once, when
 * the target was created, and can check the chain itself from prevHash and
 * rowHash. A 2xx answer advances the position; anything else is retried with
 * backoff, so nothing is skipped. Delivery is at least once: a collector may
 * see a batch twice and can drop repeats by chainSeq.
 *
 * Targets are outbound requests chosen by a tenant, so they must not reach
 * the platform's own network: HTTPS only, no redirects, and the host must not
 * resolve to a private, loopback or link-local address (security/outbound.ts).
 */
import crypto from 'crypto'
import { query } from '../db/connection.js'
import { runAsSystem } from '../db/dbContext.js'
import { openForTenant, sealForTenant } from '../security/kms/dataKeys.js'
import { checkOutboundUrl, OutboundUrlError } from '../security/outbound.js'

const PURPOSE = 'audit_stream'
const BATCH = 200

function sys(text: string, params?: any[]) {
  return runAsSystem('audit stream: delivering every tenant\'s trail to its collector', () => query(text, params))
}

export { OutboundUrlError as StreamTargetError }

function intEnv(key: string, fallback: number): number {
  const v = parseInt(process.env[key] ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

export function signature(secret: string, timestamp: number, body: string): string {
  return 'v1=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

/** Creates a target and returns its secret, which is never shown again. */
export async function createTarget(
  runner: { query: (text: string, params?: any[]) => Promise<any> },
  opts: { tenantId: string; url: unknown; createdBy: string; fromStart?: boolean }
): Promise<{ id: string; url: string; secret: string; fromSeq: number }> {
  const url = await checkOutboundUrl(opts.url)
  const secret = crypto.randomBytes(32).toString('base64url')
  const id = crypto.randomUUID()
  const sealed = await sealForTenant(opts.tenantId, PURPOSE, Buffer.from(secret), `audit-stream:${id}`)
  const head = await runner.query(`SELECT seq FROM audit_chain_heads WHERE chain = $1`, [opts.tenantId])
  const fromSeq = opts.fromStart ? 0 : Number(head.rows[0]?.seq ?? 0)
  await runner.query(
    `INSERT INTO audit_stream_targets (id, tenant_id, url, secret_sealed, secret_iv, secret_tag, secret_dek_version, last_seq, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, opts.tenantId, url.toString(), sealed.ciphertext, sealed.iv, sealed.authTag, sealed.dekVersion, fromSeq, opts.createdBy]
  )
  return { id, url: url.toString(), secret, fromSeq }
}

function eventOf(r: any) {
  return {
    chainSeq: Number(r.chain_seq), prevHash: r.prev_hash, rowHash: r.row_hash, canonical: r.canonical,
    id: r.id, at: r.created_at, actorId: r.actor_id, actorRole: r.actor_role, action: r.action_type ?? r.action,
    scope: r.action_scope, resourceType: r.resource_type ?? r.entity_type, resourceId: r.resource_id ?? r.entity_id,
    before: r.before_state ?? r.old_values, after: r.after_state ?? r.new_values, justification: r.justification,
    ip: r.ip_address, requestId: r.request_id,
  }
}

/** One pass over every due target. Returns how many batches were delivered. */
export async function deliverDue(fetchImpl: typeof fetch = fetch): Promise<number> {
  const targets = await sys(
    `SELECT * FROM audit_stream_targets WHERE enabled AND next_attempt_at <= CURRENT_TIMESTAMP ORDER BY next_attempt_at LIMIT 50`
  )
  let delivered = 0
  for (const t of targets.rows) {
    const rows = await sys(
      `SELECT a.*, audit_row_canonical(a) AS canonical FROM audit_logs a
        WHERE a.tenant_id = $1 AND a.chain_seq > $2 ORDER BY a.chain_seq LIMIT ${BATCH}`,
      [t.tenant_id, t.last_seq]
    )
    if (!rows.rows.length) continue
    try {
      // The dispatcher has no request, so no tenant context: the tenant's data
      // key is read on the system pool, like everything else here.
      const secret = (await runAsSystem("audit stream: the tenant's signing secret", () =>
        openForTenant(t.tenant_id, PURPOSE, {
          ciphertext: t.secret_sealed, iv: t.secret_iv, authTag: t.secret_tag, dekVersion: t.secret_dek_version,
        }, `audit-stream:${t.id}`))).toString()
      const url = await checkOutboundUrl(t.url)
      const body = JSON.stringify({ tenantId: t.tenant_id, events: rows.rows.map(eventOf) })
      const ts = Math.floor(Date.now() / 1000)
      const res = await fetchImpl(url, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', 'X-Jjelo-Timestamp': String(ts), 'X-Jjelo-Signature': signature(secret, ts, body) },
        body,
        signal: AbortSignal.timeout(10_000),
      })
      if (res.status < 200 || res.status >= 300) throw new Error(`the collector answered ${res.status}`)
      await sys(
        `UPDATE audit_stream_targets SET last_seq = $2, failures = 0, last_error = NULL,
                last_delivered_at = CURRENT_TIMESTAMP, next_attempt_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [t.id, rows.rows[rows.rows.length - 1].chain_seq]
      )
      delivered++
    } catch (e) {
      // Backoff: base × 2^failures, at most an hour.
      const base = intEnv('AUDIT_STREAM_RETRY_BASE_MS', 5000)
      const wait = Math.min(base * 2 ** Math.min(t.failures, 12), 3_600_000)
      await sys(
        `UPDATE audit_stream_targets SET failures = failures + 1, last_error = $2,
                next_attempt_at = CURRENT_TIMESTAMP + make_interval(secs => $3::double precision / 1000) WHERE id = $1`,
        [t.id, (e instanceof Error ? e.message : String(e)).slice(0, 300), wait]
      )
    }
  }
  return delivered
}

let timer: NodeJS.Timeout | null = null

export function startAuditStreamDispatcher(): void {
  if (timer) return
  const every = intEnv('AUDIT_STREAM_INTERVAL_MS', 5000)
  let running = false
  timer = setInterval(() => {
    if (running) return
    running = true
    deliverDue().catch((e) => console.error('[audit-stream]', e instanceof Error ? e.message : e)).finally(() => { running = false })
  }, every)
  timer.unref()
}
