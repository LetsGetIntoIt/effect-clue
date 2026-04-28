import { HashMap, Result } from "effect";
import type { Accusation } from "./Accusation";
import { deduceSync } from "./Deducer";
import {
    allCardEntries,
    GameSetup,
} from "./GameSetup";
import {
    Card,
    Player,
    PlayerOwner,
} from "./GameObjects";
import {
    getCellByOwnerCard,
    getHandSize,
    Knowledge,
    N,
    Y,
} from "./Knowledge";
import {
    Suggestion,
} from "./Suggestion";

/**
 * Information-gain scoring helpers consumed by the recommender. For
 * each candidate triple the suggester could ask, enumerate the
 * plausible refuter responses, weight by per-outcome probability,
 * and average the per-outcome unknown-cell reduction the deducer
 * produces — that's the score `Recommender.recommendSuggestions`
 * ranks on.
 *
 * The probability model is per-row marginal — each unknown cell on a
 * player's row gets `(handSize − knownYs) / unknownCellCount` —
 * cheap and directionally correct. No cross-row correlation, no
 * Monte-Carlo sampling. If a future revisit needs sharper estimates,
 * `probPlayerOwnsCard` is the seam to swap.
 *
 * Pure helpers stay synchronous; the top-level `expectedInfoGain`
 * runs `deduceSync` per outcome but takes positional inputs so it's
 * trivially callable from `Recommender.recommendSuggestions` inside
 * its own Effect.gen without a layer-rebuild dance.
 */

/**
 * Total unknown cells across every (owner, card) pair. Equal to
 * `|owners| × |cards|` minus the number of cells already pinned in
 * the checklist. Includes the case-file owner.
 */
export const countUnknowns = (
    setup: GameSetup,
    knowledge: Knowledge,
): number => {
    // owners = players + the case file = players.length + 1
    const owners = setup.players.length + 1;
    const cards = allCardEntries(setup).length;
    return owners * cards - HashMap.size(knowledge.checklist);
};

/**
 * Marginal probability that `player` owns `card`. Returns 1 / 0 for
 * pinned cells, and a uniform `(handRemaining / unknownCellsOnRow)`
 * estimate for unknown cells. Falls back to 0 when the player has no
 * known hand size and no setup default — calling code can then treat
 * that triple as "no information available".
 */
export const probPlayerOwnsCard = (
    setup: GameSetup,
    knowledge: Knowledge,
    player: Player,
    card: Card,
): number => {
    if (!setup.players.includes(player)) return 0;
    const owner = PlayerOwner(player);
    const cell = getCellByOwnerCard(knowledge, owner, card);
    if (cell === Y) return 1;
    if (cell === N) return 0;

    const handSize = getHandSize(knowledge, owner);
    if (handSize === undefined) return 0;

    let knownYs = 0;
    let unknowns = 0;
    for (const entry of allCardEntries(setup)) {
        const v = getCellByOwnerCard(knowledge, owner, entry.id);
        if      (v === Y) knownYs += 1;
        else if (v === undefined) unknowns += 1;
    }
    if (unknowns === 0) return 0;
    const numerator = Math.max(0, handSize - knownYs);
    return Math.min(1, numerator / unknowns);
};

/**
 * Probability that `player` could refute a suggestion of `candidate`
 * — i.e. owns at least one of the named cards. Short-circuits to 1 on
 * the first known Y, and reduces to `1 − ∏(1 − p_i)` over the
 * `probPlayerOwnsCard` marginals for unknowns.
 */
export const probPlayerRefutesWithAny = (
    setup: GameSetup,
    knowledge: Knowledge,
    player: Player,
    candidate: ReadonlyArray<Card>,
): number => {
    let noneProduct = 1;
    for (const card of candidate) {
        const p = probPlayerOwnsCard(setup, knowledge, player, card);
        if (p === 1) return 1;
        noneProduct *= 1 - p;
    }
    return 1 - noneProduct;
};

/**
 * One possible outcome of asking `candidate` from `suggester`'s seat.
 * `synthesizedSuggestion` is what the suggestion log would look like
 * after this outcome lands; `probability` is the (re-normalised)
 * weight of this outcome in the total outcome space.
 */
interface OutcomeVariant {
    readonly synthesizedSuggestion: Suggestion;
    readonly probability: number;
}

