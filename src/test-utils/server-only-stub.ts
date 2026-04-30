/**
 * Vitest-only replacement for the `server-only` npm package. The
 * real `server-only` module throws at import-time to keep server
 * code out of the browser bundle; that defence is correct in
 * production but a false positive under vitest, which runs in
 * jsdom but isn't actually serving the module to a browser.
 *
 * Wired via the `resolve.alias` block in `vitest.config.ts`.
 */
export {};
