import { Data, Either, HashMap, HashSet, Predicate, ReadonlyArray, pipe } from "effect";
import { ChecklistValue, Knowledge, updateCaseFileChecklist, updatePlayerChecklist } from "./Knowledge";
import { GameObjects } from "./GameObjects";
import { getOrUndefined } from "./utils/Effect";
import { CardHasTooFewOwners, CardHasTooManyOwners, CaseFileHasTooFewCards, CaseFileHasTooManyCards, LogicalParadox, PlayerHasTooFewCards, PlayerHasTooManyCards } from "./LogicalParadox";

export type ConsistencyRule = (gameObjects: GameObjects) => (knowledge: Knowledge) => Either.Either<LogicalParadox, Knowledge>;

const NUM_CASE_FILES = 1;
const EXPECTED_MIN_NUM_OWNERS_PER_CARD = 1;
const EXPECTED_MAX_NUM_OWNERS_PER_CARD = 1;
const EXPECTED_MIN_NUM_CARDS_IN_CASE_FILE_PER_CATEGORY = 1;
const EXPECTED_MAX_NUM_CARDS_IN_CASE_FILE_PER_CATEGORY = 1;

export const cardsAreOwnedAtMostOnce: ConsistencyRule =
    (gameObjects) => (knowledge) => HashSet.reduce(
        gameObjects.cards,

        // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
        Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

        (knowledge, card) => Either.flatMap(knowledge, knowledge => {
            // Is this card owned by a player?
            const numPlayerOwners = pipe(
                gameObjects.players,

                HashSet.filter(player => getOrUndefined(
                    knowledge.playerChecklist,
                    Data.tuple(player, card)
                ) === ChecklistValue("Y")),

                HashSet.size,
            );

            // Is this card owned by the case file?
            const numCaseFileOwners = getOrUndefined(
                knowledge.caseFileChecklist,
                card
            ) === ChecklistValue("Y") ? 1 : 0;

            // If we don't know the owner of the card,
            // there's no new knowledge to learn
            if (numPlayerOwners + numCaseFileOwners < EXPECTED_MIN_NUM_OWNERS_PER_CARD) {
                return Either.right(knowledge);
            }

            // If we've accounted for too many owners, that's an error
            if (numPlayerOwners + numCaseFileOwners > EXPECTED_MAX_NUM_OWNERS_PER_CARD) {
                return Either.left(CardHasTooManyOwners({
                    card,
                    numOwners: numPlayerOwners + numCaseFileOwners,
                    expectedMaxNumOwners: EXPECTED_MAX_NUM_OWNERS_PER_CARD,
                }));
            }

            // Otherwise set Ns for every other player
            return ReadonlyArray.reduce(
                gameObjects.players,

                // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
                Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

                (knowledge, player) => Either.flatMap(knowledge, knowledge => {
                    // Skip players with known ownership
                    if (getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(player, card)
                    ) !== undefined) {
                        return Either.right(knowledge);
                    }

                    // Set unknown players to N
                    return updatePlayerChecklist(
                        Data.tuple(player, card),
                        ChecklistValue("N")
                    )(knowledge);
                })
            ).pipe(
                Either.flatMap(knowledge => {
                    // Set case file to N if unknown
                    if (getOrUndefined(
                        knowledge.caseFileChecklist,
                        card
                    ) === undefined) {
                        return updateCaseFileChecklist(
                            card,
                            ChecklistValue("N")
                        )(knowledge);
                    }

                    return Either.right(knowledge);
                })
            );
        })
    );

