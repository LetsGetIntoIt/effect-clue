import type { AccusationId } from "./Accusation";
import type { CardSet } from "./CardSet";
import type { Card, CardCategory, Player } from "./GameObjects";
import type { GameSetup } from "./GameSetup";
import type { HypothesisMap, HypothesisValue } from "./Hypothesis";
import type { KnownCard } from "./InitialKnowledge";
import type { Cell } from "./Knowledge";
import type { GameSession } from "./Persistence";
import type { SuggestionId } from "./Suggestion";

/**
 * UI-level shape of a suggestion that hasn't been converted to a
 * Data.Class record yet — matches the form inputs directly. Forms
 * render these and the state layer converts them on submit. Lives in
 * the logic layer so pure-logic consumers (`describeAction`, future
 * rule helpers) can reference it without pulling in React.
 *
 * `loggedAt` is the millisecond timestamp recorded when the
 * suggestion was added to the log. The combined prior-log UI in
 * `SuggestionLogPanel` interleaves suggestions and accusations by
 * `loggedAt`. Forms set it via `Date.now()` on submit; persistence
 * round-trips it.
 */
export interface DraftSuggestion {
    readonly id: SuggestionId;
    readonly suggester: Player;
    readonly cards: ReadonlyArray<Card>;
    readonly nonRefuters: ReadonlyArray<Player>;
    readonly refuter?: Player | undefined;
    readonly seenCard?: Card | undefined;
    /**
     * Optional in the type so test fixtures and ad-hoc construction
     * sites don't have to thread it through; persistence and the
     * domain `Suggestion` constructor default `undefined` to `0`.
     */
    readonly loggedAt?: number;
}

/**
 * UI-level shape of a failed accusation that hasn't been converted to a
 * Data.Class record yet. Mirrors `DraftSuggestion` but carries only the
 * accuser and the named triple — no refuter / seen card, since a failed
 * accusation has neither. `loggedAt` follows the same convention as
 * `DraftSuggestion.loggedAt`.
 */
export interface DraftAccusation {
    readonly id: AccusationId;
    readonly accuser: Player;
    readonly cards: ReadonlyArray<Card>;
    /** See `DraftSuggestion.loggedAt`. */
    readonly loggedAt?: number;
}

/**
 * Coarse-grained UI mode. "setup" exposes the deck / player editing
 * surfaces; "play" locks them down so accidental clicks don't drop
 * hand sizes mid-game. The `newGame` action snaps back to "setup";
 * "Start playing" transitions to "play".
 *
 * Lives in ClueState (not component-local useState) so the shared-URL
 * encoder and localStorage persistence can round-trip it.
 */
export type UiMode = "setup" | "checklist" | "suggest";

/**
 * Everything dispatch-able from the UI. One concrete action per
 * thing-the-user-might-do; the reducer enumerates them exactly.
 *
 * Category / card operations come in id-based flavours (for inline
 * grid edits that know the stable id) and are resolved against the
 * current setup inside the reducer.
 *
 * **Invariant**: every mutation of `ClueState` must go through
 * `dispatch` (a `ClueAction`) — never via direct assignment or a
 * `setState` call escaping the state module. This invariant is what
 * lets the undo/redo meta-reducer observe every user-visible change
 * and what keeps the action log replayable. Components only ever
 * *read* `state` / `derived`; they never touch them.
 *
 * Ephemeral per-component UI state (like a form's local "editing"
 * buffer) is fine to keep in `useState`; the bar is specifically
 * against mutating anything inside `ClueState`.
 */
export type ClueAction =
    | { type: "newGame" }
    | { type: "loadCardSet"; cardSet: CardSet; label: string }
    | { type: "setSetup"; setup: GameSetup }
    | { type: "addCategory" }
    | { type: "removeCategoryById"; categoryId: CardCategory }
    | { type: "addCardToCategoryById"; categoryId: CardCategory }
    | { type: "removeCardById"; cardId: Card }
    | { type: "renameCategory"; categoryId: CardCategory; name: string }
    | { type: "renameCard"; cardId: Card; name: string }
    | { type: "addKnownCard"; card: KnownCard }
    | { type: "removeKnownCard"; index: number }
    | { type: "setHandSize"; player: Player; size: number | undefined }
    | { type: "addSuggestion"; suggestion: DraftSuggestion }
    | { type: "updateSuggestion"; suggestion: DraftSuggestion }
    | { type: "removeSuggestion"; id: SuggestionId }
    | { type: "addAccusation"; accusation: DraftAccusation }
    | { type: "updateAccusation"; accusation: DraftAccusation }
    | { type: "removeAccusation"; id: AccusationId }
    | { type: "addPlayer" }
    | { type: "removePlayer"; player: Player }
    | { type: "renamePlayer"; oldName: Player; newName: Player }
    | { type: "setUiMode"; mode: UiMode }
    | { type: "setHypothesis"; cell: Cell; value: HypothesisValue }
    | { type: "clearHypothesis"; cell: Cell }
    | { type: "replaceSession"; session: GameSession };

export interface ClueState {
    readonly setup: GameSetup;
    readonly handSizes: ReadonlyArray<readonly [Player, number]>;
    readonly knownCards: ReadonlyArray<KnownCard>;
    readonly suggestions: ReadonlyArray<DraftSuggestion>;
    readonly accusations: ReadonlyArray<DraftAccusation>;
    readonly uiMode: UiMode;
    /**
     * User-entered "what-if" assumptions, one per cell. Soft facts: the
     * deducer runs a parallel "joint" deduction over `realFacts ∪
     * hypotheses` so the user can see what their hunches would imply,
     * without polluting the canonical fact set or raising the global
     * contradiction banner. See {@link Hypothesis} for the model.
     */
    readonly hypotheses: HypothesisMap;
}
