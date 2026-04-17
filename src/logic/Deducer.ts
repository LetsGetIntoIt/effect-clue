import { Equal } from "effect";
import { Contradiction, Knowledge } from "./Knowledge";
import { GameSetup } from "./GameSetup";
import { applyAllRules } from "./Rules";
import { Suggestion } from "./Suggestion";

/**
 * The result of running the deducer. Either we converged to a consistent
 * fixed point, or we hit a contradiction and the game state is
 * internally inconsistent.
 */
export type DeductionResult =
    | { readonly _tag: "Ok"; readonly knowledge: Knowledge }
    | { readonly _tag: "Contradiction"; readonly error: Contradiction };

export const Ok = (knowledge: Knowledge): DeductionResult =>
    ({ _tag: "Ok", knowledge });

export const Err = (error: Contradiction): DeductionResult =>
    ({ _tag: "Contradiction", error });

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
    const rule = applyAllRules(setup, suggestions);
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
