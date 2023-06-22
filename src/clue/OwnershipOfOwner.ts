
import { flow, pipe } from '@effect/data/Function';
import { B, E, HM } from '../utils/EffectImports';
import { Brand_refined } from '../utils/ShouldBeBuiltin';

import * as Card from './Card';

export type OwnershipOfOwner = B.Branded<HM.HashMap<Card.ValidatedCard, boolean>, 'OwnershipOfOwner'>;

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

export const set = (card: Card.ValidatedCard, isOwned: boolean): ((ownership: ValidatedOwnershipOfOwner) => E.Either<B.Brand.BrandErrors, ValidatedOwnershipOfOwner>) =>
    flow(
        HM.set(card, isOwned),
        OwnershipOfOwner,
        ValidatedOwnershipOfOwner,
    );
