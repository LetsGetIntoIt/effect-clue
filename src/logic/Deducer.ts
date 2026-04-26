import { Effect, Equal, Result } from "effect";
import { Cell, Contradiction, Knowledge } from "./Knowledge";
import { ContradictionKind } from "./ContradictionKind";
import { GameSetup } from "./GameSetup";
import { applyAllRules } from "./Rules";
import { getCardSet, getPlayerSet, getSuggestions } from "./services";

/**
 * Structured contradiction information the UI can act on without
 * parsing the reason string.
 *
 * - `reason`:                 free-form human description.
 * - `offendingCells`:         cells whose values are (part of) the
 *                             conflict. The UI will highlight these.
 * - `offendingSuggestionIndices`: the indices of any suggestions in the
 *                             supplied `suggestions` array whose rules
 *                             raised (or propagated) the conflict.
 *                             Empty when the conflict came from slice
 *                             saturation on purely-known inputs
 *                             (e.g. two players set to own the same
 *                             card via known-card checkboxes).
 * - `sliceLabel`:             the label of the slice that detected the
 *                             conflict, if applicable.
 */
export interface ContradictionTrace {
    readonly reason: string;
    readonly offendingCells: ReadonlyArray<Cell>;
    readonly offendingSuggestionIndices: ReadonlyArray<number>;
    readonly sliceLabel?: string | undefined;
    /**
     * Structured identity of the rule that raised the conflict — see
     * `ContradictionKind`. The UI dispatches on `_tag` to render
     * rule-specific copy ("Player passed on this suggestion, so they
     * can't have …") instead of a generic cell-conflict sentence.
     */
    readonly contradictionKind?: ContradictionKind | undefined;
}

/**
 * Materialised deduction outcome handed to UI consumers that need to
 * branch on both success and failure in a single value. The Effect
 * failure channel is the source of truth at call sites inside
 * `Effect.gen`; boundary wrappers (state.tsx useMemo, test-utils
 * RunDeduce) use `Effect.result` to convert back to this shape so
 * React render code stays branching on `Result.isSuccess`.
 */
export type DeductionResult = Result.Result<Knowledge, ContradictionTrace>;

const traceOf = (error: Contradiction): ContradictionTrace => ({
    reason: error.reason,
    offendingCells: error.offendingCells,
    offendingSuggestionIndices:
        error.suggestionIndex !== undefined
            ? [error.suggestionIndex]
            : [],
    sliceLabel: error.sliceLabel,
    contradictionKind: error.contradictionKind,
});

/**
 * Main entry point: given an initial knowledge (typically the solver's
 * own hand), run rules to a fixed point and return the derived
 * knowledge — or fail with a ContradictionTrace if the inputs are
 * internally inconsistent.
 *
 * Game setup and suggestion log are ambient context, read from
 * CardSetService / PlayerSetService / SuggestionsService. The
 * failure value lives on the Effect failure channel (not inside a
 * success-channel Result), so callers can compose with catchAll /
 * yield*-short-circuit. UI consumers that need both paths materialise
 * back to `Result` at the runSync boundary via Effect.result.
 *
 * Fixed-point loop: each rule is monotone (only adds cells, never
 * removes), so this is guaranteed to terminate in at most
 * |owners| × |cards| iterations.
 */
const deduce = Effect.fn("deducer.evaluate")(function* (initial: Knowledge) {
    const cardSet = yield* getCardSet;
    const playerSet = yield* getPlayerSet;
    const suggestions = yield* getSuggestions;
    const setup = GameSetup({ cardSet, playerSet });
    const rule = applyAllRules(setup, suggestions);
    let current = initial;
    try {
        // Bound the loop defensively — one iteration per cell would be
        // the worst case, so an order of magnitude above that is plenty.
        const maxIterations = 1000;
        for (let i = 0; i < maxIterations; i++) {
            const next = rule(current);
            if (Equal.equals(next, current)) return next;
            current = next;
        }
        return current;
    } catch (e) {
        if (e instanceof Contradiction) {
            return yield* Effect.fail(traceOf(e));
        }
        throw e;
    }
});

export default deduce;
