# PWA icons (placeholders required)

The `app/manifest.ts` Web App Manifest references three icons in this directory:

- `icon-192.png` — 192×192 png, "any" purpose
- `icon-512.png` — 512×512 png, "any" purpose  
- `icon-maskable-512.png` — 512×512 png, "maskable" purpose (full bleed)

Until real artwork lands here, browsers will reject the PWA installability
check, the `beforeinstallprompt` event won't fire, and the in-app install
prompt modal stays hidden — even though the rest of the M5 plumbing
(service worker, manifest route, gate logic) is wired up.

To replace these with real artwork:

1. Generate the three PNGs from a square 1024×1024 (or larger) source.
   The maskable variant needs ~10% safe-zone padding so the icon doesn't
   get cropped by the OS.
2. Drop them in this directory; the manifest will pick them up
   automatically.
3. Verify installability in Chrome DevTools → Application → Manifest.
4. Test the install prompt on a real device (Chrome desktop, Android
   Chrome, Edge).

The plan ships M5 with this stub so the rest of the milestone work
(install gate, modal, "Install app" overflow item, service worker
registration) can be reviewed independently of the icon design.
