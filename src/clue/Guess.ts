import { D, HS, O, B, T, P } from '../utils/EffectImports';
import { flow, constant } from '@effect/data/Function';
import { Brand_refinedEffect, Either_fromPredicate, Option_fromPredicate, Struct_get } from '../utils/ShouldBeBuiltin';

import * as Card from './Card';
import * as Player from './Player';
import * as Game from './Game';

export interface Guess extends D.Case {
    _tag: "Guess";

    readonly cards: HS.HashSet<Card.ValidatedCard>;
    readonly guesser: Player.ValidatedPlayer;
    readonly nonRefuters: HS.HashSet<Player.ValidatedPlayer>;
    readonly refutation: O.Option<{
        refuter: Player.ValidatedPlayer;
        card: O.Option<Card.ValidatedCard>;
    }>;
};

export const Guess = D.tagged<Guess>("Guess");

export type ValidatedGuess = Guess & B.Brand<'ValidatedGuess'>;

export const ValidatedGuess = Brand_refinedEffect<ValidatedGuess, Game.Game>(
    T.gen(function* ($) {
        const game = yield* $(Game.Tag);

        return [
            Either_fromPredicate(
                // Ensure that the guessed cards are a subset of all cards in the game
                P.contramap(HS.isSubset(game.cards), Struct_get('cards')),
                constant(B.error(`All guessed cards should be part of the game`)),
            ),

            // TODO validate that the guesser is in the player set
            // TODO validate that the nonRefuters are a subset of the player set
            // TODO validate that the refuter is in the player set
            // TODo validate that the refuteCard is in the full card set
            // TODO validate that the refuteCard is in the guessed set
            // TODO validate that the guesser is not in the nonRefuter set
            // TODO validate that the guesser is not the refuter
            // TODO validate that the refuter is not in the nonRefuter set
        ];
    }),
);
