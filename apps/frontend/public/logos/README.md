# JjeloTech brand assets

## The in-app logo is SVG, not a file here

`src/components/BrandLogo.tsx` draws the mark as inline SVG — it scales
cleanly, uses the Tailwind palette (`primary-500` → `secondary-500`), and needs
no raster asset. `JjeloTechMark`, `JjeloTechLogo` and `JjeloTechIcon` are the
three exports; every screen uses one of them.

To switch back to raster artwork, replace the `<svg>` in `JjeloTechMark` with an
`<img src="/logos/your-file.png" />`. Nothing else needs changing.

## Files in this folder

| File | Used by | Notes |
|------|---------|-------|
| `favicon.png` | `index.html` — favicon and apple-touch-icon | The one raster asset still wired up |
| `platform-logo.png`, `alt-platform-logo.png` | — | Unreferenced |
| `brand-logo.png`, `alt-brand-logo.png` | — | SmartCode (development vendor) logo, unreferenced |

Only `apps/frontend/public/` is served by Vite. The `logo/` folder at the
repository root is an artwork stash — changes there have no effect on the app.

A file placed directly in `public/` is served from the root, so
`public/platform-logo.png` would be `/platform-logo.png`, not
`/logos/platform-logo.png`. Brand assets belong in this folder.
