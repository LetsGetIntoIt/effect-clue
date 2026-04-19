import { Data } from "effect";
import {
    Card,
    CardCategory,
    CaseFileOwner,
    Owner,
    Player,
    PlayerOwner,
} from "./GameObjects";

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
 * Everything needed to fully describe a game of Clue: who's playing and
 * which cards (organised into categories) are in the deck. The solver is
 * completely category-agnostic — pass in 2 categories, 10 categories, or
 * the classic 3, and the inference rules work identically.
 */
class GameSetupImpl extends Data.Class<{
    readonly players: ReadonlyArray<Player>;
    readonly categories: ReadonlyArray<Category>;
}> {}

export type GameSetup = GameSetupImpl;

export const GameSetup = (params: {
    readonly players: ReadonlyArray<Player>;
    readonly categories: ReadonlyArray<Category>;
}): GameSetup => new GameSetupImpl(params);

// ---- Id / name lookups --------------------------------------------------

/**
 * Find a category by id. Returns `undefined` if the id isn't in this
 * setup — the caller decides whether that's a bug or just "stale".
 */
export const findCategoryEntry = (
    setup: GameSetup,
    id: CardCategory,
): Category | undefined =>
    setup.categories.find(c => c.id === id);

export const findCardEntry = (
    setup: GameSetup,
    id: Card,
): CardEntry | undefined => {
    for (const cat of setup.categories) {
        const hit = cat.cards.find(c => c.id === id);
        if (hit) return hit;
    }
    return undefined;
};

/** Pretty-print a card id. Falls back to the id itself if unknown. */
export const cardName = (setup: GameSetup, id: Card): string =>
    findCardEntry(setup, id)?.name ?? String(id);

/** Pretty-print a category id. Falls back to the id itself if unknown. */
export const categoryName = (setup: GameSetup, id: CardCategory): string =>
    findCategoryEntry(setup, id)?.name ?? String(id);

/**
 * Card ids in a category, in order. Used by the solver's slice
 * generators and deducer — everything the solver touches is ids.
 */
export const cardIdsInCategory = (
    setup: GameSetup,
    categoryId: CardCategory,
): ReadonlyArray<Card> =>
    findCategoryEntry(setup, categoryId)?.cards.map(c => c.id) ?? [];

export const allCardIds = (setup: GameSetup): ReadonlyArray<Card> =>
    setup.categories.flatMap(c => c.cards.map(e => e.id));

export const allCardEntries = (
    setup: GameSetup,
): ReadonlyArray<CardEntry> =>
    setup.categories.flatMap(c => c.cards);

/** Which category does this card id belong to? */
export const categoryOfCard = (
    setup: GameSetup,
    cardId: Card,
): CardCategory | undefined => {
    for (const cat of setup.categories) {
        if (cat.cards.some(e => e.id === cardId)) return cat.id;
    }
    return undefined;
};

/**
 * All owners (players + the single case file) for a game setup. Used
 * anywhere we need to iterate the "owner" axis of the checklist.
 */
export const allOwners = (setup: GameSetup): ReadonlyArray<Owner> => [
    ...setup.players.map(PlayerOwner),
    CaseFileOwner(),
];

/**
 * How many cards are in the case file (one per category).
 */
export const caseFileSize = (setup: GameSetup): number =>
    setup.categories.length;

/**
 * The default hand size each player gets when the deck is dealt out
 * evenly. Players who end up one short in an uneven deal are handled
 * by the caller — this is just the baseline.
 */
