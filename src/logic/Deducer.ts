import { Equal } from "effect";
import { Cell, Contradiction, Knowledge } from "./Knowledge";
import { GameSetup } from "./GameSetup";
import { applyAllRules } from "./Rules";
import { Suggestion } from "./Suggestion";

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
}

/**
 * The result of running the deducer. Either we converged to a consistent
 * fixed point, or we hit a contradiction and the game state is
 * internally inconsistent.
 *
 * On contradiction the result carries both the raw `error` (kept for
 * backward-compatibility with `result.error.reason`) and a structured
 * `trace` that the UI reads to render quick-fix buttons.
 */
export type DeductionResult =
    | { readonly _tag: "Ok"; readonly knowledge: Knowledge }
    | {
        readonly _tag: "Contradiction";
        readonly error: Contradiction;
        readonly trace: ContradictionTrace;
    };

export const Ok = (knowledge: Knowledge): DeductionResult =>
    ({ _tag: "Ok", knowledge });

export const Err = (error: Contradiction): DeductionResult => ({
    _tag: "Contradiction",
    error,
    trace: {
        reason: error.reason,
        offendingCells: error.offendingCells,
        offendingSuggestionIndices:
            error.suggestionIndex !== undefined
                ? [error.suggestionIndex]
                : [],
        sliceLabel: error.sliceLabel,
    },
});

/**
 * Main entry point: given a game setup, a set of suggestions, and some
 * initial knowledge (typically the solver's own hand), run rules to a
 * fixed point and return the derived knowledge — or a Contradiction if
 * the inputs are inconsistent.
 *
 * Fixed-point loop: each rule is monotone (only adds cells, never
 * removes), so this is guaranteed to terminate in at most
 * |owners| × |cards| iterations.
 */
export const deduce = (
    setup: GameSetup,
    suggestions: Iterable<Suggestion>,
) => (
    initial: Knowledge,
): DeductionResult => {
    const suggestionArray = Array.from(suggestions);
    const rule = applyAllRules(setup, suggestionArray);
    let current = initial;
    try {
        // Bound the loop defensively — one iteration per cell would be
        // the worst case, so an order of magnitude above that is plenty.
        const maxIterations = 1000;
        for (let i = 0; i < maxIterations; i++) {
            const next = rule(current);
            if (Equal.equals(next, current)) return Ok(next);
            current = next;
        }
        return Ok(current);
    } catch (e) {
        if (e instanceof Contradiction) return Err(e);
        throw e;
    }
};

export default deduce;
