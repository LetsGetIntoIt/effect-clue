import { B, HS, CTX } from '../utils/EffectImports';
import { flow } from '@effect/data/Function';
import { Brand_refined } from '../utils/Effect';

import * as Guess from './Guess';

export type GuessSet = B.Branded<HS.HashSet<Guess.ValidatedGuess>, 'GuessSet'>;

export const GuessSet = B.nominal<GuessSet>();

export const empty: GuessSet = GuessSet(HS.empty());

export const add = (owner: Guess.ValidatedGuess): ((owners: GuessSet) => GuessSet) =>
    flow(HS.add(owner), GuessSet);

export type ValidatedGuessSet = GuessSet & B.Brand<'ValidatedGuessSet'>;

export const ValidatedGuessSet = Brand_refined<ValidatedGuessSet>([
    // TODO is there any validation to do on a collection of gueseses that can't be done individually?
]);

export const Tag = CTX.Tag<ValidatedGuessSet>();
