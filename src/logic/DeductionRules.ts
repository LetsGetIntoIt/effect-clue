import { Data, Either, HashSet, ReadonlyArray } from "effect";
import { ChecklistValue, Knowledge, updatePlayerChecklist } from "./Knowledge";
import { getOrUndefined } from "./utils/Effect";
import { Suggestion } from "./Suggestion";
import { LogicalParadox } from "./LogicalParadox";

export type DeductionRule = (
    suggestions: HashSet.HashSet<Suggestion>,
) => (
    knowledge: Knowledge,
) => Either.Either<LogicalParadox, Knowledge>;

export const nonRefutersDontHaveSuggestedCards: DeductionRule =
    (suggestions) => (knowledge) => ReadonlyArray.reduce(
        suggestions,

        // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
        Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

        (knowledge, suggestion) => ReadonlyArray.reduce(
            ReadonlyArray.cartesian(
                ReadonlyArray.fromIterable(suggestion.nonRefuters),
                ReadonlyArray.fromIterable(suggestion.cards),
            ),
            knowledge,

            (knowledge, [nonRefuter, suggestedCard]) => Either.flatMap(knowledge, knowledge => {
                // Skip ownership we already know
                if (getOrUndefined(
                    knowledge.playerChecklist,
                    Data.tuple(nonRefuter, suggestedCard),
                ) !== undefined) {
                    return Either.right(knowledge);
                }

                // Set unknown ownership to N
                return updatePlayerChecklist(
                    Data.tuple(nonRefuter, suggestedCard),
                    ChecklistValue("N"),
                )(knowledge);
            }),
        ),
    );

export const refuterUsedSeenCard: DeductionRule =
    (suggestions) => (knowledge) => ReadonlyArray.reduce(
        suggestions,

        // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
        Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

        (knowledge, suggestion) => Either.flatMap(knowledge, knowledge => {
            // If there is not a refuter or not a seen card,
            // there is no new knowledge to be learned
            if (suggestion.refuter === undefined
                || suggestion.seenCard === undefined) {
                return Either.right(knowledge);
            }

            // Skip ownership we already know
            if (getOrUndefined(
                knowledge.playerChecklist,
                Data.tuple(suggestion.refuter, suggestion.seenCard),
            ) !== undefined) {
                return Either.right(knowledge);
            }

            // Set unknown ownership to N
            return updatePlayerChecklist(
                Data.tuple(suggestion.refuter, suggestion.seenCard),
                ChecklistValue("Y"),
            )(knowledge);
        }),
    );

export const refuterUsedOnlyCardTheyOwn: DeductionRule =
    (suggestions) => (knowledge) => ReadonlyArray.reduce(
        suggestions,

        // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
        Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

        (knowledge, suggestion) => Either.flatMap(knowledge, knowledge => {
            const { cards: suggestedCards, refuter, seenCard } = suggestion;

            // If there is not a refuter or we saw the seen card, there is no knowledge to be learned
            if (refuter === undefined || seenCard !== undefined) {
                return Either.right(knowledge);
            }

            const cardNs = HashSet.reduce(
                suggestedCards,
                0,

                (count, suggestedCard) => getOrUndefined(
                    knowledge.playerChecklist,
                    Data.tuple(refuter, suggestedCard)
                ) === ChecklistValue("N")
                    ? count + 1
                    : count,
            );

            // If we haven't accounted for enough Ns, there's no new knowledge to learn
            if (cardNs < (HashSet.size(suggestedCards) - 1)) {
                return Either.right(knowledge);
            }

            // Otherwise, mark the rest of the cards as Ys
            return HashSet.reduce(
                suggestedCards,
                
                // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
                Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

                (knowledge, suggestedCard) => Either.flatMap(knowledge, knowledge => {
                    // Skip cards where we know the ownership already
                    if (getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(refuter, suggestedCard)
                    ) !== undefined) {
                        return Either.right(knowledge);
                    }

                    // Set unknown cards to N
                    return updatePlayerChecklist(
                        Data.tuple(refuter, suggestedCard),
                        ChecklistValue("Y"),
                    )(knowledge);
                }),
            );
        }),
    );
