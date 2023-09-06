import { Equal, HashSet, ReadonlyArray } from "effect";
import { Knowledge } from "./Knowledge";
import { Suggestion } from "./Suggestion";
import { cardsAreOwnedAtMostOnce, cardsAreOwnedAtLeastOnce, playerOwnsAtMostHandSize, playerOwnsAtLeastHandSize, caseFileOwnsAtMost1PerCategory, caseFileOwnsAtLeast1PerCategory } from "./ConsistencyRules";
import { nonRefutersDontHaveSuggestedCards, refuterUsedOnlyCardTheyOwn, refuterUsedSeenCard } from "./DeductionRules";

export type Deducer = (
    suggestions: HashSet.HashSet<Suggestion>,
) => (
    knowledge: Knowledge,
) => Knowledge;

const deducer: Deducer = (suggestions) => {
    const allRules = [
        // All consistency rules
        cardsAreOwnedAtMostOnce,
        cardsAreOwnedAtLeastOnce,
        playerOwnsAtMostHandSize,
        playerOwnsAtLeastHandSize,
        caseFileOwnsAtMost1PerCategory,
        caseFileOwnsAtLeast1PerCategory,

        // All deduction rules, tied to the suggestions
        ...ReadonlyArray.map(
            [
                nonRefutersDontHaveSuggestedCards,
                refuterUsedSeenCard,
                refuterUsedOnlyCardTheyOwn,
            ],

            (deductionRule) => deductionRule(suggestions),
        ),
    ];

    return (knowledge) => {
        let knowledgeIterationIn: Knowledge;
        let knowledgeOut: Knowledge = knowledge;
        do {
            knowledgeIterationIn = knowledgeOut;
            knowledgeOut = ReadonlyArray.reduce(
                allRules,
                knowledgeIterationIn,
                (knowledge, rule) => rule(knowledge),
            );
        } while (
            !Equal.equals(knowledgeOut, knowledgeIterationIn)
        );

        return knowledgeOut;
    };
};

export default deducer;
