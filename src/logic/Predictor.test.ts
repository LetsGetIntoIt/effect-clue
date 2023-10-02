import { Data, Effect, HashMap, HashSet } from "effect";
import { Knowledge } from "./Knowledge";
import { Suggestion } from "./Suggestion";
import { predict } from "./Predictor";

import { effectOrFail, effectTest } from "./test-utils/EffectTest";
import "./test-utils/EffectExpectEquals";

describe(predict, () => {
    effectTest('no hallucinations', Effect.gen(function* ($) {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.empty();

        const prediction = yield* $(predict(suggestions, initialKnowledge).pipe(
            effectOrFail,
        ));

        expect(prediction).toEqual(Data.struct({
            
        }));
    }));
});
