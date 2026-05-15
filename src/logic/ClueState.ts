import type { AccusationId } from "./Accusation";
import type { InsightConfidence } from "./BehavioralInsights";
import type { CardSet } from "./CardSet";
import type { Card, CardCategory, Player } from "./GameObjects";
import type { CardEntry, Category, GameSetup } from "./GameSetup";
import type { HypothesisMap, HypothesisValue } from "./Hypothesis";
import type { KnownCard } from "./InitialKnowledge";
import type { Cell } from "./Knowledge";
import type { GameSession } from "./Persistence";
import type { SuggestionId } from "./Suggestion";
import type { UserDeductionMap, UserDeductionValue } from "./TeachMode";

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
 * Marker for an explicit "Nobody" choice on optional suggestion-form
 * slots — distinct from `null` ("not yet decided"). Structurally
 * identical to the UI-layer `Nobody` constant in `SuggestionPills.tsx`,
 * so values constructed in either place are mutually assignable.
 */
interface PendingNobody {
    readonly kind: "nobody";
}

/**
 * Mid-flight new-suggestion form state, persisted in `ClueState` so it
 * survives mobile tab swaps (where `SuggestionLogPanel` and the form
 * underneath unmount) and full-page reloads.
 *
 * Mirrors the form-internal `FormState` shape one-to-one. Lives in the
 * logic layer so persistence and the reducer don't have to import
 * across the UI boundary.
 *
 * Only used for the new-suggestion flow; the edit-existing flow keeps
 * its own component-local buffer because edits already have a saved
 * source-of-truth in `state.suggestions`.
 */
