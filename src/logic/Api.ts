import { Data, Either, HashMap, HashSet, ReadonlyArray, ReadonlyRecord, Tuple, pipe } from "effect";
import { LogicalParadox } from "./LogicalParadox";
import { Knowledge } from "./Knowledge";
import { Suggestion } from "./Suggestion";
import { deduce } from './Deducer';
import { Card, CardCategory, GameObjects, Player } from "./GameObjects";

export type ApiPlayer = string;
export type ApiCardCategory = string;
export type ApiCardName = string;
export type ApiCard = [ApiCardCategory, ApiCardName];

export type ApiChecklistValue = "Y" | "N";

export type ApiSuggestion = [ApiPlayer, ApiCard[], ApiPlayer[], ApiPlayer?, ApiCard?];

export type ApiKnownCaseFileOwnership = Record<string, ApiChecklistValue>;
export const ApiKnownCaseFileOwnershipKey = ([category, card]: ApiCard): string => `CF-${category}-${card}`;

export type ApiKnownPlayerOwnership = Record<string, ApiChecklistValue>;
export const ApiKnownPlayerOwnershipKey = (player: ApiPlayer, [category, card]: ApiCard): string => `P-${player}-${category}-${card}`;

export type ApiKnownPlayerHandSize = Record<string, number>;
export const ApiKnownPlayerHandSizeKey = (player: ApiPlayer): string => `P-${player}`;

export interface ApiGameObjects {
    readonly players: readonly ApiPlayer[];
    readonly cards: readonly ApiCard[];
}

export interface ApiKnowledge {
    readonly knownCaseFileOwnerships: ApiKnownCaseFileOwnership;
    readonly knownPlayerOwnerships: ApiKnownPlayerOwnership;
    readonly knownPlayerHandSizes: ApiKnownPlayerHandSize;
}

export const apiDeduce = ({
    players: rawPlayers,
    cards: rawCards,
    suggestions: rawSuggestions,
    knownCaseFileOwnerships: rawKnownCaseFileOwnerships,
    knownPlayerOwnerships: rawKnownPlayerOwnerships,
    knownPlayerHandSizes: rawKnownPlayerHandSizes,
}:
    & ApiGameObjects
    & {
        readonly suggestions: readonly ApiSuggestion[];
    }
    & ApiKnowledge
): Either.Either<LogicalParadox, ApiKnowledge> => Either.gen(function* ($) {
    const players = pipe(
        rawPlayers,
        ReadonlyArray.map(player => Player(player)),
        HashSet.fromIterable,
    );

    const cards = pipe(
        rawCards,
        ReadonlyArray.map(([cardCategory, cardName]) => Card(Data.tuple(CardCategory(cardCategory), cardName))),
        HashSet.fromIterable,
    );

    const gameObjects = new GameObjects({ players, cards });

    const suggestions = HashSet.empty<Suggestion>();

    const knowledge = decodeKnowledge({
        knownCaseFileOwnerships: rawKnownCaseFileOwnerships,
        knownPlayerOwnerships: rawKnownPlayerOwnerships,
        knownPlayerHandSizes: rawKnownPlayerHandSizes,
    });

    return yield* $(
        deduce(gameObjects)(suggestions)(knowledge),
        Either.map(encodeKnowledge),
    );
});

const decodeKnowledge = (knowlege: ApiKnowledge): Knowledge => new Knowledge({
    caseFileChecklist: pipe(
        knowlege.knownCaseFileOwnerships,
        ReadonlyRecord.toEntries,
        ReadonlyArray.map(Tuple.mapFirst(key => {
            const [_, category, card] = key.split('-');
            return Card(Data.tuple(CardCategory(category), card));
        })),
        HashMap.fromIterable
    ),

    playerChecklist: pipe(
        knowlege.knownPlayerOwnerships,
        ReadonlyRecord.toEntries,
        ReadonlyArray.map(Tuple.mapFirst(key => {
            const [_, player, category, card] = key.split('-');
            return Data.tuple(
                Player(player),
                Card(Data.tuple(CardCategory(category), card)),
            );
        })),
        HashMap.fromIterable
    ),

    playerHandSize: pipe(
        knowlege.knownPlayerHandSizes,
        ReadonlyRecord.toEntries,
        ReadonlyArray.map(Tuple.mapFirst(key => {
            const [_, player] = key.split('-');
            return Player(player);
        })),
        HashMap.fromIterable
    ),
})

const encodeKnowledge = (knowledge: Knowledge): ApiKnowledge => ({
    knownCaseFileOwnerships: pipe(
        knowledge.caseFileChecklist,
        ReadonlyArray.fromIterable,
        ReadonlyArray.map(Tuple.mapFirst(([category, card]) =>
            ApiKnownCaseFileOwnershipKey([category, card]),
        )),
        ReadonlyRecord.fromEntries
    ),

    knownPlayerOwnerships: pipe(
        knowledge.playerChecklist,
        ReadonlyArray.fromIterable,
        ReadonlyArray.map(Tuple.mapFirst(([player, [category, card]]) => ApiKnownPlayerOwnershipKey(player, [category, card])
        )),
        ReadonlyRecord.fromEntries
    ),

    knownPlayerHandSizes: pipe(
        knowledge.playerHandSize,
        ReadonlyArray.fromIterable,
        ReadonlyArray.map(Tuple.mapFirst(ApiKnownPlayerHandSizeKey)),
        ReadonlyRecord.fromEntries
    ),
})
