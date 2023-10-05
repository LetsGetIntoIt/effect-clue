import { Either, HashSet, ReadonlyArray, pipe } from "effect";
import { LogicalParadox } from "./LogicalParadox";
import { Card, CardCategory, GameObjects, Player } from "./GameObjects";
import { emptyKnowledge } from "./Knowledge";
import { Suggestion } from "./Suggestion";
import { deduce } from './Deducer';

export type ApiPlayer = string;
export type ApiCardCategory = string;
export type ApiCardName = string;
export type ApiCard = [ApiCardCategory, ApiCardName];

export type ApiChecklistValue = "Y" | "N";

export type ApiKnownCaseFileOwnership = [ApiCard, ApiChecklistValue];
export type ApiKnownPlayerOwnership = [Player, ApiCard, ApiChecklistValue];
export type ApiKnownPlayerHandSize = [Player, number];

export interface ApiKnowledge {
    readonly knownCaseFileOwnerships: readonly ApiKnownCaseFileOwnership[];
    readonly knownPlayerOwnerships: readonly ApiKnownPlayerOwnership[];
    readonly knownPlayerHandSizes: readonly ApiKnownPlayerHandSize[];
}

export const apiDeduce = ({
    players: rawPlayers,
    cards: rawCards,
    knownCaseFileOwnerships: rawKnownCaseFileOwnerships,
    knownPlayerOwnerships: rawKnownPlayerOwnerships,
    knownPlayerHandSizes: rawKnownPlayerHandSizes,
}: {
    readonly players: readonly ApiPlayer[];
    readonly cards: readonly ApiCard[];
} & ApiKnowledge): Either.Either<LogicalParadox, ApiKnowledge> => Either.gen(function* ($) {
    const players = pipe(
        rawPlayers,
        ReadonlyArray.map(player => Player(player)),
        HashSet.fromIterable,
    );

    const cards = pipe(
        rawCards,
        ReadonlyArray.map(([cardCategory, cardName]) => Card([CardCategory(cardCategory), cardName])),
        HashSet.fromIterable,
    );

    const gameObjects = new GameObjects({ players, cards });

    const suggestions = HashSet.empty<Suggestion>();

    const knowledge = emptyKnowledge;

    return yield* $(
        deduce(gameObjects)(suggestions)(knowledge),
        Either.map(knowledge => ({
            knownCaseFileOwnerships: ReadonlyArray.empty(),
            knownPlayerOwnerships: ReadonlyArray.empty(),
            knownPlayerHandSizes: ReadonlyArray.empty(),
        })),
    );
});
