import { describe, expect, test } from "vitest";
import { Player, PlayerOwner } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import {
    Cell,
    emptyKnowledge,
    N,
    setCell,
    setHandSize,
    Y,
} from "./Knowledge";
import {
    countUnknowns,
    enumerateOutcomes,
    expectedInfoGain,
    probPlayerOwnsCard,
    probPlayerRefutesWithAny,
} from "./EntropyScorer";
import { cardByName } from "./test-utils/CardByName";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

const PLUM    = cardByName(setup, "Prof. Plum");
const KNIFE   = cardByName(setup, "Knife");
const CONSERV = cardByName(setup, "Conservatory");
const SCARLET = cardByName(setup, "Miss Scarlet");
const ROPE    = cardByName(setup, "Rope");
const KITCHEN = cardByName(setup, "Kitchen");

describe("countUnknowns", () => {
    test("empty knowledge: |owners| × |cards|", () => {
        // Classic 3p: 3 players + 1 case file = 4 owners. 21 cards.
        expect(countUnknowns(setup, emptyKnowledge)).toBe(4 * 21);
    });

    test("decrements by 1 when one cell is set", () => {
        const k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y);
        expect(countUnknowns(setup, k)).toBe(4 * 21 - 1);
    });

    test("decrements by N when N cells are set", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(A), KNIFE), Y);
        k = setCell(k, Cell(PlayerOwner(B), KNIFE), N);
        k = setCell(k, Cell(PlayerOwner(C), KNIFE), N);
        expect(countUnknowns(setup, k)).toBe(4 * 21 - 3);
    });
});

describe("probPlayerOwnsCard", () => {
    test("returns 1 for a known Y", () => {
        const k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y);
        expect(probPlayerOwnsCard(setup, k, A, KNIFE)).toBe(1);
    });

    test("returns 0 for a known N", () => {
        const k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), N);
        expect(probPlayerOwnsCard(setup, k, A, KNIFE)).toBe(0);
    });

    test("returns 0 when handSize is unknown", () => {
        // Cell unknown, handSize unknown → 0 (graceful degradation).
        expect(probPlayerOwnsCard(setup, emptyKnowledge, A, KNIFE)).toBe(0);
    });

    test("uniform when handSize is known and no Ys are recorded", () => {
        // Player has hand size 6 and no known Ys; 21 unknown cells.
        // p = 6/21.
        const k = setHandSize(emptyKnowledge, PlayerOwner(A), 6);
        expect(probPlayerOwnsCard(setup, k, A, KNIFE)).toBeCloseTo(6 / 21, 6);
    });

    test("scales when some Ys are already known", () => {
        // Hand size 6, 2 Ys already known → 4 remaining slots over
        // 19 unknown cells.
        let k = setHandSize(emptyKnowledge, PlayerOwner(A), 6);
        k = setCell(k, Cell(PlayerOwner(A), PLUM),  Y);
        k = setCell(k, Cell(PlayerOwner(A), CONSERV), Y);
        const expected = (6 - 2) / (21 - 2);
        expect(probPlayerOwnsCard(setup, k, A, KNIFE)).toBeCloseTo(expected, 6);
    });

    test("returns 0 when player isn't in the setup", () => {
        const ghost = Player("Ghost");
        expect(probPlayerOwnsCard(setup, emptyKnowledge, ghost, KNIFE)).toBe(0);
    });
});

describe("probPlayerRefutesWithAny", () => {
    test("any known Y short-circuits to 1", () => {
        const k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y);
        expect(probPlayerRefutesWithAny(setup, k, A, [PLUM, KNIFE, CONSERV]))
            .toBe(1);
    });

    test("all known N → 0", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(A), PLUM), N);
        k = setCell(k, Cell(PlayerOwner(A), KNIFE), N);
        k = setCell(k, Cell(PlayerOwner(A), CONSERV), N);
        expect(probPlayerRefutesWithAny(setup, k, A, [PLUM, KNIFE, CONSERV]))
            .toBe(0);
    });

    test("uniform unknowns: p = 1 − (1 − ones)^3", () => {
        // Hand size 6, 21 unknowns → per-card p = 6/21. Refute prob =
        // 1 − (15/21)^3.
        const k = setHandSize(emptyKnowledge, PlayerOwner(A), 6);
        const expected = 1 - Math.pow(1 - 6 / 21, 3);
        const actual = probPlayerRefutesWithAny(
            setup,
            k,
            A,
            [PLUM, KNIFE, CONSERV],
        );
        expect(actual).toBeCloseTo(expected, 6);
    });
});

