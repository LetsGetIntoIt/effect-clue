/**
 * Per-screen onboarding-tour persistence.
 *
 * Mirrors the `SplashState` pattern: ISO-8601 timestamps in
 * localStorage, one per per-screen storage key. Each tour
 * (setup / checklist / suggest, plus the M7 account modal and M9
 * share-import contexts) owns its own gate so dismissing the setup
 * tour doesn't suppress the checklist tour later.
 *
 * Per-mode subkeys (v2). Each screen's tour fires once per 4 weeks
 * **per mode** — the regular-mode and teach-me-mode user journeys
 * are different enough that completing one shouldn't suppress the
 * other. The persisted shape is `{ normal?: ModeState, teach?:
 * ModeState }`, with `ModeState = { lastVisitedAt?, lastDismissedAt? }`.
 *
 * v2 ↑ v1 migration: a v1 record (flat `{ lastVisitedAt?,
 * lastDismissedAt? }`) is lifted to `{ normal: <v1> }`. Pre-teach-me
 * users only ever ran the normal-mode flow, so attributing their
 * existing dismissal to the `normal` subkey preserves their gate
 * state across the upgrade and leaves the `teach` subkey fresh for
 * their first teach-mode visit.
 *
 * Storage shape mirrors the splash gate so the bump procedure
 * (encode/decode, silent fallback to `{}`) is consistent across
 * gate-shaped state. Saves merge into the existing payload so writing
 * one timestamp never clobbers another mode's data.
 */
import { DateTime, Result, Schema } from "effect";

/**
 * Whether the user is in teach-me mode or the regular solver mode.
 * The two have distinct gate state because they walk through
 * different surfaces; completing one mode's tour shouldn't suppress
 * the other.
 */
export type TourMode = "normal" | "teach";

// Module-scope discriminator constants. Pulled out so the
// `i18next/no-literal-string` lint rule doesn't flag them as
// user-facing copy at every call site.
export const TOUR_MODE_NORMAL: TourMode = "normal";
export const TOUR_MODE_TEACH: TourMode = "teach";

/**
 * Resolve the active tour mode from the boolean `state.teachMode`
 * flag. Used everywhere the tour gate, completion path, or analytics
 * super-property need a `TourMode` string.
 */
export const tourModeFromTeachMode = (teachMode: boolean): TourMode =>
    teachMode ? TOUR_MODE_TEACH : TOUR_MODE_NORMAL;

const ModeStateSchema = Schema.Struct({
    lastVisitedAt: Schema.optional(Schema.String),
    lastDismissedAt: Schema.optional(Schema.String),
});

const PersistedTourStateV2Schema = Schema.Struct({
    version: Schema.Literal(2),
    normal: Schema.optional(ModeStateSchema),
    teach: Schema.optional(ModeStateSchema),
});

const PersistedTourStateV1Schema = Schema.Struct({
    version: Schema.Literal(1),
    lastVisitedAt: Schema.optional(Schema.String),
    lastDismissedAt: Schema.optional(Schema.String),
});

const decodeV2 = Schema.decodeUnknownResult(PersistedTourStateV2Schema);
const decodeV1 = Schema.decodeUnknownResult(PersistedTourStateV1Schema);
const encodeV2 = Schema.encodeSync(PersistedTourStateV2Schema);

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

export interface ModeState {
    readonly lastVisitedAt?: DateTime.Utc;
    readonly lastDismissedAt?: DateTime.Utc;
}

export interface TourState {
    readonly normal?: ModeState;
    readonly teach?: ModeState;
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

const liftModeState = (
    raw: {
        readonly lastVisitedAt?: string | undefined;
        readonly lastDismissedAt?: string | undefined;
    },
): ModeState => {
    const out: { -readonly [K in keyof ModeState]: ModeState[K] } = {};
    if (raw.lastVisitedAt !== undefined) {
        const parsed = parseIso(raw.lastVisitedAt);
        if (parsed !== undefined) out.lastVisitedAt = parsed;
    }
    if (raw.lastDismissedAt !== undefined) {
        const parsed = parseIso(raw.lastDismissedAt);
        if (parsed !== undefined) out.lastDismissedAt = parsed;
    }
    return out;
};

export const loadTourState = (screen: ScreenKey): TourState => {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(storageKeyFor(screen));
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        const v2 = decodeV2(parsed);
        if (Result.isSuccess(v2)) {
            const out: { -readonly [K in keyof TourState]: TourState[K] } = {};
            if (v2.success.normal !== undefined) {
                out.normal = liftModeState(v2.success.normal);
            }
            if (v2.success.teach !== undefined) {
                out.teach = liftModeState(v2.success.teach);
            }
            return out;
        }
        // v2 → v1 lift: pre-teach-me users only ran the normal-mode
        // flow, so their flat dismissal attributes to `normal` and
        // the `teach` subkey stays fresh for their first teach-mode
        // visit.
        const v1 = decodeV1(parsed);
        if (Result.isSuccess(v1)) {
            return { normal: liftModeState(v1.success) };
        }
        return {};
    } catch {
        return {};
    }
};

const encodeModeState = (
    mode: ModeState | undefined,
): { lastVisitedAt?: string; lastDismissedAt?: string } | undefined => {
    if (mode === undefined) return undefined;
    const out: { lastVisitedAt?: string; lastDismissedAt?: string } = {};
    if (mode.lastVisitedAt !== undefined) {
        out.lastVisitedAt = formatIso(mode.lastVisitedAt);
    }
    if (mode.lastDismissedAt !== undefined) {
        out.lastDismissedAt = formatIso(mode.lastDismissedAt);
    }
    return Object.keys(out).length === 0 ? undefined : out;
};

const writeMerged = (
    screen: ScreenKey,
    mode: TourMode,
    patch: Partial<ModeState>,
): void => {
    if (typeof window === "undefined") return;
    try {
        const current = loadTourState(screen);
        const currentForMode = current[mode] ?? {};
        const nextForMode: ModeState = {
            ...currentForMode,
            ...(patch.lastVisitedAt !== undefined
                ? { lastVisitedAt: patch.lastVisitedAt }
                : {}),
            ...(patch.lastDismissedAt !== undefined
                ? { lastDismissedAt: patch.lastDismissedAt }
                : {}),
        };
        const otherMode: TourMode =
            mode === TOUR_MODE_NORMAL ? TOUR_MODE_TEACH : TOUR_MODE_NORMAL;
        const merged: {
            version: 2;
            normal?: { lastVisitedAt?: string; lastDismissedAt?: string };
            teach?: { lastVisitedAt?: string; lastDismissedAt?: string };
        } = { version: 2 };
        const nextSerialized = encodeModeState(nextForMode);
        const otherSerialized = encodeModeState(current[otherMode]);
        if (nextSerialized !== undefined) {
            merged[mode] = nextSerialized;
        }
        if (otherSerialized !== undefined) {
            merged[otherMode] = otherSerialized;
        }
        const encoded = encodeV2(merged);
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
    mode: TourMode,
    now: DateTime.Utc,
): void => writeMerged(screen, mode, { lastVisitedAt: now });

export const saveTourDismissed = (
    screen: ScreenKey,
    mode: TourMode,
    now: DateTime.Utc,
): void =>
    writeMerged(screen, mode, { lastVisitedAt: now, lastDismissedAt: now });

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
