import * as B from '@effect/data/Brand';
import * as HS from '@effect/data/HashSet';
import * as E from '@effect/data/Either';
import { flow, pipe } from '@effect/data/Function';
import { Brand_refined } from '../utils/ShouldBeBuiltin';

import * as CardOwner from './CardOwner';

export type CardOwnerSet = B.Branded<HS.HashSet<CardOwner.CardOwner>, 'CardOwnerSet'>;

const CardOwnerSet = B.nominal<CardOwnerSet>();

export const add = (owner: CardOwner.CardOwner): ((owners: CardOwnerSet) => CardOwnerSet) =>
    flow(HS.add(owner), CardOwnerSet);

export type ValidatedCardOwnerSet = CardOwnerSet & B.Brand<'ValidatedCardOwnerSet'>;

export const ValidatedCardOwnerSet = Brand_refined<ValidatedCardOwnerSet>([
    // TODO check that there is at least 1 player and 1 case file? Is that necessary?
]);

export const empty: ValidatedCardOwnerSet = pipe(
    HS.empty(),
    CardOwnerSet,
    ValidatedCardOwnerSet,
    E.getOrThrow,
);
