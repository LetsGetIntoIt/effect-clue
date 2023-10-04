import { Data, Either, HashMap, HashSet } from "effect";
import { ChecklistValue, Knowledge } from "./Knowledge";
import { Suggestion } from "./Suggestion";
import { nonRefutersDontHaveSuggestedCards, refuterUsedSeenCard, refuterUsedOnlyCardTheyOwn } from "./DeductionRules";
import { Player, cardsNorthAmerica } from "./GameObjects";

import "./test-utils/EffectExpectEquals";

describe('DeductionRules', () => {
    describe(nonRefutersDontHaveSuggestedCards, () => {
        test('no hallucinations', () => {
            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.empty(),
                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const suggestions: HashSet.HashSet<Suggestion> = HashSet.empty();

            const newKnowledge
                = nonRefutersDontHaveSuggestedCards(suggestions)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('some non-refuters', () => {
            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.empty(),
                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
                Data.struct({
                    suggester: Player("Anisha"),
                    cards: HashSet.make(cardsNorthAmerica.profPlum, cardsNorthAmerica.knife),
                    nonRefuters: HashSet.make(Player("Bob"), Player("Cho")),
                    refuter: undefined,
                    seenCard: undefined,
                }),

                Data.struct({
                    suggester: Player("Bob"),
                    cards: HashSet.make(cardsNorthAmerica.missScarlet, cardsNorthAmerica.conservatory),
                    nonRefuters: HashSet.make(Player("Anisha"), Player("Cho")),
                    refuter: undefined,
                    seenCard: undefined,
                }),
            );

            const newKnowledge
                = nonRefutersDontHaveSuggestedCards(suggestions)(initialKnowledge);

            expect(newKnowledge).toEqual(Either.right(new Knowledge({
                playerChecklist: HashMap.make(
                    // Ns from the first suggestion
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.knife), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.knife), ChecklistValue("N")],

                    // Ns from the second suggestion
                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.missScarlet), ChecklistValue("N")],
                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.conservatory), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.missScarlet), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.conservatory), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.empty(),

                playerHandSize: HashMap.empty(),
            })));
        });

        test('we already know everything', () => {
            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    // Ns from the first suggestion
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.knife), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.profPlum), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.knife), ChecklistValue("N")],

                    // Ns from the second suggestion
                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.missScarlet), ChecklistValue("N")],
                    [Data.tuple(Player("Anisha"), cardsNorthAmerica.conservatory), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.missScarlet), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.conservatory), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.empty(),

                playerHandSize: HashMap.empty(),
            });

            const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
                Data.struct({
                    suggester: Player("Anisha"),
                    cards: HashSet.make(cardsNorthAmerica.profPlum, cardsNorthAmerica.knife),
                    nonRefuters: HashSet.make(Player("Bob"), Player("Cho")),
                    refuter: undefined,
                    seenCard: undefined,
                }),

                Data.struct({
                    suggester: Player("Bob"),
                    cards: HashSet.make(cardsNorthAmerica.missScarlet, cardsNorthAmerica.conservatory),
                    nonRefuters: HashSet.make(Player("Anisha"), Player("Cho")),
                    refuter: undefined,
                    seenCard: undefined,
                }),
            );

            const newKnowledge
                = nonRefutersDontHaveSuggestedCards(suggestions)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('no non-refuters', () => {
            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.empty(),
                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
                Data.struct({
                    suggester: Player("Anisha"),
                    cards: HashSet.make(cardsNorthAmerica.profPlum, cardsNorthAmerica.knife),
                    nonRefuters: HashSet.empty(),
                    refuter: undefined,
                    seenCard: undefined,
                }),

                Data.struct({
                    suggester: Player("Bob"),
                    cards: HashSet.make(cardsNorthAmerica.missScarlet, cardsNorthAmerica.conservatory),
                    nonRefuters: HashSet.empty(),
                    refuter: undefined,
                    seenCard: undefined,
                }),
            );

            const newKnowledge
                = nonRefutersDontHaveSuggestedCards(suggestions)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });
    });

    describe(refuterUsedSeenCard, () => {
        test('no hallucinations', () => {
            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.empty(),
                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const suggestions: HashSet.HashSet<Suggestion> = HashSet.empty();

            const newKnowledge
                = refuterUsedSeenCard(suggestions)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('some refuted suggestions', () => {
            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.empty(),
                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
                Data.struct({
                    suggester: Player("Anisha"),
                    cards: HashSet.make(cardsNorthAmerica.profPlum, cardsNorthAmerica.knife),
                    nonRefuters: HashSet.empty(),
                    refuter: Player("Bob"),
                    seenCard: cardsNorthAmerica.knife,
                }),

                Data.struct({
                    suggester: Player("Bob"),
                    cards: HashSet.make(cardsNorthAmerica.missScarlet, cardsNorthAmerica.conservatory),
                    nonRefuters: HashSet.empty(),
                    refuter: Player("Bob"),
                    seenCard: cardsNorthAmerica.conservatory,
                }),

                Data.struct({
                    suggester: Player("Anisha"),
                    cards: HashSet.make(cardsNorthAmerica.colMustard, cardsNorthAmerica.revolver),
                    nonRefuters: HashSet.empty(),
                    refuter: Player("Cho"),
                    seenCard: cardsNorthAmerica.revolver,
                }),
            );

            const newKnowledge
                = refuterUsedSeenCard(suggestions)(initialKnowledge);

            expect(newKnowledge).toEqual(Either.right(new Knowledge({
                playerChecklist: HashMap.make(
                    // Ys from the first suggestion
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.knife), ChecklistValue("Y")],

                    // Ys from the second suggestion
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.conservatory), ChecklistValue("Y")],

                    // Ys from the third suggestion
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.revolver), ChecklistValue("Y")],
                ),

                caseFileChecklist: HashMap.empty(),

                playerHandSize: HashMap.empty(),
            })));
        });

        test('we already know everything', () => {
            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    // Ys from the first suggestion
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.knife), ChecklistValue("Y")],

                    // Ys from the second suggestion
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.conservatory), ChecklistValue("Y")],

                    // Ys from the third suggestion
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.revolver), ChecklistValue("Y")],
                ),

                caseFileChecklist: HashMap.empty(),

                playerHandSize: HashMap.empty(),
            });

            const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
                Data.struct({
                    suggester: Player("Anisha"),
                    cards: HashSet.make(cardsNorthAmerica.profPlum, cardsNorthAmerica.knife),
                    nonRefuters: HashSet.empty(),
                    refuter: Player("Bob"),
                    seenCard: cardsNorthAmerica.knife,
                }),

                Data.struct({
                    suggester: Player("Bob"),
                    cards: HashSet.make(cardsNorthAmerica.missScarlet, cardsNorthAmerica.conservatory),
                    nonRefuters: HashSet.empty(),
                    refuter: Player("Bob"),
                    seenCard: cardsNorthAmerica.conservatory,
                }),

                Data.struct({
                    suggester: Player("Anisha"),
                    cards: HashSet.make(cardsNorthAmerica.colMustard, cardsNorthAmerica.revolver),
                    nonRefuters: HashSet.empty(),
                    refuter: Player("Cho"),
                    seenCard: cardsNorthAmerica.revolver,
                }),
            );

            const newKnowledge
                = refuterUsedSeenCard(suggestions)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('no refuter', () => {
            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.empty(),
                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
                Data.struct({
                    suggester: Player("Anisha"),
                    cards: HashSet.make(cardsNorthAmerica.profPlum, cardsNorthAmerica.knife),
                    nonRefuters: HashSet.empty(),
                    refuter: undefined,
                    seenCard: undefined,
                }),
            );

            const newKnowledge
                = refuterUsedSeenCard(suggestions)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('no seen card', () => {
            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.empty(),
                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
                Data.struct({
                    suggester: Player("Anisha"),
                    cards: HashSet.make(cardsNorthAmerica.profPlum, cardsNorthAmerica.knife),
                    nonRefuters: HashSet.empty(),
                    refuter: Player("Bob"),
                    seenCard: undefined,
                }),
            );

            const newKnowledge
                = refuterUsedSeenCard(suggestions)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });
    });

    describe(refuterUsedOnlyCardTheyOwn, () => {
        test('no hallucinations', () => {
            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.empty(),
                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const suggestions: HashSet.HashSet<Suggestion> = HashSet.empty();

            const newKnowledge
                = refuterUsedOnlyCardTheyOwn(suggestions)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('we can narrow it down', () => {
            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.missScarlet), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
                Data.struct({
                    suggester: Player("Anisha"),
                    cards: HashSet.make(cardsNorthAmerica.colMustard, cardsNorthAmerica.revolver),
                    nonRefuters: HashSet.empty(),
                    refuter: Player("Bob"),
                    seenCard: undefined,
                }),

                Data.struct({
                    suggester: Player("Bob"),
                    cards: HashSet.make(cardsNorthAmerica.missScarlet, cardsNorthAmerica.conservatory),
                    nonRefuters: HashSet.empty(),
                    refuter: Player("Cho"),
                    seenCard: undefined,
                }),
            );

            const newKnowledge
                = refuterUsedOnlyCardTheyOwn(suggestions)(initialKnowledge);

            expect(newKnowledge).toEqual(Either.right(new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.colMustard), ChecklistValue("Y")],

                    [Data.tuple(Player("Cho"), cardsNorthAmerica.missScarlet), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.conservatory), ChecklistValue("Y")],
                ),

                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            })));
        });

        test('not enough information to narrow it down', () => {
            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.missScarlet), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
                Data.struct({
                    suggester: Player("Anisha"),
                    cards: HashSet.make(cardsNorthAmerica.colMustard, cardsNorthAmerica.revolver, cardsNorthAmerica.diningRoom),
                    nonRefuters: HashSet.empty(),
                    refuter: Player("Bob"),
                    seenCard: undefined,
                }),

                Data.struct({
                    suggester: Player("Bob"),
                    cards: HashSet.make(cardsNorthAmerica.missScarlet, cardsNorthAmerica.leadPipe, cardsNorthAmerica.conservatory),
                    nonRefuters: HashSet.empty(),
                    refuter: Player("Cho"),
                    seenCard: undefined,
                }),
            );

            const newKnowledge
                = refuterUsedOnlyCardTheyOwn(suggestions)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('we already know everything', () => {
            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.colMustard), ChecklistValue("Y")],

                    [Data.tuple(Player("Cho"), cardsNorthAmerica.missScarlet), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.conservatory), ChecklistValue("Y")],
                ),

                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
                Data.struct({
                    suggester: Player("Anisha"),
                    cards: HashSet.make(cardsNorthAmerica.colMustard, cardsNorthAmerica.revolver),
                    nonRefuters: HashSet.empty(),
                    refuter: Player("Bob"),
                    seenCard: undefined,
                }),

                Data.struct({
                    suggester: Player("Bob"),
                    cards: HashSet.make(cardsNorthAmerica.missScarlet, cardsNorthAmerica.conservatory),
                    nonRefuters: HashSet.empty(),
                    refuter: Player("Cho"),
                    seenCard: undefined,
                }),
            );

            const newKnowledge
                = refuterUsedOnlyCardTheyOwn(suggestions)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('no refuter', () => {
            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.missScarlet), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
                Data.struct({
                    suggester: Player("Anisha"),
                    cards: HashSet.make(cardsNorthAmerica.colMustard, cardsNorthAmerica.revolver),
                    nonRefuters: HashSet.empty(),
                    refuter: undefined,
                    seenCard: undefined,
                }),

                Data.struct({
                    suggester: Player("Bob"),
                    cards: HashSet.make(cardsNorthAmerica.missScarlet, cardsNorthAmerica.conservatory),
                    nonRefuters: HashSet.empty(),
                    refuter: undefined,
                    seenCard: undefined,
                }),
            );

            const newKnowledge
                = refuterUsedOnlyCardTheyOwn(suggestions)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });

        test('the card was seen', () => {
            const initialKnowledge: Knowledge = new Knowledge({
                playerChecklist: HashMap.make(
                    [Data.tuple(Player("Bob"), cardsNorthAmerica.revolver), ChecklistValue("N")],
                    [Data.tuple(Player("Cho"), cardsNorthAmerica.missScarlet), ChecklistValue("N")],
                ),

                caseFileChecklist: HashMap.empty(),
                playerHandSize: HashMap.empty(),
            });

            const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
                Data.struct({
                    suggester: Player("Anisha"),
                    cards: HashSet.make(cardsNorthAmerica.colMustard, cardsNorthAmerica.revolver),
                    nonRefuters: HashSet.empty(),
                    refuter: Player("Bob"),
                    seenCard: cardsNorthAmerica.revolver,
                }),

                Data.struct({
                    suggester: Player("Bob"),
                    cards: HashSet.make(cardsNorthAmerica.missScarlet, cardsNorthAmerica.conservatory),
                    nonRefuters: HashSet.empty(),
                    refuter: Player("Cho"),
                    seenCard: cardsNorthAmerica.conservatory,
                }),
            );

            const newKnowledge
                = refuterUsedOnlyCardTheyOwn(suggestions)(initialKnowledge);

            // We learned nothing new
            expect(newKnowledge).toEqual(Either.right(initialKnowledge));
        });
    });
});
