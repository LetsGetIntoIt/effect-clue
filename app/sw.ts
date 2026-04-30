/// <reference lib="webworker" />
/**
 * Service worker source — compiled by Serwist into `public/sw.js`
 * at build time.
 *
 * Caching strategy is the Serwist default (`defaultCache`):
 *
 *   - Document HTML → NetworkFirst with a 4s timeout, falls back to
 *     the cached app shell if the network is slow / offline. Lets
 *     the deducer keep working while the user is on a flaky train.
 *   - Static JS / CSS / fonts / images → CacheFirst, immutable.
 *   - JSON (e.g. RSC payloads) → NetworkFirst with a stale-revalidate
 *     fallback.
 *
 * `precacheEntries` is populated by Serwist at build time with the
 * Next.js bundle manifest, so every chunk needed for the first paint
 * lands in the cache before the user goes offline.
 *
 * The PWA install prompt only fires once the browser sees a
 * registered service worker + manifest + at least one icon ≥192px.
 * See `app/manifest.ts`.
 */
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
    interface WorkerGlobalScope extends SerwistGlobalConfig {
        __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
    }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
    // `__SW_MANIFEST` is undefined in dev (Serwist disabled) and
    // populated by the build at production time. Default to an empty
    // array so the runtime caching strategies still take effect even
    // when there's nothing to precache.
    precacheEntries: self.__SW_MANIFEST ?? [],
    skipWaiting: true,
    clientsClaim: true,
    navigationPreload: true,
    runtimeCaching: defaultCache,
});

serwist.addEventListeners();
