-- 036: the triggers that write audit rows record the tenant too.
--
-- Migration 035 gave audit_logs a tenant column and the audit API now filters
-- on it. A writer that leaves it NULL produces a row no tenant administrator
-- can ever see, which would quietly hollow out the trail for exactly the
-- people who need to read it.
--
-- The attendance trigger already knows the tenant; it simply had nowhere to
-- put it. The face-enrolment trigger derives it from the student.

CREATE OR REPLACE FUNCTION audit_attendance_changes() RETURNS TRIGGER AS $attaudit$
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
    platform_id, tenant_id, user_id, action, entity_type, entity_id,
    old_values, new_values
  ) VALUES (
    v_platform_id,
    v_tenant_id,
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
$attaudit$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_face_enrollment_changes() RETURNS TRIGGER AS $faceaudit$
BEGIN
  INSERT INTO audit_logs (
    platform_id, tenant_id, user_id, action, entity_type, entity_id,
    old_values, new_values
  ) VALUES (
    NEW.platform_id,
    NEW.tenant_id,
    NEW.enrolled_by_id,
    TG_OP,
    'face_enrollment',
    NEW.id,
    row_to_json(OLD),
    row_to_json(NEW)
  );
  RETURN NEW;
END;
$faceaudit$ LANGUAGE plpgsql;
