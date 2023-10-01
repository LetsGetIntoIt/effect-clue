import { Effect, Either, Equal, HashSet, Option, Predicate, ReadonlyArray } from "effect";
import { Knowledge, LogicalParadox } from "./Knowledge";
import { cardsAreOwnedAtMostOnce, cardsAreOwnedAtLeastOnce, playerOwnsAtMostHandSize, playerOwnsAtLeastHandSize, caseFileOwnsAtMost1PerCategory, caseFileOwnsAtLeast1PerCategory } from "./ConsistencyRules";
import { nonRefutersDontHaveSuggestedCards, refuterUsedOnlyCardTheyOwn, refuterUsedSeenCard } from "./DeductionRules";
import { Suggestion } from "./Suggestion";

export type Deducer = (
    suggestions: HashSet.HashSet<Suggestion>,
) => (
    knowledge: Knowledge,
) => Effect.Effect<never, LogicalParadox, Knowledge>;

const deducer: Deducer = (suggestions) => {
    const allRules = [
        // All consistency rules
        cardsAreOwnedAtMostOnce,
        cardsAreOwnedAtLeastOnce,
        playerOwnsAtMostHandSize,
        playerOwnsAtLeastHandSize,
        caseFileOwnsAtMost1PerCategory,
        caseFileOwnsAtLeast1PerCategory,

        // All deduction rules
        ...ReadonlyArray.map([
            nonRefutersDontHaveSuggestedCards,
            refuterUsedSeenCard,
            refuterUsedOnlyCardTheyOwn
        ], (deductionRule) => deductionRule(suggestions)),
    ];

    return (knowledge) => Effect.iterate(
        {
            previousIterationKnowledge: Option.none<Knowledge>(),
            currentKnowledge: knowledge,
        },
        {
            while: ({ previousIterationKnowledge, currentKnowledge }) =>
                Option.map(
                    // Continue if the current knowledge is different than the previous iteration
                    // (i.e. we've learned something new)
                    previousIterationKnowledge,
                    Predicate.not(Equal.equals(currentKnowledge)),
                ).pipe(
                    // Continue if there was no previous iteration yet (i.e. this is the first iteration)
                    // We should always loop through the rules at least once
                    Option.getOrElse(() => true),
                ),

            body: ({ previousIterationKnowledge, currentKnowledge }) => Either.all({
                // Save our current knowledge as the previous iteration
                previousIterationKnowledge: Either.right(Option.some(currentKnowledge)),

                // Advance our knowledge by applying all the logical rules in sequence
                currentKnowledge: ReadonlyArray.reduce(
                    allRules,
                    // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
                    Either.right(currentKnowledge) as Either.Either<LogicalParadox, Knowledge>,
                    (currentKnowledge, rule) => Either.flatMap(currentKnowledge, rule),
                ),
            }),
        }
    ).pipe(
        Effect.map(({ currentKnowledge }) => currentKnowledge),
    );
};

export default deducer;