export interface PendingSuggestionDraft {
    readonly id: string;
    readonly suggester: Player | null;
    readonly cards: ReadonlyArray<Card | null>;
    readonly nonRefuters: ReadonlyArray<Player> | PendingNobody | null;
    readonly refuter: Player | PendingNobody | null;
    readonly seenCard: Card | PendingNobody | null;
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
    | { type: "movePlayer"; player: Player; direction: "left" | "right" }
    /**
     * Bulk-replace the player list with `players`. Used by the M6
     * setup wizard's drag-to-reorder UI — `movePlayer` stays around
     * for arrow-key a11y, but a drag drops the whole new ordering at
     * once instead of N consecutive swaps. The reducer validates the
     * input is a permutation of the current list.
     */
    | { type: "reorderPlayers"; players: ReadonlyArray<Player> }
    /**
     * Bulk-replace the category list with `categories`. Used by the
     * M6 wizard's customize sub-flow drag-to-reorder. Validated as a
     * permutation against the current setup.
     */
    | { type: "reorderCategories"; categories: ReadonlyArray<Category> }
    /**
     * Bulk-replace one category's card list. Used by the M6 wizard's
     * customize sub-flow's per-category drag-to-reorder.
     */
    | {
          type: "reorderCardsInCategory";
          categoryId: CardCategory;
          cards: ReadonlyArray<CardEntry>;
      }
    | { type: "setUiMode"; mode: UiMode }
    | { type: "setHypothesis"; cell: Cell; value: HypothesisValue }
    | { type: "clearHypothesis"; cell: Cell }
    | { type: "replaceSession"; session: GameSession }
    | { type: "setPendingSuggestion"; draft: PendingSuggestionDraft | null }
    /**
     * Set (or clear) the player the user identifies AS. Drives the
     * M6 wizard's "Who are you?" step + the M8 My-cards panel +
     * refute hint. `null` means "skipped / cleared". Reference
     * invariants: cleared automatically on `removePlayer`, follows
     * the rename on `renamePlayer`.
     */
    | { type: "setSelfPlayer"; player: Player | null }
    /**
     * Persist that the user dismissed a specific behavioral insight at
     * its current confidence level. The insight resurfaces only if its
     * confidence later grows strictly past `atConfidence` — see
     * `src/logic/BehavioralInsights.ts` for the dismissal model.
     */
    | { type: "dismissInsight"; key: string; atConfidence: InsightConfidence }
    /** Forget every insight dismissal — the user wants the suggestions back. */
    | { type: "clearDismissedInsights" }
    /**
     * Set (or clear) the player who was dealt the first card. `null`
     * means "default to first in turn order" — keep the math centralized
     * via `firstDealt.ts` in the wizard rather than inlining it.
     * Reference invariants: cleared on `removePlayer`, follows the
     * rename on `renamePlayer`.
     */
    | { type: "setFirstDealtPlayer"; player: Player | null }
    /**
     * Flip teach-me mode on or off for this game. Teach-me mode hides
     * deducer-derived UI (hypotheses, leads, suggestion banners, cell
     * "why" reasoning, contradiction banner) and lets the user mark
     * checklist cells themselves via `setUserDeduction`. They can press
     * the Toolbar "Check" button to see how their marks compare to the
     * deducer's verdict. Per-game preference; rideable on transfer shares.
     */
    | { type: "setTeachMode"; enabled: boolean }
    /**
     * Set or clear a user-deduction mark for one cell. `value === null`
     * removes the entry (blank). Only meaningful when `teachMode` is on
     * but the reducer doesn't enforce that — toggling teach-mode off
     * preserves `userDeductions` so toggling back on restores the user's
     * marks.
     */
    | { type: "setUserDeduction"; cell: Cell; value: UserDeductionValue | null }
    /** Drop every user-deduction mark. */
    | { type: "clearUserDeductions" }
    /**
     * Replace `userDeductions` wholesale — used by the mid-game toggle
     * prompt's "Keep what we've deduced" option, which snapshots the
     * real-only deducer output via `seedFromKnowledge`.
     */
    | { type: "replaceUserDeductions"; userDeductions: UserDeductionMap };

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
    /**
     * UI-only ordering of active hypothesis cells, most-recent first.
     * Mirrors the keys of `hypotheses` 1:1; `hypotheses` is the value
     * source of truth (used by the deducer), and this list is what the
     * Hypotheses panel renders top-to-bottom so the panel reads like a
     * historical log. `setHypothesis` moves the cell to the front
     * (re-pinning bumps it); `clearHypothesis` removes it. Persisted
     * since v11.
     */
    readonly hypothesisOrder: ReadonlyArray<Cell>;
    /**
     * In-progress new-suggestion form state. Persisted so the form
     * survives mobile tab swaps (which unmount `SuggestionLogPanel`)
     * and full-page reloads. `null` means "no draft in flight" — the
     * form mounts empty.
     *
     * Only the new-suggestion flow reads/writes this; the
     * edit-existing flow keeps its own component-local buffer because
     * edits already have a saved source-of-truth in `suggestions`.
     */
    readonly pendingSuggestion: PendingSuggestionDraft | null;
    /**
     * The player the user identifies AS in this game. `null` means
     * skipped / not set — every UI feature gated on identity is
     * hidden in that case (no "set yourself" empty states; the
     * `<SetupSummary>` row is the discoverable path back). Driven
     * by the M6 wizard's "Who are you?" step. Read by M8's MyHand
     * panel + suggestion-form refute hint.
     *
     * Reference invariants enforced in the reducer:
     * - cleared on `removePlayer` if the removed player matches
     * - renamed on `renamePlayer` if the renamed player matches
     * - reset to `null` on `newGame`
     * - defaulted to `null` on `replaceSession` (imported games — the
     *   share wire format does NOT carry identity; the receiver picks
     *   their own)
     */
    readonly selfPlayerId: Player | null;
    /**
     * The player who was dealt the first card. `null` means "default
     * to the first player in turn order" — `firstDealt.ts` (added in
     * a later M6 sub-PR) reads through this to derive per-player
     * default hand sizes without inlining the math. Driven by the
     * "Adjust dealing" affordance on the wizard's hand-sizes step.
     *
     * Same reference invariants as `selfPlayerId`.
     */
    readonly firstDealtPlayerId: Player | null;
    /**
     * Per-game dismissal map for behavioral insights. Keyed by the
     * insight's `dismissedKey`; the value is the confidence the
     * insight had when the user dismissed it. The render-time filter
     * suppresses an insight while its current confidence is `≤` the
     * stored level — once evidence pushes confidence strictly higher,
     * the insight resurfaces. See `src/logic/BehavioralInsights.ts`.
     *
     * Reset to `new Map()` on `newGame`, `loadCardSet`, and
     * `replaceSession` (the share wire format does NOT carry these —
     * dismissals are personal scratchwork, like hypotheses).
     */
    readonly dismissedInsights: ReadonlyMap<string, InsightConfidence>;
    /**
     * Whether teach-me mode is active for this game. When `true`:
     * - the cell renderer reads `userDeductions` instead of the deducer's
     *   output
     * - the contradiction banner, hypothesis control, behavioral-insight
     *   suggestions, "lead" footnotes, and suggestion-aware banners in
     *   `MyHandPanel` are suppressed
     * - the cell explanation panel replaces its body with a "Check this
     *   cell" affordance
     * - the suggestion-form dropdowns fall back to alphabetical sort
     *
     * The deducer still runs in the background — the Toolbar Check
     * button compares `userDeductions` against the real-only deducer's
     * output to produce the four-state verdict taxonomy (verifiable /
     * falsifiable / plausible / missed) plus an Inconsistent state for
     * cells participating in intrinsic user-mark contradictions.
     *
     * Per-game preference. Rideable on `transfer` shares (the receiver
     * inherits the mode but starts with empty `userDeductions`); NOT
     * on the wire for `invite` shares (the receive modal offers an
     * optional opt-in checkbox instead).
     *
     * Reset to `false` on `newGame`. Preserved across `loadCardSet` and
     * `replaceSession` (the localStorage round-trip carries it; share
     * wire format is governed by kind).
     */
    readonly teachMode: boolean;
    /**
     * The user's manual checklist marks while teach-me mode is on.
     * Distinct from `knownCards` (which represents observed evidence
     * that feeds the deducer): user deductions are render-only guesses,
     * the user's *reasoning*. The deducer ignores them.
     *
     * Persists across `teachMode` toggles — toggling off doesn't wipe
     * the marks, so toggling back on restores them. The mid-game toggle
     * prompt asks the user whether to overwrite their existing marks
     * with the current deducer output ("Keep what we've deduced") or
     * keep them as-is.
     *
     * Reset to `emptyUserDeductions` on `newGame` and `loadCardSet`.
     * NOT on the wire for any share kind — personal scratchwork.
     */
    readonly userDeductions: UserDeductionMap;
}
