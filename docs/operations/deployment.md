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

Two-factor sign-in is required for superadmins and administrators in
production (`MFA_REQUIRED_ROLES`, default `superadmin,admin`). Each of them sets
it up on first sign-in. Set `MFA_ENCRYPTION_KEY` (`openssl rand -base64 32`)
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
- API rate limits and the notification dispatcher run per process. Running
  more than one API replica needs a shared rate-limit store, and the
  dispatcher enabled on exactly one replica.
- Uploaded files use the local-disk backend (a volume). An object store is
  not implemented.
- No staging environment, blue/green deploy or load test has been set up.
