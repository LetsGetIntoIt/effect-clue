import { Data, Effect, HashMap, HashSet } from "effect";
import { Knowledge } from "./Knowledge";
import { Suggestion } from "./Suggestion";
import { predict } from "./Predictor";

import { effectOrFail, test } from "./test-utils/EffectTest";
import "./test-utils/EffectExpectEquals";

describe(predict, () => {
    test('no hallucinations', Effect.gen(function* ($) {
        const initialKnowledge: Knowledge = new Knowledge({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.empty();

        const prediction = yield* $(predict(suggestions, initialKnowledge).pipe(
            effectOrFail,
            Effect.withConcurrency('unbounded'),
        ));

        expect(prediction).toEqual(Data.struct({
            
        }));
    }));
});
