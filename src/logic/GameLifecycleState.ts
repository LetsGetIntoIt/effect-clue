/**
 * Persisted "when did this game come into being / last get touched"
 * timestamps for the active session. Drives the stale-game prompt
 * that fires on Checklist or Suggest when the user lands on a game
 * they haven't touched in a while (or never started in the first
 * place).
 *
 * Three timestamps live in localStorage:
 *
 * - `createdAt` — set when a session is first hydrated or when the
 *   user dispatches `newGame`. Used to gate the "unstarted game" flavor
 *   of the prompt (game has no known cards / suggestions / accusations
 *   AND was created more than `STALE_GAME_THRESHOLD_UNSTARTED` ago).
 *
 * - `lastModifiedAt` — bumped whenever a state-mutating action lands.
 *   Used to gate the "started game" flavor (game has any progress
 *   AND has been idle for more than `STALE_GAME_THRESHOLD_STARTED`).
 *
 * - `lastSnoozedAt` — set when the user dismisses the prompt. Until
 *   `STALE_GAME_SNOOZE` passes we suppress the prompt so the user
 *   isn't re-asked on every page load.
 *
 * Mirrors `SplashState`: ISO-8601 strings on disk, `DateTime.Utc` at
 * the API boundary, silent fallback to `{}` on a malformed payload.
 */
import { DateTime, Duration, Result, Schema } from "effect";

const PersistedGameLifecycleSchema = Schema.Struct({
    version: Schema.Literal(1),
    createdAt: Schema.optional(Schema.String),
    lastModifiedAt: Schema.optional(Schema.String),
    lastSnoozedAt: Schema.optional(Schema.String),
    /**
     * Set the first time the user clicks "Start playing" on the
     * wizard's last step (or otherwise completes the linear setup
     * walkthrough). Drives the wizard's flow → edit mode flip: a
     * brand-new user gets the guided walkthrough; a returning user
     * who already completed it once gets the spot-check edit page
     * with the global Play CTA. Reset by `markGameCreated` on
     * `newGame` so the next session starts in flow mode again.
     */
    setupWalkthroughDoneAt: Schema.optional(Schema.String),
});

const decodeUnknown = Schema.decodeUnknownResult(
    PersistedGameLifecycleSchema,
);
const encode = Schema.encodeSync(PersistedGameLifecycleSchema);

const STORAGE_KEY = "effect-clue.gameLifecycle.v1";
/**
 * Event name dispatched on `window` whenever lifecycle state is
 * written from within the same tab. React subscribers
 * (`useSetupWalkthroughDone`) re-read storage on the event so a
 * walkthrough-completion flip propagates without a full re-render.
 */
export const WALKTHROUGH_EVENT = "effect-clue.gameLifecycle.changed";

interface GameLifecycleState {
    readonly createdAt?: DateTime.Utc;
    readonly lastModifiedAt?: DateTime.Utc;
    readonly lastSnoozedAt?: DateTime.Utc;
    readonly setupWalkthroughDoneAt?: DateTime.Utc;
}

export const STALE_GAME_THRESHOLD_STARTED: Duration.Duration = Duration.days(3);
export const STALE_GAME_THRESHOLD_UNSTARTED: Duration.Duration = Duration.days(1);
export const STALE_GAME_SNOOZE: Duration.Duration = Duration.days(1);

const parseIso = (iso: string): DateTime.Utc | undefined => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return undefined;
    return DateTime.makeUnsafe(date);
};

const formatIso = (dt: DateTime.Utc): string =>
    new Date(DateTime.toEpochMillis(dt)).toISOString();

export const loadGameLifecycleState = (): GameLifecycleState => {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const decoded = decodeUnknown(JSON.parse(raw));
        if (Result.isFailure(decoded)) return {};
        const out: {
            -readonly [K in keyof GameLifecycleState]: GameLifecycleState[K];
        } = {};
        if (decoded.success.createdAt !== undefined) {
            const parsed = parseIso(decoded.success.createdAt);
            if (parsed !== undefined) out.createdAt = parsed;
        }
        if (decoded.success.lastModifiedAt !== undefined) {
            const parsed = parseIso(decoded.success.lastModifiedAt);
            if (parsed !== undefined) out.lastModifiedAt = parsed;
        }
        if (decoded.success.lastSnoozedAt !== undefined) {
            const parsed = parseIso(decoded.success.lastSnoozedAt);
            if (parsed !== undefined) out.lastSnoozedAt = parsed;
        }
        if (decoded.success.setupWalkthroughDoneAt !== undefined) {
            const parsed = parseIso(decoded.success.setupWalkthroughDoneAt);
            if (parsed !== undefined) out.setupWalkthroughDoneAt = parsed;
        }
        return out;
    } catch {
        return {};
    }
};

