import * as D from '@effect/data/Data';
import * as B from '@effect/data/Brand';
import * as O from '@effect/data/Option';
import * as HS from '@effect/data/HashSet';
import * as P from '@effect/data/Predicate';
import * as T from '@effect/io/Effect';
import { Brand_refinedEffect, Option_fromPredicate, Struct_get } from '../utils/ShouldBeBuiltin';

import * as Card from './Card';
import * as Player from './Player';
import * as Game from './Game';
import { constant, flow } from '@effect/data/Function';

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
            flow(
                Struct_get('cards'),

                Option_fromPredicate(
                    // Check if the guessed cards are NOT a subset of all the cards in the game
                    P.not(HS.isSubset(game.cards)),
                ),

                O.map(constant(B.error(`All guessed cards should be part of the game`))),
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
