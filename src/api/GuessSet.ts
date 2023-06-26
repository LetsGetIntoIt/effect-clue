import { B, HS, CTX, E } from './utils/EffectImports';
import { flow, pipe } from '@effect/data/Function';
import { Brand_refined } from './utils/Effect';

import * as Guess from './Guess';

export type GuessSet = B.Branded<HS.HashSet<Guess.ValidatedGuess>, 'GuessSet'>;

export const GuessSet = B.nominal<GuessSet>();

export const add = (owner: Guess.ValidatedGuess): ((owners: GuessSet) => GuessSet) =>
    flow(HS.add(owner), GuessSet);

export type ValidatedGuessSet = GuessSet & B.Brand<'ValidatedGuessSet'>;

export const ValidatedGuessSet = Brand_refined<ValidatedGuessSet>([
    // TODO is there any validation to do on a collection of gueseses that can't be done individually?
]);

export const empty: ValidatedGuessSet =
    pipe(
        HS.empty(),
        GuessSet,
        ValidatedGuessSet,
        E.getOrThrow,
    );

export const Tag = CTX.Tag<ValidatedGuessSet>();
