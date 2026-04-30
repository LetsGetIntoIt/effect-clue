/**
 * Web App Manifest — Next.js metadata route. Generates
 * `/manifest.webmanifest` at request time.
 *
 * Browsers read this to determine PWA installability. Together with
 * a registered service worker (see `app/sw.ts`), at least one icon
 * ≥192px, and HTTPS, this lets Chrome / Edge / Android Chrome fire
 * `beforeinstallprompt`, which our `useInstallPrompt` hook captures
 * and replays through `<InstallPromptModal />` on the user's second
 * visit.
 *
 * Icons referenced here live in `public/icons/`. Until real artwork
 * lands, those are placeholders — the install prompt will not fire
 * because browsers reject the installable check on solid-colour
 * placeholders. Replace the icons before depending on the prompt;
 * see the M5 PR description for the manual artwork-generation step.
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
const ICON_192 = "/icons/icon-192.png";
const ICON_512 = "/icons/icon-512.png";
const ICON_MASKABLE = "/icons/icon-maskable-512.png";
const SIZE_192 = "192x192";
const SIZE_512 = "512x512";
const TYPE_PNG = "image/png";
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
            { src: ICON_192, sizes: SIZE_192, type: TYPE_PNG },
            { src: ICON_512, sizes: SIZE_512, type: TYPE_PNG },
            {
                src: ICON_MASKABLE,
                sizes: SIZE_512,
                type: TYPE_PNG,
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
