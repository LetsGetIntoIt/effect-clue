# PWA icons

The Web App Manifest (`app/manifest.ts`) currently references two SVG icons:

- `icon.svg` — any-purpose icon (full-bleed; used by browser tab favicons and the standard Android Chrome install banner).
- `icon-maskable.svg` — maskable variant with an 80% safe zone so the OS's circular / squircle / rounded-square mask doesn't clip the magnifying glass.

Both are stylised in the Clue parchment + oxblood palette (#efe6d3 background, #7a1c1c stroke). They're hand-built SVG so any DPI renders sharp without a build step.

## Why SVG instead of PNG?

Chrome / Edge / Android Chrome have accepted SVG icons in the manifest since Chromium 122 (Feb 2024), and the install criteria only requires "at least one icon entry that resolves to an actual image". SVG keeps the source small (no `sharp` build step, no committed PNG bytes), serves every DPI from one file, and is trivially editable without leaving the editor.

## Upgrading to PNG

Some platforms — especially older Android home-screen tile generators — prefer PNG. If we ever observe a degraded install experience on real devices, the upgrade path is:

1. Generate `icon-192.png`, `icon-512.png`, and `icon-maskable-512.png` from a square 1024×1024 source. The maskable variant should keep ~10% safe-zone padding.
2. Drop them in this directory.
3. Swap the manifest entries in `app/manifest.ts` (replace each SVG entry with its PNG counterpart).
4. Verify in Chrome DevTools → Application → Manifest, then on a real device.

## Verifying the install prompt fires

The prompt has its own gate (`effect-clue.install-prompt.v1`) — it requires at least 2 visits and a 4-week snooze gap. To test from scratch:

1. Open Chrome DevTools → Application → Storage → Clear site data.
2. Reload the page twice (so the visit counter hits ≥ 2).
3. Wait for the modal, OR open it from ⋯ → Install app.
4. Lighthouse PWA audit (DevTools → Lighthouse) should be green.
