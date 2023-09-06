import { ChecklistValue, Knowledge } from "./Knowledge";
import { cardsAreOwnedAtLeastOnce, cardsAreOwnedAtMostOnce, caseFileOwnsAtLeast1PerCategory, caseFileOwnsAtMost1PerCategory, playerOwnsAtLeastHandSize, playerOwnsAtMostHandSize } from "./ConsistencyRules";
import { Data, HashMap, Tuple } from "effect";
import { ALL_CARDS, ALL_ROOM_CARDS, ALL_WEAPON_CARDS, Card, Player } from "./GameObjects";

import "./test-utils/EffectExpectEquals";

describe(cardsAreOwnedAtMostOnce, () => {
    test('no hallucinations', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = cardsAreOwnedAtMostOnce(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });

    test('some cards are owned by some players', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Anisha"), Card("Prof. Plum")), ChecklistValue("Y")],
                [Data.tuple(Player("Bob"), Card("Col. Mustard")), ChecklistValue("Y")],
            ),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = cardsAreOwnedAtMostOnce(initialKnowledge);

        expect(newKnowledge).toEqual(Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Anisha"), Card("Prof. Plum")), ChecklistValue("Y")],

                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"),  Card("Prof. Plum")), ChecklistValue("N")],

                [Data.tuple(Player("Bob"), Card("Col. Mustard")), ChecklistValue("Y")],

                [Data.tuple(Player("Anisha"), Card("Col. Mustard")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"),  Card("Col. Mustard")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.make(
                [Card("Prof. Plum"), ChecklistValue("N")],
                [Card("Col. Mustard"), ChecklistValue("N")],
            ),

            playerHandSize: HashMap.empty(),
        }));
    });

    test('one card is in the casefile', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),

            caseFileChecklist: HashMap.make(
                [Card("Col. Mustard"), ChecklistValue("Y")],
            ),

            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = cardsAreOwnedAtMostOnce(initialKnowledge);

        expect(newKnowledge).toEqual(Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Anisha"), Card("Col. Mustard")), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), Card("Col. Mustard")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Col. Mustard")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.make(
                [Card("Col. Mustard"), ChecklistValue("Y")],
            ),

            playerHandSize: HashMap.empty(),
        }));
    });

    test('fully filled row', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Anisha"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Prof. Plum")), ChecklistValue("N")],

                [Data.tuple(Player("Anisha"), Card("Revolver")), ChecklistValue("Y")],
                [Data.tuple(Player("Bob"), Card("Revolver")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Revolver")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.make(
                [Card("Prof. Plum"), ChecklistValue("Y")],
                [Card("Revolver"), ChecklistValue("N")],
            ),
    
            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = cardsAreOwnedAtMostOnce(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });
});

describe(cardsAreOwnedAtLeastOnce, () => {
    test('no hallucinations', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = cardsAreOwnedAtLeastOnce(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });

    test('not enough Ns in row', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Anisha"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("N")],
            ),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = cardsAreOwnedAtLeastOnce(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });

    test('enough Ns in row', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Anisha"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Prof. Plum")), ChecklistValue("N")],

                // We don't know about (Anisha, Revolver)
                [Data.tuple(Player("Bob"), Card("Revolver")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Revolver")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.make(
                // We don't know about Prof. Plum
                [Card("Revolver"), ChecklistValue("N")],
            ),

            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = cardsAreOwnedAtLeastOnce(initialKnowledge);

        expect(newKnowledge).toEqual(Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Anisha"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Prof. Plum")), ChecklistValue("N")],

                [Data.tuple(Player("Anisha"), Card("Revolver")), ChecklistValue("Y")],
                [Data.tuple(Player("Bob"), Card("Revolver")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Revolver")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.make(
                [Card("Prof. Plum"), ChecklistValue("Y")],
                [Card("Revolver"), ChecklistValue("N")],
            ),
    
            playerHandSize: HashMap.empty(),
        }));
    });

    test('fully filled row', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Anisha"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Prof. Plum")), ChecklistValue("N")],

                [Data.tuple(Player("Anisha"), Card("Revolver")), ChecklistValue("Y")],
                [Data.tuple(Player("Bob"), Card("Revolver")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Revolver")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.make(
                [Card("Prof. Plum"), ChecklistValue("Y")],
                [Card("Revolver"), ChecklistValue("N")],
            ),
    
            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = cardsAreOwnedAtLeastOnce(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });
});

