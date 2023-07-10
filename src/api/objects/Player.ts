import { S, TU } from '../utils/effect/EffectImports';
import { pipe } from '@effect/data/Function';

export const Schema = pipe(
    // Validate the input
    S.tuple(
        pipe(
            // Validate the input
            S.string,
            S.trim,
            S.nonEmpty({ message: () => `Player name cannot be blank` }),

            // Document
            S.identifier('playerName'),
            S.title('Player name'),
            S.description('The name of the player'),
            S.examples(['Anisha', 'Bob', 'Cho']),
        ),
    ),

    // Transform to an object
    S.transform(
        S.struct({
            name: pipe(S.string, S.identifier('playerName')),
        }),

        ([name]) => ({ name }),
        ({ name }) => TU.tuple(name),
    ),

    // Provide Equals implementation and brand
    S.data,
    S.brand('Player'),

    // Document
    S.title('Player'),
    S.description('A player in the game. These are usually humans, who hold a hand of players, move pieces on the board, and make guesses about the case file.'),
    S.examples(['Anisha', 'Bob', 'Cho']),
);

export type Serialized = S.From<typeof Schema>;
export type Player = S.To<typeof Schema>;

export const decodeEither = S.decodeEither(Schema);
export const decode = S.decode(Schema);
