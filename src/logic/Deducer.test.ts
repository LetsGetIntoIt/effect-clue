import { Data, Either, HashMap, HashSet, Tuple } from "effect";
import { ChecklistValue, Knowledge } from "./Knowledge";
import { Suggestion } from "./Suggestion";
import { GameObjects, Player, cardsNorthAmerica, cardsNorthAmericaSet } from "./GameObjects";
import { deduce } from "./Deducer";

import "./test-utils/EffectExpectEquals";

describe(deduce, () => {
    test('no hallucinations', () => {
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

        const newKnowledge
            = deduce(gameObjects)(suggestions)(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(Either.right(initialKnowledge));
    });

    test('applies all rules', () => {
        const gameObjects = new GameObjects({
            cards: cardsNorthAmericaSet,
            players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
        });

        const initialKnowledge: Knowledge = new Knowledge({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Anisha"), cardsNorthAmerica.colMustard), ChecklistValue("Y")],
                [Data.tuple(Player("Anisha"), cardsNorthAmerica.revolver), ChecklistValue("Y")],
                [Data.tuple(Player("Anisha"), cardsNorthAmerica.library), ChecklistValue("Y")],
            ),

            caseFileChecklist: HashMap.empty(),

            playerHandSize: HashMap.make(
                [Player("Anisha"), 3],
                [Player("Bob"), 2],
            ),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
            Data.struct({
                suggester: Player("Anisha"),
                cards: HashSet.make(cardsNorthAmerica.profPlum, cardsNorthAmerica.knife, cardsNorthAmerica.conservatory),
                nonRefuters: HashSet.empty(),
                refuter: Player("Bob"),
                seenCard: cardsNorthAmerica.conservatory,
            }),

            Data.struct({
                suggester: Player("Cho"),
                cards: HashSet.make(cardsNorthAmerica.colMustard, cardsNorthAmerica.revolver, cardsNorthAmerica.kitchen),
                nonRefuters: HashSet.make(Player("Bob")),
                refuter: undefined,
                seenCard: undefined,
            }),

            Data.struct({
                suggester: Player("Cho"),
                cards: HashSet.make(cardsNorthAmerica.colMustard, cardsNorthAmerica.rope, cardsNorthAmerica.kitchen),
                nonRefuters: HashSet.empty(),
                refuter: Player("Bob"),
                seenCard: undefined,
            }),
        );

        const newKnowledge
            = deduce(gameObjects)(suggestions)(initialKnowledge);

        expect(newKnowledge).toEqual(Either.right(new Knowledge({
            playerChecklist: HashMap.make(
                // By the end, we will have accounted for all these players' cards
                // and we'll know that doesn't have any of the rest
                // So by default, all the cards are Ns for her unless otherwise specified
                ...HashSet.flatMap(gameObjects.cards, card => [
                    Tuple.tuple(Data.tuple(Player("Anisha"), card), ChecklistValue("N")),
                    Tuple.tuple(Data.tuple(Player("Bob"), card), ChecklistValue("N")),
                ]),

                // Our initial knowledge
                [Data.tuple(Player("Anisha"), cardsNorthAmerica.colMustard), ChecklistValue("Y")],
                [Data.tuple(Player("Anisha"), cardsNorthAmerica.revolver), ChecklistValue("Y")],
                [Data.tuple(Player("Anisha"), cardsNorthAmerica.library), ChecklistValue("Y")],

                // Nobody else has Anisha's cards
                [Data.tuple(Player("Bob"), cardsNorthAmerica.colMustard), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), cardsNorthAmerica.library), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), cardsNorthAmerica.colMustard), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), cardsNorthAmerica.library), ChecklistValue("N")],

                // Bob has the conservatory because we saw it
                [Data.tuple(Player("Bob"), cardsNorthAmerica.conservatory), ChecklistValue("Y")],

                // Nobody else has Bob's cards
                [Data.tuple(Player("Cho"), cardsNorthAmerica.conservatory), ChecklistValue("N")],

                // Bob doesn't have the Kitchen because he couldn't refute
                [Data.tuple(Player("Bob"), cardsNorthAmerica.kitchen), ChecklistValue("N")],

                // Bob has the rope because its the only card he could have refuted with
                [Data.tuple(Player("Bob"), cardsNorthAmerica.rope), ChecklistValue("Y")],

                // Nobody else has Bob's cards
                [Data.tuple(Player("Anisha"), cardsNorthAmerica.rope), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), cardsNorthAmerica.rope), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.make(
                // Nobody else has Anisha's cards
                [cardsNorthAmerica.colMustard, ChecklistValue("N")],
                [cardsNorthAmerica.revolver, ChecklistValue("N")],
                [cardsNorthAmerica.library, ChecklistValue("N")],
                [cardsNorthAmerica.colMustard, ChecklistValue("N")],
                [cardsNorthAmerica.revolver, ChecklistValue("N")],
                [cardsNorthAmerica.library, ChecklistValue("N")],

                // Nobody else has Bob's cards
                [cardsNorthAmerica.conservatory, ChecklistValue("N")],

                // Nobody else has Bob's cards
                [cardsNorthAmerica.rope, ChecklistValue("N")],
                [cardsNorthAmerica.rope, ChecklistValue("N")],
            ),

            playerHandSize: HashMap.make(
                [Player("Anisha"), 3],
                [Player("Bob"), 2],
            ),
        })));
    });
});