const writeMerged = (
    patch: Partial<GameLifecycleState>,
    options?: { readonly clear?: ReadonlyArray<keyof GameLifecycleState> },
): void => {
    if (typeof window === "undefined") return;
    try {
        const current = loadGameLifecycleState();
        const cleared = new Set<keyof GameLifecycleState>(options?.clear ?? []);
        const pickField = (
            field: keyof GameLifecycleState,
        ): DateTime.Utc | undefined => {
            if (cleared.has(field)) return undefined;
            return patch[field] ?? current[field];
        };
        const createdAt = pickField("createdAt");
        const lastModifiedAt = pickField("lastModifiedAt");
        const lastSnoozedAt = pickField("lastSnoozedAt");
        const setupWalkthroughDoneAt = pickField("setupWalkthroughDoneAt");
        const merged: {
            version: 1;
            createdAt?: string;
            lastModifiedAt?: string;
            lastSnoozedAt?: string;
            setupWalkthroughDoneAt?: string;
        } = { version: 1 };
        if (createdAt !== undefined) {
            merged.createdAt = formatIso(createdAt);
        }
        if (lastModifiedAt !== undefined) {
            merged.lastModifiedAt = formatIso(lastModifiedAt);
        }
        if (lastSnoozedAt !== undefined) {
            merged.lastSnoozedAt = formatIso(lastSnoozedAt);
        }
        if (setupWalkthroughDoneAt !== undefined) {
            merged.setupWalkthroughDoneAt = formatIso(setupWalkthroughDoneAt);
        }
        const encoded = encode(merged);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(encoded));
        // Tell React-side subscribers (useSetupWalkthroughDone) the
        // flag may have changed. Storage events don't fire in the
        // same tab on writes, so we dispatch a synthetic event.
        try {
            window.dispatchEvent(new CustomEvent(WALKTHROUGH_EVENT));
        } catch {
            // ignored — fallback to next React render
        }
    } catch {
        // Quota exceeded, private mode, etc. — non-fatal.
    }
};

/** Stamp the moment a fresh game came into being. Resets snooze
 * AND the setup-walkthrough flag — a new game should re-run the
 * first-time-through wizard. */
export const markGameCreated = (now: DateTime.Utc): void =>
    writeMerged(
        { createdAt: now, lastModifiedAt: now },
        { clear: ["lastSnoozedAt", "setupWalkthroughDoneAt"] },
    );

/** Bump the touched timestamp without changing creation or snooze. */
export const markGameTouched = (now: DateTime.Utc): void =>
    writeMerged({ lastModifiedAt: now });

/** Record that the user just dismissed the stale-game prompt. */
export const markStaleGameSnoozed = (now: DateTime.Utc): void =>
    writeMerged({ lastSnoozedAt: now });

/**
 * Record that the user finished the setup walkthrough (clicked the
 * wizard's last-step "Start playing" button). The next time they
 * visit Setup the wizard renders in spot-check edit mode, and the
 * global Play CTA in the chrome becomes visible.
 */
export const markSetupWalkthroughDone = (now: DateTime.Utc): void =>
    writeMerged({ setupWalkthroughDoneAt: now });

/** Wipe lifecycle state — used after `newGame` followed by markGameCreated. */
export const clearGameLifecycle = (): void => {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Non-fatal.
    }
};

/**
 * Pure decision helper. Given lifecycle state, "is the game started"
 * (any progress on the board), and the current time, returns whether
 * the stale-game prompt should fire.
 *
 * Eligibility rules:
 *  - If the user snoozed less than `STALE_GAME_SNOOZE` ago, never fire.
 *  - If the game is started, fire when `now - lastModifiedAt > STARTED`.
 *  - If the game is unstarted, fire when `now - createdAt > UNSTARTED`.
 *  - Missing timestamps are treated as "no signal yet" (don't fire).
 */
export const isStaleGameEligible = ({
    state,
    gameStarted,
    now,
}: {
    readonly state: GameLifecycleState;
    readonly gameStarted: boolean;
    readonly now: DateTime.Utc;
}): boolean => {
    if (state.lastSnoozedAt !== undefined) {
        const snoozeAge = DateTime.distance(state.lastSnoozedAt, now);
        if (!Duration.isGreaterThan(snoozeAge, STALE_GAME_SNOOZE)) return false;
    }
    if (gameStarted) {
        if (state.lastModifiedAt === undefined) return false;
        const idleFor = DateTime.distance(state.lastModifiedAt, now);
        return Duration.isGreaterThan(idleFor, STALE_GAME_THRESHOLD_STARTED);
    }
    if (state.createdAt === undefined) return false;
    const ageOf = DateTime.distance(state.createdAt, now);
    return Duration.isGreaterThan(ageOf, STALE_GAME_THRESHOLD_UNSTARTED);
};
