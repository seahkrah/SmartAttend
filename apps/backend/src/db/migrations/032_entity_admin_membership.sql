-- 032: an entity's designated administrator is a member of that tenant.
--
-- user_tenant_memberships was built only from school_user_associations and
-- corporate_user_associations. An administrator named by
-- school_entities.admin_user_id therefore resolved no tenant at all, and every
-- tenant-scoped route answered 403 for them.
--
-- The administrator of a tenant is a member of it by definition, so the view
-- says so. UNION (not UNION ALL) collapses the case where an administrator
-- also holds an ordinary association, which would otherwise look like two
-- memberships of the same tenant and force a tenant-selection header.

CREATE OR REPLACE VIEW user_tenant_memberships AS
  SELECT sua.user_id,
         sua.school_entity_id AS tenant_id,
         'school'::VARCHAR(20) AS platform_kind,
         t.platform_id,
         sua.status,
         t.name AS tenant_name
    FROM school_user_associations sua
    JOIN tenants t ON t.id = sua.school_entity_id
  UNION
  SELECT se.admin_user_id AS user_id,
         se.id AS tenant_id,
         'school'::VARCHAR(20) AS platform_kind,
         t.platform_id,
         'active'::VARCHAR(50) AS status,
         t.name AS tenant_name
    FROM school_entities se
    JOIN tenants t ON t.id = se.id
   WHERE se.admin_user_id IS NOT NULL
  UNION
  SELECT cua.user_id,
         cua.corporate_entity_id AS tenant_id,
         'corporate'::VARCHAR(20) AS platform_kind,
         t.platform_id,
         cua.status,
         t.name AS tenant_name
    FROM corporate_user_associations cua
    JOIN tenants t ON t.id = cua.corporate_entity_id
  UNION
  SELECT ce.admin_user_id AS user_id,
         ce.id AS tenant_id,
         'corporate'::VARCHAR(20) AS platform_kind,
         t.platform_id,
         'active'::VARCHAR(50) AS status,
         t.name AS tenant_name
    FROM corporate_entities ce
    JOIN tenants t ON t.id = ce.id
   WHERE ce.admin_user_id IS NOT NULL;
