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
    | "Candlestick"
    | "Knife"
    | "Kitchen"
    | "Ball room",
    'Card'
>;
export const Card = Brand.nominal<Card>();

export const ALL_SUSPECT_CARDS: Card[] = [
    Card("Miss Scarlet"),
    Card("Col. Mustard"),
];

export const ALL_WEAPON_CARDS: Card[] = [
    Card("Candlestick"),
    Card("Knife"),
];

export const ALL_ROOM_CARDS: Card[] = [
    Card("Kitchen"),
    Card("Ball room"),
];

export const ALL_CARDS: Card[] = [
    ...ALL_SUSPECT_CARDS,
    ...ALL_WEAPON_CARDS,
    ...ALL_ROOM_CARDS,
];
