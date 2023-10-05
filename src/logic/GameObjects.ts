import { Brand, Data, HashMap, HashSet, Option, ReadonlyArray, ReadonlyRecord, Tuple, pipe } from "effect";

export type Player = Brand.Branded<string, "Player">;
export const Player = Brand.nominal<Player>();

export type CardCategory = Brand.Branded<string, "CardCategory">;
export const CardCategory = Brand.nominal<CardCategory>();

export type Card = Brand.Branded<Data.Data<[CardCategory, string]>, "Card">;
export const Card = Brand.nominal<Card>();

export class GameObjects extends Data.Class<{
    players: HashSet.HashSet<Player>;
    cards: HashSet.HashSet<Card>;
}> {
    private _cardCategories: HashSet.HashSet<CardCategory> | undefined;
    get cardCategories() {
        if (!this._cardCategories) {
            this._cardCategories = HashMap.keySet(this.cardsByCategory);
        }
        return this._cardCategories;
    }

    private _cardsByCategory: HashMap.HashMap<CardCategory, HashSet.HashSet<Card>> | undefined;
    get cardsByCategory() {
        if (!this._cardsByCategory) {
            this._cardsByCategory = pipe(
                this.cards,

                HashSet.reduce(
                    HashMap.beginMutation(
                        HashMap.empty<CardCategory, HashSet.HashSet<Card>>(),
                    ),
                    (cardsByCategory, card) => HashMap.modifyAt(
                        cardsByCategory,
                        card[0],
                        Option.match({
                            onNone: () => Option.some(HashSet.beginMutation(HashSet.make(card))),
                            onSome: cards => Option.some(HashSet.add(cards, card)),
                        }),
                    ),
                ),

                // Mutations are done now
                HashMap.map(HashSet.endMutation),
                HashMap.endMutation,
            );
        }
        return this._cardsByCategory;
    }
}

export const cardCategoriesNorthAmerica = {
    suspect: CardCategory("Suspect"),
    weapon: CardCategory("Weapon"),
    room: CardCategory("Room"),
} as const;

export const cardsNorthAmerica = {
    missScarlet: Card(Data.tuple(cardCategoriesNorthAmerica.suspect, "Miss Scarlet")),
    colMustard: Card(Data.tuple(cardCategoriesNorthAmerica.suspect, "Col. Mustard")),
    mrsWhite: Card(Data.tuple(cardCategoriesNorthAmerica.suspect, "Mrs. White")),
    mrGreen: Card(Data.tuple(cardCategoriesNorthAmerica.suspect, "Mr. Green")),
    mrsPeacock: Card(Data.tuple(cardCategoriesNorthAmerica.suspect, "Mrs. Peacock")),
    profPlum: Card(Data.tuple(cardCategoriesNorthAmerica.suspect, "Prof. Plum")),
    candlestick: Card(Data.tuple(cardCategoriesNorthAmerica.weapon, "Candlestick")),
    knife: Card(Data.tuple(cardCategoriesNorthAmerica.weapon, "Knife")),
    leadPipe: Card(Data.tuple(cardCategoriesNorthAmerica.weapon, "Lead pipe")),
    revolver: Card(Data.tuple(cardCategoriesNorthAmerica.weapon, "Revolver")),
    rope: Card(Data.tuple(cardCategoriesNorthAmerica.weapon, "Rope")),
    wrench: Card(Data.tuple(cardCategoriesNorthAmerica.weapon, "Wrench")),
    kitchen: Card(Data.tuple(cardCategoriesNorthAmerica.room, "Kitchen")),
    ballRoom: Card(Data.tuple(cardCategoriesNorthAmerica.room, "Ball room")),
    conservatory: Card(Data.tuple(cardCategoriesNorthAmerica.room, "Conservatory")),
    diningRoom: Card(Data.tuple(cardCategoriesNorthAmerica.room, "Dining room")),
    billiardRoom: Card(Data.tuple(cardCategoriesNorthAmerica.room, "Billiard room")),
    library: Card(Data.tuple(cardCategoriesNorthAmerica.room, "Library")),
    lounge: Card(Data.tuple(cardCategoriesNorthAmerica.room, "Lounge")),
    hall: Card(Data.tuple(cardCategoriesNorthAmerica.room, "Hall")),
    study: Card(Data.tuple(cardCategoriesNorthAmerica.room, "Study")),
} as const;

export const cardsNorthAmericaSet: HashSet.HashSet<Card> = pipe(
    ReadonlyRecord.toEntries(cardsNorthAmerica),
    ReadonlyArray.map(Tuple.getSecond),
    HashSet.fromIterable,
);
