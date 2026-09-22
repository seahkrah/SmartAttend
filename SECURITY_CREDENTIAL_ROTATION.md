# Credential exposure and rotation

Plaintext credentials were committed to this repository. Deleting them from the
working tree — which this branch does — does **not** remove them from git
history. Anyone who can clone the repository, now or from any existing clone or
fork, can still read every one of them.

**The passwords below are compromised and must be rotated. Removing the files is
not a substitute for rotating.**

## What was exposed

| Where | What |
|-------|------|
| `JjeloTech Users and Platforms Passwords.txt` | Plaintext login passwords for 7 accounts, including the superadmin |
| `apps/backend/src/scripts/check_schema.js` | PostgreSQL `postgres` superuser password |
| `apps/backend/src/scripts/createTestUsers.ts` | PostgreSQL `postgres` superuser password |
| `apps/backend/src/scripts/setupTenantEntities.ts` | PostgreSQL `postgres` superuser password |
| `apps/backend/src/scripts/checkUsers.ts` | Application database password |
| `apps/backend/test_login.mjs` | Superadmin login password |
| `apps/backend/reset_superadmin_password.mjs` | Password the script assigned, plus a hardcoded user id |

The database superuser password appeared in three scripts and looks like a
personal password rather than a generated one. If it is reused anywhere else —
another machine, another service, an email account — change it there too. That
is the most serious item on this list.

## What this branch changed

- Deleted the plaintext credentials file from the working tree.
- Replaced every hardcoded secret above with an environment variable, so the
  scripts now fail loudly with a clear message instead of carrying a password.
- Added `apps/backend/scripts/rotate-credentials.mjs`.
- Added `.gitignore` rules for `*credentials*.txt`, `*passwords*.txt`,
  `*Passwords*.txt` and `rotated-credentials-*.txt`.

## What you need to do

### 1. Rotate the application accounts

```bash
cd apps/backend
export DATABASE_URL=postgresql://...
node scripts/rotate-credentials.mjs
```

Each account gets a fresh 144-bit random password and is flagged
`must_reset_password`, so the holder must choose their own at next login. The
new passwords are written to `rotated-credentials-<timestamp>.txt` with mode
`0600`; that name is gitignored. Send them over something other than this
repository, then delete the file.

Add `--all` to rotate every account in the database rather than only the seven
known-leaked ones.

### 2. Rotate the PostgreSQL passwords

```sql
ALTER USER postgres WITH PASSWORD '<new strong password>';
ALTER USER jjelotech_user WITH PASSWORD '<new strong password>';
```

Then update `DATABASE_URL` wherever it is set — your local `.env`, the
deployment environment, and the `POSTGRES_PASSWORD` in `docker-compose.yml` if
you run the containers.

### 3. Purge the history

Rotating first is what actually protects the accounts; purging is cleanup. It
rewrites every commit, so coordinate with anyone else working on the repository
— they will need a fresh clone.

```bash
pip install git-filter-repo
git filter-repo --invert-paths \
  --path 'Smart Attend Users and Platforms Pa.txt' \
  --path 'JjeloTech Users and Platforms Passwords.txt'
git push --force --all
git push --force --tags
```

Both filenames are listed because the file was renamed during the JjeloTech
rebrand and history contains it under each name.

Purging does not reach existing clones, forks, or anything GitHub has already
cached, which is why step 1 is the one that matters.

### 4. Check whether the secrets leaked further

If the repository is or ever was public, assume the credentials were scraped and
treat every reused password as compromised. GitHub's secret scanning
(**Settings → Code security**) will flag recognised token formats, though it
will not catch plain passwords like these.
