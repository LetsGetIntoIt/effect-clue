import { Data, HashMap, HashSet, ReadonlyArray, Tuple } from "effect";
import { ChecklistValue, Knowledge } from "./Knowledge";
import { Suggestion } from "./Suggestion";
import { ALL_CARDS, Card, Player } from "./GameObjects";
import deducer from "./Deducer";

import "./test-utils/EffectExpectEquals";

describe(deducer, () => {
    test('no hallucinations', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.empty();

        const newKnowledge
            = deducer(suggestions)(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });

    test('applies all rules', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Anisha"), Card("Col. Mustard")), ChecklistValue("Y")],
                [Data.tuple(Player("Anisha"), Card("Revolver")), ChecklistValue("Y")],
                [Data.tuple(Player("Anisha"), Card("Library")), ChecklistValue("Y")],
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
                cards: HashSet.make(Card("Prof. Plum"), Card("Knife"), Card("Conservatory")),
                nonRefuters: HashSet.empty(),
                refuter: Player("Bob"),
                seenCard: Card("Conservatory"),
            }),

            Data.struct({
                suggester: Player("Cho"),
                cards: HashSet.make(Card("Col. Mustard"), Card("Revolver"), Card("Kitchen")),
                nonRefuters: HashSet.make(Player("Bob")),
                refuter: undefined,
                seenCard: undefined,
            }),

            Data.struct({
                suggester: Player("Cho"),
                cards: HashSet.make(Card("Col. Mustard"), Card("Rope"), Card("Kitchen")),
                nonRefuters: HashSet.empty(),
                refuter: Player("Bob"),
                seenCard: undefined,
            }),
        );

        const newKnowledge
            = deducer(suggestions)(initialKnowledge);

        expect(newKnowledge).toEqual(Data.struct({
            playerChecklist: HashMap.make(
                // By the end, we will have accounted for all these players' cards
                // and we'll know that doesn't have any of the rest
                // So by default, all the cards are Ns for her unless otherwise specified
                ...ReadonlyArray.flatMap(ALL_CARDS, card => [
                    Tuple.tuple(Data.tuple(Player("Anisha"), card), ChecklistValue("N")),
                    Tuple.tuple(Data.tuple(Player("Bob"), card), ChecklistValue("N")),
                ]),

                // Our initial knowledge
                [Data.tuple(Player("Anisha"), Card("Col. Mustard")), ChecklistValue("Y")],
                [Data.tuple(Player("Anisha"), Card("Revolver")), ChecklistValue("Y")],
                [Data.tuple(Player("Anisha"), Card("Library")), ChecklistValue("Y")],

                // Nobody else has Anisha's cards
                [Data.tuple(Player("Bob"), Card("Col. Mustard")), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), Card("Revolver")), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), Card("Library")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Col. Mustard")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Revolver")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Library")), ChecklistValue("N")],

                // Bob has the conservatory because we saw it
                [Data.tuple(Player("Bob"), Card("Conservatory")), ChecklistValue("Y")],

                // Nobody else has Bob's cards
                [Data.tuple(Player("Cho"), Card("Conservatory")), ChecklistValue("N")],

                // Bob doesn't have the Kitchen because he couldn't refute
                [Data.tuple(Player("Bob"), Card("Kitchen")), ChecklistValue("N")],

                // Bob has the rope because its the only card he could have refuted with
                [Data.tuple(Player("Bob"), Card("Rope")), ChecklistValue("Y")],

                // Nobody else has Bob's cards
                [Data.tuple(Player("Anisha"), Card("Rope")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Rope")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.make(
                // Nobody else has Anisha's cards
                [Card("Col. Mustard"), ChecklistValue("N")],
                [Card("Revolver"), ChecklistValue("N")],
                [Card("Library"), ChecklistValue("N")],
                [Card("Col. Mustard"), ChecklistValue("N")],
                [Card("Revolver"), ChecklistValue("N")],
                [Card("Library"), ChecklistValue("N")],

                // Nobody else has Bob's cards
                [Card("Conservatory"), ChecklistValue("N")],

                // Nobody else has Bob's cards
                [Card("Rope"), ChecklistValue("N")],
                [Card("Rope"), ChecklistValue("N")],
            ),

            playerHandSize: HashMap.make(
                [Player("Anisha"), 3],
                [Player("Bob"), 2],
            ),
        }));
    });
});
