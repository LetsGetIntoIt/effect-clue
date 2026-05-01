// @ts-check

/**
 * Serwist configurator-mode config.
 *
 * Read by `serwist build` (the `@serwist/cli` post-build step) to
 * compile `app/sw.ts` into `public/sw.js` AND inject the precache
 * manifest after Next.js finishes its own build. Serwist's plugin
 * mode (`@serwist/next`) is webpack-only; configurator mode is
 * bundler-agnostic, which lets `next build` keep running on
 * Turbopack while still emitting a working service worker.
 *
 * The `app/sw.ts` source file itself is unchanged from the plugin-
 * mode era — both modes consume the same `swSrc` shape and rely on
 * the `self.__SW_MANIFEST` injection that Workbox / Serwist hooks
 * into.
 *
 * **Why `.js` and not `.ts`?** `@serwist/cli`'s bin loads the config
 * via `await import(configFile)` and Node's ESM loader doesn't read
 * `.ts` natively. The JSDoc `@type` import below gets the same
 * editor-side typechecking that a `.ts` file would, so we don't
 * lose much by writing the config in plain ESM JS.
 */

/** @type {import("@serwist/next/config").SerwistOptions} */
const config = {
    swSrc: "app/sw.ts",
    swDest: "public/sw.js",
    // `precachePrerendered: true` is the default and what we want —
    // on first install the SW seeds its cache with the SSR'd HTML
    // for `/`, `/about`, `/play`, and `/manifest.webmanifest` so
    // offline navigation hydrates from cache instead of Chrome's
    // "you are offline" page. Dynamic routes (`/api/*`,
    // `/share/[id]`) aren't prerendered so they're naturally
    // excluded from the manifest. Per-asset revisions come from the
    // chunk hashes Next.js emits, so no global revision stamp is
    // needed here.
};

import { serwist } from "@serwist/next/config";
export default serwist(config);
