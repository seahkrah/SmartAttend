# Deploying and operating JjeloTech

Everything here was run end to end against the images built from this
repository: migrations from an empty database, readiness, the face engine
inside the container, superadmin bootstrap and sign-in, a backup, and a
verified restore. What has not been done is listed at the end.

## The pieces

| Image | Built from | Runs |
|---|---|---|
| `jjelotech-api` | `apps/backend/Dockerfile` (context: repository root) | the API as an unprivileged user; `node dist/db/migrate.js` applies migrations |
| `jjelotech-web` | `apps/frontend/Dockerfile` (context: repository root) | the built web app on nginx, port 8080, unprivileged |
| PostgreSQL 16 | `postgres:16-bookworm` | the database |

The API image is Debian-based (about 1.2 GB) because face matching uses
TensorFlow's native binding, which does not run on Alpine.

## Run the stack

```bash
cp deploy/.env.example deploy/.env      # fill in every value; generate secrets
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Startup order:

1. The database starts.
2. The `migrate` job applies any new migrations and exits.
3. The API starts only if the migrations succeeded.
4. The web app is compiled for `API_PUBLIC_URL`, so change that and you
   rebuild `web`.

Put a TLS-terminating reverse proxy (Caddy, nginx, a cloud load balancer) in
front of the API and web ports. Neither container serves HTTPS.
`TRUST_PROXY=1` tells the API there is exactly one proxy in front of it, so
it takes the client's address from that proxy's `X-Forwarded-For` and from
nowhere else.

### Production configuration

With `NODE_ENV=production` the API refuses to start if `JWT_SECRET`,
`DATABASE_URL`, `PUBLIC_APP_URL` (https) or `CORS_ORIGINS` is missing or looks
like a placeholder.

Database TLS is `DATABASE_SSL=verify` by default: encrypted, with the server's
certificate checked, against `DATABASE_SSL_CA` for a private CA. Use
`DATABASE_SSL=off` only for a database reachable solely on a private network,
as in the compose file. There is no setting that encrypts without checking the
certificate.

Two-factor sign-in (an authenticator app or a passkey) is required for every
privileged role (superadmin, admin, hr_director, hr, it) everywhere but
`NODE_ENV=development` or `test`, staging included. `MFA_REQUIRED_ROLES` can
add roles to that list, never remove them. Each person sets it up on first
sign-in. Set `MFA_ENCRYPTION_KEY` (`openssl rand -base64 32`)
before anyone enrols, and keep it with the other secrets: losing it means
everyone sets up two-factor again. `DATABASE_POOL_MAX` (default 20) should be
the database's `max_connections` divided by the number of API replicas.

### First superadmin

Either of:

- run `SUPERADMIN_EMAIL=… SUPERADMIN_NAME=… npm run setup-superadmin` from a
  checkout of `apps/backend` with `DATABASE_URL` pointing at the database;
- `POST /api/auth/register-superadmin` with header
  `X-Bootstrap-Token: $SUPERADMIN_BOOTSTRAP_TOKEN`. In production this is
  refused without the token, even for the first account.

Then create tenants and appoint their administrators from the control plane.
Administrators receive invitation links, or you hand the links over.

### Sessions, cookies and sign-in

The browser app keeps its session in two `httpOnly`, `SameSite=Strict`
cookies set by the API (`src/auth/cookies.ts`), and sends a CSRF token with
every state-changing request. For the browser to send those cookies, **the
app and the API must be on the same site**: one registrable domain, such as
`app.school.lr` and `api.school.lr`. Two unrelated domains will not work.

| Setting | Default | What it does |
|---|---|---|
| `CORS_ORIGINS` | none in production | The app's origin(s). Also the origins whose cookie-authenticated writes are accepted, and the passkey origins unless `WEBAUTHN_ORIGINS` is set. |
| `CSRF_SECRET` | `JWT_SECRET` | Key of the CSRF token (an HMAC of the session id). Set its own value to rotate it apart from the access tokens. |
| `COOKIE_SECURE` | on in production | Cookies sent over HTTPS only. Cannot be turned off in production. |
| `STEP_UP_MAX_AGE_SECONDS` | `300` | How recent a sign-in or step-up must be for sensitive actions. |
| `PASSWORD_BREACH_CHECK` | `range` in production | `off` stops the Pwned Passwords range lookup (only five hex characters of a SHA-1 leave the server). `PASSWORD_BREACH_RANGE_URL` points it at a mirror. |
| `RATE_LIMIT_SHARED_API` | `false` | Also count the general per-address limit in PostgreSQL. The sign-in, refresh, account and two-factor limits always are. |
| `WEBAUTHN_RP_ID` | host of `PUBLIC_APP_URL` | The passkey relying party. Changing it later makes existing passkeys unusable. |
| `API_PUBLIC_URL` | `http://localhost:$PORT` | The API's public address: single sign-on's redirect and SAML endpoints are built from it. |

