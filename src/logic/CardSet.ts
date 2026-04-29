import { Data } from "effect";
import { Card, CardCategory } from "./GameObjects";

/**
 * A card entry in a category. Keeps identity (`id`) separate from
 * display name — see GameObjects.ts for why.
 */
class CardEntryImpl extends Data.Class<{
    readonly id: Card;
    readonly name: string;
}> {}
export type CardEntry = CardEntryImpl;
export const CardEntry = (params: {
    readonly id: Card;
    readonly name: string;
}): CardEntry => new CardEntryImpl(params);

/**
 * One category of cards (Suspect / Weapon / Room, or any custom
 * deck). Carries its own opaque id so renames don't orphan references.
 */
class CategoryImpl extends Data.Class<{
    readonly id: CardCategory;
    readonly name: string;
    readonly cards: ReadonlyArray<CardEntry>;
}> {}
export type Category = CategoryImpl;
export const Category = (params: {
    readonly id: CardCategory;
    readonly name: string;
    readonly cards: ReadonlyArray<CardEntry>;
}): Category => new CategoryImpl(params);

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

/**
 * Structural equality between two `CardSet`s by user-visible *name*
 * — ids are deliberately ignored. Same category names in the same
 * order, each with the same card names in the same order, returns
 * `true`. Renaming a card or category, adding/removing/reordering
 * either, all return `false`.
 *
 * The name-based comparison is what drives the "active pack" pill
 * highlight: as long as the user's table looks like a saved pack to
 * them, that pack is the active one. The moment they edit anything,
 * the match drops and "Save as card pack" becomes the active call to
 * action.
 */
export const cardSetEquals = (a: CardSet, b: CardSet): boolean => {
    if (a === b) return true;
    if (a.categories.length !== b.categories.length) return false;
    for (let i = 0; i < a.categories.length; i += 1) {
        const ca = a.categories[i]!;
        const cb = b.categories[i]!;
        if (ca.name !== cb.name) return false;
        if (ca.cards.length !== cb.cards.length) return false;
        for (let j = 0; j < ca.cards.length; j += 1) {
            if (ca.cards[j]!.name !== cb.cards[j]!.name) return false;
        }
    }
    return true;
};
