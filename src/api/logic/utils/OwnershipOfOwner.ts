
import { flow, pipe } from '@effect/data/Function';
import { B, E, HM } from '../../utils/effect/EffectImports';
import { Brand_refined } from '../../utils/effect/Effect';

import { Card } from '../../objects';

export type OwnershipOfOwner = B.Branded<HM.HashMap<Card.Card, boolean>, 'OwnershipOfOwner'>;

export const OwnershipOfOwner = B.nominal<OwnershipOfOwner>();

export type ValidatedOwnershipOfOwner = OwnershipOfOwner & B.Brand<'OwnershipOfOwner'>;

export const ValidatedOwnershipOfOwner = Brand_refined<ValidatedOwnershipOfOwner>([
    // TODO validate that the owned and unowned 
]);

export const empty: ValidatedOwnershipOfOwner =
    pipe(
        HM.empty(),
        OwnershipOfOwner,
        ValidatedOwnershipOfOwner,
        E.getOrThrow,
    );

export const set = (card: Card.Card, isOwned: boolean): ((ownership: ValidatedOwnershipOfOwner) => E.Either<B.Brand.BrandErrors, ValidatedOwnershipOfOwner>) =>
    flow(
        HM.set(card, isOwned),
        OwnershipOfOwner,
        ValidatedOwnershipOfOwner,
    );
