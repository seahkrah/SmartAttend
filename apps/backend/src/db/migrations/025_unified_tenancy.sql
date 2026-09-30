-- ============================================================================
-- Migration 025: Unified tenancy
-- ============================================================================
-- Establishes the Platform -> Tenant -> User -> Resource chain the system
-- claims to enforce but does not.
--
-- Before this migration:
--   * users.platform_id references platforms ('school' | 'corporate' | 'system'),
--     which is the PLATFORM, not the tenant
--   * TenantContext.tenantId was set from platform_id, so every institution on
--     the school platform shared one "tenant"
--   * no domain table (students, faculty, employees, courses, class_schedules,
--     rooms, semesters, departments, attendance, enrollments) carried any
--     tenant column at all
--
-- The real tenants are the rows in school_entities and corporate_entities.
-- This migration introduces `tenants` as the single registry spanning both
-- platforms, and puts tenant_id on every tenant-owned table.
--
-- tenants.id is deliberately the SAME uuid as the originating entity row, so
-- the tables that already reference school_entities(id) as a tenant
-- (metrics, incidents, clock_drift_log, tenant_configurations, ...) keep
-- pointing at a valid tenant without being rewritten.
--
-- NOTE: the runner splits on ';' outside dollar-quotes, strings and comments.

-- ---------------------------------------------------------------------------
-- 1. Tenant registry
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE RESTRICT,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('school', 'corporate')),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50),
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_platform_code
  ON tenants(platform_id, code) WHERE code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_platform ON tenants(platform_id);
CREATE INDEX IF NOT EXISTS idx_tenants_kind ON tenants(kind);

-- Backfill from the existing entity tables. id is carried over unchanged.
INSERT INTO tenants (id, platform_id, kind, name, code, status, is_active, created_at)
SELECT se.id,
       (SELECT id FROM platforms WHERE name = 'school' LIMIT 1),
       'school',
       se.name,
       se.code,
       COALESCE(se.status, 'active'),
       COALESCE(se.is_active, TRUE),
       COALESCE(se.created_at, CURRENT_TIMESTAMP)
FROM school_entities se
WHERE EXISTS (SELECT 1 FROM platforms WHERE name = 'school')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenants (id, platform_id, kind, name, code, status, is_active, created_at)
SELECT ce.id,
       (SELECT id FROM platforms WHERE name = 'corporate' LIMIT 1),
       'corporate',
       ce.name,
       ce.code,
       COALESCE(ce.status, 'active'),
       COALESCE(ce.is_active, TRUE),
       COALESCE(ce.created_at, CURRENT_TIMESTAMP)
FROM corporate_entities ce
WHERE EXISTS (SELECT 1 FROM platforms WHERE name = 'corporate')
ON CONFLICT (id) DO NOTHING;

