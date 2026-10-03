/**
 * Single sign-on (auth/sso/*).
 *
 * Public, at /api/auth/sso:
 *   GET  /providers?tenant=CODE   the sign-in options a school or company offers
 *   GET  /:providerId/start       sends the browser to the provider
 *   GET  /oidc/callback           an OpenID Connect provider sends it back here
 *   POST /saml/acs                a SAML provider posts its answer here
 *   GET  /saml/metadata           this service provider, for the IdP's configuration
 *   POST /complete { code }       the app trades its one-time code for a session
 *
 * For a tenant's administrators, at /api/admin/sso:
 *   GET    /           the tenant's providers (never their secrets)
 *   POST   /           add an OpenID Connect or SAML provider (step-up)
 *   PATCH  /:id        enable or disable one
 *   DELETE /:id        remove one (step-up)
 */
import express, { Request, Response } from 'express'
import { query } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import { resolveTenantContext, requireRoles, requireTenant, type TenantRequest } from '../auth/tenantContextMiddleware.js'
import { requireRecentAuth } from '../auth/stepUp.js'
import { accountForSignIn, assertMaySignIn, issueTokens, LoginError, recordSignIn } from '../auth/authService.js'
import { createChallenge, mfaEnabled } from '../auth/mfaService.js'
import { deliverTokens } from '../auth/cookies.js'
import { appUrl } from '../auth/accountTokens.js'
import {
  apiPublicUrl, createOidcProvider, createSamlProvider, finishOidc, finishSaml, providersForTenantCode, SsoError, spendHandoff, startSignIn,
} from '../auth/sso/service.js'
import { samlAcsUrl, samlEntityId } from '../auth/sso/saml.js'
import { loginLimiter } from '../security/httpSecurity.js'
import { KmsError } from '../security/kms/index.js'
import { logAudit } from '../services/domainAuditService.js'
import { getClientIp } from '../utils/getClientIp.js'
import { logError } from '../utils/errorMessages.js'
import { publicRoute } from '../auth/guards.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const ssoRouter = express.Router()

ssoRouter.get('/providers', publicRoute("the sign-in providers a tenant offers, for the sign-in page"), loginLimiter, async (req: Request, res: Response) => {
  try {
    return res.json({ providers: await providersForTenantCode(String(req.query.tenant ?? '')) })
  } catch (error) {
    logError('SSO providers', error)
    return res.status(500).json({ error: 'Could not load the sign-in options' })
  }
})

/** Back to the app's sign-in page, saying why, in a word the page knows. */
function backToLogin(res: Response, code: string, error?: unknown) {
  // Why a provider's answer was refused helps whoever configures it; the
  // message names the check, never a token or an assertion.
  if (code === 'provider_refused' && error instanceof Error) console.warn('[SSO] refused:', error.message)
  return res.redirect(302, `${appUrl()}/login?sso_error=${encodeURIComponent(code)}`)
}

ssoRouter.get('/:providerId/start', publicRoute("starts single sign-on with a tenant's identity provider"), loginLimiter, async (req: Request, res: Response) => {
  if (!UUID.test(req.params.providerId)) return backToLogin(res, 'unknown_provider')
  try {
    return res.redirect(302, await startSignIn(req.params.providerId))
  } catch (error) {
    if (error instanceof SsoError) return backToLogin(res, error.code)
    logError('SSO start', error)
    return backToLogin(res, 'error')
  }
})

ssoRouter.get('/oidc/callback', publicRoute("the identity provider returns here; state, nonce and PKCE are checked"), loginLimiter, async (req: Request, res: Response) => {
  // The provider reports its own refusals (the person cancelled, say) here.
  if (req.query.error) return backToLogin(res, 'provider_refused')
  try {
    const code = await finishOidc(req.query.state, req.query.code)
    // In the fragment: it reaches the app's script, and no server's log.
    return res.redirect(302, `${appUrl()}/sso/complete#code=${encodeURIComponent(code)}`)
  } catch (error) {
    if (error instanceof SsoError) return backToLogin(res, error.code, error)
    logError('SSO callback', error)
    return backToLogin(res, 'error')
  }
})

ssoRouter.post('/saml/acs', publicRoute("the identity provider posts a signed assertion here"), loginLimiter, async (req: Request, res: Response) => {
  try {
    const code = await finishSaml(req.body?.RelayState, req.body?.SAMLResponse)
    return res.redirect(302, `${appUrl()}/sso/complete#code=${encodeURIComponent(code)}`)
  } catch (error) {
    if (error instanceof SsoError) return backToLogin(res, error.code, error)
    logError('SAML ACS', error)
    return backToLogin(res, 'error')
  }
})

/** What an identity provider's administrator needs to register this service. */
ssoRouter.get('/saml/metadata', publicRoute("this service provider's metadata, for the identity provider"), (_req: Request, res: Response) => {
  const api = apiPublicUrl()
  res.type('application/samlmetadata+xml').send(`<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${samlEntityId(api)}">
  <md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" WantAssertionsSigned="true">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${samlAcsUrl(api)}" index="1"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`)
})

