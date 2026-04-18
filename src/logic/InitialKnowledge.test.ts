import { Card, Player, PlayerOwner } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import {
    getCellByOwnerCard,
    getHandSize,
    N,
    Y,
} from "./Knowledge";
import { buildInitialKnowledge } from "./InitialKnowledge";
import deduce from "./Deducer";

import "./test-utils/EffectExpectEquals";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

describe("buildInitialKnowledge", () => {
    test("applies default hand sizes when no explicit entries", () => {
        const k = buildInitialKnowledge(setup, [], []);
        // Classic 3-player: 6+6+9=21 cards total, 3 case-file, 18 dealt
        // across 3 players → 6 each.
        expect(getHandSize(k, PlayerOwner(A))).toBe(6);
        expect(getHandSize(k, PlayerOwner(B))).toBe(6);
        expect(getHandSize(k, PlayerOwner(C))).toBe(6);
    });

    test("explicit hand sizes override defaults for that player only", () => {
        const k = buildInitialKnowledge(setup, [], [[A, 4] as const]);
        expect(getHandSize(k, PlayerOwner(A))).toBe(4);
        // Bob/Cho still get their defaults.
        expect(getHandSize(k, PlayerOwner(B))).toBe(6);
        expect(getHandSize(k, PlayerOwner(C))).toBe(6);
    });

    test("default hand sizes feed the row-sums-to-K rule through deduction", () => {
        // Mark Anisha as owning 6 specific cards spread across categories
        // (no explicit hand size). Default hand size for classic 3p is 6,
        // which matches — so every *other* card in Anisha's row must be
        // forced to N by the hand-size consistency rule.
        const known = [
            { player: A, card: Card("Miss Scarlet") },
            { player: A, card: Card("Col. Mustard") },
            { player: A, card: Card("Candlestick") },
            { player: A, card: Card("Knife") },
            { player: A, card: Card("Kitchen") },
            { player: A, card: Card("Ball room") },
        ];
        const initial = buildInitialKnowledge(setup, known, []);
        const result = deduce(setup, [])(initial);
        expect(result._tag).toBe("Ok");
        if (result._tag !== "Ok") return;

        // Cards not in Anisha's known list must be N in her row.
        const PLUM = Card("Prof. Plum");
        const ROPE = Card("Rope");
        const STUDY = Card("Study");
        expect(getCellByOwnerCard(result.knowledge, PlayerOwner(A), PLUM))
            .toBe(N);
        expect(getCellByOwnerCard(result.knowledge, PlayerOwner(A), ROPE))
            .toBe(N);
        expect(getCellByOwnerCard(result.knowledge, PlayerOwner(A), STUDY))
            .toBe(N);
    });

    test("skips players not in the current setup", () => {
        const stranger = Player("Stranger");
        const k = buildInitialKnowledge(
            setup,
            [],
            [[stranger, 10] as const],
        );
        // Stranger's size is dropped; everyone else still defaults.
        expect(getHandSize(k, PlayerOwner(stranger))).toBeUndefined();
        expect(getHandSize(k, PlayerOwner(A))).toBe(6);
    });

    test("sets known cards to Y; drops cards not in the deck", () => {
        const MUSTARD = Card("Col. Mustard");
        const JOKER = Card("Joker"); // not in classic
        const k = buildInitialKnowledge(
            setup,
            [
                { player: A, card: MUSTARD },
                { player: A, card: JOKER },
            ],
            [],
        );
        expect(getCellByOwnerCard(k, PlayerOwner(A), MUSTARD)).toBe(Y);
        expect(getCellByOwnerCard(k, PlayerOwner(A), JOKER)).toBeUndefined();
    });
});
