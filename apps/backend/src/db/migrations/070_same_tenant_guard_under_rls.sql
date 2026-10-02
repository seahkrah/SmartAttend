-- guard_same_tenant, corrected for row-level security (migration 069).
--
-- The guard looks up the tenant of each row a new row refers to. Under RLS,
-- a row belonging to another tenant is invisible to the caller, so the lookup
-- found nothing, and the guard took "not found" to mean "missing, let the
-- foreign key report it". But PostgreSQL makes foreign-key checks without
-- RLS, so the foreign key found the row and accepted it: tenant A could link
-- its guardian to tenant B's student. Found by src/tests/blindWrite.manual.ts.
--
-- Now a referenced row the caller cannot see is refused. It is reported as a
-- foreign-key violation (23503), which is what a missing row has always
-- produced, so routes keep mapping it to the same response, and the reply
-- does not reveal whether the row exists in another tenant. Seen across
-- tenants (system context), a row in another tenant is refused as before.

CREATE OR REPLACE FUNCTION guard_same_tenant() RETURNS TRIGGER AS $same$
DECLARE
  i INTEGER := 0;
  col TEXT;
  parent TEXT;
  ref TEXT;
  parent_tenant UUID;
  found_rows INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A % row cannot be moved to another tenant', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;

  WHILE i < TG_NARGS LOOP
    col := TG_ARGV[i];
    parent := TG_ARGV[i + 1];
    ref := to_jsonb(NEW) ->> col;
    IF ref IS NOT NULL THEN
      EXECUTE format('SELECT tenant_id FROM %I WHERE id = $1', parent)
        INTO parent_tenant USING ref::uuid;
      -- EXECUTE does not set FOUND; the row count says whether the caller
      -- can see the referenced row at all.
      GET DIAGNOSTICS found_rows = ROW_COUNT;
      IF found_rows = 0 THEN
        RAISE EXCEPTION '%.% refers to a % row that does not exist in this tenant',
          TG_TABLE_NAME, col, parent
          USING ERRCODE = 'foreign_key_violation';
      ELSIF parent_tenant IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION '%.% refers to a % row that belongs to another tenant',
          TG_TABLE_NAME, col, parent
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    i := i + 2;
  END LOOP;

  RETURN NEW;
END;
$same$ LANGUAGE plpgsql;
