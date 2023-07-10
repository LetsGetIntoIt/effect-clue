import { S } from '../utils/effect/EffectImports';
import { pipe } from '@effect/data/Function';

import * as Card from './Card';
import * as Player from './Player';

export const Schema = pipe(
    // Validate the input
    S.struct({
        cards: pipe(
            S.readonlySet(Card.Schema),

            // Document
            S.identifier('cards'),
            S.title('Cards'),
            S.description('The cards that were guessed. There should be one card of every type'),
        ),

        guesser: pipe(
            Player.Schema,

            // Document
            S.identifier('guesser'),
            S.title('Guesser'),
            S.description('The player who made this guess'),
        ),

        nonRefuters: pipe(
            S.readonlySet(Player.Schema),

            // Document
            S.identifier('nonRefuters'),
            S.title('Non-refuters'),
            S.description('The players who were given the opportunity to refute this guess, but were unable to do so.'),
        ),

        refutation: pipe(
            S.optionFromNullable(S.struct({
                refuter: pipe(
                    Player.Schema,

                    // Document
                    S.identifier('refuter'),
                    S.title('Refuter'),
                    S.description('The player who refuted this guess'),
                ),

                card: pipe(
                    S.optionFromNullable(Card.Schema),

                    // Document
                    S.identifier('refuteCard'),
                    S.title('Refute card'),
                    S.description('The card used to refute this guess, if known.'),
                ),
            })),

            // Document
            S.identifier('refutation'),
            S.title('Refutation'),
            S.description('The player and card that refuted this guess, if any.'),
        ),
    }),

    // Provide Equals implementation and brand
    S.data,
    S.brand('Guess'),

    // Document
    S.title('Guess'),
    S.description('A guess in the game. These are usually humans, who hold a hand of guesss, move pieces on the board, and make guesses about the case file.'),
    S.examples(['Anisha', 'Bob', 'Cho']),
);

export type Serialized = S.From<typeof Schema>;
export type Guess = S.To<typeof Schema>;

export const decodeEither = S.decodeEither(Schema);
export const decode = S.decode(Schema);
