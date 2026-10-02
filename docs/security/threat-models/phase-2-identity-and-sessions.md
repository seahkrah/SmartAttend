# Threat model: identity and session hardening (Phase 2)

Scope: accounts and their credentials, sign-in and its second factors, the
tokens a browser holds, sessions, and the audit trail that records what
signed-in people did. Dimension 2 of the scorecard, and the audit-chain part
of dimension 3.

## Assets

- Accounts (`users`): names, emails, phones, roles, password hashes.
- Credentials and their state: sessions and refresh-token hashes, setup and
  reset links, two-factor secrets and recovery codes, sign-in challenges,
  failed-sign-in counts, passkeys.
- The access and refresh tokens a browser holds.
- The audit trail: who did what, in which tenant.

## Today's controls (before Phase 2)

- Server-side sessions. A 15-minute access token names its session; the
  refresh token is opaque, stored as SHA-256, and rotated on every use. A
  replayed old token after a 30-second race window ends the session.
- Every request checks that the session is live and the account active.
- TOTP two-factor with recovery codes; required for configured roles.
- Lockout after repeated failures, stored in the database.
- Single-use, hashed setup and reset links.
- Session list and remote sign-out (`/api/auth/sessions`).
- Audit rows carry a checksum and the database refuses UPDATE and DELETE.

Gaps: the browser keeps both tokens in `localStorage`, readable by any script
on the page. Accounts and credential tables have no tenant boundary for the
API's runtime role (finding 17). Rate limits live in each process's memory.
The audit trail can be truncated at its end, or have a row removed by the
owner role, without a trace. There are no passkeys, no step-up, and no SSO.

## STRIDE

| Threat | Example | Phase 2 control | Residual |
|---|---|---|---|
| **Information disclosure**: accounts across tenants | A query in school A's context omitting a membership join returns every user on the platform, password hashes included (finding 17). | `users` under forced RLS: a row is visible to the runtime role only for the person themselves, a member of the tenant in force, or a row created in that tenant. The runtime role cannot read `password_hash` at all (column privilege): passwords are checked and set only by the identity code on the system pool. Membership and approval tables get the tenant policy on their tenant column. | Identity code on the system pool (sign-in, password set, account lookup by email for linking) is not filtered; it is allow-listed and returns only what the caller needs. |
| Disclosure of **credentials** | SQL injected in any route reads `auth_sessions`, setup-link hashes or TOTP secrets. | The runtime role has no privilege on credential tables. Only `src/auth/` session, token, MFA and passkey modules reach them, through the system pool. | A bug in those modules. They are small and unit- and e2e-tested. |
| **Spoofing** via a stolen token (XSS) | A script injected into the page reads `localStorage.accessToken` and the refresh token, then uses them from elsewhere for 30 days. | Tokens move to cookies: `httpOnly` (scripts cannot read them), `Secure` outside local development, `SameSite=Strict`, refresh cookie scoped to `/api/auth`. The browser app never sees a token. | XSS can still act inside the page while it is open. CSP on the frontend (Phase 8) and step-up for sensitive actions limit that. |
| **Cross-site request forgery** | Another site posts a form to the API; the browser attaches the cookie. | `SameSite=Strict`, plus a double-submit CSRF token: a state-changing request authenticated by cookie must send `X-CSRF-Token` equal to the `jj_csrf` cookie, which is an HMAC of the session id. Origin checked against the allowed list. Bearer-token requests (no ambient credential) are exempt. | — |
| **Spoofing** via refresh-token theft | A copied refresh token is used after its owner refreshed. | Rotation with reuse detection revokes the session (exists). Now tested end to end as its own suite. | A thief who refreshes first holds the session until the owner's next refresh ends it. |
| **Spoofing** via phishing of passwords and codes | A fake page relays a password and TOTP code. | WebAuthn passkeys, which are bound to the origin, as a sign-in and second factor. | People who have no passkey. |
| **Elevation** with a borrowed, signed-in session | An unlocked laptop: someone changes the email, disables two-factor or opens a break-glass grant. | Step-up: these actions need a password, TOTP or passkey proof from the last 5 minutes, recorded on the session. | — |
| **Spoofing** through SSO | A forged ID token, a token for another tenant's IdP, or an IdP asserting an email in another tenant. | OIDC per tenant: issuer, audience, signature (JWKS), nonce, state and PKCE checked; the account found must be a member of the tenant that owns the IdP configuration. | SAML is not built in Phase 2 (see the scorecard). Real IdPs need owner action. |
| **Denial of service** and guessing across replicas | Each API replica keeps its own rate-limit counters, so N replicas allow N times the attempts. | Rate-limit counters in PostgreSQL, shared by every replica. Lockout already is. | One extra write per limited request. |
| **Weak passwords** | `Welcome2024!` passes the length rule. | Breached-password check: k-anonymity range lookup (only the first five characters of the SHA-1 leave the server) when configured, and the bundled list of common passwords always. | When the range service is unreachable, only the bundled list applies; this is logged. |
| **Repudiation**: an edited or trimmed audit trail | The owner role deletes a row, or the last rows, to hide an action. | Hash chain per tenant: each row stores the hash of the previous row of its tenant and its own hash. A verifier command recomputes the chain and reports the first break. Export (JSON lines) and streaming to a webhook. | Deleting the very end of the chain is detected only against an exported or streamed copy; the verifier records the head it last saw, and the stream sends every row out. |
| **Tampering** with sessions by the runtime role | Injected SQL un-revokes a session. | No privilege on `auth_sessions` for the runtime role. | — |
