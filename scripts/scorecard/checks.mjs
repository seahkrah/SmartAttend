/**
 * Gates that need more than a grep or a command. Each returns
 * { status: 'pass' | 'fail' | 'not-run', detail? }.
 */

/** Tables in public that have a tenant_id column. */
async function tenantTables(db) {
  const { rows } = await db.query(`
    SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           pg_get_userbyid(c.relowner) AS owner,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
           (SELECT count(*) FROM pg_policies pp
             WHERE pp.schemaname = 'public' AND pp.tablename = c.relname
               AND NOT (coalesce(pp.qual, '') LIKE '%tenant_id = ( SELECT app_current_tenant()%'
                        AND coalesce(pp.with_check, '') LIKE '%tenant_id = ( SELECT app_current_tenant()%')) AS loose
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
     ORDER BY c.relname`)
  return rows
}

async function roleProblems(db, name) {
  const { rows } = await db.query(
    `SELECT rolsuper, rolbypassrls,
            pg_has_role($1, 'jjelotech_system', 'MEMBER') AS system_member
       FROM pg_roles WHERE rolname = $1`,
    [name],
  )
  if (!rows.length) return [`${name} does not exist`]
  const owned = (await tenantTables(db)).filter(t => t.owner === name)
  const problems = []
  if (rows[0].rolsuper) problems.push('is superuser')
  if (rows[0].rolbypassrls) problems.push('has BYPASSRLS')
  if (rows[0].system_member) problems.push('is a member of jjelotech_system, which every policy exempts')
  if (owned.length) problems.push(`owns ${owned.length} tenant tables`)
  return problems
}

export const customChecks = {
  /**
   * Every tenant table: RLS on and FORCED, and its policies are the tenant
   * policy (a policy that admits everything, USING (true), would otherwise
   * satisfy "has a policy").
   */
  async rlsCoverage({ env }) {
    const tables = await tenantTables(env.db)
    if (!tables.length) return { status: 'fail', detail: 'no tables with tenant_id found' }
    const bad = tables.filter(t => !t.rls || !t.forced || Number(t.policies) === 0 || Number(t.loose) > 0)
    return bad.length
      ? {
          status: 'fail',
          detail: `${bad.length}/${tables.length} tenant tables lack forced RLS or the tenant policy (e.g. ${bad
            .slice(0, 5)
            .map(t => t.table)
            .join(', ')})`,
        }
      : { status: 'pass', detail: `${tables.length} tenant tables` }
  },

  /**
   * The role the running API actually uses: its pool connects with
   * application_name 'jjelotech-api' (db/connection.ts), so the database says
   * which role that is. Not a member of jjelotech_system, not superuser,
   * NOBYPASSRLS, owning no tenant table.
   */
  async runtimeRole({ env }) {
    if (!env.available.api) return { status: 'not-run', detail: 'needs a running API' }
    // Make the API open a connection, so there is one to look at.
    await fetch(`${process.env.API_BASE.replace(/\/$/, '')}/api/health/ready`).catch(() => {})
    const { rows } = await env.db.query(
      `SELECT DISTINCT usename FROM pg_stat_activity WHERE application_name = 'jjelotech-api' AND usename IS NOT NULL`,
    )
    if (!rows.length)
      return { status: 'fail', detail: "no connection from the API's pool (application_name jjelotech-api) found" }
    const problems = []
    for (const r of rows) for (const p of await roleProblems(env.db, r.usename)) problems.push(`${r.usename} ${p}`)
    return problems.length
      ? { status: 'fail', detail: problems.join('; ') }
      : { status: 'pass', detail: rows.map(r => r.usename).join(', ') }
  },

  /**
   * Every single-column foreign key between tenant tables is covered by a
   * guard_same_tenant trigger naming that column and parent. PostgreSQL
   * checks foreign keys without RLS, so without the guard a row of tenant A
   * can reference tenant B's.
   */
  async sameTenantGuards({ env }) {
    const { rows } = await env.db.query(`
      WITH tt AS (SELECT c.oid FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
                   WHERE ns.nspname = 'public' AND c.relkind = 'r'
                     AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)),
           fks AS (SELECT con.conrelid AS child, a.attname AS col, con.confrelid AS parent
                     FROM pg_constraint con
                     JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
                     JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
                    WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1 AND pa.attname = 'id' AND a.attname <> 'tenant_id'
                      AND con.conrelid IN (SELECT oid FROM tt) AND con.confrelid IN (SELECT oid FROM tt)),
           cov AS (SELECT tg.tgrelid AS child, arr[i] AS col, arr[i + 1] AS parent_name
                     FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid AND p.proname = 'guard_same_tenant'
                     CROSS JOIN LATERAL (SELECT string_to_array(rtrim(encode(tg.tgargs, 'escape'), '\\000'), '\\000') AS arr) x
                     CROSS JOIN LATERAL generate_series(1, coalesce(array_length(arr, 1), 0), 2) AS i
                    WHERE NOT tg.tgisinternal)
      SELECT f.child::regclass::text || '.' || f.col AS ref,
             EXISTS (SELECT 1 FROM cov c WHERE c.child = f.child AND c.col = f.col AND c.parent_name = f.parent::regclass::text) AS guarded
        FROM fks f`)
    const missing = rows.filter(r => !r.guarded)
    if (rows.length < 20)
      return { status: 'fail', detail: `only ${rows.length} references found; is the schema migrated?` }
    return missing.length
      ? {
          status: 'fail',
          detail: `${missing.length}/${rows.length} unguarded (e.g. ${missing
            .slice(0, 4)
            .map(r => r.ref)
            .join(', ')})`,
        }
      : { status: 'pass', detail: `${rows.length} references guarded` }
  },
}
