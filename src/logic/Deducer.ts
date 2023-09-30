import { Either, Equal, ReadonlyArray } from "effect";
import { Knowledge, LogicalParadox } from "./Knowledge";
import { cardsAreOwnedAtMostOnce, cardsAreOwnedAtLeastOnce, playerOwnsAtMostHandSize, playerOwnsAtLeastHandSize, caseFileOwnsAtMost1PerCategory, caseFileOwnsAtLeast1PerCategory } from "./ConsistencyRules";
import { nonRefutersDontHaveSuggestedCards, refuterUsedOnlyCardTheyOwn, refuterUsedSeenCard } from "./DeductionRules";

export type Deducer = (
    knowledge: Knowledge,
) => Either.Either<LogicalParadox, Knowledge>;

const deducer: Deducer = (knowledge) => {
    const allRules = [
        // All consistency rules
        cardsAreOwnedAtMostOnce,
        cardsAreOwnedAtLeastOnce,
        playerOwnsAtMostHandSize,
        playerOwnsAtLeastHandSize,
        caseFileOwnsAtMost1PerCategory,
        caseFileOwnsAtLeast1PerCategory,

        // All deduction rules
        nonRefutersDontHaveSuggestedCards,
        refuterUsedSeenCard,
        refuterUsedOnlyCardTheyOwn,
    ];

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

export default deducer;