export const cardsAreOwnedAtLeastOnce: ConsistencyRule =
    (gameObjects) => (knowledge) => HashSet.reduce(
        gameObjects.cards,

        // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
        Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

        (knowledge, card) => Either.flatMap(knowledge, knowledge => {
            // How many players definitely do NOT own this card?
            const playerNs = pipe(
                gameObjects.players,

                HashSet.filter(
                    (player) => getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(player, card)
                    ) === ChecklistValue("N"),
                ),

                HashSet.size,
            );

            // Does the casefile NOT own this card?
            const caseFileN = getOrUndefined(
                knowledge.caseFileChecklist,
                card
            ) === ChecklistValue("N")
                ? 1
                : 0;

            // If there is not exactly one cell that is blank or Y,
            // there's no new knowledge to learn
            if (playerNs + caseFileN + EXPECTED_MAX_NUM_OWNERS_PER_CARD < HashSet.size(gameObjects.players) + NUM_CASE_FILES) {
                return Either.right(knowledge);
            }

             // If we've accounted for too many non-owners, that's a paradox
            if (playerNs + caseFileN + EXPECTED_MIN_NUM_OWNERS_PER_CARD > HashSet.size(gameObjects.players) + NUM_CASE_FILES) {
                return Either.left(CardHasTooFewOwners({
                    card,
                    numNonOwners: playerNs + caseFileN,
                    expectedMinNumOwners: EXPECTED_MIN_NUM_OWNERS_PER_CARD,
                }));
            }

            // Otherwise set Ys for every other player
            return HashSet.reduce(
                gameObjects.players,

                // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
                Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

                (knowledge, player) => Either.flatMap(knowledge, knowledge => {
                    // Skip players with known ownership
                    if (getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(player, card)
                    ) !== undefined) {
                        return Either.right(knowledge);
                    }

                    // Set unknown players to Y
                    return updatePlayerChecklist(
                        Data.tuple(player, card),
                        ChecklistValue("Y")
                    )(knowledge);
                })
            ).pipe(
                Either.flatMap(knowledge => {
                    // Set case file to Y if unknown
                    if (getOrUndefined(
                        knowledge.caseFileChecklist,
                        card
                    ) === undefined) {
                        return updateCaseFileChecklist(
                            card,
                            ChecklistValue("Y")
                        )(knowledge);
                    }

                    return Either.right(knowledge);
                })
            );
        })
    );

export const playerOwnsAtMostHandSize: ConsistencyRule =
    (gameObjects) => (knowledge) => HashSet.reduce(
        gameObjects.players,

        // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
        Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

        (knowledge, player) => Either.flatMap(knowledge, knowledge => {
            // Get the hand size for the player
            const handSize = getOrUndefined(
                knowledge.playerHandSize,
                player
            );

            // If we don't know their hand size,
            // there's no new knowledge to learn
            if (Predicate.isNullable(handSize)) {
                return Either.right(knowledge);
            }

            // Check if we have accounted for all their cards
            const cardYs = pipe(
                gameObjects.cards,

                HashSet.filter(
                    (card) => getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(player, card)
                    ) === ChecklistValue("Y")
                ),

                HashSet.size,
            );

            // If we haven't accounted for all their cards,
            // there's no new knowledge to learn
            if (cardYs < handSize) {
                return Either.right(knowledge);
            }

            // If we've accounted for more than their hand size,
            // that's a paradox
            if (cardYs > handSize) {
                return Either.left(PlayerHasTooManyCards({
                    player,
                    numOwned: cardYs,
                    expectedMaxNumCards: handSize,
                }));
            }

            // Otherwise, mark the rest of the cards as Ns
            return HashSet.reduce(
                gameObjects.cards,

                // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
                Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

                (knowledge, card) => Either.flatMap(knowledge, knowledge => {
                    // Skip cards where we know the ownership already
                    if (getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(player, card)
                    ) !== undefined) {
                        return Either.right(knowledge);
                    }

                    // Set unknown cards to N
                    return updatePlayerChecklist(
                        Data.tuple(player, card),
                        ChecklistValue("N")
                    )(knowledge);
                })
            );
        })
    );

export const playerOwnsAtLeastHandSize: ConsistencyRule =
    (gameObjects) => (knowledge) => HashSet.reduce(
        gameObjects.players,

        // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
        Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

        (knowledge, player) => Either.flatMap(knowledge, knowledge => {
            // Get the hand size for the player
            const handSize = getOrUndefined(
                knowledge.playerHandSize,
                player,
            );

            // If we don't know their hand size,
            // there's no new knowledge to learn
            if (Predicate.isNullable(handSize)) {
                return Either.right(knowledge);
            }

            // Check if we have accounted for all their Ns
            const cardNs = pipe(
                gameObjects.cards,

                HashSet.filter(
                    (card) => getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(player, card)
                    ) === ChecklistValue("N")
                ),

                HashSet.size,
            );

            // If we haven't accounted for all their Ns,
            // there's no new knowledge to learn
            if (cardNs + handSize < HashSet.size(gameObjects.cards)) {
                return Either.right(knowledge);
            }

            // If we've accounted for more than their share of Ns
            if (cardNs + handSize > HashSet.size(gameObjects.cards)) {
                return Either.left(PlayerHasTooFewCards({
                    player,
                    numNotOwned: cardNs,
                    expectedMinNumCards: handSize,
                }));
            }

            // Otherwise, mark the rest of the cards as Ys
            return HashSet.reduce(
                gameObjects.cards,

                // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
                Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

                (knowledge, card) => Either.flatMap(knowledge, knowledge => {
                    // Skip cards where we know the ownership already
                    if (getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(player, card)
                    ) !== undefined) {
                        return Either.right(knowledge);
                    }

                    // Set unknown cards to N
                    return updatePlayerChecklist(
                        Data.tuple(player, card),
                        ChecklistValue("Y"),
                    )(knowledge);
                }),
            );
        }),
    );

