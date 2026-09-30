-- 038: the correction views expose the tenant, so reads can be scoped.
--
-- attendance_corrections has a tenant_id; the two views built over it dropped
-- it. Every route that read a correction went through those views, so there
-- was no column left to filter on and one school's correction trail — reason
-- text, who signed it off, what the original mark had been — was readable by
-- any other.
--
-- correction_audit_log records who created or reverted a correction and gains
-- its own tenant column, so the meta-trail is partitioned the same way.

ALTER TABLE correction_audit_log
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

UPDATE correction_audit_log l
   SET tenant_id = c.tenant_id
  FROM attendance_corrections c
 WHERE c.id = l.correction_id AND l.tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_correction_audit_log_tenant ON correction_audit_log (tenant_id);

-- A view's column list can only be appended to in place, and tenant_id belongs
-- beside the id it qualifies, so both views are dropped and rebuilt.
DROP VIEW IF EXISTS attendance_correction_trail;

CREATE VIEW attendance_correction_trail AS
  SELECT ac.id           AS correction_id,
         ac.tenant_id,
         ac.attendance_record_id,
         ac.record_type,
         ac.original_status,
         ac.corrected_status,
         ac.original_attendance_state,
         ac.corrected_attendance_state,
         ac.correction_reason,
         ac.correction_type,
         u.email         AS corrected_by,
         ac.correction_timestamp,
         ac.supporting_evidence_url,
         ac.is_reverted,
         ac.reverted_at,
         ru.email        AS reverted_by,
         ac.revert_reason,
         CASE WHEN ac.is_reverted THEN 'REVERTED' ELSE 'ACTIVE' END AS status
    FROM attendance_corrections ac
    LEFT JOIN users u  ON u.id  = ac.corrected_by_user_id
    LEFT JOIN users ru ON ru.id = ac.reverted_by_user_id;

DROP VIEW IF EXISTS correction_statistics;

CREATE VIEW correction_statistics AS
  SELECT ac.tenant_id,
         DATE(ac.correction_timestamp) AS correction_date,
         ac.correction_type,
         COUNT(*)                                        AS total_corrections,
         COUNT(*) FILTER (WHERE ac.is_reverted)          AS reverted_count,
         COUNT(*) FILTER (WHERE NOT ac.is_reverted)      AS active_count
    FROM attendance_corrections ac
   GROUP BY ac.tenant_id, DATE(ac.correction_timestamp), ac.correction_type;
