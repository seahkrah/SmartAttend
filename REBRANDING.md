# Rebranding: SmartAttend → JjeloTech

Every occurrence of the SmartAttend name in the codebase has been replaced with
JjeloTech. This document records what changed automatically and the handful of
steps that have to be done outside the repository.

## Naming convention applied

| Old | New | Where |
|-----|-----|-------|
| `SmartAttend` | `JjeloTech` | UI copy, docs, comments, page titles |
| `SMARTATTEND` | `JJELOTECH` | console banners, SQL headers |
| `smartattend` | `jjelotech` | package names, database names, identifiers |
| `@smartattend/types` | `@jjelotech/types` | shared types package |
| `smartattend-backend` / `smartattend-frontend` | `jjelotech-backend` / `jjelotech-frontend` | app package names |
| `SmartAttendLogo` / `SmartAttendIcon` | `JjeloTechLogo` / `JjeloTechIcon` | React components |
| `superadmin@smartattend.local` | `superadmin@jjelotech.local` | seeded superadmin account |

## Manual steps

### 1. Rename the GitHub repository

On GitHub: **Settings → General → Repository name** → change `SmartAttend` to
`JjeloTech` → **Rename**. GitHub keeps redirects from the old URL, but update
the local remote anyway:

```bash
git remote set-url origin https://github.com/seahkrah/JjeloTech
```

### 2. Rename the local folder

```bash
cd ..
mv SmartAttend JjeloTech
cd JjeloTech
```

### 3. Rename the database

The connection strings in `.env.development`, `.env.staging`, `.env.production`
and `.env.example` now point at `jjelotech_dev` / `jjelotech_staging` /
`jjelotech_prod`. Rename the existing database to match:

```bash
psql -U postgres -c 'ALTER DATABASE smartattend_dev RENAME TO jjelotech_dev;'
```

Do the same for any staging or production database. If you would rather keep
the old database name, change `DATABASE_URL` in the relevant `.env` file
instead — nothing else depends on the name.

### 4. Recreate the Docker volumes

`docker-compose.yml` now uses the container names `jjelotech-db`,
`jjelotech-backend` and `jjelotech-frontend`, the role `jjelotech_user` and the
database `jjelotech_db`. Existing containers carry the old names, so remove
them first:

```bash
docker compose down
docker compose up -d --build
```

Postgres data lives in a named volume, so this does not lose data — but the
role inside the old volume is still `smartattend_user`. For a clean start, add
`-v` to the `down` command and re-run the migrations.

### 5. Reinstall dependencies

The shared types package changed scope, so the `node_modules` symlinks have to
be rebuilt:

```bash
cd packages/types && npm install && npm run build
cd ../../apps/backend  && npm install
cd ../frontend         && npm install
```

### 6. Run the migration

`024_rebrand_account_identities.sql` moves any existing `@smartattend.local`
account to `@jjelotech.local`. Fresh databases get the new address directly from
`004_superadmin_system.sql`.

```bash
cd apps/backend && npx tsx src/db/migrate.ts
```

The superadmin sign-in address becomes `superadmin@jjelotech.local`. Passwords
are unchanged.

## Brand assets

`apps/frontend/public/logos/platform-logo.png` carries the old SmartAttend
wordmark and is no longer referenced anywhere. The UI now uses
`jjelotech-mark.png`, the wordmark-free icon. See
`apps/frontend/public/logos/README.md` for how to drop in the real JjeloTech
logo.

The `brand-logo.png` asset and the "Powered by SmartCode" line on the landing
page refer to SmartCode, the development vendor — a separate brand from the
product — so they were left as they are.
