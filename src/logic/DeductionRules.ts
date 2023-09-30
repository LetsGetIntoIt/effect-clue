import { Data, Either, HashMap, HashSet, ReadonlyArray } from "effect";
import { ChecklistValue, Knowledge, LogicalParadox, updatePlayerChecklist } from "./Knowledge";
import { getOrUndefined } from "./utils/Effect";

export type DeductionRule = (
    knowledge: Knowledge,
) => Either.Either<LogicalParadox, Knowledge>;

export const nonRefutersDontHaveSuggestedCards: DeductionRule =
    (knowledge) => ReadonlyArray.reduce(
        knowledge.suggestions,
        knowledge,

        (knowledge, suggestion) => ReadonlyArray.reduce(
            ReadonlyArray.cartesian(
                ReadonlyArray.fromIterable(suggestion.nonRefuters),
                ReadonlyArray.fromIterable(suggestion.cards),
            ),
            knowledge,

            (knowledge, [nonRefuter, suggestedCard]) => {
                // Skip ownership we already know
                if (getOrUndefined(
                    knowledge.playerChecklist,
                    Data.tuple(nonRefuter, suggestedCard),
                ) !== undefined) {
                    return knowledge;
                }

                // Set unknown ownership to N
                return updatePlayerChecklist(
                        Data.tuple(nonRefuter, suggestedCard),
                        ChecklistValue("N"),
                )(knowledge);
            },
        ),
    );

export const refuterUsedSeenCard: DeductionRule =
    (knowledge) => ReadonlyArray.reduce(
        knowledge.suggestions,
        knowledge,

        (knowledge, suggestion) => {
            // If there is not a refuter or not a seen card,
            // there is no new knowledge to be learned
            if (suggestion.refuter === undefined
                || suggestion.seenCard === undefined) {
                return knowledge;
            }

            // Skip ownership we already know
            if (getOrUndefined(
                knowledge.playerChecklist,
                Data.tuple(suggestion.refuter, suggestion.seenCard),
            ) !== undefined) {
                return knowledge;
            }

            // Set unknown ownership to N
            return updatePlayerChecklist(
                Data.tuple(suggestion.refuter, suggestion.seenCard),
                ChecklistValue("Y"),
            )(knowledge);
        },
    );

export const refuterUsedOnlyCardTheyOwn: DeductionRule =
    (knowledge) => ReadonlyArray.reduce(
        knowledge.suggestions,
        knowledge,

        (knowledge, suggestion) => {
            const { cards: suggestedCards, refuter, seenCard } = suggestion;

            // If there is not a refuter or we saw the seen card, there is no knowledge to be learned
            if (refuter === undefined || seenCard !== undefined) {
                return knowledge;
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
                return knowledge;
            }

            // Otherwise, mark the rest of the cards as Ys
            return HashSet.reduce(
                suggestedCards,
                knowledge,

                (knowledge, suggestedCard) => {
                    // Skip cards where we know the ownership already
                    if (getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(refuter, suggestedCard)
                    ) !== undefined) {
                        return knowledge;
                    }

                    // Set unknown cards to N
                    return updateKnowledge(knowledge, {
                        playerChecklist: HashMap.set(
                            Data.tuple(refuter, suggestedCard),
                            ChecklistValue("Y"),
                        ),
                    });
                }
            );
        },
    );