describe(playerOwnsAtMostHandSize, () => {
    test('no hallucinations', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = playerOwnsAtMostHandSize(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });

    test('accounted for all', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("Y")],
                [Data.tuple(Player("Bob"), Card("Wrench")), ChecklistValue("Y")],
            ),

            caseFileChecklist: HashMap.empty(),
    
            playerHandSize: HashMap.make(
                [Player("Bob"), 2],
            ),
        });

        const newKnowledge
            = playerOwnsAtMostHandSize(initialKnowledge);

        expect(newKnowledge).toEqual(Data.struct({
            playerChecklist: HashMap.make(
                ...ALL_CARDS.map(card =>
                    Tuple.tuple(Data.tuple(Player("Bob"), card), ChecklistValue("N")),
                ),

                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("Y")],
                [Data.tuple(Player("Bob"), Card("Wrench")), ChecklistValue("Y")],
            ),

            caseFileChecklist: HashMap.empty(),
    
            playerHandSize: HashMap.make(
                [Player("Bob"), 2],
            ),
        }));
    });

    test('hand size unknown', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("Y")],
                [Data.tuple(Player("Bob"), Card("Wrench")), ChecklistValue("Y")],
            ),

            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = playerOwnsAtMostHandSize(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });

    test('accounted for some but not all', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("Y")],
                [Data.tuple(Player("Bob"), Card("Wrench")), ChecklistValue("Y")],
            ),

            caseFileChecklist: HashMap.empty(),
    
            playerHandSize: HashMap.make(
                [Player("Bob"), 3],
            ),
        });

        const newKnowledge
            = playerOwnsAtMostHandSize(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });

    test('fully filled column', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                ...ALL_CARDS.map(card =>
                    Tuple.tuple(Data.tuple(Player("Bob"), card), ChecklistValue("N")),
                ),

                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("Y")],
                [Data.tuple(Player("Bob"), Card("Wrench")), ChecklistValue("Y")],
            ),

            caseFileChecklist: HashMap.empty(),
    
            playerHandSize: HashMap.make(
                [Player("Bob"), 2],
            ),
        });

        const newKnowledge
            = playerOwnsAtMostHandSize(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });
});

describe(playerOwnsAtLeastHandSize, () => {
    test('no hallucinations', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = playerOwnsAtLeastHandSize(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });

    test('accounted for all', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), Card("Wrench")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.empty(),
    
            playerHandSize: HashMap.make(
                // Bob owns every card except a few...
                // makes it easier to manually set the Ns because there's fewer of them
                [Player("Bob"), ALL_CARDS.length - 2],
            ),
        });

        const newKnowledge
            = playerOwnsAtLeastHandSize(initialKnowledge);

        expect(newKnowledge).toEqual(Data.struct({
            playerChecklist: HashMap.make(
                ...ALL_CARDS.map(card =>
                    Tuple.tuple(Data.tuple(Player("Bob"), card), ChecklistValue("Y")),
                ),

                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), Card("Wrench")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.empty(),
    
            playerHandSize: HashMap.make(
                [Player("Bob"), ALL_CARDS.length - 2],
            ),
        }));
    });

    test('hand size unknown', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), Card("Wrench")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.empty(),
    
            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = playerOwnsAtLeastHandSize(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });

    test('accounted for some but not all', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Bob"), Card("Wrench")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.empty(),
    
            playerHandSize: HashMap.make(
                // Bob owns every card except a few...
                // makes it easier to manually set the Ns because there's fewer of them
                [Player("Bob"), ALL_CARDS.length - 2],
            ),
        });

        const newKnowledge
            = playerOwnsAtLeastHandSize(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });

    test('fully filled column', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                ...ALL_CARDS.map(card =>
                    Tuple.tuple(Data.tuple(Player("Bob"), card), ChecklistValue("N")),
                ),

                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("Y")],
                [Data.tuple(Player("Bob"), Card("Wrench")), ChecklistValue("Y")],
            ),

            caseFileChecklist: HashMap.empty(),
    
            playerHandSize: HashMap.make(
                [Player("Bob"), 2],
            ),
        });

        const newKnowledge
            = playerOwnsAtLeastHandSize(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });
});

