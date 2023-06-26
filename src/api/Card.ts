import { D, B, S, P } from '../utils/EffectImports';
import { constant } from '@effect/data/Function';
import { Brand_refined, Either_fromPredicate, Struct_get } from '../utils/Effect';

export interface Card extends D.Case {
    _tag: "Card";
    readonly cardType: string;
    readonly label: string;
};

export const Card = D.tagged<Card>("Card");

export type ValidatedCard = Card & B.Brand<'ValidatedCard'>;

export const ValidatedCard = Brand_refined<ValidatedCard>([
    Either_fromPredicate(
        P.contramap(S.isNonEmpty, Struct_get('cardType')),
        constant(B.error(`cardType should be a non-empty string`)),
    ),

    Either_fromPredicate(
        P.contramap(S.isNonEmpty, Struct_get('label')),
        constant(B.error(`label should be a non-empty string`)),
    ),
]);
