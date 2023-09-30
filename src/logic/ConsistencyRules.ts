import { Data, Number, ReadonlyArray, pipe } from "effect";
import { ChecklistValue, Knowledge, updateCaseFileChecklist, updatePlayerChecklist } from "./Knowledge";
import { ALL_CARDS, ALL_PLAYERS, ALL_ROOM_CARDS, ALL_SUSPECT_CARDS, ALL_WEAPON_CARDS } from "./GameObjects";
import { getOrUndefined } from "./utils/Effect";

export type ConsistencyRule = (knowledge: Knowledge) => Knowledge;

export const cardsAreOwnedAtMostOnce: ConsistencyRule =
    (knowledge) => ReadonlyArray.reduce(
        ALL_CARDS,
        knowledge,

        (knowledge, card) => {
            // Is this card owned by a player?
            const isOwnedBySomePlayer = ReadonlyArray.some(
                ALL_PLAYERS,

                player => getOrUndefined(
                    knowledge.playerChecklist,
                    Data.tuple(player, card)
                ) === ChecklistValue("Y"),
            );

            // Is this card owned by the case file?
            const isOwnedByCaseFile = getOrUndefined(
                knowledge.caseFileChecklist,
                card
            ) === ChecklistValue("Y");

            // If we don't know the owner of the card,
            // there's no new knowledge to learn
            if (!isOwnedBySomePlayer && !isOwnedByCaseFile) {
                return knowledge;
            }

            // Otherwise set Ns for every other player
            knowledge = ReadonlyArray.reduce(
                ALL_PLAYERS,
                knowledge,

                (knowledge, player) => {
                    // Skip players with known ownership
                    if (getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(player, card)
                    ) !== undefined) {
                        return knowledge;
                    }

                    // Set unknown players to N
                    return updatePlayerChecklist(
                        Data.tuple(player, card),
                        ChecklistValue("N"),
                    )(knowledge);
                },
            );

            // Set case file to N if unknown
            if (getOrUndefined(
                knowledge.caseFileChecklist,
                card,
            ) === undefined) {
                knowledge = updateCaseFileChecklist(
                    card,
                    ChecklistValue("N"),
                )(knowledge);
            }

            return knowledge;
        },
    );

export const cardsAreOwnedAtLeastOnce: ConsistencyRule =
    (knowledge) => ReadonlyArray.reduce(
        ALL_CARDS,
        knowledge,

        (knowledge, card) => {
            // How many players definitely do NOT own this card?
            const playerNs = pipe(
                ALL_PLAYERS,

                ReadonlyArray.map(
                    (player) => getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(player, card)
                    ) === ChecklistValue("N")
                        ? 1
                        : 0
                ),

                ReadonlyArray.reduce(0, Number.sum),
            );

            // Does the casefile NOT own this card?
            const caseFileN = getOrUndefined(
                knowledge.caseFileChecklist,
                card,
            ) === ChecklistValue("N")
                ? 1
                : 0;

            const totalNs = playerNs + caseFileN;

            // If there is not exactly one cell that is blank or Y,
            // there's no new knowledge to learn
            if (totalNs !== ALL_PLAYERS.length) {
                return knowledge;
            }

            // Otherwise set Ys for every other player
            knowledge = ReadonlyArray.reduce(
                ALL_PLAYERS,
                knowledge,

                (knowledge, player) => {
                    // Skip players with known ownership
                    if (getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(player, card)
                    ) !== undefined) {
                        return knowledge;
                    }

                    // Set unknown players to Y
                    return updatePlayerChecklist(
                        Data.tuple(player, card),
                        ChecklistValue("Y"),
                    )(knowledge);
                },
            );

            // Set case file to Y if unknown
            if (getOrUndefined(
                knowledge.caseFileChecklist,
                card,
            ) === undefined) {
                knowledge = updateCaseFileChecklist(
                    card,
                    ChecklistValue("Y"),
                )(knowledge);
            }

            return knowledge;
        },
    );

export const playerOwnsAtMostHandSize: ConsistencyRule =
    (knowledge) => ReadonlyArray.reduce(
        ALL_PLAYERS,
        knowledge,

        (knowledge, player) => {
            // Get the hand size for the player
            const handSize = getOrUndefined(
                knowledge.playerHandSize,
                player,
            );

            // If we don't know their hand size,
            // there's no new knowledge to learn
            if (handSize === undefined) {
                return knowledge;
            }

            // Check if we have accounted for all their cards
            const cardYs = pipe(
                ALL_CARDS,

                ReadonlyArray.map(
                    (card) => getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(player, card)
                    ) === ChecklistValue("Y")
                        ? 1
                        : 0
                ),

                ReadonlyArray.reduce(0, Number.sum),
            );

            // If we haven't accounted for all their cards,
            // there's no new knowledge to learn
            if (cardYs < handSize) {
                return knowledge;
            }

            // Otherwise, mark the rest of the cards as Ns
            return ReadonlyArray.reduce(
                ALL_CARDS,
                knowledge,

                (knowledge, card) => {
                    // Skip cards where we know the ownership already
                    if (getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(player, card)
                    ) !== undefined) {
                        return knowledge;
                    }

                    // Set unknown cards to N
                    return updatePlayerChecklist(
                        Data.tuple(player, card),
                        ChecklistValue("N"),
                    )(knowledge);
                }
            );
        },
    );

