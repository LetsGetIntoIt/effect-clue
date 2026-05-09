import { Data } from "effect";
import { CardSet } from "./CardSet";
import {
    Card,
    CardCategory,
    CaseFileOwner,
    Owner,
    Player,
    PlayerOwner,
} from "./GameObjects";
import { PlayerSet } from "./PlayerSet";
import { CardEntry, Category } from "./CardSet";

// Re-export the deck-side types + helpers so existing imports
// (`from "./GameSetup"`) keep working after the split. CardSet.ts is
// the canonical home for anything that operates on just the card half.
export { CardEntry, Category } from "./CardSet";
export {
    findCategoryEntry,
    findCardEntry,
    cardName,
    categoryName,
    cardIdsInCategory,
    allCardIds,
    allCardEntries,
    categoryOfCard,
} from "./CardSet";

/**
 * A full game setup — the composition of a `CardSet` (which
 * categories / cards are in play) and a `PlayerSet` (who's at the
 * table). Most solver code wants just one half: `applyAllRules` +
 * `recommendSuggestions` operate on cards, player-name UI touches
 * only players. The composite is what the reducer and persistence
 * code carry around.
 *
 * Computed `players` / `categories` getters preserve the pre-split
 * call-site shape (`setup.players`, `setup.categories`) so the 50+
 * existing reads don't need mechanical renaming.
 */
class GameSetupImpl extends Data.Class<{
    readonly cardSet: CardSet;
    readonly playerSet: PlayerSet;
}> {
    get players(): ReadonlyArray<Player> {
        return this.playerSet.players;
    }

    get categories(): ReadonlyArray<Category> {
        return this.cardSet.categories;
    }
}

export type GameSetup = GameSetupImpl;

/**
 * Construct a `GameSetup`. Accepts the split shape
 * `{ cardSet, playerSet }` *or* the legacy flat shape
 * `{ players, categories }` so pre-split call sites continue to work.
 */
export const GameSetup = (
    params:
        | {
              readonly cardSet: CardSet;
              readonly playerSet: PlayerSet;
          }
        | {
              readonly players: ReadonlyArray<Player>;
              readonly categories: ReadonlyArray<Category>;
          },
): GameSetup => {
    if ("cardSet" in params) {
        return new GameSetupImpl({
            cardSet: params.cardSet,
            playerSet: params.playerSet,
        });
    }
    return new GameSetupImpl({
        cardSet: CardSet({ categories: params.categories }),
        playerSet: PlayerSet({ players: params.players }),
    });
};

/**
 * All owners (players + the single case file) for a game setup. Used
 * anywhere we need to iterate the "owner" axis of the checklist.
 * Needs both halves of the setup, so it stays on `GameSetup` rather
 * than moving to `CardSet` or `PlayerSet`.
 */
export const allOwners = (setup: GameSetup): ReadonlyArray<Owner> => [
    ...setup.playerSet.players.map(PlayerOwner),
    CaseFileOwner(),
];

/**
 * The default hand size each player gets when the deck is dealt out
 * evenly. Players who end up one short in an uneven deal are handled
 * by the caller — this is just the baseline. Depends on card count
 * (from CardSet) and player count (from PlayerSet).
 */
export const defaultHandSizes = (
    setup: GameSetup,
): ReadonlyArray<readonly [Player, number]> => {
    const cards = setup.cardSet.categories.flatMap(c =>
        c.cards.map(e => e.id),
    );
    const dealt = cards.length - setup.cardSet.categories.length;
    const players = setup.playerSet.players;
    const n = players.length;
    if (n === 0) return [];
    const base = Math.floor(dealt / n);
    const extras = dealt - base * n;
    return players.map((player, i) =>
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
const presetCard = (name: string, slug: string): CardEntry =>
    CardEntry({ id: Card(`card-${slug}`), name });

const presetCategory = (
    name: string,
    slug: string,
    cards: ReadonlyArray<CardEntry>,
): Category =>
    Category({ id: CardCategory(`category-${slug}`), name, cards });

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
    presetCategory("Suspect", "suspects", CLASSIC_SUSPECTS),
    presetCategory("Weapon", "weapons", CLASSIC_WEAPONS),
    presetCategory("Room", "rooms", CLASSIC_ROOMS),
];

/** The classic Clue deck packaged as a reusable CardSet. */
const CLASSIC_CARD_SET: CardSet = CardSet({
    categories: CLASSIC_CATEGORIES,
});

const MASTER_DETECTIVE_CATEGORIES: ReadonlyArray<Category> = [
    presetCategory("Suspect", "md-suspects", [
        ...CLASSIC_SUSPECTS,
        presetCard("Miss Peach", "miss-peach"),
        presetCard("Mon. Brunette", "mon-brunette"),
        presetCard("Madame Rose", "madame-rose"),
        presetCard("Sgt. Gray", "sgt-gray"),
    ]),
    presetCategory("Weapon", "md-weapons", [
        ...CLASSIC_WEAPONS,
        presetCard("Horseshoe", "horseshoe"),
        presetCard("Poison", "poison"),
    ]),
    presetCategory("Room", "md-rooms", [
        ...CLASSIC_ROOMS,
        presetCard("Courtyard", "courtyard"),
        presetCard("Gazebo", "gazebo"),
        presetCard("Trophy room", "trophy-room"),
    ]),
];

/** Master Detective expansion's deck as a reusable CardSet. */
const MASTER_DETECTIVE_CARD_SET: CardSet = CardSet({
    categories: MASTER_DETECTIVE_CATEGORIES,
});

/**
 * Build a fresh Classic-deck setup with 4 generically-named players.
 * Used as the "new game" default — users can rename the players and
 * add or remove rows from the UI grid. The deck is independent of
 * the roster (see `CARD_SETS` below) so callers can swap either
 * half without disturbing the other.
 */
export const newGameSetup = (): GameSetup =>
    GameSetup({
        cardSet: CLASSIC_CARD_SET,
        playerSet: PlayerSet({
            players: players(["Player 1", "Player 2", "Player 3", "Player 4"]),
        }),
    });

/**
 * The default setup surfaced by the UI's "New game" button.
 */
export const DEFAULT_SETUP: GameSetup = newGameSetup();

/**
 * Classic three-player Clue. Kept for tests; not exposed in the UI.
 */
export const CLASSIC_SETUP_3P: GameSetup = GameSetup({
    cardSet: CLASSIC_CARD_SET,
    playerSet: PlayerSet({ players: players(["Anisha", "Bob", "Cho"]) }),
});

interface CardSetChoice {
    readonly id: string;
    readonly label: string;
    readonly cardSet: CardSet;
}

/**
 * Card packs the UI offers as swap-in decks. Each entry is just the
 * deck — player rosters stay with whatever the current game already
 * has, so clicking "Master Detective" swaps the cards without
 * touching the players.
 */
export const CARD_SETS: ReadonlyArray<CardSetChoice> = [
    { id: "classic", label: "Classic", cardSet: CLASSIC_CARD_SET },
    { id: "master-detective", label: "Master Detective", cardSet: MASTER_DETECTIVE_CARD_SET },
];
