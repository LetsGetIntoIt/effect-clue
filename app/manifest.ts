/**
 * Web App Manifest — Next.js metadata route. Generates
 * `/manifest.webmanifest` at request time.
 *
 * Browsers read this to determine PWA installability. Together with
 * a registered service worker (see `app/sw.ts`), at least one
 * referenced icon, and HTTPS, this lets Chrome / Edge / Android
 * Chrome fire `beforeinstallprompt`, which our `useInstallPrompt`
 * hook captures and replays through `<InstallPromptModal />` on
 * the user's second visit.
 *
 * Icons are SVG so the same source serves every device DPI. The
 * manifest declares `sizes: "any"` for the SVG variants — Chrome's
 * documented behaviour is to accept SVG as the primary
 * install-icon source, downsampling to whatever size the OS
 * requests. The maskable variant uses an 80% safe zone so circular
 * masks don't clip the magnifying glass.
 *
 * Upgrade path to PNGs (recommended once a designer-built source
 * exists): drop 192/512/maskable-512 PNGs in `public/icons/`,
 * swap the entries below, and verify the install icon stays sharp
 * on Android Chrome (which sometimes prefers PNG for the home-
 * screen tile).
 */
import type { MetadataRoute } from "next";

// W3C manifest spec discriminator values. Module-scoped so
// `i18next/no-literal-string` treats them as wire-format constants
// rather than user copy. These are the values browsers actually
// match against; they're not localised even on a multi-locale app.
const NAME = "Clue Solver";
const SHORT_NAME = "Clue Solver";
const DESCRIPTION =
    "A solver for the board game Clue (Cluedo). Track suggestions, log disproofs, and let the deducer narrow the case file.";
const START_URL = "/play";
const DISPLAY: "standalone" = "standalone";
const ORIENTATION: "any" = "any";
const BG_COLOR = "#efe6d3";
const THEME_COLOR = "#7a1c1c";
const ICON_SVG = "/icons/icon.svg";
const ICON_MASKABLE_SVG = "/icons/icon-maskable.svg";
const SIZE_ANY = "any";
const TYPE_SVG = "image/svg+xml";
const PURPOSE_MASKABLE: "maskable" = "maskable";
const DIR: "ltr" = "ltr";
const LANG = "en";

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: NAME,
        short_name: SHORT_NAME,
        description: DESCRIPTION,
        start_url: START_URL,
        display: DISPLAY,
        background_color: BG_COLOR,
        theme_color: THEME_COLOR,
        orientation: ORIENTATION,
        icons: [
            { src: ICON_SVG, sizes: SIZE_ANY, type: TYPE_SVG },
            {
                src: ICON_MASKABLE_SVG,
                sizes: SIZE_ANY,
                type: TYPE_SVG,
                purpose: PURPOSE_MASKABLE,
            },
        ],
        // Setting `dir`/`lang` makes the manifest crawlable for
        // accessibility audits even though the app is single-locale
        // today.
        dir: DIR,
        lang: LANG,
    };
}