export const playerOwnsAtLeastHandSize: ConsistencyRule =
    (knowledge) => ReadonlyArray.reduce(
        ALL_PLAYERS,
        knowledge,

        (knowledge, player) => {
            // Get the hand size for the player
            const handSize = getOrUndefined(
                knowledge.playerHandSize,
                player,
            );

            // If we don't know their hand size,
            // there's no new knowledge to learn
            if (handSize === undefined) {
                return knowledge;
            }

            // Check if we have accounted for all their Ns
            const cardNs = pipe(
                ALL_CARDS,

                ReadonlyArray.map(
                    (card) => getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(player, card)
                    ) === ChecklistValue("N")
                        ? 1
                        : 0
                ),

                ReadonlyArray.reduce(0, Number.sum),
            );

            // If we haven't accounted for all their Ns,
            // there's no new knowledge to learn
            if (cardNs < (ALL_CARDS.length - handSize)) {
                return knowledge;
            }

            // Otherwise, mark the rest of the cards as Ys
            return ReadonlyArray.reduce(
                ALL_CARDS,
                knowledge,

                (knowledge, card) => {
                    // Skip cards where we know the ownership already
                    if (getOrUndefined(
                        knowledge.playerChecklist,
                        Data.tuple(player, card)
                    ) !== undefined) {
                        return knowledge;
                    }

                    // Set unknown cards to N
                    return updatePlayerChecklist(
                        Data.tuple(player, card),
                        ChecklistValue("Y"),
                    )(knowledge);
                }
            );
        },
    );

export const caseFileOwnsAtMost1PerCategory: ConsistencyRule =
    (knowledge) => ReadonlyArray.reduce(
        [ALL_SUSPECT_CARDS, ALL_WEAPON_CARDS, ALL_ROOM_CARDS],
        knowledge,

        (knowledge, cardsOfCategory) => {
            // Check if we have accounted for 1 of the category
            const isSomeCardOwned = ReadonlyArray.some(
                cardsOfCategory,

                card => getOrUndefined(
                    knowledge.caseFileChecklist,
                    card,
                ) === ChecklistValue("Y"),
            );

            // If we haven't gotten 1 Y for the category,
            // there's no new knowledge to learn
            if (!isSomeCardOwned) {
                return knowledge;
            }

            // Otherwise, mark the rest of the cards as Ns
            return ReadonlyArray.reduce(
                cardsOfCategory,
                knowledge,

                (knowledge, card) => {
                    // Skip cards with known ownership
                    if (getOrUndefined(
                        knowledge.caseFileChecklist,
                        card,
                    ) !== undefined) {
                        return knowledge;
                    }

                    // Set unknown cards to N
                    return updateCaseFileChecklist(
                        card,
                        ChecklistValue("N"),
                    )(knowledge);
                }
            );
        },
    );

export const caseFileOwnsAtLeast1PerCategory: ConsistencyRule =
    (knowledge) => ReadonlyArray.reduce(
        [ALL_SUSPECT_CARDS, ALL_WEAPON_CARDS, ALL_ROOM_CARDS],
        knowledge,

        (knowledge, cardsOfCategory) => {
            // Check if we have accounted for all but 1 Ns
            const cardNs = pipe(
                cardsOfCategory,

                ReadonlyArray.map(
                    (card) => getOrUndefined(
                        knowledge.caseFileChecklist,
                        card,
                    ) === ChecklistValue("N")
                        ? 1
                        : 0
                ),

                ReadonlyArray.reduce(0, Number.sum),
            );

            // If we haven't accounted for all but 1 Ns,
            // there's no new knowledge to learn
            if (cardNs < (cardsOfCategory.length - 1)) {
                return knowledge;
            }

            // Otherwise, mark the rest of the cards as Ys
            return ReadonlyArray.reduce(
                cardsOfCategory,
                knowledge,

                (knowledge, card) => {
                    // Skip cards where we know the ownership already
                    if (getOrUndefined(
                        knowledge.caseFileChecklist,
                        card,
                    ) !== undefined) {
                        return knowledge;
                    }

                    // Set unknown cards to N
                    return updateCaseFileChecklist(
                        card,
                        ChecklistValue("Y"),
                    )(knowledge);
                }
            );
        },
    );
