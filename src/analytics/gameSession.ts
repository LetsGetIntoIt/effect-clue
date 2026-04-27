/**
 * Per-game analytics session bookkeeping.
 *
 * Some funnel events need state that doesn't naturally live in
 * `ClueState` — e.g. `game_started` needs the wall-clock duration
 * since `game_setup_started`, and `case_file_solved` should fire at
 * most once per game even though its trigger (a state derivation)
 * can re-evaluate many times.
 *
 * We keep that bookkeeping out of the reducer (which must stay pure)
 * and out of localStorage (analytics is best-effort across reloads)
 * by holding it in a module-level singleton. Each `newGame()` call
 * advances `gameId`, which acts as the dedupe key for one-shot events.
 */

type SessionState = {
    /** 0 = no session opened yet this page-load. 1+ = current game. */
    gameId: number;
    /** Wall-clock ms when `startSetup()` was last called. */
    setupStartedAt: number | null;
    /** Wall-clock ms when `claimGameStarted()` last returned true. */
    gameStartedAt: number | null;
    /** `gameId` for which `claimGameStarted()` last returned true. */
    gameStartedFiredFor: number | null;
    /** `gameId` for which `claimCaseFileSolved()` last returned true. */
    caseFileSolvedFiredFor: number | null;
};

const session: SessionState = {
    gameId: 0,
    setupStartedAt: null,
    gameStartedAt: null,
    gameStartedFiredFor: null,
    caseFileSolvedFiredFor: null,
};

/**
 * Open a new analytics session — call alongside the `newGame`
 * dispatch (or once on initial mount in setup mode for fresh
 * visits). Stamps the setup-start timestamp and bumps `gameId`
 * so the one-shot flags re-arm.
 */
export const startSetup = (): void => {
    session.gameId += 1;
    session.setupStartedAt = Date.now();
};

/**
 * `true` until the first `startSetup()` call this page-load.
 * The mount effect uses this to fire `gameSetupStarted` exactly
 * once for fresh visits without double-firing when the user
 * later clicks "New Game" (which calls `startSetup` itself).
 */
export const isFirstSession = (): boolean => session.gameId === 0;

/**
 * Setup duration in ms. Returns 0 if `startSetup` was never
 * called (e.g. user reloaded straight into checklist mode and
 * never went through setup) so the event still fires with a
 * sensible payload rather than `NaN`.
 */
export const setupDurationMs = (): number => {
    if (session.setupStartedAt === null) return 0;
    return Date.now() - session.setupStartedAt;
};

/**
 * Returns `true` exactly once per game, then `false` until the
 * next `startSetup`. Use to dedupe `game_started` so it doesn't
 * re-fire on every uiMode round-trip. Returns `false` while
 * `gameId === 0` (no session opened yet).
 */
export const claimGameStarted = (): boolean => {
    if (session.gameId === 0) return false;
    if (session.gameStartedFiredFor === session.gameId) return false;
    session.gameStartedFiredFor = session.gameId;
    session.gameStartedAt = Date.now();
    return true;
};

/**
 * Time elapsed since `claimGameStarted()` last returned true. Used as
 * the `durationMs` for `caseFileSolved` so it measures *play* time
 * (game-start → solved), not setup-plus-play. Returns 0 if no game
 * has been started yet (e.g. user reloaded into checklist mode).
 */
export const gameDurationMs = (): number => {
    if (session.gameStartedAt === null) return 0;
    return Date.now() - session.gameStartedAt;
};

/**
 * Returns `true` exactly once per game, then `false`. Use to
 * dedupe `case_file_solved` so the deduce-diff observer doesn't
 * re-fire it on every subsequent suggestion. Returns `false`
 * while `gameId === 0`.
 */
export const claimCaseFileSolved = (): boolean => {
    if (session.gameId === 0) return false;
    if (session.caseFileSolvedFiredFor === session.gameId) return false;
    session.caseFileSolvedFiredFor = session.gameId;
    return true;
};
