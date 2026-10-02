-- Phase 1 independent audit fixes (docs/scorecard/audit-phase-1.md).

-- ── 1. What the runtime role may not write ──────────────────────────────────
-- Break-glass grants are opened and closed only by the control plane (the
-- system pool). The runtime role could insert a forged grant or delete one,
-- within its own tenant. It reads them; that is all.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jjelotech_app') THEN
    REVOKE INSERT, UPDATE, DELETE ON break_glass_grants FROM jjelotech_app;
    -- The access log is written by requireTenant as the runtime role, so
    -- INSERT stays; erasing or editing what was done does not.
    REVOKE UPDATE, DELETE ON break_glass_access_log FROM jjelotech_app;
    -- Data keys are created on first use (INSERT) and retired by rotation
    -- (UPDATE of retired_at, which the immutability trigger allows).
    -- Deleting them destroys a tenant's sealed data: a system action.
    REVOKE DELETE ON tenant_data_keys FROM jjelotech_app;
  END IF;
END
$$;

-- ── 2. A same-tenant guard on every reference between tenant tables ─────────
-- PostgreSQL checks foreign keys without row-level security, so a reference
-- from tenant A's row to tenant B's row passes the foreign key. The 22
-- hand-written guard_same_tenant triggers covered some references; 87
-- single-column foreign keys between tenant tables had none. This finds
-- every such foreign key from the catalog and adds the missing guards, one
-- trigger per table, and later migrations call it again for new tables.
CREATE OR REPLACE FUNCTION app_apply_same_tenant_guards() RETURNS integer
  LANGUAGE plpgsql AS
$$
DECLARE
  t record;
  args text;
  cols text;
  n integer := 0;
BEGIN
  FOR t IN
    WITH tenant_tables AS (
      SELECT c.oid FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public' AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
    ),
    fks AS (
      SELECT con.conrelid AS child, a.attname AS col, con.confrelid AS parent
        FROM pg_constraint con
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
       WHERE con.contype = 'f'
         AND array_length(con.conkey, 1) = 1
         AND pa.attname = 'id'
         AND a.attname <> 'tenant_id'
         AND con.conrelid IN (SELECT oid FROM tenant_tables)
         AND con.confrelid IN (SELECT oid FROM tenant_tables)
    ),
    -- (column, parent) pairs some guard_same_tenant trigger already checks.
    covered AS (
      SELECT tg.tgrelid AS child, args_arr[i] AS col, args_arr[i + 1] AS parent_name
        FROM pg_trigger tg
        JOIN pg_proc p ON p.oid = tg.tgfoid AND p.proname = 'guard_same_tenant'
        CROSS JOIN LATERAL (SELECT string_to_array(rtrim(encode(tg.tgargs, 'escape'), '\000'), '\000') AS args_arr) x
        CROSS JOIN LATERAL generate_series(1, coalesce(array_length(args_arr, 1), 0), 2) AS i
       WHERE NOT tg.tgisinternal AND tg.tgname NOT LIKE '%\_fk\_same\_tenant'
    ),
    missing AS (
      SELECT f.child, f.col, f.parent FROM fks f
       WHERE NOT EXISTS (SELECT 1 FROM covered c
                          WHERE c.child = f.child AND c.col = f.col AND c.parent_name = f.parent::regclass::text)
    )
    SELECT child::regclass::text AS child_name,
           array_agg(col ORDER BY col) AS cols,
           array_agg(parent::regclass::text ORDER BY col) AS parents
      FROM missing GROUP BY child
  LOOP
    args := '';
    FOR i IN 1 .. array_length(t.cols, 1) LOOP
      args := args || CASE WHEN i > 1 THEN ', ' ELSE '' END
                   || quote_literal(t.cols[i]) || ', ' || quote_literal(t.parents[i]);
    END LOOP;
    SELECT string_agg(quote_ident(c), ', ') INTO cols FROM unnest(t.cols) AS c;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', left('trg_' || t.child_name, 45) || '_fk_same_tenant', t.child_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF tenant_id, %s ON %I FOR EACH ROW EXECUTE FUNCTION guard_same_tenant(%s)',
      left('trg_' || t.child_name, 45) || '_fk_same_tenant', cols, t.child_name, args);
    n := n + 1;
  END LOOP;
  RETURN n;
END
$$;

SELECT app_apply_same_tenant_guards();
