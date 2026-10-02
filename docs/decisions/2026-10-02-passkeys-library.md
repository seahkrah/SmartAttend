# Passkeys: SimpleWebAuthn

Date: 2026-10-02. Status: accepted.

WebAuthn verification (CBOR, COSE keys, attestation formats, signature
counters) is easy to get subtly wrong and is not something to write by hand.

| Package | Where | Licence | Why | Maintenance |
|---|---|---|---|---|
| `@simplewebauthn/server` 14 | backend (ships in the API image) | MIT | Generates registration and authentication options and verifies the responses. Its dependencies are the `@peculiar` ASN.1 and X.509 libraries and a small CBOR decoder. | Active since 2020; the reference Node library in the FIDO Alliance developer resources |
| `@simplewebauthn/browser` 14 | frontend (ships in the web bundle) | MIT | Calls `navigator.credentials` and converts between its binary values and JSON. No dependencies. | Same project |

Both were added with `npm install`; the backend lockfile gained only these
packages and their dependencies, nothing existing changed. `npm audit` found
nothing new.

How it is used: `apps/backend/src/auth/passkeys.ts`. User verification is
required, attestation is "none" (we trust the passkey to belong to whoever
registered it while signed in, not to a vendor), the relying party is the
site's host, and the accepted origins are the API's allowed origins. The end-to-end
suite `webauthn` checks the verification with a software authenticator that
builds every message itself, so a regression in the library or in our use of
it fails CI.

## SAML: node-saml

| Package | Where | Licence | Why | Maintenance |
|---|---|---|---|---|
| `@node-saml/node-saml` 5 | backend (ships in the API image) | MIT | SAML 2.0 service provider: builds the AuthnRequest, verifies the response's XML signature (through `xml-crypto` 6), audience, validity window and InResponseTo. XML signature handling is where SAML implementations fail; this is the maintained successor of `passport-saml`. | node-saml organisation; active |

Used in `apps/backend/src/auth/sso/saml.ts` with assertions required to be
signed, InResponseTo always checked against the one sign-in whose RelayState
came back, and the assertion's issuer checked by our code as well: the
library's `idpIssuer` option did not catch an assertion from another issuer
signed with the registered key (found by the `sso` suite). `npm audit`
found nothing new.
