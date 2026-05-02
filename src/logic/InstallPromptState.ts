/**
 * Persistence + gate for the PWA install prompt modal.
 *
 * Tracks two things in localStorage under
 * `effect-clue.install-prompt.v1`:
 *
 * - `visits` — incremented every time `useInstallPrompt` mounts.
 *   Drives the "fire on second visit, not the first" rule from the
 *   plan: the first visit alone triggers the splash; the install
 *   prompt waits until the user comes back at least once before
 *   asking them to install.
 * - `lastShownAt` / `lastDismissedAt` — ISO-8601 timestamps. The
 *   gate snoozes the prompt for 4 weeks after a dismiss so we don't
 *   harass users who said no, but still re-asks dormant returnees.
 *
 * Mirrors the `SplashState` / `TourState` patterns: structured
 * Schema validation with silent fallback to `{}` on a malformed
 * payload, try/catch around writes for quota / private-mode safety,
 * merging writes that preserve unrelated fields.
 */
import { DateTime, Duration, Result, Schema } from "effect";

const PersistedInstallPromptStateSchema = Schema.Struct({
    version: Schema.Literal(1),
    visits: Schema.optional(Schema.Number),
    lastShownAt: Schema.optional(Schema.String),
    lastDismissedAt: Schema.optional(Schema.String),
});

const decodeUnknown = Schema.decodeUnknownResult(
    PersistedInstallPromptStateSchema,
);
const encode = Schema.encodeSync(PersistedInstallPromptStateSchema);

const STORAGE_KEY = "effect-clue.install-prompt.v1";

interface InstallPromptState {
    readonly visits: number;
    readonly lastShownAt?: DateTime.Utc;
    readonly lastDismissedAt?: DateTime.Utc;
}

const empty: InstallPromptState = { visits: 0 };

const parseIso = (iso: string): DateTime.Utc | undefined => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return undefined;
    return DateTime.makeUnsafe(date);
};

const formatIso = (dt: DateTime.Utc): string =>
    new Date(DateTime.toEpochMillis(dt)).toISOString();

export const loadInstallPromptState = (): InstallPromptState => {
    if (typeof window === "undefined") return empty;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return empty;
        const decoded = decodeUnknown(JSON.parse(raw));
        if (Result.isFailure(decoded)) return empty;
        const out: {
            -readonly [K in keyof InstallPromptState]: InstallPromptState[K];
        } = { visits: decoded.success.visits ?? 0 };
        if (decoded.success.lastShownAt !== undefined) {
            const parsed = parseIso(decoded.success.lastShownAt);
            if (parsed !== undefined) out.lastShownAt = parsed;
        }
        if (decoded.success.lastDismissedAt !== undefined) {
            const parsed = parseIso(decoded.success.lastDismissedAt);
            if (parsed !== undefined) out.lastDismissedAt = parsed;
        }
        return out;
    } catch {
        return empty;
    }
};

const writeMerged = (patch: Partial<InstallPromptState>): void => {
    if (typeof window === "undefined") return;
    try {
        const current = loadInstallPromptState();
        const visits = patch.visits ?? current.visits;
        const lastShownAt = patch.lastShownAt ?? current.lastShownAt;
        const lastDismissedAt =
            patch.lastDismissedAt ?? current.lastDismissedAt;
        const merged: {
            version: 1;
            visits?: number;
            lastShownAt?: string;
            lastDismissedAt?: string;
        } = { version: 1, visits };
        if (lastShownAt !== undefined) {
            merged.lastShownAt = formatIso(lastShownAt);
        }
        if (lastDismissedAt !== undefined) {
            merged.lastDismissedAt = formatIso(lastDismissedAt);
        }
        const encoded = encode(merged);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(encoded));
    } catch {
        // Quota, private mode, etc. — non-fatal.
    }
};

/** Bumps the visit counter by 1. Caller is responsible for ordering
 * (read state → decide → bump). */
export const recordInstallPromptVisit = (): void => {
    const current = loadInstallPromptState();
    writeMerged({ visits: current.visits + 1 });
};

export const recordInstallPromptShown = (now: DateTime.Utc): void =>
    writeMerged({ lastShownAt: now });

export const recordInstallPromptDismissed = (now: DateTime.Utc): void =>
    writeMerged({ lastDismissedAt: now });

export const INSTALL_PROMPT_SNOOZE_DURATION = Duration.weeks(4);
export const INSTALL_PROMPT_MIN_VISITS = 2;

/**
 * Pure decision helper: should the install prompt be shown right
 * now? Tested in isolation; the UI hook (`useInstallPrompt`) wires
 * this up to React state.
 */
export const computeShouldShowInstallPrompt = (
    state: InstallPromptState,
    now: DateTime.Utc,
    snoozeDuration: Duration.Duration = INSTALL_PROMPT_SNOOZE_DURATION,
    minVisits: number = INSTALL_PROMPT_MIN_VISITS,
): boolean => {
    if (state.visits < minVisits) return false;
    if (state.lastDismissedAt === undefined) return true;
    const elapsed = DateTime.distance(state.lastDismissedAt, now);
    return Duration.isGreaterThan(elapsed, snoozeDuration);
};