/**
 * Enumerate the possible refuter responses to `candidate`. Players
 * are walked in setup order (assumed clockwise from `suggester`); a
 * given player gets the chance to refute only if every earlier player
 * couldn't.
 *
 * Each variant carries:
 *   - the synthesized `Suggestion` that would land in the log,
 *   - the probability of reaching that variant (re-normalised so the
 *     returned variants sum to 1).
 *
 * Returns an empty array when no outcome is reachable (e.g. every
 * player has all three cards N already, or the suggester isn't in
 * setup.players).
 */
export const enumerateOutcomes = (
    setup: GameSetup,
    knowledge: Knowledge,
    suggester: Player,
    candidate: ReadonlyArray<Card>,
): ReadonlyArray<OutcomeVariant> => {
    const players = setup.players;
    const sIdx = players.indexOf(suggester);
    if (sIdx < 0) return [];
    // Order = every other player, clockwise from the suggester.
    const order: Player[] = [];
    for (let i = 1; i < players.length; i++) {
        order.push(players[(sIdx + i) % players.length] as Player);
    }
    if (order.length === 0) return [];

    // Precompute per-player refute probabilities.
    const q = order.map(p =>
        probPlayerRefutesWithAny(setup, knowledge, p, candidate),
    );
    // reach[k] = probability the suggestion reaches player k without
    // earlier players refuting.
    const reach: number[] = [];
    let acc = 1;
    for (const qk of q) { reach.push(acc); acc *= 1 - qk; }
    const noneRefuteRaw = acc;

    type RawVariant = {
        readonly refuter?: Player;
        readonly seenCard?: Card;
        readonly nonRefuters: Player[];
        readonly weight: number;
    };
    const raw: RawVariant[] = [];

    // Variant 1: nobody refutes.
    raw.push({
        nonRefuters: [...order],
        weight: noneRefuteRaw,
    });

    // Variants 2..N: each player k refutes; the seen card is one of
    // the candidate's cards weighted by P(player owns card | refutes).
    for (let k = 0; k < order.length; k++) {
        const P = order[k]!;
        const reachK = reach[k]!;
        const qK = q[k]!;
        if (reachK === 0 || qK === 0) continue;
        const perCard = candidate.map(c =>
            probPlayerOwnsCard(setup, knowledge, P, c),
        );
        const sum = perCard.reduce((a, b) => a + b, 0);
        if (sum === 0) continue;
        for (let ci = 0; ci < candidate.length; ci++) {
            const p = perCard[ci]!;
            if (p === 0) continue;
            raw.push({
                refuter: P,
                seenCard: candidate[ci]!,
                nonRefuters: order.slice(0, k),
                weight: reachK * qK * (p / sum),
            });
        }
    }

    const total = raw.reduce((a, v) => a + v.weight, 0);
    if (total === 0) return [];
    return raw
        .filter(v => v.weight > 0)
        .map(v => ({
            synthesizedSuggestion: Suggestion({
                suggester,
                cards: candidate,
                nonRefuters: v.nonRefuters,
                refuter: v.refuter,
                seenCard: v.seenCard,
            }),
            probability: v.weight / total,
        }));
};

/**
 * Expected reduction in unknown cells if `suggester` asks `candidate`,
 * averaged across the outcome space and weighted by per-outcome
 * probability.
 *
 * For each outcome we run `deduceSync` on the original setup +
 * suggestions log + the synthesized suggestion that outcome would
 * produce. Outcomes that lead to a contradiction (the simple per-row
 * marginal model can produce these on edge cases) are dropped, and
 * the remaining probabilities are re-normalised — never silently
 * inflating the score.
 *
 * Returns 0 when no outcome is reachable. The score is always
 * non-negative; deduce is monotone (only adds cells), so
 * `unknownsBefore − unknownsAfter ≥ 0`.
 */
export const expectedInfoGain = (
    setup: GameSetup,
    knowledge: Knowledge,
    suggestions: ReadonlyArray<Suggestion>,
    accusations: ReadonlyArray<Accusation>,
    suggester: Player,
    candidate: ReadonlyArray<Card>,
): number => {
    const outcomes = enumerateOutcomes(setup, knowledge, suggester, candidate);
    if (outcomes.length === 0) return 0;
    const before = countUnknowns(setup, knowledge);

    let sumProb = 0;
    let sumWeightedGain = 0;
    for (const o of outcomes) {
        const result = deduceSync(
            setup,
            [...suggestions, o.synthesizedSuggestion],
            accusations,
            knowledge,
        );
        if (Result.isFailure(result)) continue;
        const after = countUnknowns(setup, result.success);
        sumProb += o.probability;
        sumWeightedGain += o.probability * Math.max(0, before - after);
    }
    return sumProb === 0 ? 0 : sumWeightedGain / sumProb;
};
