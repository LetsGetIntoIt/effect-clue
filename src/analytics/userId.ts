/**
 * Anonymous, browser-scoped identifier used for cross-system event
 * correlation between PostHog (`distinct_id`) and Honeycomb
 * (`user.id` resource attribute).
 *
 * - Generated lazily via `crypto.randomUUID()` on first read.
 * - Persisted in `localStorage` so a returning visitor keeps the same
 *   id across reloads and game sessions.
 * - Reset whenever the user clears their site data.
 * - Carries no PII. Effect Clue has no accounts; this is purely a
 *   browser-local correlation token.
 */

const STORAGE_KEY = "effect-clue:anon-id";

const isBrowser = (): boolean =>
    typeof window !== "undefined" && typeof window.localStorage !== "undefined";

export const getOrCreateAnonymousUserId = (): string => {
    if (!isBrowser()) return "ssr";
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
};