describe(caseFileOwnsAtMost1PerCategory, () => {
    test('no hallucinations', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = caseFileOwnsAtMost1PerCategory(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });

    test('accounted for all in a few categories', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),

            caseFileChecklist: HashMap.make(
                [Card("Wrench"), ChecklistValue("Y")],
                [Card("Dining room"), ChecklistValue("Y")],
            ),

            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = caseFileOwnsAtMost1PerCategory(initialKnowledge);

        expect(newKnowledge).toEqual(Data.struct({
            playerChecklist: HashMap.empty(),

            caseFileChecklist: HashMap.make(
                ...ALL_WEAPON_CARDS.map(card =>
                    Tuple.tuple(card, ChecklistValue("N")),
                ),
                [Card("Wrench"), ChecklistValue("Y")],

                ...ALL_ROOM_CARDS.map(card =>
                    Tuple.tuple(card, ChecklistValue("N")),
                ),
                [Card("Dining room"), ChecklistValue("Y")],
            ),
    
            playerHandSize: HashMap.empty(),
        }));
    });

    test('fully filled column', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),

            caseFileChecklist: HashMap.make(
                ...ALL_WEAPON_CARDS.map(card =>
                    Tuple.tuple(card, ChecklistValue("N")),
                ),
                [Card("Wrench"), ChecklistValue("Y")],

                ...ALL_ROOM_CARDS.map(card =>
                    Tuple.tuple(card, ChecklistValue("N")),
                ),
                [Card("Dining room"), ChecklistValue("Y")],
            ),
    
            playerHandSize: HashMap.make(
                [Player("Bob"), 2],
            ),
        });

        const newKnowledge
            = caseFileOwnsAtMost1PerCategory(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });
});

describe(caseFileOwnsAtLeast1PerCategory, () => {
    test('no hallucinations', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = caseFileOwnsAtLeast1PerCategory(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });

    test('accounted for all in a few categories', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),

            caseFileChecklist: HashMap.make(
                ...ALL_WEAPON_CARDS.filter(card =>
                    card !== Card("Wrench")
                ).map(card =>
                    Tuple.tuple(card, ChecklistValue("N")),
                ),

                ...ALL_ROOM_CARDS.filter(card =>
                    card !== Card("Dining room")
                ).map(card =>
                    Tuple.tuple(card, ChecklistValue("N")),
                ),
            ),
    
            playerHandSize: HashMap.empty(),
        });

        const newKnowledge
            = caseFileOwnsAtLeast1PerCategory(initialKnowledge);

        expect(newKnowledge).toEqual(Data.struct({
            playerChecklist: HashMap.empty(),

            caseFileChecklist: HashMap.make(
                ...ALL_WEAPON_CARDS.map(card =>
                    Tuple.tuple(card, ChecklistValue("N")),
                ),
                [Card("Wrench"), ChecklistValue("Y")],

                ...ALL_ROOM_CARDS.map(card =>
                    Tuple.tuple(card, ChecklistValue("N")),
                ),
                [Card("Dining room"), ChecklistValue("Y")],
            ),

            playerHandSize: HashMap.empty(),
        }));
    });

    test('fully filled column', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),

            caseFileChecklist: HashMap.make(
                ...ALL_WEAPON_CARDS.map(card =>
                    Tuple.tuple(card, ChecklistValue("N")),
                ),
                [Card("Wrench"), ChecklistValue("Y")],

                ...ALL_ROOM_CARDS.map(card =>
                    Tuple.tuple(card, ChecklistValue("N")),
                ),
                [Card("Dining room"), ChecklistValue("Y")],
            ),
    
            playerHandSize: HashMap.make(
                [Player("Bob"), 2],
            ),
        });

        const newKnowledge
            = caseFileOwnsAtMost1PerCategory(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(initialKnowledge);
    });
});
