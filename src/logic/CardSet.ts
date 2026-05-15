import { Data } from "effect";
import { Card, CardCategory, newCardId, newCategoryId } from "./GameObjects";

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

// ---- Name disambiguation ----------------------------------------------

/**
 * Roman numeral suffix used when a proposed name collides with an
 * existing one. Starts at ii (not i) because the first occurrence
 * keeps its bare name — only duplicates get a suffix.
 *
 * We go Roman deliberately: user-entered parenthesised suffixes like
 * "(2)", "(v2)", "(alt)" stay verbatim and don't get clobbered.
 */
const ROMAN_DIGITS: ReadonlyArray<readonly [number, string]> = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"],
    [100, "c"], [90, "xc"], [50, "l"], [40, "xl"],
    [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

export const toRoman = (n: number): string => {
    if (n <= 0) return "";
    let remaining = n;
    let out = "";
    for (const [value, symbol] of ROMAN_DIGITS) {
        while (remaining >= value) {
            out += symbol;
            remaining -= value;
        }
    }
    return out;
};

/**
 * Given a proposed name and a set of existing names, return a
 * guaranteed-unique variant. If `proposed` itself is free, it comes
 * back unchanged. Otherwise we append " (ii)", " (iii)", ... until
 * we find a free slot.
 *
 * The `existing` argument is the set of names we're disambiguating
 * *against* (callers exclude the current entry's own name when
 * renaming, so an idempotent rename doesn't double up).
 */
export const disambiguateName = (
    proposed: string,
    existing: ReadonlyArray<string>,
): string => {
    const trimmed = proposed.trim();
    if (trimmed.length === 0) return trimmed;
    const taken = new Set(existing.map(s => s.trim()));
    if (!taken.has(trimmed)) return trimmed;
    for (let n = 2; n < 10000; n++) {
        const candidate = `${trimmed} (${toRoman(n)})`;
        if (!taken.has(candidate)) return candidate;
    }
    // Absurd fallback — we're not rendering 10k card names.
    return `${trimmed} (${Date.now().toString(36)})`;
};

/** Pick the next "Category N" that doesn't collide with any existing one. */
const nextNumberedCategoryName = (
    existingNames: ReadonlyArray<string>,
): string => {
    const taken = new Set(existingNames);
    let n = 1;
    while (taken.has(`Category ${n}`)) n++;
    return `Category ${n}`;
};

/** Pick the next "Card N" that doesn't collide anywhere in the deck. */
const nextNumberedCardName = (
    existingNames: ReadonlyArray<string>,
): string => {
    const taken = new Set(existingNames);
    let n = 1;
    while (taken.has(`Card ${n}`)) n++;
    return `Card ${n}`;
};

// ---- Pure transforms ---------------------------------------------------
//
// These mirror the reducer's `addCategory` / `removeCategoryById` /
// `addCardToCategoryById` / `removeCardById` / `renameCategory` /
// `renameCard` / `reorderCategories` / `reorderCardsInCategory` cases,
// but operate on a `CardSet` rather than a full `ClueState`. The
// reducer cases delegate here so the modal's draft buffer can share
// the same logic without touching session state.

export const addCategoryToCardSet = (cs: CardSet): CardSet => {
    const existingCategoryNames = cs.categories.map(c => c.name);
    const existingCardNames = allCardEntries(cs).map(c => c.name);
    const catName = disambiguateName(
        nextNumberedCategoryName(existingCategoryNames),
        existingCategoryNames,
    );
    const cardName = disambiguateName(
        nextNumberedCardName(existingCardNames),
        existingCardNames,
    );
    const newCat = Category({
        id: newCategoryId(),
        name: catName,
        cards: [CardEntry({ id: newCardId(), name: cardName })],
    });
    return CardSet({
        categories: [...cs.categories, newCat],
    });
};

export const removeCategoryFromCardSet = (
    cs: CardSet,
    id: CardCategory,
): CardSet => {
    // The last remaining category can't be removed — every deck needs
    // at least one. Callers should hide the remove affordance, but
    // guard here too so a stale dispatch can't empty the set.
    if (cs.categories.length <= 1) return cs;
    // Identity preservation for unknown ids — the reducer's no-op tests
    // (e.g. duplicate dispatch) rely on `===` against the previous state.
    if (!cs.categories.some(c => c.id === id)) return cs;
    return CardSet({
        categories: cs.categories.filter(c => c.id !== id),
    });
};

export const renameCategoryInCardSet = (
    cs: CardSet,
    id: CardCategory,
    name: string,
): CardSet => {
    const current = findCategoryEntry(cs, id);
    if (!current) return cs;
    const proposed = name.trim();
    if (proposed.length === 0) return cs;
    if (proposed === current.name) return cs;
    const othersNames = cs.categories
        .filter(c => c.id !== id)
        .map(c => c.name);
    const finalName = disambiguateName(proposed, othersNames);
    return CardSet({
        categories: cs.categories.map(c =>
            c.id === id
                ? Category({ id: c.id, name: finalName, cards: c.cards })
                : c,
        ),
    });
};

export const addCardToCategoryInCardSet = (
    cs: CardSet,
    categoryId: CardCategory,
): CardSet => {
    const existingCardNames = allCardEntries(cs).map(c => c.name);
    const cardName = disambiguateName(
        nextNumberedCardName(existingCardNames),
        existingCardNames,
    );
    return CardSet({
        categories: cs.categories.map(c =>
            c.id === categoryId
                ? Category({
                      id: c.id,
                      name: c.name,
                      cards: [
                          ...c.cards,
                          CardEntry({ id: newCardId(), name: cardName }),
                      ],
                  })
                : c,
        ),
    });
};

export const removeCardFromCardSet = (
    cs: CardSet,
    cardId: Card,
): CardSet => {
    const target = cs.categories.find(c =>
        c.cards.some(e => e.id === cardId),
    );
    if (!target) return cs;
    // A category with one remaining card can't drop to zero — every
    // category must have at least one card. Guard here too.
    if (target.cards.length <= 1) return cs;
    return CardSet({
        categories: cs.categories.map(c =>
            c.id === target.id
                ? Category({
                      id: c.id,
                      name: c.name,
                      cards: c.cards.filter(e => e.id !== cardId),
                  })
                : c,
        ),
    });
};

export const renameCardInCardSet = (
    cs: CardSet,
    cardId: Card,
    name: string,
): CardSet => {
    const current = findCardEntry(cs, cardId);
    if (!current) return cs;
    const proposed = name.trim();
    if (proposed.length === 0) return cs;
    if (proposed === current.name) return cs;
    const othersNames = allCardEntries(cs)
        .filter(e => e.id !== cardId)
        .map(e => e.name);
    const finalName = disambiguateName(proposed, othersNames);
    return CardSet({
        categories: cs.categories.map(c =>
            Category({
                id: c.id,
                name: c.name,
                cards: c.cards.map(e =>
                    e.id === cardId
                        ? CardEntry({ id: e.id, name: finalName })
                        : e,
                ),
            }),
        ),
    });
};

export const reorderCategoriesInCardSet = (
    cs: CardSet,
    categories: ReadonlyArray<Category>,
): CardSet => {
    // Permutation check: same set of category ids, just reordered.
    if (categories.length !== cs.categories.length) return cs;
    const currentIds = new Set(cs.categories.map(c => c.id));
    for (const c of categories) {
        if (!currentIds.has(c.id)) return cs;
    }
    return CardSet({ categories });
};

export const reorderCardsInCategoryInCardSet = (
    cs: CardSet,
    categoryId: CardCategory,
    cards: ReadonlyArray<CardEntry>,
): CardSet => {
    const cat = cs.categories.find(c => c.id === categoryId);
    if (!cat) return cs;
    if (cards.length !== cat.cards.length) return cs;
    const currentIds = new Set(cat.cards.map(c => c.id));
    for (const card of cards) {
        if (!currentIds.has(card.id)) return cs;
    }
    return CardSet({
        categories: cs.categories.map(c =>
            c.id === categoryId ? Category({ id: c.id, name: c.name, cards }) : c,
        ),
    });
};
