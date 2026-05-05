import { Effect, Result } from "effect";
import { describe, expect, test } from "vitest";
import { deduceSync } from "./Deducer";
import {
    CellHypothesis,
    evaluateHypotheses,
    type CellHypothesis as CellHypothesisType,
    type HypothesisEvaluation,
} from "./Hypothesis";
import { KnownCard, buildInitialKnowledge } from "./InitialKnowledge";
import { N, Y } from "./Knowledge";
import { CaseFileOwner, Player, PlayerOwner } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { cardByName } from "./test-utils/CardByName";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const KNIFE = cardByName(setup, "Knife");

const run = (params: {
    readonly knownCards?: ReadonlyArray<KnownCard>;
    readonly hypotheses: ReadonlyArray<CellHypothesisType>;
}): ReadonlyArray<HypothesisEvaluation> => {
    const initial = buildInitialKnowledge(
        setup,
        params.knownCards ?? [],
        [],
    );
    const factualResult = deduceSync(setup, [], [], initial);
    return Effect.runSync(
        evaluateHypotheses({
            setup,
            suggestions: [],
            accusations: [],
            initialKnowledge: initial,
            factualResult,
            hypotheses: params.hypotheses,
        }),
    );
};

describe("evaluateHypotheses", () => {
    test("marks a hypothesis verified when factual knowledge already matches it", () => {
        const [evaluation] = run({
            knownCards: [KnownCard({ player: A, card: KNIFE })],
            hypotheses: [
                CellHypothesis({
                    owner: PlayerOwner(A),
                    card: KNIFE,
                    value: Y,
                }),
            ],
        });

        expect(evaluation?.status).toBe("verified");
        expect(evaluation?.impactCount).toBe(0);
    });

    test("marks a hypothesis falsified when factual knowledge proves the opposite", () => {
        const [evaluation] = run({
            knownCards: [KnownCard({ player: A, card: KNIFE })],
            hypotheses: [
                CellHypothesis({
                    owner: PlayerOwner(A),
                    card: KNIFE,
                    value: N,
                }),
            ],
        });

        expect(evaluation?.status).toBe("falsified");
    });

    test("marks a non-contradictory unknown-cell hypothesis plausible with deterministic impact", () => {
        const [evaluation] = run({
            hypotheses: [
                CellHypothesis({
                    owner: PlayerOwner(A),
                    card: KNIFE,
                    value: Y,
                }),
            ],
        });

        expect(evaluation?.status).toBe("plausible");
        expect(evaluation?.impactCount).toBeGreaterThan(0);
    });

    test("marks hypotheses blocked when the real game is already contradictory", () => {
        const [evaluation] = run({
            knownCards: [
                KnownCard({ player: A, card: KNIFE }),
                KnownCard({ player: B, card: KNIFE }),
            ],
            hypotheses: [
                CellHypothesis({
                    owner: CaseFileOwner(),
                    card: KNIFE,
                    value: Y,
                }),
            ],
        });

        expect(evaluation?.status).toBe("blocked");
        expect(evaluation?.contradiction).toBeDefined();
    });

    test("evaluates mutually incompatible hypotheses independently", () => {
        const evaluations = run({
            hypotheses: [
                CellHypothesis({
                    owner: PlayerOwner(A),
                    card: KNIFE,
                    value: Y,
                }),
                CellHypothesis({
                    owner: PlayerOwner(B),
                    card: KNIFE,
                    value: Y,
                }),
            ],
        });

        expect(evaluations.map(e => e.status)).toEqual([
            "plausible",
            "plausible",
        ]);
    });

    test("marks the hypothesis falsified when its solo assumption contradicts deductions", () => {
        const initial = buildInitialKnowledge(
            setup,
            [KnownCard({ player: A, card: KNIFE })],
            [],
        );
        const [evaluation] = Effect.runSync(
            evaluateHypotheses({
                setup,
                suggestions: [],
                accusations: [],
                initialKnowledge: initial,
                factualResult: Result.succeed(initial),
                hypotheses: [
                    CellHypothesis({
                        owner: PlayerOwner(B),
                        card: KNIFE,
                        value: Y,
                    }),
                ],
            }),
        );

        expect(evaluation?.status).toBe("falsified");
        expect(evaluation?.contradiction).toBeDefined();
    });
});
