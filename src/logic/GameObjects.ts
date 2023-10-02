import { Brand } from "effect";

export type Player = Brand.Branded<
    | "Anisha"
    | "Bob"
    | "Cho",
    'Player'
>;
export const Player = Brand.nominal<Player>();
export const ALL_PLAYERS = [
    Player("Anisha"),
    Player("Bob"),
    Player("Cho"),
];

export type Card = Brand.Branded<
    | "Miss Scarlet"
    | "Col. Mustard"
    | "Mrs. White"
    | "Mr. Green"
    | "Mrs. Peacock"
    | "Prof. Plum"
    | "Candlestick"
    | "Knife"
    | "Lead pipe"
    | "Revolver"
    | "Rope"
    | "Wrench"
    | "Kitchen"
    | "Ball room"
    | "Conservatory"
    | "Dining room"
    | "Billiard room"
    | "Library"
    | "Lounge"
    | "Hall"
    | "Study",
    'Card'
>;
export const Card = Brand.nominal<Card>();

export const ALL_SUSPECT_CARDS: Card[] = [
    // Card("Miss Scarlet"),
    // Card("Col. Mustard"),
    // Card("Mrs. White"),
    // Card("Mr. Green"),
    Card("Mrs. Peacock"),
    Card("Prof. Plum"),
];

export const ALL_WEAPON_CARDS: Card[] = [
    // Card("Candlestick"),
    // Card("Knife"),
    // Card("Lead pipe"),
    // Card("Revolver"),
    Card("Rope"),
    Card("Wrench"),
];

export const ALL_ROOM_CARDS: Card[] = [
    // Card("Kitchen"),
    // Card("Ball room"),
    // Card("Conservatory"),
    // Card("Dining room"),
    // Card("Billiard room"),
    // Card("Library"),
    // Card("Lounge"),
    Card("Hall"),
    Card("Study"),
];

export const ALL_CARDS: Card[] = [
    ...ALL_SUSPECT_CARDS,
    ...ALL_WEAPON_CARDS,
    ...ALL_ROOM_CARDS,
];
