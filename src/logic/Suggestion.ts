import { Data, HashSet, ReadonlyArray } from "effect";
import { Card, Player } from "./GameObjects";

/**
 * A single suggestion made during a game of Clue. The suggester names
 * three cards (one of each category); each subsequent player either
 * refutes it by showing one of those cards or can't refute at all.
 *
 * - `suggester`:   who made the suggestion
 * - `cards`:       the set of cards named (typically 3, always ≥ 1)
 * - `nonRefuters`: players who passed without refuting
 * - `refuter`:     the player who showed a card, if any
 * - `seenCard`:    which card we saw (undefined if we didn't make the
 *                  suggestion ourselves or the refuter isn't showing us)
 */
export type Suggestion = Data.Data<{
    readonly suggester: Player;
    readonly cards: HashSet.HashSet<Card>;
    readonly nonRefuters: HashSet.HashSet<Player>;
    readonly refuter: Player | undefined;
    readonly seenCard: Card | undefined;
}>;

export const Suggestion = (params: {
    suggester: Player;
    cards: Iterable<Card>;
    nonRefuters: Iterable<Player>;
    refuter?: Player | undefined;
    seenCard?: Card | undefined;
}): Suggestion => Data.struct({
    suggester: params.suggester,
    cards: HashSet.fromIterable(params.cards),
    nonRefuters: HashSet.fromIterable(params.nonRefuters),
    refuter: params.refuter,
    seenCard: params.seenCard,
});

export const suggestionCards = (s: Suggestion): ReadonlyArray<Card> =>
    ReadonlyArray.fromIterable(s.cards);

export const suggestionNonRefuters = (s: Suggestion): ReadonlyArray<Player> =>
    ReadonlyArray.fromIterable(s.nonRefuters);