export const defaultHandSizes = (
    setup: GameSetup,
): ReadonlyArray<readonly [Player, number]> => {
    const dealt = allCardIds(setup).length - caseFileSize(setup);
    const n = setup.players.length;
    if (n === 0) return [];
    const base = Math.floor(dealt / n);
    const extras = dealt - base * n;
    return setup.players.map((player, i) =>
        [player, base + (i < extras ? 1 : 0)] as const);
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

// ---- Presets -----------------------------------------------------------

/**
 * Build a CardEntry with a stable id derived from the human-readable
 * slug. Using deterministic ids in presets keeps share-URL decoding
 * stable across users (two people loading Classic 4p get the same ids)
 * and makes IDs legible in dev tools.
 */
const presetCard = (name: string, slug: string): CardEntry => ({
    id: Card(`card-${slug}`),
    name,
});

const presetCategory = (
    name: string,
    slug: string,
    cards: ReadonlyArray<CardEntry>,
): Category => ({
    id: CardCategory(`category-${slug}`),
    name,
    cards,
});

const players = (names: ReadonlyArray<string>): ReadonlyArray<Player> =>
    names.map(Player);

const CLASSIC_SUSPECTS: ReadonlyArray<CardEntry> = [
    presetCard("Miss Scarlet", "miss-scarlet"),
    presetCard("Col. Mustard", "col-mustard"),
    presetCard("Mrs. White", "mrs-white"),
    presetCard("Mr. Green", "mr-green"),
    presetCard("Mrs. Peacock", "mrs-peacock"),
    presetCard("Prof. Plum", "prof-plum"),
];

const CLASSIC_WEAPONS: ReadonlyArray<CardEntry> = [
    presetCard("Candlestick", "candlestick"),
    presetCard("Knife", "knife"),
    presetCard("Lead pipe", "lead-pipe"),
    presetCard("Revolver", "revolver"),
    presetCard("Rope", "rope"),
    presetCard("Wrench", "wrench"),
];

const CLASSIC_ROOMS: ReadonlyArray<CardEntry> = [
    presetCard("Kitchen", "kitchen"),
    presetCard("Ball room", "ball-room"),
    presetCard("Conservatory", "conservatory"),
    presetCard("Dining room", "dining-room"),
    presetCard("Billiard room", "billiard-room"),
    presetCard("Library", "library"),
    presetCard("Lounge", "lounge"),
    presetCard("Hall", "hall"),
    presetCard("Study", "study"),
];

const CLASSIC_CATEGORIES: ReadonlyArray<Category> = [
    presetCategory("Suspects", "suspects", CLASSIC_SUSPECTS),
    presetCategory("Weapons", "weapons", CLASSIC_WEAPONS),
    presetCategory("Rooms", "rooms", CLASSIC_ROOMS),
];

/**
 * Build a fresh classic-Clue setup with N generically-named players. Used
 * as the "new game" default — users can rename the players and add or
 * remove rows from the UI grid.
 */
export const newGameSetup = (playerCount: number = 4): GameSetup => GameSetup({
    players: players(
        Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`),
    ),
    categories: CLASSIC_CATEGORIES,
});

/**
 * The single default preset surfaced in the UI's "New game" button.
 */
export const DEFAULT_SETUP: GameSetup = newGameSetup(4);

/**
 * Classic three-player Clue. Kept for tests; not exposed in the UI.
 */
export const CLASSIC_SETUP_3P: GameSetup = GameSetup({
    players: players(["Anisha", "Bob", "Cho"]),
    categories: CLASSIC_CATEGORIES,
});

/**
 * Classic Clue with the six standard suspects as six players.
 */
const CLASSIC_SETUP_6P: GameSetup = GameSetup({
    players: players([
        "Miss Scarlet",
        "Col. Mustard",
        "Mrs. White",
        "Mr. Green",
        "Mrs. Peacock",
        "Prof. Plum",
    ]),
    categories: CLASSIC_CATEGORIES,
});

/**
 * Master Detective edition: more suspects, weapons, and rooms.
 */
const MASTER_DETECTIVE_SETUP: GameSetup = GameSetup({
    players: players([
        "Miss Scarlet",
        "Col. Mustard",
        "Mrs. White",
        "Mr. Green",
        "Mrs. Peacock",
        "Prof. Plum",
    ]),
    categories: [
        presetCategory("Suspects", "md-suspects", [
            ...CLASSIC_SUSPECTS,
            presetCard("Miss Peach", "miss-peach"),
            presetCard("Mon. Brunette", "mon-brunette"),
            presetCard("Madame Rose", "madame-rose"),
            presetCard("Sgt. Gray", "sgt-gray"),
        ]),
        presetCategory("Weapons", "md-weapons", [
            ...CLASSIC_WEAPONS,
            presetCard("Horseshoe", "horseshoe"),
            presetCard("Poison", "poison"),
        ]),
        presetCategory("Rooms", "md-rooms", [
            ...CLASSIC_ROOMS,
            presetCard("Courtyard", "courtyard"),
            presetCard("Gazebo", "gazebo"),
            presetCard("Trophy room", "trophy-room"),
        ]),
    ],
});

interface SetupPreset {
    readonly id: string;
    readonly label: string;
    readonly build: () => GameSetup;
}

/**
 * Preset definitions surfaced as buttons in the GameSetupPanel. `build`
 * is a thunk rather than a direct GameSetup so callers can't accidentally
 * mutate shared data.
 */
export const PRESETS: ReadonlyArray<SetupPreset> = [
    { id: "classic-4p",        label: "Classic (4 players)",         build: () => newGameSetup(4) },
    { id: "classic-6p",        label: "Classic (6 players)",         build: () => CLASSIC_SETUP_6P },
    { id: "master-detective",  label: "Master Detective (6 players)", build: () => MASTER_DETECTIVE_SETUP },
];
