import { B, D, O, S } from '../utils/EffectImports';
import { flow, constant } from '@effect/data/Function';
import { Brand_refined, Option_fromRefinement, Struct_get } from '../utils/ShouldBeBuiltin';

export interface Player extends D.Case {
    _tag: "Player";
    readonly name: string;
};

export const Player = D.tagged<Player>("Player");

export type ValidatedPlayer = Player & B.Brand<'ValidatedPlayer'>;

export const ValidatedPlayer = Brand_refined<ValidatedPlayer>([
    flow(
        Struct_get('name'),
        Option_fromRefinement(S.isEmpty),
        O.map(constant(B.error(`name should be a non-empty string`))),
    ),
]);
