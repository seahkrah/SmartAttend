-- ============================================================================
-- Migration 029: Fix the school_attendance audit trigger
-- ============================================================================
-- audit_attendance_changes, added by 017, inserts NEW.platform_id into
-- audit_logs. school_attendance has no platform_id column, so the trigger
-- raised 'record "new" has no field "platform_id"' on every INSERT and
-- UPDATE — meaning marking school attendance failed outright. The sibling
-- trigger on face_recognition_enrollments is fine, because that table does
-- have the column.
--
-- Derive the platform from the tenant instead, which is the correct source
-- now that tenancy exists: a tenant belongs to exactly one platform.
--
-- Also fixes a second defect in the same function: it recorded row_to_json(OLD)
-- on INSERT, where OLD is null, and returned NEW unconditionally, which is
-- wrong for a DELETE trigger should one ever be attached.

CREATE OR REPLACE FUNCTION audit_attendance_changes()
RETURNS TRIGGER AS $audit$
DECLARE
  v_platform_id UUID;
  v_tenant_id UUID;
  v_marked_by UUID;
BEGIN
  -- DELETE carries no NEW row.
  IF TG_OP = 'DELETE' THEN
    v_tenant_id := OLD.tenant_id;
    v_marked_by := OLD.marked_by_id;
  ELSE
    v_tenant_id := NEW.tenant_id;
    v_marked_by := NEW.marked_by_id;
  END IF;

  IF v_tenant_id IS NOT NULL THEN
    SELECT platform_id INTO v_platform_id FROM tenants WHERE id = v_tenant_id;
  END IF;

  -- audit_logs.user_id references users(id), but school_attendance.marked_by_id
  -- references faculty(id). Resolve to the underlying identity so the audit
  -- row points at a person rather than at a faculty record id that will not
  -- satisfy the foreign key.
  INSERT INTO audit_logs (
    platform_id, user_id, action, entity_type, entity_id,
    old_values, new_values
  ) VALUES (
    v_platform_id,
    (SELECT user_id FROM faculty WHERE id = v_marked_by),
    TG_OP,
    'attendance',
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD)::jsonb END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW)::jsonb END
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$audit$ LANGUAGE plpgsql;
