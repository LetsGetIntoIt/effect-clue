import { Data } from "effect";
import {
    ALL_CATEGORIES,
    Card,
    CardCategory,
    CaseFileOwner,
    Owner,
    Player,
    PlayerOwner,
} from "./GameObjects";

/**
 * Everything needed to fully describe a game of Clue: who's playing and
 * which cards are in the deck. Previously these were hardcoded globals;
 * making them data lets us support 2–6 player games, Master Detective's
 * 30-card deck, Harry Potter Clue, or custom homebrews without touching
 * the solver.
 */
export type GameSetup = Data.Data<{
    readonly players: ReadonlyArray<Player>;
    readonly suspects: ReadonlyArray<Card>;
    readonly weapons: ReadonlyArray<Card>;
    readonly rooms: ReadonlyArray<Card>;
}>;

export const GameSetup = (params: {
    players: ReadonlyArray<Player>;
    suspects: ReadonlyArray<Card>;
    weapons: ReadonlyArray<Card>;
    rooms: ReadonlyArray<Card>;
}): GameSetup => Data.struct(params);

export const cardsInCategory = (
    setup: GameSetup,
    category: CardCategory,
): ReadonlyArray<Card> => {
    switch (category) {
        case "suspect": return setup.suspects;
        case "weapon":  return setup.weapons;
        case "room":    return setup.rooms;
    }
};

export const allCards = (setup: GameSetup): ReadonlyArray<Card> => [
    ...setup.suspects,
    ...setup.weapons,
    ...setup.rooms,
];

export const categoryOf = (
    setup: GameSetup,
    card: Card,
): CardCategory | undefined => {
    if (setup.suspects.includes(card)) return "suspect";
    if (setup.weapons.includes(card))  return "weapon";
    if (setup.rooms.includes(card))    return "room";
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
export const caseFileSize = (): number => ALL_CATEGORIES.length;

/**
 * The default hand size each player gets when the deck is dealt out
 * evenly. Players who end up one short in an uneven deal are handled
 * by the caller — this is just the baseline.
 */
export const defaultHandSizes = (
    setup: GameSetup,
): ReadonlyArray<readonly [Player, number]> => {
    const dealt = allCards(setup).length - caseFileSize();
    const n = setup.players.length;
    if (n === 0) return [];
    const base = Math.floor(dealt / n);
    const extras = dealt - base * n;
    return setup.players.map((player, i) =>
        [player, base + (i < extras ? 1 : 0)] as const);
};

// ---- Presets -----------------------------------------------------------

const cards = (names: ReadonlyArray<string>): ReadonlyArray<Card> =>
    names.map(Card);
const players = (names: ReadonlyArray<string>): ReadonlyArray<Player> =>
    names.map(Player);

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

/**
 * Build a fresh classic-Clue setup with N generically-named players. Used
 * as the "new game" default — users can rename the players and add or
 * remove rows from the UI grid.
 */
export const newGameSetup = (playerCount: number = 4): GameSetup => GameSetup({
    players: players(
        Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`),
    ),
    suspects: CLASSIC_SUSPECTS,
    weapons: CLASSIC_WEAPONS,
    rooms: CLASSIC_ROOMS,
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
    suspects: CLASSIC_SUSPECTS,
    weapons: CLASSIC_WEAPONS,
    rooms: CLASSIC_ROOMS,
});