ssoRouter.post('/complete', publicRoute("redeems the single-use handoff code from the callback"), loginLimiter, async (req: Request, res: Response) => {
  try {
    // The session may act only in the tenant whose provider vouched (F5).
    const { userId, mfaDone, tenantId } = await spendHandoff(req.body?.code)
    const user = await accountForSignIn(userId)
    if (!user) throw new SsoError('no_account', 'There is no account for that address here.')
    await assertMaySignIn(user, false)
    // Our second factor still applies, unless the tenant trusts its
    // provider's and the provider says it used one.
    if (!mfaDone && (await mfaEnabled(user.id))) {
      return res.json({ mfaRequired: true, mfaToken: await createChallenge(user.id, getClientIp(req), tenantId) })
    }
    const tokens = await issueTokens(user, { ip: getClientIp(req), userAgent: String(req.headers['user-agent'] ?? ''), boundTenantId: tenantId })
    await recordSignIn(user.id)
    return res.json({
      message: 'Login successful',
      user: {
        id: user.id, email: user.email, fullName: user.full_name, phone: user.phone, platform: user.platform_name,
        role: user.role_name, permissions: user.permissions || [], profileImage: user.profile_image_url,
        mustResetPassword: false,
      },
      ...deliverTokens(req, res, tokens),
    })
  } catch (error) {
    if (error instanceof SsoError) return res.status(400).json({ error: error.message, code: error.code.toUpperCase() })
    if (error instanceof LoginError) return res.status(403).json({ error: error.message, code: error.code.toUpperCase() })
    logError('SSO complete', error)
    return res.status(500).json({ error: 'Sign-in failed. Please try again.' })
  }
})

export const ssoAdminRouter = express.Router()
ssoAdminRouter.use(authenticateToken, resolveTenantContext, requireTenant, requireRoles('admin'))

ssoAdminRouter.get('/', async (req: TenantRequest, res: Response) => {
  const r = await query(
    `SELECT id, kind, name, issuer, client_id, idp_entity_id, idp_sso_url, email_domains, trust_idp_mfa, enabled, created_at
       FROM tenant_sso_providers WHERE tenant_id = $1 ORDER BY created_at`,
    [req.ctx!.tenantId]
  )
  const api = apiPublicUrl()
  return res.json({
    providers: r.rows,
    // What to register at the provider.
    oidcRedirectUri: `${api}/api/auth/sso/oidc/callback`,
    saml: { entityId: samlEntityId(api), acsUrl: samlAcsUrl(api), metadataUrl: `${api}/api/auth/sso/saml/metadata` },
  })
})

ssoAdminRouter.post('/', requireRecentAuth, async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    const kind = req.body?.kind ?? 'oidc'
    if (kind !== 'oidc' && kind !== 'saml') return res.status(400).json({ error: 'kind is oidc or saml' })
    const p = kind === 'saml'
      ? await createSamlProvider({ query }, {
          tenantId: ctx.tenantId!, name: req.body?.name, entityId: req.body?.entityId, ssoUrl: req.body?.ssoUrl,
          certificate: req.body?.certificate, emailDomains: req.body?.emailDomains, trustIdpMfa: req.body?.trustIdpMfa,
          createdBy: ctx.userId,
        })
      : await createOidcProvider({ query }, {
          tenantId: ctx.tenantId!, name: req.body?.name, issuer: req.body?.issuer, clientId: req.body?.clientId,
          clientSecret: req.body?.clientSecret, emailDomains: req.body?.emailDomains, trustIdpMfa: req.body?.trustIdpMfa,
          createdBy: ctx.userId,
        })
    await logAudit({ actorId: ctx.userId, actorRole: ctx.roleName, actionType: 'SSO_PROVIDER_ADDED', actionScope: 'TENANT',
      resourceType: 'sso_provider', resourceId: p.id, tenantId: ctx.tenantId!, ipAddress: getClientIp(req),
      afterState: { kind: p.kind, name: p.name, issuer: p.issuer ?? p.idp_entity_id, emailDomains: p.email_domains, trustIdpMfa: p.trust_idp_mfa } })
    return res.status(201).json({ provider: p })
  } catch (error) {
    if (error instanceof SsoError) return res.status(400).json({ error: error.message, code: error.code.toUpperCase() })
    if (error instanceof KmsError) return res.status(503).json({ error: 'Single sign-on needs a key manager (KMS) to keep the client secret.' })
    logError('SSO provider add', error)
    return res.status(500).json({ error: 'Could not add the provider' })
  }
})

ssoAdminRouter.patch('/:id', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  if (!UUID.test(req.params.id) || typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'Say enabled: true or false' })
  const r = await query(
    `UPDATE tenant_sso_providers SET enabled = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2 RETURNING id, enabled`,
    [req.params.id, ctx.tenantId, req.body.enabled]
  )
  if (!r.rows.length) return res.status(404).json({ error: 'Not found' })
  await logAudit({ actorId: ctx.userId, actorRole: ctx.roleName, actionType: req.body.enabled ? 'SSO_PROVIDER_ENABLED' : 'SSO_PROVIDER_DISABLED',
    actionScope: 'TENANT', resourceType: 'sso_provider', resourceId: req.params.id, tenantId: ctx.tenantId!, ipAddress: getClientIp(req) })
  return res.json({ provider: r.rows[0] })
})

ssoAdminRouter.delete('/:id', requireRecentAuth, async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Not found' })
  const r = await query(`DELETE FROM tenant_sso_providers WHERE id = $1 AND tenant_id = $2 RETURNING name`, [req.params.id, ctx.tenantId])
  if (!r.rows.length) return res.status(404).json({ error: 'Not found' })
  await logAudit({ actorId: ctx.userId, actorRole: ctx.roleName, actionType: 'SSO_PROVIDER_REMOVED', actionScope: 'TENANT',
    resourceType: 'sso_provider', resourceId: req.params.id, tenantId: ctx.tenantId!, ipAddress: getClientIp(req),
    beforeState: { name: r.rows[0].name } })
  return res.json({ removed: true })
})
