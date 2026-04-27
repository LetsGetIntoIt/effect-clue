import { Array as Arr, Brand, Data, HashSet } from "effect";
import { Card, Player } from "./GameObjects";

/**
 * Stable identifier for a logged accusation. Branded so we can't
 * accidentally pass a raw string (or some other id — player, card, etc.)
 * where an AccusationId is expected. Provenance refers back to
 * accusations by this id, independent of array order.
 *
 * The empty string `""` is reserved as a sentinel for "not yet assigned"
 * (used by tests that don't care about identity, and for pre-id
 * persistence payloads). The reducer / `replaceSession` swap the empty
 * sentinel out for a fresh id from `newAccusationId()` on hydration so
 * provenance always has a stable handle.
 */
export type AccusationId = Brand.Branded<string, "AccusationId">;
export const AccusationId = Brand.nominal<AccusationId>();

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

export const newAccusationId = (): AccusationId =>
    AccusationId(`accusation-${randomId()}`);

/**
 * A single accusation made during a game of Clue. The accuser names
 * one card per category; if the case file doesn't match, the accuser
 * is out — but every other player has now learned that the named
 * triple is *not* the case file.
 *
 * - `id`:        stable identifier, parallel to `Suggestion.id`.
 * - `accuser`:   who made the accusation. Tracked for the action log
 *                / provenance even though the rule itself only cares
 *                about the cards (the case file isn't any of those
 *                three, regardless of who guessed).
 * - `cards`:     the set of cards named (typically one per category).
 *                Order-agnostic; stored as a HashSet so structural
 *                equality on the record doesn't depend on iteration
 *                order.
 *
 * Modelled as a `Data.Class` for the same reasons as `Suggestion` —
 * structural `Equal.equals`, `HashMap` interoperability, and named-
 * field destructuring at call sites.
 */
class AccusationImpl extends Data.Class<{
    readonly id: AccusationId;
    readonly accuser: Player;
    readonly cards: HashSet.HashSet<Card>;
}> {}

export type Accusation = AccusationImpl;

export const Accusation = (params: {
    id?: AccusationId;
    accuser: Player;
    cards: Iterable<Card>;
}): Accusation =>
    new AccusationImpl({
        id: params.id ?? AccusationId(""),
        accuser: params.accuser,
        cards: HashSet.fromIterable(params.cards),
    });

export const accusationCards = (a: Accusation): ReadonlyArray<Card> =>
    Arr.fromIterable<Card>(a.cards);
