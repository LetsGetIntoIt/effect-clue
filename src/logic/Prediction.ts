import { HashMap } from "effect";
import { Data } from "effect/index";
import { Player, Card } from "./GameObjects";
import { Probability, toPercent } from "./Probability";

export type Prediction = Data.Data<{
    playerChecklist: HashMap.HashMap<
        Data.Data<[Player, Card]>,
        bigint
    >;

    caseFileChecklist: HashMap.HashMap<Card, bigint>;
}>;

export const emptyPrediction: Prediction = Data.struct({
    playerChecklist: HashMap.empty(),
    caseFileChecklist: HashMap.empty(),
});

export const updatePlayerChecklist = (
    key: Data.Data<[Player, Card]>,
    value: Probability,
) => (
    prediction: Prediction,
): Prediction => Data.struct({
    playerChecklist: HashMap.set(prediction.playerChecklist, key, toPercent(value)),
    caseFileChecklist: prediction.caseFileChecklist,
});

export const updateCaseFileChecklist = (
    key: Card,
    value: Probability,
) => (
    prediction: Prediction,
): Prediction => Data.struct({
    playerChecklist: prediction.playerChecklist,
    caseFileChecklist: HashMap.set(prediction.caseFileChecklist, key, toPercent(value)),
});
