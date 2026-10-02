/**
 * Rate-limit counters in PostgreSQL, shared by every API replica.
 *
 * express-rate-limit keeps counters in each process's memory by default, so
 * N replicas behind a load balancer allow N times the sign-in attempts. This
 * store keeps them in one table (migration 077) with one atomic upsert per
 * counted request: a window that has ended starts again at 1.
 *
 * Used by the limiters that guard credentials (sign-in, refresh, account and
 * two-factor requests, enquiries). The global per-address flood limit uses it
 * too when RATE_LIMIT_SHARED_API=true; by default that one stays in memory,
 * since it costs a write on every request and a proxy or load balancer is the
 * usual place for flood control. The per-account lockout was already in the
 * database (authService).
 *
 * Counters are not tenant data; the table is system-only and the store uses
 * the system pool.
 */
import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit'
import { query } from '../db/connection.js'
import { runAsSystem } from '../db/dbContext.js'

function sys(text: string, params?: unknown[]) {
  return runAsSystem('rate limits: counters shared across replicas', () => query(text, params as any[]))
}

export class PostgresRateLimitStore implements Store {
  windowMs = 60_000
  localKeys = false
  prefix: string

  constructor(name: string) {
    // One table for every limiter; the name keeps their counters apart.
    this.prefix = `${name}:`
  }

  init(options: Options): void {
    this.windowMs = options.windowMs
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const r = await sys(
      `SELECT hits, reset_at FROM http_rate_limits WHERE key = $1 AND reset_at > CURRENT_TIMESTAMP`,
      [this.prefix + key]
    )
    if (!r.rows.length) return undefined
    return { totalHits: Number(r.rows[0].hits), resetTime: new Date(r.rows[0].reset_at) }
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const r = await sys(
      `INSERT INTO http_rate_limits AS l (key, hits, reset_at)
       VALUES ($1, 1, CURRENT_TIMESTAMP + make_interval(secs => $2::double precision / 1000))
       ON CONFLICT (key) DO UPDATE
          SET hits = CASE WHEN l.reset_at <= CURRENT_TIMESTAMP THEN 1 ELSE l.hits + 1 END,
              reset_at = CASE WHEN l.reset_at <= CURRENT_TIMESTAMP
                              THEN CURRENT_TIMESTAMP + make_interval(secs => $2::double precision / 1000)
                              ELSE l.reset_at END
       RETURNING hits, reset_at`,
      [this.prefix + key, this.windowMs]
    )
    // Now and then, forget windows that ended a while ago.
    if (Math.random() < 0.005) {
      sys(`DELETE FROM http_rate_limits WHERE reset_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'`).catch(() => undefined)
    }
    return { totalHits: Number(r.rows[0].hits), resetTime: new Date(r.rows[0].reset_at) }
  }

  async decrement(key: string): Promise<void> {
    await sys(`UPDATE http_rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = $1`, [this.prefix + key])
  }

  async resetKey(key: string): Promise<void> {
    await sys(`DELETE FROM http_rate_limits WHERE key = $1`, [this.prefix + key])
  }
}
