import { S, TU } from '../utils/effect/EffectImports';
import { pipe } from '@effect/data/Function';

export const Schema = pipe(
    // Validate the input
    S.tuple(
        pipe(
            // Validate the input
            S.string,
            S.trim,
            S.nonEmpty({ message: () => `Card type cannot be blank` }),

            // Document
            S.identifier('cardType'),
            S.title('Card type'),
            S.description('The category of the card'),
            S.examples(['Suspect', 'Weapon', 'Room']),
        ),

        pipe(
            // Validate the input
            S.string,
            S.trim,
            S.nonEmpty({ message: () => `Card label cannot be blank` }),

            // Document
            S.identifier('cardLabel'),
            S.title('Card label'),
            S.description('The identifying name of the card'),
            S.examples(['Col. Mustard', 'Wrench', 'Conservatory']),
        ),
    ),

    // Transform to an object
    S.transform(
        S.struct({
            cardType: pipe(S.string, S.identifier('cardType')),
            label: pipe(S.string, S.identifier('cardLabel')),
        }),

        ([cardType, label]) => ({ cardType, label }),
        ({ cardType, label }) => TU.tuple(cardType, label),
    ),

    // Provide Equals implementation and brand
    S.data,
    S.brand('Card'),

    // Document
    S.title('Card'),
    S.description('A card to be used in the game. These are put in the case file, dealt to players, guessed, used to refute guesses, etc.'),
    S.examples(['Col. Mustard (Suspect)', 'Wrench (Weapon)', 'Conservatory (Room)']),
);

export type Serialized = S.From<typeof Schema>;
export type Card = S.To<typeof Schema>;

export const decodeEither = S.decodeEither(Schema);
export const decodeSync = S.decodeSync(Schema);
