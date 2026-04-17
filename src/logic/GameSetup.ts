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
 * One category of cards in a game — e.g. "Suspects", "Weapons", "Rooms",
 * or anything custom. The case file will contain exactly one card from
 * each category.
 */
export interface Category {
    readonly name: CardCategory;
    readonly cards: ReadonlyArray<Card>;
}

/**
 * Everything needed to fully describe a game of Clue: who's playing and
 * which cards (organised into categories) are in the deck. The solver is
 * completely category-agnostic — pass in 2 categories, 10 categories, or
 * the classic 3, and the inference rules work identically.
 */
export type GameSetup = Data.Data<{
    readonly players: ReadonlyArray<Player>;
    readonly categories: ReadonlyArray<Category>;
}>;

export const GameSetup = (params: {
    players: ReadonlyArray<Player>;
    categories: ReadonlyArray<Category>;
}): GameSetup => Data.struct(params);

/**
 * Find the card list for a given category name, or `undefined` if no such
 * category exists in this setup.
 */
export const cardsInCategory = (
    setup: GameSetup,
    category: CardCategory,
): ReadonlyArray<Card> =>
    setup.categories.find(c => c.name === category)?.cards ?? [];

export const allCategories = (setup: GameSetup): ReadonlyArray<CardCategory> =>
    setup.categories.map(c => c.name);

export const allCards = (setup: GameSetup): ReadonlyArray<Card> =>
    setup.categories.flatMap(c => c.cards);

export const categoryOf = (
    setup: GameSetup,
    card: Card,
): CardCategory | undefined =>
    setup.categories.find(c => c.cards.includes(card))?.name;

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
    const dealt = allCards(setup).length - caseFileSize(setup);
    const n = setup.players.length;
    if (n === 0) return [];
    const base = Math.floor(dealt / n);
    const extras = dealt - base * n;
    return setup.players.map((player, i) =>
        [player, base + (i < extras ? 1 : 0)] as const);
};

// ---- Validation --------------------------------------------------------

export interface SetupValidationError {
    readonly kind:
        | "empty-category-name"
        | "duplicate-category-name"
        | "category-has-no-cards"
        | "empty-card-name"
        | "duplicate-card-name"
        | "duplicate-player-name"
        | "empty-player-name"
        | "no-players"
        | "no-categories";
    readonly message: string;
}

/**
 * Validate a setup. Returns all errors found, so the UI can display them
 * all at once rather than dribble them in one-by-one. Empty array means
 * the setup is well-formed and safe to solve against.
 */
export const validateSetup = (
    setup: GameSetup,
): ReadonlyArray<SetupValidationError> => {
    const errors: SetupValidationError[] = [];

    if (setup.players.length === 0) {
        errors.push({
            kind: "no-players",
            message: "At least one player is required.",
        });
    }

    const seenPlayers = new Set<string>();
    for (const p of setup.players) {
        const s = String(p).trim();
        if (s.length === 0) {
            errors.push({
                kind: "empty-player-name",
                message: "Player names cannot be blank.",
            });
        } else if (seenPlayers.has(s)) {
            errors.push({
                kind: "duplicate-player-name",
                message: `Duplicate player name: "${s}".`,
            });
        } else {
            seenPlayers.add(s);
        }
    }

    if (setup.categories.length === 0) {
        errors.push({
            kind: "no-categories",
            message: "At least one category is required.",
        });
    }

    const seenCategories = new Set<string>();
    const seenCards = new Set<string>();
    for (const cat of setup.categories) {
        const name = String(cat.name).trim();
        if (name.length === 0) {
            errors.push({
                kind: "empty-category-name",
                message: "Category names cannot be blank.",
            });
        } else if (seenCategories.has(name)) {
            errors.push({
                kind: "duplicate-category-name",
                message: `Duplicate category name: "${name}".`,
            });
        } else {
            seenCategories.add(name);
        }

        if (cat.cards.length === 0) {
            errors.push({
                kind: "category-has-no-cards",
                message: `Category "${name}" must have at least one card.`,
            });
        }
        for (const card of cat.cards) {
            const cn = String(card).trim();
            if (cn.length === 0) {
                errors.push({
                    kind: "empty-card-name",
                    message: "Card names cannot be blank.",
                });
            } else if (seenCards.has(cn)) {
                errors.push({
                    kind: "duplicate-card-name",
                    message: `Duplicate card name: "${cn}".`,
                });
            } else {
                seenCards.add(cn);
            }
        }
    }

    return errors;
};

// ---- Presets -----------------------------------------------------------

const cards = (names: ReadonlyArray<string>): ReadonlyArray<Card> =>
    names.map(Card);
const players = (names: ReadonlyArray<string>): ReadonlyArray<Player> =>
    names.map(Player);

const SUSPECTS_CATEGORY = CardCategory("Suspects");
const WEAPONS_CATEGORY  = CardCategory("Weapons");
const ROOMS_CATEGORY    = CardCategory("Rooms");

const CLASSIC_SUSPECTS = cards([
    "Miss Scarlet",
    "Col. Mustard",
    "Mrs. White",
    "Mr. Green",
    "Mrs. Peacock",
    "Prof. Plum",
]);

const CLASSIC_WEAPONS = cards([
    "Candlestick",
    "Knife",
    "Lead pipe",
    "Revolver",
    "Rope",
    "Wrench",
]);

const CLASSIC_ROOMS = cards([
    "Kitchen",
    "Ball room",
    "Conservatory",
    "Dining room",
    "Billiard room",
    "Library",
    "Lounge",
    "Hall",
    "Study",
]);

const CLASSIC_CATEGORIES: ReadonlyArray<Category> = [
    { name: SUSPECTS_CATEGORY, cards: CLASSIC_SUSPECTS },
    { name: WEAPONS_CATEGORY,  cards: CLASSIC_WEAPONS  },
    { name: ROOMS_CATEGORY,    cards: CLASSIC_ROOMS    },
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
export const CLASSIC_SETUP_6P: GameSetup = GameSetup({
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
export const MASTER_DETECTIVE_SETUP: GameSetup = GameSetup({
    players: players([
        "Miss Scarlet",
        "Col. Mustard",
        "Mrs. White",
        "Mr. Green",
        "Mrs. Peacock",
        "Prof. Plum",
    ]),
    categories: [
        {
            name: SUSPECTS_CATEGORY,
            cards: cards([
                "Miss Scarlet",
                "Col. Mustard",
                "Mrs. White",
                "Mr. Green",
                "Mrs. Peacock",
                "Prof. Plum",
                "Miss Peach",
                "Mon. Brunette",
                "Madame Rose",
                "Sgt. Gray",
            ]),
        },
        {
            name: WEAPONS_CATEGORY,
            cards: cards([
                "Candlestick",
                "Knife",
                "Lead pipe",
                "Revolver",
                "Rope",
                "Wrench",
                "Horseshoe",
                "Poison",
            ]),
        },
        {
            name: ROOMS_CATEGORY,
            cards: cards([
                "Kitchen",
                "Ball room",
                "Conservatory",
                "Dining room",
                "Billiard room",
                "Library",
                "Lounge",
                "Hall",
                "Study",
                "Courtyard",
                "Gazebo",
                "Trophy room",
            ]),
        },
    ],
});

export interface SetupPreset {
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
