import { B, D, O, P, S } from './utils/EffectImports';
import { flow, constant } from '@effect/data/Function';
import { Brand_refined, Either_fromPredicate, Option_fromRefinement, Struct_get } from './utils/Effect';

export interface Player extends D.Case {
    _tag: "Player";
    readonly name: string;
};

export const Player = D.tagged<Player>("Player");

export type ValidatedPlayer = Player & B.Brand<'ValidatedPlayer'>;

export const ValidatedPlayer = Brand_refined<ValidatedPlayer>([
    Either_fromPredicate(
        P.contramap(S.isNonEmpty, Struct_get('name')),
        constant(B.error(`carnamedType should be a non-empty string`)),
    ),
]);
