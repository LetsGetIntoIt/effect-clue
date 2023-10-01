import { Data, HashMap, HashSet } from "effect";
import { Knowledge } from "./Knowledge";
import { Suggestion } from "./Suggestion";
import { predict } from "./Predictor";

import "./test-utils/EffectExpectEquals";

describe(predict, () => {
    test('no hallucinations', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.empty();

        const prediction
            = predict(suggestions)(initialKnowledge);

        expect(prediction).toEqual(Data.struct({
            
        }));
    });
});
