import pg from 'pg'
import dotenv from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'
import { currentDbContext, type DbContext } from './dbContext.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load .env from backend root
dotenv.config({ path: join(__dirname, '..', '..', '.env') })

const { Pool } = pg

// A DATE column is a calendar day, and is returned as one: 'YYYY-MM-DD'.
// node-postgres otherwise builds a JS Date at the server's local midnight,
// which serialises to the API as '2027-04-12T00:00:00.000Z' (shown raw on
// screens), moves to the previous day when converted anywhere west of the
// server, and turns String(d).slice(0, 10) into a weekday name. Four modules
// had grown their own isoDay() workaround; this makes it true everywhere.
// Timestamps (TIMESTAMP, TIMESTAMPTZ) are unaffected.
const PG_DATE_OID = 1082
pg.types.setTypeParser(PG_DATE_OID, (value: string) => value)

console.log('[DB] DATABASE_URL:', process.env.DATABASE_URL ? '***configured***' : '***NOT SET***')

/**
 * TLS to the database. DATABASE_SSL:
 *   verify  encrypted, and the server's certificate must check out (with
 *           DATABASE_SSL_CA naming a CA file for a private CA). The default
 *           in production.
 *   off     no TLS: only for a database reachable solely on a private
 *           network, such as the compose stack's. The default elsewhere.
 * There is deliberately no "encrypt but trust anything" setting.
 */
export function databaseSsl(env: NodeJS.ProcessEnv = process.env): false | { rejectUnauthorized: true; ca?: string } {
  const mode = (env.DATABASE_SSL ?? (env.NODE_ENV === 'production' ? 'verify' : 'off')).toLowerCase()
  if (mode === 'off') return false
  if (mode !== 'verify') throw new Error(`DATABASE_SSL must be "verify" or "off", not "${mode}"`)
  return env.DATABASE_SSL_CA
    ? { rejectUnauthorized: true, ca: readFileSync(env.DATABASE_SSL_CA, 'utf8') }
    : { rejectUnauthorized: true }
}

// node-postgres defaults to 10 connections. Every request makes a few
// queries of its own (session, tenant context) before its real work, so 10
// became the queue at around 20 concurrent users in load testing. Size it to
// the database's max_connections divided by the number of API replicas.
const poolMax = Math.max(parseInt(process.env.DATABASE_POOL_MAX ?? '', 10) || 20, 1)

/**
 * Every connection this pool hands out carries the caller's tenant.
 *
 * On checkout, app.tenant_id and app.user_id are set from the async context
 * (dbContext.ts) whenever they differ from what that connection last held,
 * and row-level security (migration 069) filters every tenant table by it.
 * This is the one way to reach the database, so query(), getConnection()
 * and pool.query/connect are all bound without each call site saying so.
 *
 * A session-level setting made inside a transaction is undone by its
 * rollback, so a connection that comes back mid-transaction (a release
 * without COMMIT/ROLLBACK) is destroyed rather than trusted.
 */
interface ClientState {
  contextKey: string | null
  txStatus: string
}
const clientState = new WeakMap<pg.PoolClient, ClientState>()

function stateOf(client: pg.PoolClient): ClientState {
  let state = clientState.get(client)
  if (!state) {
    state = { contextKey: null, txStatus: 'I' }
    clientState.set(client, state)
    // ReadyForQuery carries the backend's transaction status: I(dle), T, E.
    const connection = (client as unknown as { connection?: NodeJS.EventEmitter }).connection
    connection?.on('readyForQuery', (msg: { status?: string }) => {
      state!.txStatus = msg?.status ?? 'I'
    })
  }
  return state
}

class TenantBoundPool extends Pool {
  constructor(config: pg.PoolConfig, readonly role: 'app' | 'system') {
    super(config)
  }

