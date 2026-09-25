# JjeloTech web app

React 18 + Vite + TypeScript + Tailwind. See the
[repository README](../../README.md) to run it.

`npm run build` also runs two gates:

- `scripts/check-nav.mjs`: every menu entry has a route, and every route is
  either in a menu or listed with a reason.
- `scripts/check-api.mjs`: every API call names a route the server has.

Menus are defined per audience in `src/navigation/navConfig.ts`.
