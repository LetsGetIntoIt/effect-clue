import { Effect, HashMap, HashSet } from "effect";
import { Knowledge } from "./Knowledge";
import { Suggestion } from "./Suggestion";
import { predict } from "./Predictor";

import { effectOrFail, test } from "./test-utils/EffectTest";
import "./test-utils/EffectExpectEquals";
import { GameObjects, Player, cardsNorthAmericaSet } from "./GameObjects";

describe(predict, () => {
    test('it completes', Effect.gen(function* ($) {
        const gameObjects = new GameObjects({
            cards: cardsNorthAmericaSet,
            players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
        });

        const initialKnowledge: Knowledge = new Knowledge({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.empty();

        const prediction = yield* $(predict(gameObjects, suggestions, initialKnowledge).pipe(
            effectOrFail,
            Effect.withConcurrency('unbounded'),
        ));

        expect(prediction).toBeDefined();
    }));
});