describe("enumerateOutcomes", () => {
    test("probabilities sum to ~1 on a fresh game", () => {
        // Need handSize set so probabilities are non-zero.
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(A), 6);
        k = setHandSize(k, PlayerOwner(B), 6);
        k = setHandSize(k, PlayerOwner(C), 6);
        const outcomes = enumerateOutcomes(setup, k, A, [PLUM, KNIFE, CONSERV]);
        expect(outcomes.length).toBeGreaterThan(0);
        const total = outcomes.reduce((s, o) => s + o.probability, 0);
        expect(total).toBeCloseTo(1, 6);
    });

    test("nobody-refutes variant has nonRefuters = every other player", () => {
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(A), 6);
        k = setHandSize(k, PlayerOwner(B), 6);
        k = setHandSize(k, PlayerOwner(C), 6);
        const outcomes = enumerateOutcomes(setup, k, A, [PLUM, KNIFE, CONSERV]);
        const noRefuter = outcomes.find(
            o => o.synthesizedSuggestion.refuter === undefined,
        );
        expect(noRefuter).toBeDefined();
        if (!noRefuter) return;
        // Both other players (B and C) appear in nonRefuters.
        const nrPlayers = Array.from(noRefuter.synthesizedSuggestion.nonRefuters);
        expect(nrPlayers).toContain(B);
        expect(nrPlayers).toContain(C);
        expect(nrPlayers).toHaveLength(2);
    });

    test("a refuter variant has nonRefuters = the players strictly before it", () => {
        // setup.players is [Anisha, Bob, Cho]. Suggester = A → walking
        // order is [B, C]. A variant where C refutes lists B as a
        // non-refuter.
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(A), 6);
        k = setHandSize(k, PlayerOwner(B), 6);
        k = setHandSize(k, PlayerOwner(C), 6);
        const outcomes = enumerateOutcomes(setup, k, A, [PLUM, KNIFE, CONSERV]);
        const cRefutes = outcomes.find(
            o => o.synthesizedSuggestion.refuter === C,
        );
        expect(cRefutes).toBeDefined();
        if (!cRefutes) return;
        const nrPlayers = Array.from(cRefutes.synthesizedSuggestion.nonRefuters);
        expect(nrPlayers).toEqual([B]);
    });

    test("suggester not in setup → empty result", () => {
        const ghost = Player("Ghost");
        const outcomes = enumerateOutcomes(
            setup,
            emptyKnowledge,
            ghost,
            [PLUM, KNIFE, CONSERV],
        );
        expect(outcomes).toEqual([]);
    });

    test("everyone-knows-N → only the nobody-refutes variant remains", () => {
        // Mark every other player as N for every card in the candidate.
        // Nobody can refute → the only reachable outcome is the
        // nobody-refuted variant, with probability 1.
        let k = emptyKnowledge;
        for (const card of [PLUM, KNIFE, CONSERV]) {
            k = setCell(k, Cell(PlayerOwner(B), card), N);
            k = setCell(k, Cell(PlayerOwner(C), card), N);
        }
        const outcomes = enumerateOutcomes(setup, k, A, [PLUM, KNIFE, CONSERV]);
        expect(outcomes).toHaveLength(1);
        const only = outcomes[0]!;
        expect(only.synthesizedSuggestion.refuter).toBeUndefined();
        expect(only.probability).toBeCloseTo(1, 6);
    });
});

describe("expectedInfoGain", () => {
    test("0 on a fully-solved case file (no remaining unknowns to reduce)", () => {
        // Pin every cell of every category. Every triple's
        // outcomes will produce 0 reduction.
        let k = emptyKnowledge;
        // Trivial setup: pin every owner × card cell to N (case file
        // and players). This is over-saturated, but countUnknowns
        // hits 0 and the gain is 0 either way.
        for (const entry of setup.categories.flatMap(c => c.cards)) {
            for (const p of setup.players) {
                k = setCell(k, Cell(PlayerOwner(p), entry.id), N);
            }
        }
        const gain = expectedInfoGain(
            setup,
            k,
            [],
            [],
            A,
            [PLUM, KNIFE, CONSERV],
        );
        // No outcomes reachable (everyone knows N for every card)
        // → 0.
        expect(gain).toBe(0);
    });

    test("non-zero on a fresh game with handSizes set", () => {
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(A), 6);
        k = setHandSize(k, PlayerOwner(B), 6);
        k = setHandSize(k, PlayerOwner(C), 6);
        const gain = expectedInfoGain(
            setup,
            k,
            [],
            [],
            A,
            [PLUM, KNIFE, CONSERV],
        );
        expect(gain).toBeGreaterThan(0);
    });

    test("monotone — adding a known N to a previously-unknown cell never increases gain", () => {
        // Baseline state.
        let baseline = emptyKnowledge;
        baseline = setHandSize(baseline, PlayerOwner(A), 6);
        baseline = setHandSize(baseline, PlayerOwner(B), 6);
        baseline = setHandSize(baseline, PlayerOwner(C), 6);

        const candidate = [PLUM, KNIFE, CONSERV] as const;
        const gainBefore = expectedInfoGain(
            setup,
            baseline,
            [],
            [],
            A,
            candidate,
        );

        // Add a known N for an unrelated cell. The new state has
        // strictly more knowledge.
        const stronger = setCell(
            baseline,
            Cell(PlayerOwner(B), SCARLET),
            N,
        );
        const gainAfter = expectedInfoGain(
            setup,
            stronger,
            [],
            [],
            A,
            candidate,
        );
        // We know strictly more, so the *remaining* unknowns to
        // reduce is smaller. Gain should not exceed the baseline.
        expect(gainAfter).toBeLessThanOrEqual(gainBefore + 1e-9);
    });

    test("0 when no outcome is reachable (suggester not in setup)", () => {
        const ghost = Player("Ghost");
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(A), 6);
        const gain = expectedInfoGain(
            setup,
            k,
            [],
            [],
            ghost,
            [PLUM, KNIFE, CONSERV],
        );
        expect(gain).toBe(0);
    });

    test("two candidate triples — info gain returns finite, non-negative scores", () => {
        // Sanity: two arbitrary triples both produce finite, non-negative
        // expected gain on the same input.
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(A), 6);
        k = setHandSize(k, PlayerOwner(B), 6);
        k = setHandSize(k, PlayerOwner(C), 6);
        const t1 = expectedInfoGain(setup, k, [], [], A, [PLUM, KNIFE, CONSERV]);
        const t2 = expectedInfoGain(setup, k, [], [], A, [SCARLET, ROPE, KITCHEN]);
        expect(Number.isFinite(t1)).toBe(true);
        expect(Number.isFinite(t2)).toBe(true);
        expect(t1).toBeGreaterThanOrEqual(0);
        expect(t2).toBeGreaterThanOrEqual(0);
    });
});
