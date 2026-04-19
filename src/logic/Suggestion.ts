import { Brand, Data, HashSet, ReadonlyArray } from "effect";
import { Card, Player } from "./GameObjects";

/**
 * Stable identifier for a logged suggestion. Branded so we can't
 * accidentally pass a raw string (or some other id — player, card, etc.)
 * where a SuggestionId is expected. Provenance and footnotes refer back
 * to suggestions by this id, independent of array order.
 *
 * The empty string `""` is reserved as a sentinel for "not yet assigned"
 * (used by tests that don't care about identity, and by pre-migration
 * session data from v1/v2 before suggestion ids existed).
 */
export type SuggestionId = Brand.Branded<string, "SuggestionId">;
export const SuggestionId = Brand.nominal<SuggestionId>();

const randomId = (): string => {
    if (
        typeof globalThis !== "undefined" &&
        typeof globalThis.crypto !== "undefined" &&
        typeof globalThis.crypto.randomUUID === "function"
    ) {
        return globalThis.crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
};

export const newSuggestionId = (): SuggestionId =>
    SuggestionId(`suggestion-${randomId()}`);

/**
 * A single suggestion made during a game of Clue. The suggester names
 * one card per category; each subsequent player either refutes it by
 * showing one of those cards or can't refute at all.
 *
 * - `id`:          stable identifier, so provenance/footnotes can refer
 *                  back to a specific suggestion even as the array order
 *                  changes. The UI-layer `DraftSuggestion` has always had
 *                  one; carrying it into the domain record keeps the two
 *                  in sync and lets rules emit it in provenance. Defaults
 *                  to `SuggestionId("")` (tests pass in literals) and is
 *                  ignored by the solver — it's metadata, not inference
 *                  input.
 * - `suggester`:   who made the suggestion
 * - `cards`:       the set of cards named (typically one per category)
 * - `nonRefuters`: players who passed without refuting
 * - `refuter`:     the player who showed a card, if any
 * - `seenCard`:    which card we saw (undefined if we didn't make the
 *                  suggestion ourselves or the refuter isn't showing us)
 */
class SuggestionImpl extends Data.Class<{
    readonly id: SuggestionId;
    readonly suggester: Player;
    readonly cards: HashSet.HashSet<Card>;
    readonly nonRefuters: HashSet.HashSet<Player>;
    readonly refuter: Player | undefined;
    readonly seenCard: Card | undefined;
}> {}

export type Suggestion = SuggestionImpl;

export const Suggestion = (params: {
    id?: SuggestionId;
    suggester: Player;
    cards: Iterable<Card>;
    nonRefuters: Iterable<Player>;
    refuter?: Player | undefined;
    seenCard?: Card | undefined;
}): Suggestion =>
    new SuggestionImpl({
        id: params.id ?? SuggestionId(""),
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
