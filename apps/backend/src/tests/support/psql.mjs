#!/usr/bin/env node
/**
 * `psql <url> -Atc <sql>` for the e2e suites, without needing the PostgreSQL
 * client installed: Node and the backend's own `pg` are always there, a psql
 * binary is not (it is missing on Windows development machines).
 *
 * Output matches what the suites read from psql -At:
 *   - each result row on its own line, columns joined by "|", values as
 *     PostgreSQL's text output (t/f, ISO dates), NULL as empty;
 *   - the command tag (INSERT 0 1, UPDATE 2, ...) after any rows, for
 *     anything but SELECT;
 *   - on error, "ERROR:  <message>" on stderr and exit status 1.
 * Several statements in one string run as psql -c runs them: one implicit
 * transaction, all or nothing. One known difference: DDL tags are the bare
 * verb (CREATE, not CREATE TABLE); no suite reads them.
 */
import pg from 'pg'

const args = process.argv.slice(2)
const url = args.find((a) => /^postgres(ql)?:\/\//.test(a)) ?? process.env.DATABASE_URL
const c = args.indexOf('-Atc')
const sql = c === -1 ? args.at(-1) : args[c + 1]

const client = new pg.Client({
  connectionString: url,
  // Raw text for every type, exactly as psql prints it.
  types: { getTypeParser: () => (value) => value },
})

try {
  await client.connect()
  // Arrays, not objects: two columns with one name (`SELECT 1, 2`) must both print.
  const results = await client.query({ text: sql, rowMode: 'array' })
  const out = []
  for (const r of Array.isArray(results) ? results : [results]) {
    for (const row of r.rows) out.push(row.map((v) => v ?? '').join('|'))
    if (r.command && r.command !== 'SELECT') {
      out.push(r.command === 'INSERT' ? `INSERT 0 ${r.rowCount}` : r.rowCount === null ? r.command : `${r.command} ${r.rowCount}`)
    }
  }
  if (out.length) process.stdout.write(out.join('\n') + '\n')
} catch (e) {
  process.stderr.write(`ERROR:  ${e.message}\n`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
