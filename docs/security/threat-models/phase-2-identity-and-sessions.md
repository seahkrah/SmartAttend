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
| **Information disclosure**: accounts across tenants | A query in school A's context omitting a membership join returns every user on the platform, password hashes included (finding 17). | `users` under forced RLS: a row is visible to the runtime role only for the person themselves, a member of the tenant in force, or a row created in that tenant. The runtime role cannot read `password_hash` at all (column privilege): passwords are checked and set only by the identity code on the system pool. Membership and approval tables get the tenant policy on their tenant column. A membership, approval or entity administrator may name only an account the tenant can already see (trigger, migration 081); making another tenant's account a member, as for a guardian already signing in at another school, is identity code on the system pool. *Added after the independent audit (F1): visibility followed memberships the tenant could write itself.* | Identity code on the system pool (sign-in, password set, account lookup by email for linking) is not filtered; it is allow-listed and returns only what the caller needs. |
| Disclosure of **credentials** | SQL injected in any route reads `auth_sessions`, setup-link hashes or TOTP secrets. | Credential tables follow their account under RLS: the runtime role sees them only for accounts of the tenant in force (or the caller's own). Tokens and recovery codes are stored as hashes, TOTP secrets sealed. Failed sign-ins, passkey challenges and SSO sign-ins are system-only. | Injected SQL inside tenant A can read A's people's hashed tokens and sealed secrets. Keeping credentials from the runtime role altogether was not done: invitations are issued inside the tenant's own transaction. |
| **Spoofing** via a stolen token (XSS) | A script injected into the page reads `localStorage.accessToken` and the refresh token, then uses them from elsewhere for 30 days. | Tokens move to cookies: `httpOnly` (scripts cannot read them), `Secure` outside local development, `SameSite=Strict`, refresh cookie scoped to `/api/auth`. The browser app never sees a token. | XSS can still act inside the page while it is open. CSP on the frontend (Phase 8) and step-up for sensitive actions limit that. |
| **Cross-site request forgery** | Another site posts a form to the API; the browser attaches the cookie. | `SameSite=Strict`, plus a double-submit CSRF token: a state-changing request authenticated by cookie must send `X-CSRF-Token` equal to the `jj_csrf` cookie, which is an HMAC of the session id. Origin checked against the allowed list. Bearer-token requests (no ambient credential) are exempt. | — |
| **Spoofing** via refresh-token theft | A copied refresh token is used after its owner refreshed. | Rotation with reuse detection revokes the session (exists). Now tested end to end as its own suite. | A thief who refreshes first holds the session until the owner's next refresh ends it. |
| **Spoofing** via phishing of passwords and codes | A fake page relays a password and TOTP code. | WebAuthn passkeys, which are bound to the origin, as a sign-in and second factor. | People who have no passkey. |
| **Elevation** with a borrowed, signed-in session | An unlocked laptop: someone changes the email, disables two-factor or opens a break-glass grant. | Step-up: these actions need a password, TOTP or passkey proof from the last 5 minutes, recorded on the session. | — |
| **Spoofing** through SSO | A forged ID token, a token for another tenant's IdP, or an IdP asserting an email in another tenant. | OIDC per tenant: issuer, audience, signature (JWKS, RS256/ES256 only), nonce, state and PKCE checked. SAML: assertion signed by the registered certificate, audience, validity window, InResponseTo of this sign-in, issuer. The account must already exist and be a member of the tenant that owns the provider. | Tested against providers the suite runs, not real tenants (owner action). A tenant's own IdP can sign in any of that tenant's members: that is what trusting it means. `trust_idp_mfa` lets the IdP's factor stand in for theirs. A person who belonged to several tenants, signed in that way, could also use their other memberships (*audit F5*); since Phase 3 such a session is bound to the provider's tenant (migration 082). |
| **Server-side request forgery** through a tenant's addresses | A tenant names `http://169.254.169.254/` as its audit collector or OIDC issuer. | HTTPS only, no credentials in the address, no redirects followed, and the host must not resolve to a private, loopback, link-local, CGNAT or multicast address (`security/outbound.ts`). IPv6 forms that carry an IPv4 address (mapped, also in hex; compatible; NAT64; 6to4) are judged by that address, and Teredo is refused (*audit F3*). | DNS rebinding: the name is resolved for the check and again for the request. |
| **Denial of service** and guessing across replicas | Each API replica keeps its own rate-limit counters, so N replicas allow N times the attempts. | Rate-limit counters in PostgreSQL, shared by every replica. Lockout already is. | One extra write per limited request. |
| **Weak passwords** | `Welcome2024!` passes the length rule. | Breached-password check: k-anonymity range lookup (only the first five characters of the SHA-1 leave the server) when configured, and the bundled list of common passwords always. | When the range service is unreachable, only the bundled list applies; this is logged. |
| **Repudiation**: an edited or trimmed audit trail | The owner role deletes a row, or the last rows, to hide an action. | Hash chain per tenant: each row stores the hash of the previous row of its tenant and its own hash. A verifier command recomputes the chain and reports the first break. Export (JSON lines) and streaming to a webhook. | Deleting the very end of the chain is detected only against an exported or streamed copy; the verifier records the head it last saw, and the stream sends every row out. |
| **Tampering** with sessions by the runtime role | Injected SQL un-revokes a session, or ends the sessions of anyone the tenant can see. | The runtime role may read `auth_sessions` for its tenant's people (RLS) but holds no INSERT, UPDATE or DELETE on it (migration 081). Sessions are created, rotated, listed for the device list and ended only by `src/auth/sessions.ts` on the system pool. *Corrected after the independent audit (F2): the first version of this row claimed no privilege at all, while the role still had UPDATE.* | — |
