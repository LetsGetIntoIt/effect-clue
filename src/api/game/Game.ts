import { CTX, HS, B, E, PR } from "../utils/effect/EffectImports";
import { pipe } from '@effect/data/Function';
import { Struct_get } from "../utils/effect/Effect";

import * as CardOwner from './CardOwner';
import { Card, Player, CaseFile, Guess } from "../objects";

export type Game  = B.Branded<{
    readonly cards: HS.HashSet<Card.Card>;
    readonly players: HS.HashSet<Player.Player>;
    readonly caseFile: CaseFile.CaseFile;
    readonly guesses: HS.HashSet<Guess.Guess>;

    readonly cardTypes: HS.HashSet<string>;
    readonly owners: HS.HashSet<CardOwner.CardOwner>;
}, 'Game'>;

const GameNominal = B.nominal<Game>();

export const Tag = CTX.Tag<Game>();

export const Game = ({
    cards,
    players,
    caseFile,
    guesses,
}: {
    readonly cards: HS.HashSet<Card.Card>;
    readonly players: HS.HashSet<Player.Player>;
    readonly caseFile: CaseFile.CaseFile;
    readonly guesses: HS.HashSet<Guess.Guess>;
}): E.Either<PR.ParseErrors, Game> =>
    E.gen(function* ($) {
        // Validate the card set

        // Validate the players
        
        // Validate the case file

        // Validate the guesses
        // - All guessed cards should be part of the Game
        // - The guessed cards cover all card types in the Game
        // - The guesser is part of the Game
        // - The refuter, if any, is part of the game
        // - The refuteCard, if any, is part of the game
        // - The guessed cards have no duplicate card types
        // - validate that the refuteCard is in the guessed set
        // - validate that the guesser is not in the nonRefuter set
        // - validate that the guesser is not the refuter
        // - validate that the refuter is not in the nonRefuter set

        // Compute the card types
        const cardTypes = HS.map(
            cards,
            Struct_get('cardType'),
        );

        // Compute the owners
        const owners = HS.fromIterable<CardOwner.CardOwner>([
            ...HS.map(players, player => CardOwner.CardOwnerPlayer({ player })),
            CardOwner.CardOwnerCaseFile({ caseFile }),
        ]);

        return yield* $(E.right(GameNominal({
            cards,
            players,
            caseFile,
            guesses,
            cardTypes,
            owners,
        })));
    });