export const caseFileOwnsAtMost1PerCategory: ConsistencyRule =
    (gameObjects) => (knowledge) => HashMap.reduce(
        gameObjects.cardsByCategory,

        // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
        Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

        (knowledge, cardsOfCategory) => Either.flatMap(knowledge, knowledge => {
            // Check if we have accounted for 1 of the category
            const numYs = pipe(
                cardsOfCategory,

                HashSet.filter(card => getOrUndefined(
                    knowledge.caseFileChecklist,
                    card,
                ) === ChecklistValue("Y")),

                HashSet.size,
            );

            // If we haven't gotten 1 Y for the category,
            // there's no new knowledge to learn
            if (numYs < EXPECTED_MIN_NUM_CARDS_IN_CASE_FILE_PER_CATEGORY) {
                return Either.right(knowledge);
            }

            // If we've account for too many cards, that's an error
            if (numYs > EXPECTED_MAX_NUM_CARDS_IN_CASE_FILE_PER_CATEGORY) {
                return Either.left(CaseFileHasTooManyCards({
                    numOwned: numYs,
                    expectedMaxNumCards: EXPECTED_MAX_NUM_CARDS_IN_CASE_FILE_PER_CATEGORY,
                }))
            }

            // Otherwise, mark the rest of the cards as Ns
            return ReadonlyArray.reduce(
                cardsOfCategory,
                
                // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
                Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

                (knowledge, card) => Either.flatMap(knowledge, knowledge => {
                    // Skip cards with known ownership
                    if (getOrUndefined(
                        knowledge.caseFileChecklist,
                        card,
                    ) !== undefined) {
                        return Either.right(knowledge);
                    }

                    // Set unknown cards to N
                    return updateCaseFileChecklist(
                        card,
                        ChecklistValue("N"),
                    )(knowledge);
                }),
            );
        }),
    );

export const caseFileOwnsAtLeast1PerCategory: ConsistencyRule =
    (gameObjects) => (knowledge) => HashMap.reduce(
        gameObjects.cardsByCategory,

        // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
        Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

        (knowledge, cardsOfCategory) => Either.flatMap(knowledge, knowledge => {
            // Check if we have accounted for all but 1 Ns
            const cardNs = pipe(
                cardsOfCategory,

                HashSet.filter(
                    (card) => getOrUndefined(
                        knowledge.caseFileChecklist,
                        card,
                    ) === ChecklistValue("N")
                ),

                HashSet.size,
            );

            // If we haven't accounted for all but 1 Ns,
            // there's no new knowledge to learn
            if (cardNs + EXPECTED_MAX_NUM_CARDS_IN_CASE_FILE_PER_CATEGORY < HashSet.size(cardsOfCategory)) {
                return Either.right(knowledge);
            }

            // If we've accounted for too many Ns, that's a paradox
            if (cardNs + EXPECTED_MIN_NUM_CARDS_IN_CASE_FILE_PER_CATEGORY > HashSet.size(cardsOfCategory)) {
                return Either.left(CaseFileHasTooFewCards({
                    numNotOwned: cardNs,
                    expectedMinNumCards: EXPECTED_MIN_NUM_CARDS_IN_CASE_FILE_PER_CATEGORY,
                }));
            }

            // Otherwise, mark the rest of the cards as Ys
            return ReadonlyArray.reduce(
                cardsOfCategory,
                
                // This typecast is annoying. See Discord thread: https://discord.com/channels/795981131316985866/1158093341855060048
                Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,

                (knowledge, card) => Either.flatMap(knowledge, knowledge => {
                    // Skip cards where we know the ownership already
                    if (getOrUndefined(
                        knowledge.caseFileChecklist,
                        card,
                    ) !== undefined) {
                        return Either.right(knowledge);
                    }

                    // Set unknown cards to N
                    return updateCaseFileChecklist(
                        card,
                        ChecklistValue("Y"),
                    )(knowledge);
                }),
            );
        }),
    );