Single sign-on is configured per tenant by its administrators
(`/api/admin/sso`): an OpenID Connect provider by issuer, client id and
secret (register `<API_PUBLIC_URL>/api/auth/sso/oidc/callback` as its
redirect URI), or a SAML provider by entity id, sign-in URL and signing
certificate (give it `<API_PUBLIC_URL>/api/auth/sso/saml/metadata`). The
client secret, and every audit-stream secret, is sealed under the tenant's
data key, so both need the KMS (see "Encryption keys"). Addresses a tenant
chooses (an identity provider, an audit collector) must be public HTTPS;
`OUTBOUND_ALLOW_HTTP` and `OUTBOUND_ALLOW_PRIVATE` exist for test
environments only.

### The audit trail

Each tenant's audit rows form a hash chain (migration 079). Check it with

```bash
node dist/scripts/verifyAuditChain.js --checkpoint /secure/audit-checkpoint.json
```

(`npm run audit:verify` from a checkout). It exits 1 and names every break.
Run it on a schedule, and keep the checkpoint file where the database's
owner cannot write: it is what shows the end of a chain cut off and the head
rewound. Tenants can also stream their trail to a collector of their own
(`/api/audit/streams`); `AUDIT_STREAM_INTERVAL_MS` (5 s) and
`AUDIT_STREAM_RETRY_BASE_MS` (5 s) pace delivery.

## Health

- `GET /api/health`: the process is up (liveness).
- `GET /api/health/ready`: returns 200 only when the database answers and no
  migration is pending (readiness). The API image's `HEALTHCHECK` uses it; so
  should any load balancer or orchestrator.

In production the API writes one JSON line per request (time, method, path,
status, milliseconds, never the query string) to stdout. Ship stdout to your
log system.

## Backups

```bash
deploy/backup.sh                              # prints the path of the new dump
deploy/verify-restore.sh backups/jjelotech-<stamp>.dump
```

`backup.sh` writes two things:

- a `pg_dump` custom-format dump;
- a tar of the uploaded files.

It keeps the newest 14 of each (`KEEP` to change). Both are written under a
temporary name and renamed when complete, so a half-written backup never
looks finished.

`verify-restore.sh` restores a dump into a scratch database on the same
server, checks every table's row count against the dump's own data, checks
that migrations are recorded, and checks that the files archive is readable.
It then drops the scratch database. It exits non-zero if any check fails,
and it was confirmed to fail on a truncated dump.

Run both on a schedule, for example nightly with cron. Copy the backups off
the machine; a backup on the same disk as the database protects against
mistakes, not against losing the disk.

For a managed PostgreSQL, use the provider's snapshots or
`pg_dump "$DATABASE_URL" -Fc`, and still restore one regularly.

### Restoring for real

1. Stop the API: `docker compose stop api`.
2. Create an empty database, then run
   `pg_restore --no-owner -d <db> <dump>`.
3. Point `DATABASE_URL` at it.
4. Unpack the files archive into the files volume.
5. Start the API and confirm `/api/health/ready` returns 200.

## Encryption keys

Two kinds of secret protect data at rest, and neither is ever stored in the
database:

- `BIOMETRIC_TEMPLATE_KEY`: the original key for face templates.
  Templates sealed under it keep opening.
- A **key-encryption key (KEK)** for per-tenant data keys
  ([src/security/kms](../../apps/backend/src/security/kms)). Each tenant gets
  its own data key per purpose, stored only wrapped by the KEK and bound to
  that tenant. New face templates are sealed under the tenant's key, so a
  template copied into another tenant's row cannot be opened, and deleting a
  tenant's keys (`tenant_data_keys`) makes its sealed data unreadable,
  backups included.

| Setting | Meaning |
|---|---|
| `KMS_BACKEND=local` with `KMS_LOCAL_KEK` (32 bytes, `openssl rand -hex 32`) or `KMS_LOCAL_KEK_FILE` | The KEK in the environment or a file. Keep it out of database backups. |
| `KMS_BACKEND=vault-transit` with `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_TRANSIT_KEY` | HashiCorp Vault's transit engine. Create the key with `derived=true`, so the tenant context binds every wrap. |
| unset | Per-tenant keys are off; templates are sealed under `BIOMETRIC_TEMPLATE_KEY`. |

Losing the KEK makes every tenant's sealed data unreadable. Back it up
separately from the database, and test a restore with it.

## Database roles

Tenant data is filtered by PostgreSQL row-level security
([decisions/2026-10-02-adopt-rls.md](../decisions/2026-10-02-adopt-rls.md)).
That needs two connections:

