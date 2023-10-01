import { HashMap } from "effect";
import { Data } from "effect/index";
import { Player, Card } from "./GameObjects";
import { Probability } from "./Probability";

export type Prediction = Data.Data<{
    playerChecklist: HashMap.HashMap<
        Data.Data<[Player, Card]>,
        Probability
    >;

    caseFileChecklist: HashMap.HashMap<Card, Probability>;
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
    playerChecklist: HashMap.set(prediction.playerChecklist, key, value),
    caseFileChecklist: prediction.caseFileChecklist,
});

export const updateCaseFileChecklist = (
    key: Card,
    value: Probability,
) => (
    prediction: Prediction,
): Prediction => Data.struct({
    playerChecklist: prediction.playerChecklist,
    caseFileChecklist: HashMap.set(prediction.caseFileChecklist, key, value),
});
