import { Data } from "effect";
import { Card, CardCategory } from "./GameObjects";

/**
 * A card entry in a category. Keeps identity (`id`) separate from
 * display name — see GameObjects.ts for why.
 */
export interface CardEntry {
    readonly id: Card;
    readonly name: string;
}

/**
 * One category of cards (Suspects / Weapons / Rooms, or any custom
 * deck). Carries its own opaque id so renames don't orphan references.
 */
export interface Category {
    readonly id: CardCategory;
    readonly name: string;
    readonly cards: ReadonlyArray<CardEntry>;
}

/**
 * The "deck" half of a game setup: which categories are in play and
 * which card ids populate each. Players are tracked separately in
 * `PlayerSet` — saved presets persist only the `CardSet` so the same
 * deck can be reused across different player rosters.
 */
class CardSetImpl extends Data.Class<{
    readonly categories: ReadonlyArray<Category>;
}> {}

export type CardSet = CardSetImpl;

export const CardSet = (params: {
    readonly categories: ReadonlyArray<Category>;
}): CardSet => new CardSetImpl(params);

// ---- Id / name lookups --------------------------------------------------

export const findCategoryEntry = (
    cardSet: CardSet,
    id: CardCategory,
): Category | undefined =>
    cardSet.categories.find(c => c.id === id);

export const findCardEntry = (
    cardSet: CardSet,
    id: Card,
): CardEntry | undefined => {
    for (const cat of cardSet.categories) {
        const hit = cat.cards.find(c => c.id === id);
        if (hit) return hit;
    }
    return undefined;
};

/** Pretty-print a card id. Falls back to the id itself if unknown. */
export const cardName = (cardSet: CardSet, id: Card): string =>
    findCardEntry(cardSet, id)?.name ?? String(id);

/** Pretty-print a category id. Falls back to the id itself if unknown. */
export const categoryName = (cardSet: CardSet, id: CardCategory): string =>
    findCategoryEntry(cardSet, id)?.name ?? String(id);

/**
 * Card ids in a category, in order. Used by the solver's slice
 * generators and deducer — everything the solver touches is ids.
 */
export const cardIdsInCategory = (
    cardSet: CardSet,
    categoryId: CardCategory,
): ReadonlyArray<Card> =>
    findCategoryEntry(cardSet, categoryId)?.cards.map(c => c.id) ?? [];

export const allCardIds = (cardSet: CardSet): ReadonlyArray<Card> =>
    cardSet.categories.flatMap(c => c.cards.map(e => e.id));

export const allCardEntries = (
    cardSet: CardSet,
): ReadonlyArray<CardEntry> =>
    cardSet.categories.flatMap(c => c.cards);

/** Which category does this card id belong to? */
export const categoryOfCard = (
    cardSet: CardSet,
    cardId: Card,
): CardCategory | undefined => {
    for (const cat of cardSet.categories) {
        if (cat.cards.some(e => e.id === cardId)) return cat.id;
    }
    return undefined;
};

/**
 * How many cards are in the case file (one per category).
 */
export const caseFileSize = (cardSet: CardSet): number =>
    cardSet.categories.length;
