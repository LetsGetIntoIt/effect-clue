import { Brand, Data, HashMap, HashSet } from "effect";

export type Player = Brand.Branded<string, "Player">;
export const Player = Brand.nominal<Player>();

export type CardCategory = Brand.Branded<string, "CardCategory">;
export const CardCategory = Brand.nominal<CardCategory>();

export type Card = Brand.Branded<[CardCategory, string], "Card">;
export const Card = Brand.nominal<Card>();

export class GameObjects extends Data.Class<{
    players: HashSet.HashSet<Player>;
    cards: HashSet.HashSet<Card>;
}> {
    private _cardCategories: HashSet.HashSet<CardCategory> | undefined;
    get cardCategories() {
        if (!this._cardCategories) {
            this._cardCategories = HashSet.map(this.cards, ([category]) => category);
        }
        return this._cardCategories;
    }

    private _cardsByCategory: HashMap.HashMap<CardCategory, HashSet.HashSet<Card>> | undefined;
    get cardsByCategory() {
        if (!this._cardsByCategory) {
            this._cardsByCategory = null as unknown as HashMap.HashMap<CardCategory, HashSet.HashSet<Card>>;
        }
        return this._cardsByCategory;
    }
}