  // pg-pool's own query() calls connect(callback); both forms go through here.
  connect(): Promise<pg.PoolClient>
  connect(callback: (err: Error | undefined, client: pg.PoolClient | undefined, done: (release?: any) => void) => void): void
  connect(callback?: any): any {
    const checkout = this.bound(currentDbContext())
    if (!callback) return checkout
    checkout.then(
      (client) => callback(undefined, client, (release?: any) => client.release(release)),
      (err) => callback(err, undefined, () => {}),
    )
    return undefined
  }

  private async bound(ctx: DbContext, attempt = 0): Promise<pg.PoolClient> {
    const client = await super.connect()
    const state = stateOf(client)
    if (state.txStatus !== 'I') {
      client.release(new Error('connection returned to the pool inside a transaction'))
      if (attempt < 3) return this.bound(ctx, attempt + 1)
      throw new Error('No clean database connection available')
    }
    const tenant = ctx.mode === 'tenant' ? ctx.tenantId : ''
    const user = ctx.userId ?? ''
    const key = `${tenant}|${user}`
    if (state.contextKey !== key) {
      try {
        await client.query(`SELECT set_config('app.tenant_id', $1, false), set_config('app.user_id', $2, false)`, [
          tenant,
          user,
        ])
      } catch (error) {
        client.release(error as Error)
        throw error
      }
      state.contextKey = key
    }
    return client
  }
}

const baseConfig = {
  ssl: databaseSsl(),
  max: poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
}

// The runtime role (APP_DATABASE_URL): not the owner, NOBYPASSRLS. Without
// it, everything runs as DATABASE_URL's role, which RLS exempts: the
// behaviour before migration 069, and what the runtime-role gate fails on.
const appUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL
const appPool = new TenantBoundPool({ ...baseConfig, connectionString: appUrl }, 'app')
const systemPool =
  appUrl === process.env.DATABASE_URL
    ? appPool
    : new TenantBoundPool({ ...baseConfig, max: Math.max(Math.ceil(poolMax / 4), 2), connectionString: process.env.DATABASE_URL }, 'system')

if (systemPool !== appPool) console.log('[DB] runtime role in use: tenant tables are filtered by row-level security')

for (const p of new Set([appPool, systemPool])) {
  p.on('error', (err) => {
    console.error('Unexpected error on idle client', err)
    process.exit(-1)
  })
}

/** The pool for the current context: system work on the system pool. */
function poolFor(): TenantBoundPool {
  return currentDbContext().mode === 'system' ? systemPool : appPool
}

export async function query(text: string, params?: any[]) {
  try {
    const res = await poolFor().query(text, params)
    return res
  } catch (error) {
    // Only log query errors in development, never log query text in production
    if (process.env.NODE_ENV === 'development') {
      console.error('Database query error:', { error: (error as Error).message })
    }
    throw error
  }
}

export async function getConnection() {
  return await poolFor().connect()
}

export async function initializeDatabase() {
  try {
    const result = await query('SELECT 1')
    console.log('✅ Database connection successful')
    // Migrations are not applied here. They are a deliberate step
    // (`npx tsx src/db/migrate.ts`, run by setup, CI and the deploy docs), and
    // the server used to apply a hardcoded subset of them (001-012) on start,
    // in an order of its own — on a fresh database that ran migrations out of
    // sequence and left a half-built schema that looked like a working one.
    // startServer reports anything pending, and /api/health/ready refuses
    // traffic until it is applied.
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    throw error
  }
}

/**
 * The pool, for code that calls pool.query / pool.connect directly. It routes
 * by context like query() does; there is no unbound way in.
 */
const pool = {
  query: (text: string, params?: any[]) => poolFor().query(text, params),
  connect: () => poolFor().connect(),
  end: async () => {
    await Promise.all([...new Set([appPool, systemPool])].map((p) => p.end()))
  },
  on: (event: 'error', listener: (err: Error) => void) => {
    for (const p of new Set([appPool, systemPool])) p.on(event, listener)
    return pool
  },
}

export default pool
