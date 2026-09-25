# Accounts, sign-in and sessions

What the platform guarantees about who is signed in, how accounts come to
exist, and what it does not yet do. Code references are to `apps/backend/src`.

## Sessions

A sign-in creates a row in `auth_sessions` (migration 058). The browser gets:

- an **access token**: a JWT valid for 15 minutes naming the user and the
  session (`sid`);
- a **refresh token**: 256 random bits, opaque. The server stores only its
  SHA-256.

Every authenticated request checks the session is live and the account
active (`auth/middleware.ts` → `sessionIsLive`). So these take effect on the
**next request**, not when a token expires:

| Event | Sessions ended |
|---|---|
| `POST /api/auth/logout` | this one |
| `POST /api/auth/logout-all` | all of the user's |
| `DELETE /api/auth/sessions/:id` | that one (own sessions only; another user's reads as 404) |
| Password change | all but the device that changed it |
| Password reset or account activation | all |
| Account deactivated (`users.is_active = false`) | all, via the per-request check |
| Refresh token replayed after rotation | that session (see below) |

**Rotation.** Every `POST /api/auth/refresh` replaces the refresh token. The
token just replaced gets `409 REFRESH_RACE` for 30 seconds, because two tabs can
refresh at once; the browser then uses the pair the other tab stored
(`frontend/src/utils/sessionRefresh.ts`, one refresh in flight per tab).
Presenting a replaced token after that window means it was copied: the session
is ended, which signs out both the thief and the owner, and the reason
`refresh_token_reused` is recorded.

Sessions last 30 days from sign-in. Ended sessions are deleted 30 days after
they end.

Users see their signed-in devices, and can end any of them, on every settings
page (`SessionsPanel`).

## Sign-in

`POST /api/auth/login` and `POST /api/auth/login-superadmin` share one
implementation (`auth/authService.ts` → `loginUser`).

- **Nothing is revealed before the password is right.** An unknown address
  and a wrong password get the same 401 and body. For an unknown address the
  password is still compared, against a dummy bcrypt hash, so the two take the
  same time.
- **Lockout.** Five wrong passwords for an address within 15 minutes pause
  sign-in for that address, returning `429 LOGIN_LOCKED` with `Retry-After`,
  even for the right password. This applies whether or not the address has an
  account, so it cannot be used to discover accounts. Failures are stored in
  the database (`auth_failed_logins`), so the lockout holds across processes
  and restarts. A successful sign-in clears the count.
  - Trade-off: someone who knows an address can keep it locked by guessing
    wrongly. The pause is short and the owner can still reset their password.
- Only after a correct password are these reported: wrong platform
  (`PLATFORM_MISMATCH`), not yet activated, awaiting approval, suspended, no
  tenant, tenant suspended.
- The superadmin sign-in page accepts only platform superadmins. Anyone
  else's correct password reads as a wrong one there.

## Passwords

`auth/passwordPolicy.ts`, following NIST SP 800-63B:

- 10 to 128 characters, with no composition rules;
- not on a list of the most common passwords (also checked with punctuation
  stripped);
- does not contain the email's local part;
- is not one repeated character.

Passwords are hashed with bcrypt at cost 12. The same policy applies to
activation, reset, change and self-registration. The server returns the
specific problems, and the pages show them.

## How accounts come to exist

**Nobody chooses another person's password.** An administrator creating an
account (school users, students and faculty, corporate employees, admissions
enrolment, bulk import, a superadmin appointing a tenant administrator)
creates it with a password nobody knows (`unusablePasswordHash`). They also
send an **invitation**: a single-use link, valid for 7 days, to `/activate`,
where the person chooses their own password. The creating call returns how
the invitation travels, never a password:

- `email`: queued to a working email channel;
- `simulated`: the tenant has no email provider, so the message was recorded
  but not sent;
- `unavailable`: email is switched off, or the message could not be queued.

When email is not available, the administrator can ask for the link itself
(`handover: true`) to give to the person directly. That request:

- is audited (`USER_SETUP_LINK_ISSUED`); the audit write happens inside the
  transaction, so no audit record means no link;
- works only for an account nobody has signed in to;
- never works for an administrator's account from a tenant screen;
- cancels any earlier link.

Endpoints:

- `POST /api/auth/admin/school/users/:userId/invitation`
- `POST /api/corporate/admin/employees/:employeeId/invitation`
- `POST /api/superadmin/tenant-admins/:adminId/invitation`

Until the invitation is used, sign-in is refused and the user lists show
**Awaiting setup**.

**Self-registration** (`POST /api/auth/register-with-role`) always waits for
an administrator of the chosen tenant. Before this, students and employees
were admitted at once, so anyone could make themselves a member of any school
or company by picking it from a list.

The legacy `POST /api/auth/register`, which created an active account with
whatever role id the client sent, is gone.

**Superadmins.** `POST /api/auth/register-superadmin` needs
`SUPERADMIN_BOOTSTRAP_TOKEN` (at least 32 characters, compared in constant
time) in production, and everywhere once a superadmin exists.

## Password reset

`POST /api/auth/password/forgot` always answers 202 with the same text. The
work happens after the answer is sent, so neither the answer nor its timing
depends on whether the account exists. For a real, activated account it
queues a link to `/reset-password`, valid for 30 minutes and single use. It
sends at most one per account every two minutes. Using the link ends every
session.

Superadmins have no tenant outbox, so they are not sent reset links; another
superadmin restores their access.

Both kinds of link:

- store only the token's SHA-256 (`auth_tokens`);
- are spent atomically, so a link works once;
- are cancelled when a newer link of the same kind is issued.

The pages remove the token from the address bar as soon as they load.

**Administrators cannot read the links.** The wording of `account.invitation`
and `account.password_reset` is fixed in code: tenants cannot override those
templates (`403`). Their bodies are withheld from
`GET /api/notifications/messages/:id` (`body_withheld: true`). The body is
stored in `notification_messages` because the delivery worker needs it. Anyone
with direct database access can therefore read an unexpired link. The links
are short-lived and single use.

## HTTP protections

`security/httpSecurity.ts`:

- **Security headers** (helmet). The API serves JSON and files only, so its
  content security policy is `default-src 'none'; frame-ancestors 'none'`.
- **CORS.** Only the origins in `CORS_ORIGINS` get a grant; development falls
  back to the local Vite and preview ports.
- **Client address.** This is Express's `req.ip`, which honours forwarding
  headers only from proxies named in `TRUST_PROXY`. It used to be the first
  `X-Forwarded-For` entry of any request, so a client could choose the address
  that the IP allowlist, the audit trail and sign-in throttling believed.
- **Rate limits** per client address, all configurable:

  | Scope | Default limit |
  |---|---|
  | Whole API | 3000 per minute |
  | Sign-in | 120 per minute |
  | Refresh | 600 per minute |
  | Account endpoints (forgot, reset, activate, register) | 30 per 15 minutes |

  They are generous because a whole school behind one NAT shares an address.
  They are counted per process, in memory; the lockout above is what stops
  guessing against one account.
- **Production configuration check** (`config/validateEnv.ts`). With
  `NODE_ENV=production` the server refuses to start if any of these is
  missing or looks like a placeholder:
  - `JWT_SECRET`
  - `DATABASE_URL`
  - `PUBLIC_APP_URL` (must be https)
  - `CORS_ORIGINS`

## Not done yet

These are stated so nobody assumes otherwise:

- **No second factor.** There is no TOTP or WebAuthn for administrators or
  superadmins yet. The earlier "MFA" middleware accepted any code and was
  removed.
- **Tokens live in `localStorage`.** A script injected into the web app could
  read them. Moving the refresh token to an `httpOnly`, `SameSite=Strict`
  cookie (with CSRF protection on `/refresh`) would remove that exposure. It
  is not done.
- **No single sign-on** (SAML or OIDC).
- **Rate limits are per process.** Behind several API instances each has its
  own counters; a shared store (Redis) would make them global. The sign-in
  lockout is already global.
- **Email delivery depends on each tenant configuring a provider.** Until one
  is configured, invitations and resets are recorded, not sent. Administrators
  are told so and can hand over setup links. Password resets for such a tenant
  have no delivery path except an administrator issuing a new setup link, and
  that is possible only for accounts that have never signed in.

## Tests

- `apps/backend/src/tests/accountSecurity.e2e.py` (90 checks against the
  running API): sessions, rotation and replay, logout, device sign-out,
  expiry, password change, reset, lockout, spoofed addresses, deactivation,
  invitations and handover for school, corporate and superadmin, template
  lock, outbox redaction, self-registration, superadmin bootstrap, CORS and
  headers.
- `apps/backend/src/auth/authSecurity.test.ts` (unit): password policy,
  production configuration, CORS and proxy settings, the rate limiter's 429,
  token hashing.
