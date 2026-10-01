# Phase 0 tooling dependencies

Date: 2026-10-01. Status: accepted.

Every dependency below is a development tool. None of them ships in the API
or web image.

| Package | Where | Licence | Why | Maintenance |
|---|---|---|---|---|
| `eslint` 9, `@eslint/js` | backend, frontend | MIT | Neither workspace had a linter. Configured to error only on rules that find bugs. | OpenJS Foundation; monthly releases |
| `typescript-eslint` 8 | backend, frontend | MIT | TypeScript parser and rules for ESLint. | Active; tracks TypeScript releases |
| `globals` | backend, frontend | MIT | Node and browser global names for ESLint. | sindresorhus; stable |
| `eslint-plugin-react-hooks` 5 | frontend | MIT | Rules of hooks are errors; dependency arrays are warnings. | Meta / React team |
| `prettier` 3 | repository root | MIT | Formatting check. Applied to `scripts/` only for now (see below). | Active |
| `yaml` 2 | `scripts/scorecard` | ISC | Parses `rubric.yml`. No dependencies of its own. | Active, single maintainer with long history |

## Upgrades made for security advisories

- `vitest` and `@vitest/ui` 4.0.18 → 4.1.11 (backend). 4.0.18 is inside a
  critical advisory range. Patch-level within 4.x; the 56 database-free unit
  tests and the 117-test suite pass. Installed with npm 11, because npm 10's
  resolver crashes on this tree (`Cannot read properties of null (reading
  'edgesOut')`). The resulting lockfile installs cleanly with npm 10's
  `npm ci`, which is what CI and the Dockerfiles use.
- `vite` 5 → 7 and `@vitejs/plugin-react` 4 → 5 (frontend). Vite ≤ 6.4.2 has
  a high-severity dev-server advisory. Typecheck and production build pass.

## Known and not yet fixed

- `react-router-dom` 6 has two moderate advisories (an open redirect through a
  backslash in `<Link>`/`useNavigate`, and an SSR hydration issue that does not
  apply to a client-only app). The fix is react-router 7, a major upgrade with
  routing changes across the app. Tracked in `docs/security/findings.md`.
  Dependabot will propose it, and CI fails on high or critical advisories.

## Formatting is not applied to `apps/` yet

Reformatting about 87k lines in one commit would conflict with every open
branch, including `feat/grade-school-classes`, which this work is based on.
The reformat is one mechanical commit, to land when that branch merges, with
its hash added to `.git-blame-ignore-revs`. Until then `npm run format:check`
covers `scripts/`, and the scorecard's `prettier` gate notes the limit.
