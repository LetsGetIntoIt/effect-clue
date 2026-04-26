/**
 * Persisted state for the about-app splash modal.
 *
 * Two timestamps live in localStorage:
 *
 * - `lastVisitedAt` — updated every time the user lands on `/play`.
 *   Drives the re-engagement gate: if it's been > DURATION since the
 *   last visit, we show the splash again on the next visit.
 *
 * - `lastDismissedAt` — set only when the user closes the splash with
 *   the "don't show this again" checkbox ticked. Today the gate just
 *   reads its truthiness ("has the user ever opted out?"); we store
 *   the actual timestamp so future analytics can answer "when".
 *
 * Stored as ISO-8601 strings on disk — what `new Date().toJSON()`
 * produces, easy to read in DevTools, easy to round-trip via `new
 * Date(iso)`. We convert to/from `DateTime.Utc` at the boundary so
 * the rest of the codebase keeps the Effect type.
 *
 * Mirrors the `CustomCardSets` pattern: `Schema.decodeUnknownResult`
 * for reads (silent fallback to `{}` on malformed payload), try/catch
 * for writes (private mode / quota). Saves merge into the existing
 * payload so writing one timestamp never clobbers the other.
 */
import { DateTime, Result, Schema } from "effect";

const PersistedSplashStateSchema = Schema.Struct({
    version: Schema.Literal(1),
    lastVisitedAt: Schema.optional(Schema.String),
    lastDismissedAt: Schema.optional(Schema.String),
});

const decodeUnknown = Schema.decodeUnknownResult(PersistedSplashStateSchema);
const encode = Schema.encodeSync(PersistedSplashStateSchema);

const STORAGE_KEY = "effect-clue.splash.v1";

export interface SplashState {
    readonly lastVisitedAt?: DateTime.Utc;
    readonly lastDismissedAt?: DateTime.Utc;
}

const parseIso = (iso: string): DateTime.Utc | undefined => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return undefined;
    return DateTime.makeUnsafe(date);
};

const formatIso = (dt: DateTime.Utc): string =>
    new Date(DateTime.toEpochMillis(dt)).toISOString();

export const loadSplashState = (): SplashState => {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const decoded = decodeUnknown(JSON.parse(raw));
        if (Result.isFailure(decoded)) return {};
        const out: { -readonly [K in keyof SplashState]: SplashState[K] } = {};
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

const writeMerged = (patch: Partial<SplashState>): void => {
    if (typeof window === "undefined") return;
    try {
        const current = loadSplashState();
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
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(encoded));
    } catch {
        // Quota exceeded, private mode, etc. — non-fatal.
    }
};

export const saveLastVisited = (now: DateTime.Utc): void =>
    writeMerged({ lastVisitedAt: now });

export const saveDismissed = (now: DateTime.Utc): void =>
    writeMerged({ lastDismissedAt: now });
