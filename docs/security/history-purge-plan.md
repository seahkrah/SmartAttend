# Git history purge plan

Status: **prepared, not run.** It rewrites every commit and needs a force-push,
so the repository owner runs it, after rotating every credential first.
Rotation is what protects the accounts; the purge is cleanup.

Owner action OA-1 in `docs/scorecard/OWNER_ACTIONS.md`.

## Why the plan in SECURITY_CREDENTIAL_ROTATION.md is not enough

That plan removes the plaintext credentials file under its two historical
names. The same passwords were also written **inside scripts** that still
exist, or existed, at other paths:

- `apps/backend/src/scripts/check_schema.js`, `createTestUsers.ts`,
  `setupTenantEntities.ts`, `checkUsers.ts` (PostgreSQL passwords)
- `apps/backend/test_login.mjs`, `apps/backend/reset_superadmin_password.mjs`
  (superadmin password; both deleted in Phase 0)

Removing a path does not touch old revisions of the other files. The literal
values have to be replaced across history with `--replace-text`.

## Steps

0. **Rotate first.** Follow sections 1 and 2 of
   `SECURITY_CREDENTIAL_ROTATION.md`. Change any reused password everywhere
   else it is used.

1. Work on a fresh mirror, never your working clone:

   ```bash
   git clone --mirror <remote-url> jjelotech-purge.git
   cd jjelotech-purge.git
   ```

2. Write `../secrets-to-purge.txt`, one **old** credential value per line, in
   the form `literal-value==>REMOVED`. Only you hold these values. Keep the
   file outside any repository and delete it afterwards. (The Phase 0 work
   deliberately never read them.)

3. Purge the files and the values:

   ```bash
   pip install git-filter-repo
   git filter-repo \
     --invert-paths \
       --path 'Smart Attend Users and Platforms Pa.txt' \
       --path 'JjeloTech Users and Platforms Passwords.txt' \
     --replace-text ../secrets-to-purge.txt
   ```

4. Verify before pushing. Each command must print nothing:

   ```bash
   while IFS= read -r line; do
     value="${line%%==>*}"
     git log --all -p -S "$value" --format=%H | head -1
   done < ../secrets-to-purge.txt
   docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.21.2 git /repo --redact --no-banner
   ```

5. Push and tell everyone with a clone that they need a fresh one:

   ```bash
   git push --force --mirror
   ```

6. Ask GitHub Support to drop cached views of the removed commits, if the
   repository is or was public, or has forks.

7. In `.github/workflows/ci.yml`, change the "Secret scan (commits in this
   push)" step to scan the whole history (drop `--log-opts`), so the purge
   stays true.

## What the purge does not do

It does not reach existing clones, forks, CI caches, or anything already
scraped. That is why step 0 comes first.
