import { ChecklistValue, Knowledge } from "./Knowledge";
import { cardsAreOwnedAtLeastOnce, cardsAreOwnedAtMostOnce, caseFileOwnsAtLeast1PerCategory, caseFileOwnsAtMost1PerCategory, playerOwnsAtLeastHandSize, playerOwnsAtMostHandSize } from "./ConsistencyRules";
import { Data, Either, HashMap, HashSet, Tuple, pipe } from "effect";
import { GameObjects, Player, cardsNorthAmerica, cardCategoriesNorthAmerica, cardsNorthAmericaSet } from "./GameObjects";

import "./test-utils/EffectExpectEquals";

describe('ConsistencyRules', () => {
    describe(cardsAreOwnedAtMostOnce, () => {
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

            const newKnowledge
                = cardsAreOwnedAtMostOnce(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('some cards are owned by some players', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.profPlum), ChecklistValue("Y")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.colMustard), ChecklistValue("Y")],
                ),
                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const newKnowledge
                = cardsAreOwnedAtMostOnce(gameObjects)(initialKnowledge);

            expect(newKnowledge).toEqual(Either.right(new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.profPlum), ChecklistValue("Y")],

                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"),  cardsNorthAmerica.profPlum), ChecklistValue("N")],

                    [Data.tuple(Player("Bob"), cardsNorthAmerica.colMustard), ChecklistValue("Y")],

                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.colMustard), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"),  cardsNorthAmerica.colMustard), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.make(
                    [cardsNorthAmerica.profPlum, ChecklistValue("N")],
                    [cardsNorthAmerica.colMustard, ChecklistValue("N")],
                ),

                playerHandSize: HashMap.empty(),
            })));
        });

        test('one card is in the casefile', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.empty(),

                caseFileChecklist: HashMap.make(
                    [cardsNorthAmerica.colMustard, ChecklistValue("Y")],
                ),

                playerHandSize: HashMap.empty(),
            });

            const newKnowledge
                = cardsAreOwnedAtMostOnce(gameObjects)(initialKnowledge);

            expect(newKnowledge).toEqual(Either.right(new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.colMustard), ChecklistValue("N")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.colMustard), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.colMustard), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.make(
                    [cardsNorthAmerica.colMustard, ChecklistValue("Y")],
                ),

                playerHandSize: HashMap.empty(),
            })));
        });

        test('fully filled row', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.profPlum), ChecklistValue("N")],

                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.revolver), ChecklistValue("Y")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.make(
                    [cardsNorthAmerica.profPlum, ChecklistValue("Y")],
                    [cardsNorthAmerica.revolver, ChecklistValue("N")],
                ),
        
                playerHandSize: HashMap.empty(),
            });

            const newKnowledge
                = cardsAreOwnedAtMostOnce(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });
    });

    describe(cardsAreOwnedAtLeastOnce, () => {
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

            const newKnowledge
                = cardsAreOwnedAtLeastOnce(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('not enough Ns in row', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                ),
                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const newKnowledge
                = cardsAreOwnedAtLeastOnce(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('enough Ns in row', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.profPlum), ChecklistValue("N")],

                    // We don't know about (Anisha, Revolver)
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.make(
                    // We don't know about Prof. Plum
                    [cardsNorthAmerica.revolver, ChecklistValue("N")],
                ),

                playerHandSize: HashMap.empty(),
            });

            const newKnowledge
                = cardsAreOwnedAtLeastOnce(gameObjects)(initialKnowledge);

            expect(newKnowledge).toEqual(Either.right(new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.profPlum), ChecklistValue("N")],

                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.revolver), ChecklistValue("Y")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.make(
                    [cardsNorthAmerica.profPlum, ChecklistValue("Y")],
                    [cardsNorthAmerica.revolver, ChecklistValue("N")],
                ),
        
                playerHandSize: HashMap.empty(),
            })));
        });

        test('fully filled row', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.profPlum), ChecklistValue("N")],

                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.revolver), ChecklistValue("Y")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.make(
                    [cardsNorthAmerica.profPlum, ChecklistValue("Y")],
                    [cardsNorthAmerica.revolver, ChecklistValue("N")],
                ),
        
                playerHandSize: HashMap.empty(),
            });

            const newKnowledge
                = cardsAreOwnedAtLeastOnce(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });
    });

    describe(playerOwnsAtMostHandSize, () => {
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

            const newKnowledge
                = playerOwnsAtMostHandSize(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('accounted for all', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("Y")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.wrench), ChecklistValue("Y")],
                ),

                caseFileChecklist: HashMap.empty(),
        
                playerHandSize: HashMap.make(
                    [Player("Bob"), 2],
                ),
            });

            const newKnowledge
                = playerOwnsAtMostHandSize(gameObjects)(initialKnowledge);

            expect(newKnowledge).toEqual(Either.right(new Knowledge({
                playerChecklist: HashMap.make(
                    ...HashSet.map(gameObjects.cards, card =>
                        Tuple.tuple(Data.tuple(Player("Bob"), card), ChecklistValue("N")),
                    ),

                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("Y")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.wrench), ChecklistValue("Y")],
                ),

                caseFileChecklist: HashMap.empty(),
        
                playerHandSize: HashMap.make(
                    [Player("Bob"), 2],
                ),
            })));
        });

        test('hand size unknown', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("Y")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.wrench), ChecklistValue("Y")],
                ),

                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const newKnowledge
                = playerOwnsAtMostHandSize(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('accounted for some but not all', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("Y")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.wrench), ChecklistValue("Y")],
                ),

                caseFileChecklist: HashMap.empty(),
        
                playerHandSize: HashMap.make(
                    [Player("Bob"), 3],
                ),
            });

            const newKnowledge
                = playerOwnsAtMostHandSize(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('fully filled column', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    ...HashSet.map(gameObjects.cards, card =>
                        Tuple.tuple(Data.tuple(Player("Bob"), card), ChecklistValue("N")),
                    ),

                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("Y")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.wrench), ChecklistValue("Y")],
                ),

                caseFileChecklist: HashMap.empty(),
        
                playerHandSize: HashMap.make(
                    [Player("Bob"), 2],
                ),
            });

            const newKnowledge
                = playerOwnsAtMostHandSize(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });
    });

    describe(playerOwnsAtLeastHandSize, () => {
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

            const newKnowledge
                = playerOwnsAtLeastHandSize(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('accounted for all', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.wrench), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.empty(),
        
                playerHandSize: HashMap.make(
                    // Bob owns every card except a few...
                    // makes it easier to manually set the Ns because there's fewer of them
                    [Player("Bob"), HashSet.size(gameObjects.cards) - 2],
                ),
            });

            const newKnowledge
                = playerOwnsAtLeastHandSize(gameObjects)(initialKnowledge);

            expect(newKnowledge).toEqual(Either.right(new Knowledge({
                playerChecklist: HashMap.make(
                    ...HashSet.map(gameObjects.cards, card =>
                        Tuple.tuple(Data.tuple(Player("Bob"), card), ChecklistValue("Y")),
                    ),

                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.wrench), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.empty(),
        
                playerHandSize: HashMap.make(
                    [Player("Bob"), HashSet.size(gameObjects.cards) - 2],
                ),
            })));
        });

        test('hand size unknown', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.wrench), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.empty(),
        
                playerHandSize: HashMap.empty(),
            });

            const newKnowledge
                = playerOwnsAtLeastHandSize(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('accounted for some but not all', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.wrench), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.empty(),
        
                playerHandSize: HashMap.make(
                    // Bob owns every card except a few...
                    // makes it easier to manually set the Ns because there's fewer of them
                    [Player("Bob"), HashSet.size(gameObjects.cards) - 2],
                ),
            });

            const newKnowledge
                = playerOwnsAtLeastHandSize(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('fully filled column', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    ...HashSet.map(gameObjects.cards, card =>
                        Tuple.tuple(Data.tuple(Player("Bob"), card), ChecklistValue("N")),
                    ),

                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("Y")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.wrench), ChecklistValue("Y")],
                ),

                caseFileChecklist: HashMap.empty(),
        
                playerHandSize: HashMap.make(
                    [Player("Bob"), 2],
                ),
            });

            const newKnowledge
                = playerOwnsAtLeastHandSize(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });
    });

    describe(caseFileOwnsAtMost1PerCategory, () => {
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

            const newKnowledge
                = caseFileOwnsAtMost1PerCategory(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('accounted for all in a few categories', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.empty(),

                caseFileChecklist: HashMap.make(
                    [cardsNorthAmerica.wrench, ChecklistValue("Y")],
                    [cardsNorthAmerica.diningRoom, ChecklistValue("Y")],
                ),

                playerHandSize: HashMap.empty(),
            });

            const newKnowledge
                = caseFileOwnsAtMost1PerCategory(gameObjects)(initialKnowledge);

            expect(newKnowledge).toEqual(Either.right(new Knowledge({
                playerChecklist: HashMap.empty(),

                caseFileChecklist: HashMap.make(
                    ...pipe(
                        HashMap.unsafeGet(gameObjects.cardsByCategory, cardCategoriesNorthAmerica.weapon),
                        HashSet.map(card => Tuple.tuple(card, ChecklistValue("N"))),
                    ),
                    [cardsNorthAmerica.wrench, ChecklistValue("Y")],

                    ...pipe(
                        HashMap.unsafeGet(gameObjects.cardsByCategory, cardCategoriesNorthAmerica.room),
                        HashSet.map(card => Tuple.tuple(card, ChecklistValue("N"))),
                    ),
                    [cardsNorthAmerica.diningRoom, ChecklistValue("Y")],
                ),
        
                playerHandSize: HashMap.empty(),
            })));
        });

        test('fully filled column', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.empty(),

                caseFileChecklist: HashMap.make(
                    ...pipe(
                        HashMap.unsafeGet(gameObjects.cardsByCategory, cardCategoriesNorthAmerica.weapon),
                        HashSet.map(card => Tuple.tuple(card, ChecklistValue("N"))),
                    ),
                    [cardsNorthAmerica.wrench, ChecklistValue("Y")],

                    ...pipe(
                        HashMap.unsafeGet(gameObjects.cardsByCategory, cardCategoriesNorthAmerica.room),
                        HashSet.map(card => Tuple.tuple(card, ChecklistValue("N"))),
                    ),
                    [cardsNorthAmerica.diningRoom, ChecklistValue("Y")],
                ),
        
                playerHandSize: HashMap.make(
                    [Player("Bob"), 2],
                ),
            });

            const newKnowledge
                = caseFileOwnsAtMost1PerCategory(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });
    });

    describe(caseFileOwnsAtLeast1PerCategory, () => {
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

            const newKnowledge
                = caseFileOwnsAtLeast1PerCategory(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('accounted for all in a few categories', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.empty(),

                caseFileChecklist: HashMap.make(
                    ...pipe(
                        HashMap.unsafeGet(gameObjects.cardsByCategory, cardCategoriesNorthAmerica.weapon),
                        HashSet.filter(card => card !== cardsNorthAmerica.wrench),
                        HashSet.map(card => Tuple.tuple(card, ChecklistValue("N"))),
                    ),

                    ...pipe(
                        HashMap.unsafeGet(gameObjects.cardsByCategory, cardCategoriesNorthAmerica.room),
                        HashSet.filter(card => card !== cardsNorthAmerica.diningRoom),
                        HashSet.map(card => Tuple.tuple(card, ChecklistValue("N"))),
                    )
                ),
        
                playerHandSize: HashMap.empty(),
            });

            const newKnowledge
                = caseFileOwnsAtLeast1PerCategory(gameObjects)(initialKnowledge);

            expect(newKnowledge).toEqual(Either.right(new Knowledge({
                playerChecklist: HashMap.empty(),

                caseFileChecklist: HashMap.make(
                    ...pipe(
                        HashMap.unsafeGet(gameObjects.cardsByCategory, cardCategoriesNorthAmerica.weapon),
                        HashSet.map(card => Tuple.tuple(card, ChecklistValue("N"))),
                    ),
                    [cardsNorthAmerica.wrench, ChecklistValue("Y")],

                    ...pipe(
                        HashMap.unsafeGet(gameObjects.cardsByCategory, cardCategoriesNorthAmerica.room),
                        HashSet.map(card => Tuple.tuple(card, ChecklistValue("N"))),
                    ),
                    [cardsNorthAmerica.diningRoom, ChecklistValue("Y")],
                ),

                playerHandSize: HashMap.empty(),
            })));
        });

        test('fully filled column', () => {
            const gameObjects = new GameObjects({
                cards: cardsNorthAmericaSet,
                players: HashSet.make(Player("Anisha"), Player("Bob"), Player("Cho")),
            });

            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.empty(),

                caseFileChecklist: HashMap.make(
                    ...pipe(
                        HashMap.unsafeGet(gameObjects.cardsByCategory, cardCategoriesNorthAmerica.weapon),
                        HashSet.map(card => Tuple.tuple(card, ChecklistValue("N"))),
                    ),
                    [cardsNorthAmerica.wrench, ChecklistValue("Y")],

                    ...pipe(
                        HashMap.unsafeGet(gameObjects.cardsByCategory, cardCategoriesNorthAmerica.room),
                        HashSet.map(card => Tuple.tuple(card, ChecklistValue("N"))),
                    ),
                    [cardsNorthAmerica.diningRoom, ChecklistValue("Y")],
                ),
        
                playerHandSize: HashMap.make(
                    [Player("Bob"), 2],
                ),
            });

            const newKnowledge
                = caseFileOwnsAtMost1PerCategory(gameObjects)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });
    });
});
