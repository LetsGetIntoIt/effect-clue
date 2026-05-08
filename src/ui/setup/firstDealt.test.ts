import { describe, expect, test } from "vitest";
import { Player } from "../../logic/GameObjects";
import { CardSet } from "../../logic/CardSet";
import { CLASSIC_SETUP_3P, GameSetup } from "../../logic/GameSetup";
import { PlayerSet } from "../../logic/PlayerSet";
import { firstDealtHandSizes } from "./firstDealt";

const fourPlayerClassic = () =>
    GameSetup({
        cardSet: CardSet({ categories: CLASSIC_SETUP_3P.cardSet.categories }),
        playerSet: PlayerSet({
            players: [Player("A"), Player("B"), Player("C"), Player("D")],
        }),
    });

describe("firstDealtHandSizes", () => {
    test("null first-dealt with even split: every player gets the same", () => {
        // Classic deck = 21 cards, 3 case-file cards → 18 dealt
        // across 3 players → 6 each.
        expect(firstDealtHandSizes(CLASSIC_SETUP_3P, null)).toEqual([
            [Player("Anisha"), 6],
            [Player("Bob"), 6],
            [Player("Cho"), 6],
        ]);
    });

    test("null first-dealt with uneven split: first players get the extras", () => {
        // 4 players, 18 dealt → 4 base + 2 extras, first two players
        // in dealing order (= turn order, since first-dealt is null)
        // get 5; the rest get 4.
        const sizes = firstDealtHandSizes(fourPlayerClassic(), null);
        expect(sizes).toEqual([
            [Player("A"), 5],
            [Player("B"), 5],
            [Player("C"), 4],
            [Player("D"), 4],
        ]);
    });

    test("non-null first-dealt rotates the extras around the dealing order", () => {
        // 4 players, 18 dealt, first-dealt = C → dealing order
        // C, D, A, B. First two (C, D) get the extras → C=5, D=5,
        // A=4, B=4. Returned rows stay in turn order.
        const sizes = firstDealtHandSizes(fourPlayerClassic(), Player("C"));
        expect(sizes).toEqual([
            [Player("A"), 4],
            [Player("B"), 4],
            [Player("C"), 5],
            [Player("D"), 5],
        ]);
    });

    test("empty player set returns empty array", () => {
        const empty = GameSetup({
            cardSet: CLASSIC_SETUP_3P.cardSet,
            playerSet: PlayerSet({ players: [] }),
        });
        expect(firstDealtHandSizes(empty, null)).toEqual([]);
    });
});
