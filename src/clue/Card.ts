import { D, B, S, O } from '../utils/EffectImports';
import { flow, constant } from '@effect/data/Function';
import { Brand_refined, Option_fromRefinement, Struct_get } from '../utils/ShouldBeBuiltin';

export interface Card extends D.Case {
    _tag: "Card";
    readonly cardType: string;
    readonly label: string;
};

export const Card = D.tagged<Card>("Card");

export type ValidatedCard = Card & B.Brand<'ValidatedCard'>;

export const ValidatedCard = Brand_refined<ValidatedCard>([
    flow(
        Struct_get('cardType'),
        Option_fromRefinement(S.isEmpty),
        O.map(constant(B.error(`cardType should be a non-empty string`))),
    ),

    flow(
        Struct_get('label'),
        Option_fromRefinement(S.isEmpty),
        O.map(constant(B.error(`label should be a non-empty string`))),
    ),
]);
