import { Data, Either, HashMap, HashSet } from "effect";
import { ChecklistValue, Knowledge } from "./Knowledge";
import { Suggestion } from "./Suggestion";
import { nonRefutersDontHaveSuggestedCards, refuterUsedSeenCard, refuterUsedOnlyCardTheyOwn } from "./DeductionRules";
import { Card, Player } from "./GameObjects";

import "./test-utils/EffectExpectEquals";

describe(nonRefutersDontHaveSuggestedCards, () => {
    test('no hallucinations', () => {
        const initialKnowledge: Knowledge = Data.struct({
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
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
            Data.struct({
                suggester: Player("Anisha"),
                cards: HashSet.make(Card("Prof. Plum"), Card("Knife")),
                nonRefuters: HashSet.make(Player("Bob"), Player("Cho")),
                refuter: undefined,
                seenCard: undefined,
            }),

            Data.struct({
                suggester: Player("Bob"),
                cards: HashSet.make(Card("Miss Scarlet"), Card("Conservatory")),
                nonRefuters: HashSet.make(Player("Anisha"), Player("Cho")),
                refuter: undefined,
                seenCard: undefined,
            }),
        );

        const newKnowledge
            = nonRefutersDontHaveSuggestedCards(suggestions)(initialKnowledge);

        expect(newKnowledge).toEqual(Either.right(Data.struct({
            playerChecklist: HashMap.make(
                // Ns from the first suggestion
                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), Card("Knife")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Knife")), ChecklistValue("N")],

                // Ns from the second suggestion
                [Data.tuple(Player("Anisha"), Card("Miss Scarlet")), ChecklistValue("N")],
                [Data.tuple(Player("Anisha"), Card("Conservatory")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Miss Scarlet")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Conservatory")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.empty(),

            playerHandSize: HashMap.empty(),
        })));
    });

    test('we already know everything', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                // Ns from the first suggestion
                [Data.tuple(Player("Bob"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), Card("Knife")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Prof. Plum")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Knife")), ChecklistValue("N")],

                // Ns from the second suggestion
                [Data.tuple(Player("Anisha"), Card("Miss Scarlet")), ChecklistValue("N")],
                [Data.tuple(Player("Anisha"), Card("Conservatory")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Miss Scarlet")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Conservatory")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.empty(),

            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
            Data.struct({
                suggester: Player("Anisha"),
                cards: HashSet.make(Card("Prof. Plum"), Card("Knife")),
                nonRefuters: HashSet.make(Player("Bob"), Player("Cho")),
                refuter: undefined,
                seenCard: undefined,
            }),

            Data.struct({
                suggester: Player("Bob"),
                cards: HashSet.make(Card("Miss Scarlet"), Card("Conservatory")),
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
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
            Data.struct({
                suggester: Player("Anisha"),
                cards: HashSet.make(Card("Prof. Plum"), Card("Knife")),
                nonRefuters: HashSet.empty(),
                refuter: undefined,
                seenCard: undefined,
            }),

            Data.struct({
                suggester: Player("Bob"),
                cards: HashSet.make(Card("Miss Scarlet"), Card("Conservatory")),
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
        const initialKnowledge: Knowledge = Data.struct({
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
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
            Data.struct({
                suggester: Player("Anisha"),
                cards: HashSet.make(Card("Prof. Plum"), Card("Knife")),
                nonRefuters: HashSet.empty(),
                refuter: Player("Bob"),
                seenCard: Card("Knife"),
            }),

            Data.struct({
                suggester: Player("Bob"),
                cards: HashSet.make(Card("Miss Scarlet"), Card("Conservatory")),
                nonRefuters: HashSet.empty(),
                refuter: Player("Bob"),
                seenCard: Card("Conservatory"),
            }),

            Data.struct({
                suggester: Player("Anisha"),
                cards: HashSet.make(Card("Col. Mustard"), Card("Revolver")),
                nonRefuters: HashSet.empty(),
                refuter: Player("Cho"),
                seenCard: Card("Revolver"),
            }),
        );

        const newKnowledge
            = refuterUsedSeenCard(suggestions)(initialKnowledge);

        expect(newKnowledge).toEqual(Either.right(Data.struct({
            playerChecklist: HashMap.make(
                // Ys from the first suggestion
                [Data.tuple(Player("Bob"), Card("Knife")), ChecklistValue("Y")],

                // Ys from the second suggestion
                [Data.tuple(Player("Bob"), Card("Conservatory")), ChecklistValue("Y")],

                // Ys from the third suggestion
                [Data.tuple(Player("Cho"), Card("Revolver")), ChecklistValue("Y")],
            ),

            caseFileChecklist: HashMap.empty(),

            playerHandSize: HashMap.empty(),
        })));
    });

    test('we already know everything', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                // Ys from the first suggestion
                [Data.tuple(Player("Bob"), Card("Knife")), ChecklistValue("Y")],

                // Ys from the second suggestion
                [Data.tuple(Player("Bob"), Card("Conservatory")), ChecklistValue("Y")],

                // Ys from the third suggestion
                [Data.tuple(Player("Cho"), Card("Revolver")), ChecklistValue("Y")],
            ),

            caseFileChecklist: HashMap.empty(),

            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
            Data.struct({
                suggester: Player("Anisha"),
                cards: HashSet.make(Card("Prof. Plum"), Card("Knife")),
                nonRefuters: HashSet.empty(),
                refuter: Player("Bob"),
                seenCard: Card("Knife"),
            }),

            Data.struct({
                suggester: Player("Bob"),
                cards: HashSet.make(Card("Miss Scarlet"), Card("Conservatory")),
                nonRefuters: HashSet.empty(),
                refuter: Player("Bob"),
                seenCard: Card("Conservatory"),
            }),

            Data.struct({
                suggester: Player("Anisha"),
                cards: HashSet.make(Card("Col. Mustard"), Card("Revolver")),
                nonRefuters: HashSet.empty(),
                refuter: Player("Cho"),
                seenCard: Card("Revolver"),
            }),
        );

        const newKnowledge
            = refuterUsedSeenCard(suggestions)(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(Either.right(initialKnowledge));
    });

    test('no refuter', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
            Data.struct({
                suggester: Player("Anisha"),
                cards: HashSet.make(Card("Prof. Plum"), Card("Knife")),
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
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.empty(),
            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
            Data.struct({
                suggester: Player("Anisha"),
                cards: HashSet.make(Card("Prof. Plum"), Card("Knife")),
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
        const initialKnowledge: Knowledge = Data.struct({
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
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Bob"), Card("Revolver")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Miss Scarlet")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
            Data.struct({
                suggester: Player("Anisha"),
                cards: HashSet.make(Card("Col. Mustard"), Card("Revolver")),
                nonRefuters: HashSet.empty(),
                refuter: Player("Bob"),
                seenCard: undefined,
            }),

            Data.struct({
                suggester: Player("Bob"),
                cards: HashSet.make(Card("Miss Scarlet"), Card("Conservatory")),
                nonRefuters: HashSet.empty(),
                refuter: Player("Cho"),
                seenCard: undefined,
            }),
        );

        const newKnowledge
            = refuterUsedOnlyCardTheyOwn(suggestions)(initialKnowledge);

        expect(newKnowledge).toEqual(Either.right(Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Bob"), Card("Revolver")), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), Card("Col. Mustard")), ChecklistValue("Y")],

                [Data.tuple(Player("Cho"), Card("Miss Scarlet")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Conservatory")), ChecklistValue("Y")],
            ),

            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        })));
    });

    test('not enough information to narrow it down', () => {
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Bob"), Card("Revolver")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Miss Scarlet")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
            Data.struct({
                suggester: Player("Anisha"),
                cards: HashSet.make(Card("Col. Mustard"), Card("Revolver"), Card("Dining room")),
                nonRefuters: HashSet.empty(),
                refuter: Player("Bob"),
                seenCard: undefined,
            }),

            Data.struct({
                suggester: Player("Bob"),
                cards: HashSet.make(Card("Miss Scarlet"), Card("Lead pipe"), Card("Conservatory")),
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
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Bob"), Card("Revolver")), ChecklistValue("N")],
                [Data.tuple(Player("Bob"), Card("Col. Mustard")), ChecklistValue("Y")],

                [Data.tuple(Player("Cho"), Card("Miss Scarlet")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Conservatory")), ChecklistValue("Y")],
            ),

            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
            Data.struct({
                suggester: Player("Anisha"),
                cards: HashSet.make(Card("Col. Mustard"), Card("Revolver")),
                nonRefuters: HashSet.empty(),
                refuter: Player("Bob"),
                seenCard: undefined,
            }),

            Data.struct({
                suggester: Player("Bob"),
                cards: HashSet.make(Card("Miss Scarlet"), Card("Conservatory")),
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
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Bob"), Card("Revolver")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Miss Scarlet")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
            Data.struct({
                suggester: Player("Anisha"),
                cards: HashSet.make(Card("Col. Mustard"), Card("Revolver")),
                nonRefuters: HashSet.empty(),
                refuter: undefined,
                seenCard: undefined,
            }),

            Data.struct({
                suggester: Player("Bob"),
                cards: HashSet.make(Card("Miss Scarlet"), Card("Conservatory")),
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
        const initialKnowledge: Knowledge = Data.struct({
            playerChecklist: HashMap.make(
                [Data.tuple(Player("Bob"), Card("Revolver")), ChecklistValue("N")],
                [Data.tuple(Player("Cho"), Card("Miss Scarlet")), ChecklistValue("N")],
            ),

            caseFileChecklist: HashMap.empty(),
            playerHandSize: HashMap.empty(),
        });

        const suggestions: HashSet.HashSet<Suggestion> = HashSet.make(
            Data.struct({
                suggester: Player("Anisha"),
                cards: HashSet.make(Card("Col. Mustard"), Card("Revolver")),
                nonRefuters: HashSet.empty(),
                refuter: Player("Bob"),
                seenCard: Card("Revolver"),
            }),

            Data.struct({
                suggester: Player("Bob"),
                cards: HashSet.make(Card("Miss Scarlet"), Card("Conservatory")),
                nonRefuters: HashSet.empty(),
                refuter: Player("Cho"),
                seenCard: Card("Conservatory"),
            }),
        );

        const newKnowledge
            = refuterUsedOnlyCardTheyOwn(suggestions)(initialKnowledge);

        // We learned nothing new
        expect(newKnowledge).toEqual(Either.right(initialKnowledge));
    });
});
