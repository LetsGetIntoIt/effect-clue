import { Effect, Equal, Result } from "effect";
import { Cell, Contradiction, Knowledge } from "./Knowledge";
import { GameSetup } from "./GameSetup";
import { applyAllRules } from "./Rules";
import {
    CardSetService,
    PlayerSetService,
    SuggestionsService,
    getCardSet,
    getPlayerSet,
    getSuggestions,
} from "./services";

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
 * The result of running the deducer. `Result.succeed(knowledge)` means
 * we converged to a consistent fixed point; `Result.fail(trace)` means
 * we hit a contradiction and the game state is internally inconsistent.
 *
 * We return `ContradictionTrace` (not the `Contradiction` Error itself)
 * on the failure channel so callers depend only on the structured data
 * they need for UI quick-fixes, not on the thrown Error's identity.
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
});

/**
 * Main entry point: given an initial knowledge (typically the solver's
 * own hand), run rules to a fixed point and return the derived
 * knowledge — or a Contradiction if the inputs are inconsistent.
 *
 * The game setup and suggestion log are ambient context, read from
 * CardSetService, PlayerSetService, and SuggestionsService. Consumers
 * that don't live inside an Effect.gen can use `deduceSync` (below)
 * for a synchronous convenience wrapper.
 *
 * Fixed-point loop: each rule is monotone (only adds cells, never
 * removes), so this is guaranteed to terminate in at most
 * |owners| × |cards| iterations.
 */
const deduce = (
    initial: Knowledge,
): Effect.Effect<
    DeductionResult,
    never,
    CardSetService | PlayerSetService | SuggestionsService
> =>
    Effect.gen(function* () {
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
                if (Equal.equals(next, current)) return Result.succeed(next);
                current = next;
            }
            return Result.succeed(current);
        } catch (e) {
            if (e instanceof Contradiction) return Result.fail(traceOf(e));
            throw e;
        }
    });

export default deduce;
