# JJELOTECH SYSTEMS brand assets

Every brand asset the app uses comes from one master file: **`logo/favicon.svg`**
at the repository root, a vector trace of the logo (sun, chevron, "JjeloTech"
wordmark and the tagline *Engineering the Dawn of Enterprise Systems*).

To change the artwork, replace that file and run, in `apps/frontend`:

```bash
node scripts/brand-assets.mjs
```

The PNG icons are rasterised from `favicon.svg` and need re-exporting at the same
sizes whenever the mark changes.

## Files in this folder

| File | Used by | Notes |
|------|---------|-------|
| `favicon.svg` | `index.html`: browser tab icon | The mark on a dark rounded tile. Generated. |
| `favicon-32.png` | `index.html`: fallback icon | 32×32, rasterised from `favicon.svg` |
| `apple-touch-icon.png` | `index.html`: iOS home screen and link previews | 180×180, rasterised from `favicon.svg` |
| `jjelotech-logo-wordmark.svg` | Landing page hero | Mark and wordmark, transparent, for dark backgrounds. Generated. |
| `jjelotech-logo.svg` | README and documents | As above, with the tagline. Generated. |
| `brand-logo.png`, `alt-brand-logo.png` | — | SmartCode (development vendor) logos, credited in the landing page footer. Unreferenced. |

In the app itself the mark is drawn inline by `src/components/BrandLogo.tsx` from
`src/components/brandMarkPaths.ts` (also generated), so it needs no image request
and reads on light and dark surfaces alike.

The SmartAttend-era assets that used to live here (`favicon.png`,
`platform-logo.png`, `alt-platform-logo.png`, `../favicon 1.svg`) were removed in
the rebrand. They're still in Git history.

Only `apps/frontend/public/` is served. The `logo/` folder at the repository root
is the artwork source and isn't served.
