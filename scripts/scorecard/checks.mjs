/**
 * Gates that need more than a grep or a command. Each returns
 * { status: 'pass' | 'fail' | 'not-run', detail? }.
 */

/** Tables in public that have a tenant_id column. */
async function tenantTables(db) {
  const { rows } = await db.query(`
    SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           pg_get_userbyid(c.relowner) AS owner,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
     ORDER BY c.relname`)
  return rows
}

export const customChecks = {
  /** Every tenant table: RLS on, FORCED, and at least one policy. */
  async rlsCoverage({ env }) {
    const tables = await tenantTables(env.db)
    if (!tables.length) return { status: 'fail', detail: 'no tables with tenant_id found' }
    const bad = tables.filter(t => !t.rls || !t.forced || Number(t.policies) === 0)
    return bad.length
      ? {
          status: 'fail',
          detail: `${bad.length}/${tables.length} tenant tables lack forced RLS or a policy (e.g. ${bad
            .slice(0, 5)
            .map(t => t.table)
            .join(', ')})`,
        }
      : { status: 'pass', detail: `${tables.length} tenant tables` }
  },

  /** The API's role: not superuser, NOBYPASSRLS, owns no tenant table. */
  async runtimeRole({ env, requireFromBackend }) {
    if (!process.env.APP_DATABASE_URL) {
      return { status: 'fail', detail: 'APP_DATABASE_URL (the runtime role) is not set; the API uses the owner role' }
    }
    const pg = requireFromBackend('pg')
    const app = new pg.Client({ connectionString: env.appDbUrl, connectionTimeoutMillis: 5000 })
    await app.connect()
    try {
      const { rows } = await app.query(
        `SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      )
      const role = rows[0]
      const owned = (await tenantTables(env.db)).filter(t => t.owner === role.name)
      const problems = []
      if (role.rolsuper) problems.push('is superuser')
      if (role.rolbypassrls) problems.push('has BYPASSRLS')
      if (owned.length) problems.push(`owns ${owned.length} tenant tables`)
      return problems.length
        ? { status: 'fail', detail: `${role.name} ${problems.join(', ')}` }
        : { status: 'pass', detail: role.name }
    } finally {
      await app.end()
    }
  },
}