| Setting | Role | Used for |
|---|---|---|
| `DATABASE_URL` | the owner (runs migrations; member of `jjelotech_system`) | migrations, and the API's system pool: identity lookups, the control plane, the notification dispatcher |
| `APP_DATABASE_URL` | the runtime login, a member of `jjelotech_app`: not the owner, not a superuser, `NOBYPASSRLS` | every other query the API makes |

The compose stack does this for you: set `APP_DB_PASSWORD` in `deploy/.env`
(`openssl rand -hex 24`; hex, so it needs no escaping in a URL), and the
`migrate` job creates or updates the `jjelotech_api` login after migrating.
Elsewhere, after migrations:

```bash
DATABASE_URL=<owner> APP_DB_USER=jjelotech_api APP_DB_PASSWORD=<secret>   node dist/scripts/createRuntimeRole.js
```

then set `APP_DATABASE_URL` for the API. Without it the API runs everything
as the owner and nothing is filtered (the API logs
`runtime role in use` at start when it is set).

**If the owner cannot create roles** (a managed database where the
migration user lacks `CREATEROLE`), migration 069 warns, enables RLS without
forcing it, and the API keeps working as before. Have an administrator run,
once:

```sql
CREATE ROLE jjelotech_app NOLOGIN NOBYPASSRLS;
CREATE ROLE jjelotech_system NOLOGIN;
GRANT jjelotech_system TO <migration user>;
```

then re-run migrations (069 is idempotent and forces RLS once the roles
exist) and create the runtime login as above.

## Rolling back across the migration renumbering

Fourteen migrations were renamed on 2026-10-01 (`006_…` became `006a_…`, and
so on; see `apps/backend/src/db/migrationLedger.ts`). The first `migrate.ts`
run of a newer image rewrites those rows in the `migrations` table.

An image built **before** that change knows only the old names. Rolled back
onto a database the newer image has migrated, it would see fourteen pending
migrations: its readiness check would never report ready, and its migrator
would try to run them again over the existing schema. Do not run the old
migrator. First put the ledger back, in one transaction:

```sql
BEGIN;
UPDATE migrations SET name = '006_add_platform_id_to_school_departments.sql' WHERE name = '006a_add_platform_id_to_school_departments.sql';
UPDATE migrations SET name = '006_infrastructure_control_plane.sql' WHERE name = '006b_infrastructure_control_plane.sql';
UPDATE migrations SET name = '006_superadmin_security_tables.sql' WHERE name = '006c_superadmin_security_tables.sql';
UPDATE migrations SET name = '007_add_platform_id_to_students.sql' WHERE name = '007a_add_platform_id_to_students.sql';
UPDATE migrations SET name = '007_role_escalation_detection.sql' WHERE name = '007b_role_escalation_detection.sql';
UPDATE migrations SET name = '007_safety_controls.sql' WHERE name = '007c_safety_controls.sql';
UPDATE migrations SET name = '008_5_immutability_triggers.sql' WHERE name = '008a_immutability_triggers.sql';
UPDATE migrations SET name = '008_add_platform_id_to_corporate_departments.sql' WHERE name = '008b_add_platform_id_to_corporate_departments.sql';
UPDATE migrations SET name = '008_immutable_audit_logging.sql' WHERE name = '008c_immutable_audit_logging.sql';
UPDATE migrations SET name = '008_incident_management_system.sql' WHERE name = '008d_incident_management_system.sql';
UPDATE migrations SET name = '012_add_password_reset_flag.sql' WHERE name = '012a_add_password_reset_flag.sql';
UPDATE migrations SET name = '012_platform_metrics_7_1.sql' WHERE name = '012b_platform_metrics_7_1.sql';
UPDATE migrations SET name = '017_face_recognition_and_sessions.sql' WHERE name = '017a_face_recognition_and_sessions.sql';
UPDATE migrations SET name = '017_time_authority_clock_drift_tracking.sql' WHERE name = '017b_time_authority_clock_drift_tracking.sql';
COMMIT;
```

Then start the older image. Rolling forward again needs nothing: the newer
migrator renames the rows once more.

## Building images behind a TLS-intercepting proxy

Pass the proxy's CA as a build secret. It is used only while installing
packages and is not kept in the image:

```bash
docker build --secret id=ca,src=/path/to/ca.pem -f apps/backend/Dockerfile -t jjelotech-api .
```

## Not done yet

- No platform metrics exporter (Prometheus or OpenTelemetry) and no alerting.
  Per-tenant operational figures are at `/api/metrics`, for tenant
  administrators only.
- The notification dispatcher and the audit-stream dispatcher run in every
  API process. With more than one replica, enable the notification dispatcher
  on exactly one; the audit-stream dispatcher may run on several but then
  delivers some batches twice (collectors drop repeats by `chainSeq`).
- Nothing schedules `verifyAuditChain` yet.
- Uploaded files use the local-disk backend (a volume). An object store is
  not implemented.
- No staging environment, blue/green deploy or load test has been set up.
