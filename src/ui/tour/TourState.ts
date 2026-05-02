/**
 * Per-screen onboarding-tour persistence.
 *
 * Mirrors the `SplashState` pattern: two ISO-8601 timestamps in
 * localStorage, one per per-screen storage key. Each tour
 * (setup / checklist / suggest, plus the M7 account modal and M9
 * share-import contexts) owns its own gate so dismissing the setup
 * tour doesn't suppress the checklist tour later.
 *
 * - `lastVisitedAt` — bumped every time the user lands on a screen
 *   whose tour is gated. Drives the re-engagement gate.
 * - `lastDismissedAt` — set when the user closes a tour (skip,
 *   complete, X, Esc, or backdrop click). Today the gate just reads
 *   "is this defined?"; the timestamp itself fuels future analytics.
 *
 * Storage shape mirrors the splash gate so the bump procedure
 * (encode/decode, silent fallback to `{}`) is consistent across
 * gate-shaped state. Saves merge into the existing payload so
 * writing one timestamp never clobbers the other.
 */
import { DateTime, Result, Schema } from "effect";

const PersistedTourStateSchema = Schema.Struct({
    version: Schema.Literal(1),
    lastVisitedAt: Schema.optional(Schema.String),
    lastDismissedAt: Schema.optional(Schema.String),
});

const decodeUnknown = Schema.decodeUnknownResult(PersistedTourStateSchema);
const encode = Schema.encodeSync(PersistedTourStateSchema);

/**
 * Identifier for the screen a tour belongs to. Each value gets its
 * own storage key, its own gate, and its own analytics events.
 *
 * `checklistSuggest` covers BOTH the Checklist and Suggest panes —
 * they're side-by-side on desktop and the tour walks across them in
 * one pass on mobile (the driver dispatches `setUiMode` between
 * steps that need a different pane mounted). The legacy `checklist`
 * and `suggest` keys are gone; `resetAllTourState` wipes their
 * orphaned localStorage entries automatically since it scans by
 * prefix.
 *
 * `account` and `shareImport` are reserved for M7 / M9 — `tours.ts`
 * doesn't define content for them yet, but the storage key pattern
 * is shared so the helper functions work uniformly.
 */
export type ScreenKey =
    | "setup"
    | "checklistSuggest"
    | "sharing"
    | "firstSuggestion"
    | "account"
    | "shareImport";

export interface TourState {
    readonly lastVisitedAt?: DateTime.Utc;
    readonly lastDismissedAt?: DateTime.Utc;
}

const STORAGE_KEY_PREFIX = "effect-clue.tour.";

const storageKeyFor = (screen: ScreenKey): string =>
    `${STORAGE_KEY_PREFIX}${screen}.v1`;

const parseIso = (iso: string): DateTime.Utc | undefined => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return undefined;
    return DateTime.makeUnsafe(date);
};

const formatIso = (dt: DateTime.Utc): string =>
    new Date(DateTime.toEpochMillis(dt)).toISOString();

export const loadTourState = (screen: ScreenKey): TourState => {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(storageKeyFor(screen));
        if (!raw) return {};
        const decoded = decodeUnknown(JSON.parse(raw));
        if (Result.isFailure(decoded)) return {};
        const out: { -readonly [K in keyof TourState]: TourState[K] } = {};
        if (decoded.success.lastVisitedAt !== undefined) {
            const parsed = parseIso(decoded.success.lastVisitedAt);
            if (parsed !== undefined) out.lastVisitedAt = parsed;
        }
        if (decoded.success.lastDismissedAt !== undefined) {
            const parsed = parseIso(decoded.success.lastDismissedAt);
            if (parsed !== undefined) out.lastDismissedAt = parsed;
        }
        return out;
    } catch {
        return {};
    }
};

const writeMerged = (
    screen: ScreenKey,
    patch: Partial<TourState>,
): void => {
    if (typeof window === "undefined") return;
    try {
        const current = loadTourState(screen);
        const lastVisitedAt = patch.lastVisitedAt ?? current.lastVisitedAt;
        const lastDismissedAt =
            patch.lastDismissedAt ?? current.lastDismissedAt;
        const merged: {
            version: 1;
            lastVisitedAt?: string;
            lastDismissedAt?: string;
        } = { version: 1 };
        if (lastVisitedAt !== undefined) {
            merged.lastVisitedAt = formatIso(lastVisitedAt);
        }
        if (lastDismissedAt !== undefined) {
            merged.lastDismissedAt = formatIso(lastDismissedAt);
        }
        const encoded = encode(merged);
        window.localStorage.setItem(
            storageKeyFor(screen),
            JSON.stringify(encoded),
        );
    } catch {
        // Quota exceeded, private mode, etc. — non-fatal.
    }
};

export const saveTourVisited = (
    screen: ScreenKey,
    now: DateTime.Utc,
): void => writeMerged(screen, { lastVisitedAt: now });

export const saveTourDismissed = (
    screen: ScreenKey,
    now: DateTime.Utc,
): void => writeMerged(screen, { lastDismissedAt: now });

/**
 * Wipe every per-screen tour key from localStorage so the next visit
 * to each screen re-fires the tour. Used by the "Restart tour"
 * overflow-menu item; explicitly ignores keys outside the
 * `effect-clue.tour.` namespace so it doesn't reach into splash
 * / session / pack-usage state.
 */
export const resetAllTourState = (): void => {
    if (typeof window === "undefined") return;
    try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key !== null && key.startsWith(STORAGE_KEY_PREFIX)) {
                keysToRemove.push(key);
            }
        }
        for (const key of keysToRemove) {
            window.localStorage.removeItem(key);
        }
    } catch {
        // Quota / private mode / etc. — non-fatal.
    }
};