-- Keep the registry in step when an entity is created or renamed. Without
-- this, a tenant created through the existing entity APIs would be invisible
-- to every tenant-scoped query.
CREATE OR REPLACE FUNCTION sync_tenant_from_school_entity()
RETURNS TRIGGER AS $sync$
BEGIN
  INSERT INTO tenants (id, platform_id, kind, name, code, status, is_active, created_at, updated_at)
  VALUES (
    NEW.id,
    (SELECT id FROM platforms WHERE name = 'school' LIMIT 1),
    'school',
    NEW.name,
    NEW.code,
    COALESCE(NEW.status, 'active'),
    COALESCE(NEW.is_active, TRUE),
    COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        code = EXCLUDED.code,
        status = EXCLUDED.status,
        is_active = EXCLUDED.is_active,
        updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$sync$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_tenant_from_corporate_entity()
RETURNS TRIGGER AS $sync$
BEGIN
  INSERT INTO tenants (id, platform_id, kind, name, code, status, is_active, created_at, updated_at)
  VALUES (
    NEW.id,
    (SELECT id FROM platforms WHERE name = 'corporate' LIMIT 1),
    'corporate',
    NEW.name,
    NEW.code,
    COALESCE(NEW.status, 'active'),
    COALESCE(NEW.is_active, TRUE),
    COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        code = EXCLUDED.code,
        status = EXCLUDED.status,
        is_active = EXCLUDED.is_active,
        updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$sync$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_tenant_school ON school_entities;
CREATE TRIGGER trg_sync_tenant_school
AFTER INSERT OR UPDATE ON school_entities
FOR EACH ROW EXECUTE FUNCTION sync_tenant_from_school_entity();

DROP TRIGGER IF EXISTS trg_sync_tenant_corporate ON corporate_entities;
CREATE TRIGGER trg_sync_tenant_corporate
AFTER INSERT OR UPDATE ON corporate_entities
FOR EACH ROW EXECUTE FUNCTION sync_tenant_from_corporate_entity();

-- ---------------------------------------------------------------------------
-- 2. tenant_id on tenant-owned tables
-- ---------------------------------------------------------------------------
-- Nullable for now: existing rows predate tenancy and cannot all be resolved
-- automatically. Application code treats a NULL tenant_id as unassigned and
-- refuses to serve it through tenant-scoped endpoints. A later migration can
-- tighten to NOT NULL once every row is attributed.

-- Applied through a guarded loop: the schema has drifted across migrations
-- (enrollments, for example, is dropped by 002 and replaced by student_courses),
-- so naming a table that does not exist must not abort the migration.
DO $addtenant$
DECLARE
  t TEXT;
  targets TEXT[] := ARRAY[
    -- SMS domain
    'students', 'faculty', 'courses', 'class_schedules', 'rooms', 'semesters',
    'school_departments', 'school_attendance', 'enrollments', 'student_courses',
    'faculty_courses', 'course_sessions',
    -- EMS domain
    'employees', 'corporate_departments', 'corporate_checkins', 'work_assignments',
    -- shared, tenant-owned
    'attendance_corrections', 'face_recognition_enrollments',
    'face_recognition_verifications'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT', t);
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I(tenant_id)', 'idx_' || t || '_tenant', t);
    ELSE
      RAISE NOTICE 'skipping tenant_id on %: table does not exist', t;
    END IF;
  END LOOP;
END $addtenant$;


-- ---------------------------------------------------------------------------
-- 3. Backfill from existing associations
-- ---------------------------------------------------------------------------
-- Only where ownership is unambiguous: a user belonging to exactly one tenant.
-- Rows that cannot be attributed are left NULL rather than guessed at.

UPDATE students s
SET tenant_id = sua.school_entity_id
FROM school_user_associations sua
WHERE s.user_id = sua.user_id
  AND s.tenant_id IS NULL
  AND sua.status = 'active'
  AND (SELECT COUNT(*) FROM school_user_associations x
        WHERE x.user_id = s.user_id AND x.status = 'active') = 1;

UPDATE faculty f
SET tenant_id = sua.school_entity_id
FROM school_user_associations sua
WHERE f.user_id = sua.user_id
  AND f.tenant_id IS NULL
  AND sua.status = 'active'
  AND (SELECT COUNT(*) FROM school_user_associations x
        WHERE x.user_id = f.user_id AND x.status = 'active') = 1;

UPDATE employees e
SET tenant_id = cua.corporate_entity_id
FROM corporate_user_associations cua
WHERE e.user_id = cua.user_id
  AND e.tenant_id IS NULL
  AND cua.status = 'active'
  AND (SELECT COUNT(*) FROM corporate_user_associations x
        WHERE x.user_id = e.user_id AND x.status = 'active') = 1;

-- Derive the rest of the SMS graph from the rows just attributed.
UPDATE school_attendance sa
SET tenant_id = s.tenant_id
FROM students s
WHERE sa.student_id = s.id AND sa.tenant_id IS NULL AND s.tenant_id IS NOT NULL;

DO $bf$
BEGIN
  IF to_regclass('public.enrollments') IS NOT NULL THEN
    EXECUTE 'UPDATE enrollments en SET tenant_id = s.tenant_id FROM students s
             WHERE en.student_id = s.id AND en.tenant_id IS NULL AND s.tenant_id IS NOT NULL';
  END IF;
END $bf$;

UPDATE student_courses sc
SET tenant_id = s.tenant_id
FROM students s
WHERE sc.student_id = s.id AND sc.tenant_id IS NULL AND s.tenant_id IS NOT NULL;

UPDATE faculty_courses fc
SET tenant_id = f.tenant_id
FROM faculty f
WHERE fc.faculty_id = f.id AND fc.tenant_id IS NULL AND f.tenant_id IS NOT NULL;

UPDATE corporate_checkins cc
SET tenant_id = e.tenant_id
FROM employees e
WHERE cc.employee_id = e.id AND cc.tenant_id IS NULL AND e.tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Tenant membership view
-- ---------------------------------------------------------------------------
-- One place to ask "which tenants may this user act in, on which platform".
-- Tenant context is resolved from this server-side; a client-supplied tenant
-- id is never trusted.

CREATE OR REPLACE VIEW user_tenant_memberships AS
SELECT sua.user_id,
       sua.school_entity_id AS tenant_id,
       'school'::VARCHAR(20) AS platform_kind,
       t.platform_id,
       sua.status,
       t.name AS tenant_name
FROM school_user_associations sua
JOIN tenants t ON t.id = sua.school_entity_id
UNION ALL
SELECT cua.user_id,
       cua.corporate_entity_id AS tenant_id,
       'corporate'::VARCHAR(20) AS platform_kind,
       t.platform_id,
       cua.status,
       t.name AS tenant_name
FROM corporate_user_associations cua
JOIN tenants t ON t.id = cua.corporate_entity_id;
