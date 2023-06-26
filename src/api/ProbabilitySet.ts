
import { D, B, T, CTX } from '../utils/EffectImports';
import { Brand_refinedEffect } from '../utils/Effect';

import * as Card from './Card';
import * as Game from './Game';
import * as CardOwner from './CardOwner';
import * as ConclusionMap from './ConclusionMap';
import * as Combinatorics from './Combinatorics';

export interface ProbabilitySet extends D.Case {
    _tag: "ProbabilitySet";
    ownership: ConclusionMap.ValidatedConclusionMap<D.Data<[CardOwner.CardOwner, Card.ValidatedCard]>, Combinatorics.Probability>;
};

export const ProbabilitySet = D.tagged<ProbabilitySet>("ProbabilitySet");

export type ValidatedProbabilitySetSet = ProbabilitySet & B.Brand<'ValidatedProbabilitySetSet'>;

export const ValidatedProbabilitySetSet = Brand_refinedEffect<ValidatedProbabilitySetSet, Game.Game>(
    T.gen(function* ($) {
        return [
            // TODO validate that all of the probabilities add up to 1 for each card
        ];
    }),
);

export const Tag = CTX.Tag<ValidatedProbabilitySetSet>();
