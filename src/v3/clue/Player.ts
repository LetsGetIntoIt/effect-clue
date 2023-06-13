import * as E from '@effect/data/Either';
import * as H from '@effect/data/Hash';
import * as EQ from "@effect/data/Equal";
import * as ST from "@effect/data/Struct";
import * as S from '@effect/data/String';
import * as P from '@effect/data/Predicate';
import * as EQV from '@effect/data/typeclass/Equivalence';
import { Equal_isEqual, Refinement_struct, Show, Show_isShow, Show_symbol } from '../utils/ShouldBeBuiltin';
import { pipe } from '@effect/data/Function';

export interface Player extends EQ.Equal, Show {
    readonly label: string;
}

export const isPlayer: P.Refinement<unknown, Player> =
    pipe(
        Refinement_struct({
            label: P.isString,
        }),

        P.compose(Equal_isEqual),
        P.compose(Show_isShow),
    );

export const Equivalence: EQV.Equivalence<Player> = ST.getEquivalence({
    label: S.Equivalence,
});

export const create = (
    label: string,
): E.Either<string, Player> =>
    E.right({
        label,

        [Show_symbol](): string {
            return this.label;
        },
    
        [EQ.symbol](that: EQ.Equal): boolean {
            return isPlayer(that) && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });
