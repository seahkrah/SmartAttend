-- Phase 3 (authorisation): a single sign-on session belongs to the tenant
-- whose identity provider vouched for the person (audit phase 2, F5).
--
-- A tenant's identity provider can sign in any of that tenant's members;
-- that is what trusting it means. It must not also open the person's other
-- tenants: a member of schools A and B, signed in through A's provider, could
-- otherwise switch to B with X-Tenant-Id, and B never trusted A's provider.
-- A session started through SSO records the provider's tenant, and the
-- tenant middleware offers that session no other membership. A second-factor
-- challenge started by SSO carries the tenant through to the session.
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS bound_tenant_id UUID
  REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE mfa_login_challenges ADD COLUMN IF NOT EXISTS bound_tenant_id UUID
  REFERENCES tenants(id) ON DELETE CASCADE;

COMMENT ON COLUMN auth_sessions.bound_tenant_id IS
  'Set for a session started through single sign-on: the only tenant it may act in.';
