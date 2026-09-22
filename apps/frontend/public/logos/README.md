# JjeloTech brand assets

| File | Used by | Status |
|------|---------|--------|
| `jjelotech-mark.png` | `BrandLogo.tsx`, `SuperadminLayout.tsx`, `LandingPage.tsx` | Active — icon mark only, no wordmark |
| `favicon.png` | `index.html` (favicon, apple-touch-icon) | Active |
| `brand-logo.png`, `alt-brand-logo.png` | — | SmartCode (development vendor) logo, unreferenced |
| `platform-logo.png`, `alt-platform-logo.png` | — | **Legacy SmartAttend wordmark — do not use** |

## Replacing the mark with the real JjeloTech logo

The rebrand from SmartAttend to JjeloTech removed every reference to the old
wordmark. `jjelotech-mark.png` is the existing icon mark (no text), used as a
stand-in so nothing stale ships.

To drop in the real logo, overwrite `jjelotech-mark.png` and `favicon.png` —
no code changes are needed. Once that is done the legacy `platform-logo.png`
and `alt-platform-logo.png` files can be deleted; they are kept for now only so
the old artwork is not lost.
