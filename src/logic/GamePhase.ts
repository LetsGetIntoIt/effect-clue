/**
 * Mutually-exclusive game phases derived from {@link ClueState}. The
 * single source of truth for "where is the user in the lifecycle of
 * this game?" — consolidates the four scattered inline checks the
 * codebase used to inline at every call site:
 *
 * - the wizard's `hasGameProgress` flip-the-CTA-label rule
 * - state.tsx's `gameStartedRef` for smart-landing focus
 * - Clue.tsx's `gameStarted` for tour eligibility
 * - useStaleGameGate's `gameStarted` for the idle-threshold pick
 *
 * Plus the wizard's `hasGameData()` brand-new-user-redirect helper.
 *
 * The phase ordering is forward-only during normal play; `newGame`
 * resets to `"new"`.
 *
 *   new ──► dirty ──► setupCompleted ──► gameStarted
 *                                            │
 *                                  newGame action
 *                                            ▼
 *                                          new
 */
import { DEFAULT_SETUP } from "./GameSetup";
import type { ClueState } from "./ClueState";

export type GamePhase = "new" | "dirty" | "setupCompleted" | "gameStarted";

const PHASE_ORDER: Record<GamePhase, number> = {
    new: 0,
    dirty: 1,
    setupCompleted: 2,
    gameStarted: 3,
};

/**
 * `true` when `phase` is at least `threshold` in the lifecycle
 * ordering. Reads naturally at call sites:
 * `phaseAtLeast(phase, "setupCompleted")` ≈ "the game is at least
 * setup-completed."
 */
export const phaseAtLeast = (
    phase: GamePhase,
    threshold: GamePhase,
): boolean => PHASE_ORDER[phase] >= PHASE_ORDER[threshold];

/**
 * Broader engagement check — "the user has touched any concrete card
 * information." True iff knownCards OR suggestions OR accusations
 * exist. Different from `getGamePhase(state) === "gameStarted"`
 * because knownCards entry counts here but not as gameStarted.
 *
 * Consumed by the stale-game gate (idle-threshold pick), tour
 * eligibility (StartupCoordinator's `gameStarted` input), and
 * smart-landing focus on ⌘H. These surfaces want "any engagement,"
 * not strictly "the user has played a suggestion" — keeping the
 * helper separate lets the phase model stay crisp without forcing
 * those consumers to migrate their semantics.
 */
export const hasCardInformation = (state: ClueState): boolean =>
    state.knownCards.length > 0
    || state.suggestions.length > 0
    || state.accusations.length > 0;

/**
 * `true` when at least one suggestion or accusation has been logged
 * — the strict "the user has played" signal. The wizard's CTA flips
 * its label on this; the phase machine elevates to `gameStarted`
 * on this.
 */
const hasGameProgress = (state: ClueState): boolean =>
    state.suggestions.length > 0 || state.accusations.length > 0;

/**
 * `true` when the minimum data needed to play exists: a card pack is
 * chosen, at least two players are entered, and every player has a
 * hand-size entry. Sum-of-hand-sizes is intentionally not enforced
 * — wizardSteps's validation treats sum mismatch as a `warning`,
 * not `blocked`, and we want the phase to honor the same threshold.
 *
 * `knownCards` / `selfPlayerId` aren't required either — both are
 * skippable in the wizard; the user can play without them.
 */
const hasMinimumSetup = (state: ClueState): boolean => {
    if (state.setup.categories.length === 0) return false;
    const players = state.setup.players;
    if (players.length < 2) return false;
    const handSizePlayers = new Set(state.handSizes.map(([p]) => p));
    return players.every((p) => handSizePlayers.has(p));
};

/**
 * `true` when any user-touched state exists. Mirrors the legacy
 * `hasGameData()` semantics — the brand-new-user redirect needs a
 * very permissive "is there anything to preserve?" check that
 * includes player-roster customisation, pack swaps, identity, and
 * first-dealt-player edits.
 */
const hasAnyData = (state: ClueState): boolean => {
    if (state.knownCards.length > 0) return true;
    if (state.handSizes.length > 0) return true;
    if (state.suggestions.length > 0) return true;
    if (state.accusations.length > 0) return true;
    if (state.selfPlayerId !== null) return true;
    if (state.firstDealtPlayerId !== null) return true;
    const players = state.setup.players;
    if (players.length !== DEFAULT_SETUP.players.length) return true;
    for (let i = 0; i < players.length; i++) {
        if (players[i] !== DEFAULT_SETUP.players[i]) return true;
    }
    const categories = state.setup.categories;
    if (categories.length !== DEFAULT_SETUP.categories.length) return true;
    for (let i = 0; i < categories.length; i++) {
        if (categories[i] !== DEFAULT_SETUP.categories[i]) return true;
    }
    return false;
};

/**
 * Pure derivation: which phase is this game in? Guarded match where
 * the first satisfied condition wins (most-progressed match), so the
 * result is well-defined for every `ClueState`.
 */
export const getGamePhase = (state: ClueState): GamePhase => {
    if (hasGameProgress(state)) return "gameStarted";
    if (hasMinimumSetup(state)) return "setupCompleted";
    if (hasAnyData(state)) return "dirty";
    return "new";
};
