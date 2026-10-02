/**
 * Creates (or updates) the API's runtime database login: a member of
 * jjelotech_app, never of jjelotech_system, with no attribute that would let
 * it step around row-level security.
 *
 *   DATABASE_URL=<owner or admin> APP_DB_USER=jjelotech_api APP_DB_PASSWORD=... \
 *     npx tsx src/scripts/createRuntimeRole.ts
 *
 * Then set APP_DATABASE_URL to that login for the API. Run after migrations
 * (migration 069 creates jjelotech_app). Idempotent: re-running resets the
 * password and re-asserts the attributes.
 */
import pg from 'pg'
import { databaseSsl } from '../db/connection.js'

const USER = /^[a-z_][a-z0-9_]{2,62}$/

async function main() {
  const name = process.env.APP_DB_USER
  const password = process.env.APP_DB_PASSWORD
  if (!name || !USER.test(name)) throw new Error('APP_DB_USER must be a lower-case identifier')
  if (!password || password.length < 16) throw new Error('APP_DB_PASSWORD must be at least 16 characters')

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl() })
  await client.connect()
  try {
    const app = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'jjelotech_app'`)
    if (!app.rowCount) throw new Error('Role jjelotech_app does not exist: run migrations first')

    const exists = (await client.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [name])).rowCount
    // Identifiers cannot be bound parameters; the name is checked above and
    // quoted here. The password is passed as a literal by format('%L').
    const attrs = 'LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT'
    const verb = exists ? 'ALTER' : 'CREATE'
    const stmt = (await client.query(`SELECT format('${verb} ROLE %I WITH ${attrs} PASSWORD %L', $1::text, $2::text) AS sql`, [name, password]))
      .rows[0].sql
    await client.query(stmt)
    await client.query(`SELECT format('GRANT jjelotech_app TO %I', $1::text) AS sql`, [name]).then((r) => client.query(r.rows[0].sql))

    const member = await client.query(`SELECT pg_has_role($1, 'jjelotech_system', 'MEMBER') AS m`, [name])
    if (member.rows[0].m) throw new Error(`${name} is a member of jjelotech_system; revoke that, it exempts the role from RLS`)
    console.log(`${verb === 'CREATE' ? 'Created' : 'Updated'} runtime role ${name} (member of jjelotech_app, NOBYPASSRLS)`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
