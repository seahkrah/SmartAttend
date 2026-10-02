/**
 * Single sign-on (auth/sso/*).
 *
 * Public, at /api/auth/sso:
 *   GET  /providers?tenant=CODE   the sign-in options a school or company offers
 *   GET  /:providerId/start       sends the browser to the provider
 *   GET  /oidc/callback           the provider sends it back here
 *   POST /complete { code }       the app trades its one-time code for a session
 *
 * For a tenant's administrators, at /api/admin/sso:
 *   GET    /           the tenant's providers (never their secrets)
 *   POST   /           add an OpenID Connect provider (step-up)
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
import { createOidcProvider, finishOidc, providersForTenantCode, SsoError, spendHandoff, startSignIn } from '../auth/sso/service.js'
import { loginLimiter } from '../security/httpSecurity.js'
import { KmsError } from '../security/kms/index.js'
import { logAudit } from '../services/domainAuditService.js'
import { getClientIp } from '../utils/getClientIp.js'
import { logError } from '../utils/errorMessages.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const ssoRouter = express.Router()

ssoRouter.get('/providers', loginLimiter, async (req: Request, res: Response) => {
  try {
    return res.json({ providers: await providersForTenantCode(String(req.query.tenant ?? '')) })
  } catch (error) {
    logError('SSO providers', error)
    return res.status(500).json({ error: 'Could not load the sign-in options' })
  }
})

/** Back to the app's sign-in page, saying why, in a word the page knows. */
function backToLogin(res: Response, code: string) {
  return res.redirect(302, `${appUrl()}/login?sso_error=${encodeURIComponent(code)}`)
}

ssoRouter.get('/:providerId/start', loginLimiter, async (req: Request, res: Response) => {
  if (!UUID.test(req.params.providerId)) return backToLogin(res, 'unknown_provider')
  try {
    return res.redirect(302, await startSignIn(req.params.providerId))
  } catch (error) {
    if (error instanceof SsoError) return backToLogin(res, error.code)
    logError('SSO start', error)
    return backToLogin(res, 'error')
  }
})

ssoRouter.get('/oidc/callback', loginLimiter, async (req: Request, res: Response) => {
  // The provider reports its own refusals (the person cancelled, say) here.
  if (req.query.error) return backToLogin(res, 'provider_refused')
  try {
    const code = await finishOidc(req.query.state, req.query.code)
    // In the fragment: it reaches the app's script, and no server's log.
    return res.redirect(302, `${appUrl()}/sso/complete#code=${encodeURIComponent(code)}`)
  } catch (error) {
    if (error instanceof SsoError) return backToLogin(res, error.code)
    logError('SSO callback', error)
    return backToLogin(res, 'error')
  }
})

ssoRouter.post('/complete', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { userId, mfaDone } = await spendHandoff(req.body?.code)
    const user = await accountForSignIn(userId)
    if (!user) throw new SsoError('no_account', 'There is no account for that address here.')
    await assertMaySignIn(user, false)
    // Our second factor still applies, unless the tenant trusts its
    // provider's and the provider says it used one.
    if (!mfaDone && (await mfaEnabled(user.id))) {
      return res.json({ mfaRequired: true, mfaToken: await createChallenge(user.id, getClientIp(req)) })
    }
    const tokens = await issueTokens(user, { ip: getClientIp(req), userAgent: String(req.headers['user-agent'] ?? '') })
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
    `SELECT id, kind, name, issuer, client_id, email_domains, trust_idp_mfa, enabled, created_at
       FROM tenant_sso_providers WHERE tenant_id = $1 ORDER BY created_at`,
    [req.ctx!.tenantId]
  )
  return res.json({
    providers: r.rows,
    redirectUri: `${process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`}/api/auth/sso/oidc/callback`,
  })
})

ssoAdminRouter.post('/', requireRecentAuth, async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    if (req.body?.kind && req.body.kind !== 'oidc') {
      return res.status(400).json({ error: 'Only OpenID Connect providers can be added here' })
    }
    const p = await createOidcProvider({ query }, {
      tenantId: ctx.tenantId!, name: req.body?.name, issuer: req.body?.issuer, clientId: req.body?.clientId,
      clientSecret: req.body?.clientSecret, emailDomains: req.body?.emailDomains, trustIdpMfa: req.body?.trustIdpMfa,
      createdBy: ctx.userId,
    })
    await logAudit({ actorId: ctx.userId, actorRole: ctx.roleName, actionType: 'SSO_PROVIDER_ADDED', actionScope: 'TENANT',
      resourceType: 'sso_provider', resourceId: p.id, tenantId: ctx.tenantId!, ipAddress: getClientIp(req),
      afterState: { name: p.name, issuer: p.issuer, emailDomains: p.email_domains, trustIdpMfa: p.trust_idp_mfa } })
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
