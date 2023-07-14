import { S, TU } from '../utils/effect/EffectImports';
import { pipe } from '@effect/data/Function';

export const Schema = pipe(
    // Validate the input
    S.tuple(
        pipe(
            // Validate the input
            S.string,
            S.trim,
            S.nonEmpty({ message: () => `Case file label cannot be blank` }),

            // Document
            S.identifier('caseFileLabel'),
            S.title('CaseFile name'),
            S.description('The name of the caseFile'),
            S.examples(['Murder', 'Case file']),
        ),
    ),

    // Transform to an object
    S.transform(
        S.struct({
            label: pipe(S.string, S.identifier('caseFileLabel')),
        }),

        ([label]) => ({ label }),
        ({ label }) => TU.tuple(label),
    ),

    // Provide Equals implementation and brand
    S.data,
    S.brand('CaseFile'),

    // Document
    S.title('CaseFile'),
    S.description('A case file in the game. At the beginning of the game, some unknown set of card are put into this case file. Players spend the rest fo the game trying to figure out which cards are in here.'),
    S.examples(['Case file', 'Murder']),
);

export type Serialized = S.From<typeof Schema>;
export type CaseFile = S.To<typeof Schema>;

export const decodeEither = S.decodeEither(Schema);
export const decodeSync = S.decodeSync(Schema);

export const is = S.is(Schema);

export const standard = decodeSync(['Case file']);
