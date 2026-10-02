-- Phase 2: single sign-on per tenant (src/auth/sso/*, routes/sso.ts).
--
-- A school or company can let its people sign in through its own identity
-- provider (Google Workspace, Microsoft Entra ID, any OpenID Connect
-- provider; SAML 2.0). The provider vouches for an email address; the
-- account must already exist and belong to that tenant. Nobody is created
-- by signing in: accounts come from the tenant's administrators (and, later,
-- SCIM).

CREATE TABLE IF NOT EXISTS tenant_sso_providers (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind                  text NOT NULL CHECK (kind IN ('oidc', 'saml')),
  name                  text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  enabled               boolean NOT NULL DEFAULT true,
  -- OpenID Connect: the issuer and what its discovery document said.
  issuer                text,
  client_id             text,
  client_secret_sealed  bytea,
  client_secret_iv      bytea,
  client_secret_tag     bytea,
  client_secret_dek_version integer,
  authorization_endpoint text,
  token_endpoint        text,
  jwks_uri              text,
  -- SAML 2.0: the IdP's entity id, sign-in URL and signing certificate.
  idp_entity_id         text,
  idp_sso_url           text,
  idp_certificate       text,
  -- Addresses the provider may vouch for (e.g. {'school.edu.lr'}); empty means any.
  email_domains         text[] NOT NULL DEFAULT '{}',
  -- Whether the provider's own two-factor stands in for ours.
  trust_idp_mfa         boolean NOT NULL DEFAULT false,
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (kind <> 'oidc' OR (issuer IS NOT NULL AND client_id IS NOT NULL AND token_endpoint IS NOT NULL AND jwks_uri IS NOT NULL)),
  CHECK (kind <> 'saml' OR (idp_entity_id IS NOT NULL AND idp_sso_url IS NOT NULL AND idp_certificate IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_tenant_sso_providers_tenant ON tenant_sso_providers (tenant_id);

-- A sign-in in flight: state, nonce and PKCE verifier (OIDC) or request id
-- (SAML). Single-use, ten minutes; exists before anyone is known, so the
-- table is system-only.
CREATE TABLE IF NOT EXISTS sso_sign_ins (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id    uuid NOT NULL REFERENCES tenant_sso_providers(id) ON DELETE CASCADE,
  state_hash     text NOT NULL UNIQUE,
  nonce          text NOT NULL,
  code_verifier  text,
  cookie_mode    boolean NOT NULL DEFAULT true,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sso_sign_ins_expires ON sso_sign_ins (expires_at);
SELECT app_apply_scoped_rls('sso_sign_ins', '(SELECT app_is_system())');

-- One-time codes the browser trades for its session after the provider's
-- redirect, so tokens never travel in a URL.
CREATE TABLE IF NOT EXISTS sso_handoffs (
  code_hash   text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES tenant_sso_providers(id) ON DELETE CASCADE,
  mfa_done    boolean NOT NULL DEFAULT false,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
SELECT app_apply_scoped_rls('sso_handoffs', '(SELECT app_is_system())');

SELECT app_apply_tenant_rls();
