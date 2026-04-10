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

const suspects = (names: ReadonlyArray<string>): ReadonlyArray<Card> =>
    names.map(Card);

const weapons = suspects;
const rooms = suspects;
const players = (names: ReadonlyArray<string>): ReadonlyArray<Player> =>
    names.map(Player);

/**
 * Classic three-player Clue, matching the hardcoded setup from the
 * original codebase.
 */
export const CLASSIC_SETUP_3P: GameSetup = GameSetup({
    players: players(["Anisha", "Bob", "Cho"]),
    suspects: suspects([
        "Miss Scarlet",
        "Col. Mustard",
        "Mrs. White",
        "Mr. Green",
        "Mrs. Peacock",
        "Prof. Plum",
    ]),
    weapons: weapons([
        "Candlestick",
        "Knife",
        "Lead pipe",
        "Revolver",
        "Rope",
        "Wrench",
    ]),
    rooms: rooms([
        "Kitchen",
        "Ball room",
        "Conservatory",
        "Dining room",
        "Billiard room",
        "Library",
        "Lounge",
        "Hall",
        "Study",
    ]),
});

/**
 * Classic Clue with the default 6 suspects as 6 players — useful for the
 * full board-game experience.
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
    suspects: CLASSIC_SETUP_3P.suspects,
    weapons: CLASSIC_SETUP_3P.weapons,
    rooms: CLASSIC_SETUP_3P.rooms,
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
    suspects: suspects([
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
    weapons: weapons([
        "Candlestick",
        "Knife",
        "Lead pipe",
        "Revolver",
        "Rope",
        "Wrench",
        "Horseshoe",
        "Poison",
    ]),
    rooms: rooms([
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
});

export const PRESETS: ReadonlyArray<{ name: string; setup: GameSetup }> = [
    { name: "Classic (3 players)", setup: CLASSIC_SETUP_3P },
    { name: "Classic (6 players)", setup: CLASSIC_SETUP_6P },
    { name: "Master Detective (6 players)", setup: MASTER_DETECTIVE_SETUP },
];
