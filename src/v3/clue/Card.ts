import * as E from '@effect/data/Either';
import * as H from '@effect/data/Hash';
import * as EQ from "@effect/data/Equal";
import * as ST from "@effect/data/Struct";
import * as S from '@effect/data/String';
import * as EQV from '@effect/data/typeclass/Equivalence';
import { Refinement_struct, Refinement_and, Show, Show_isShow, Show_symbol } from '../utils/ShouldBeBuiltin';
import * as P from '@effect/data/Predicate';
import { pipe } from '@effect/data/Function';

export interface Card extends EQ.Equal, Show {
    readonly cardType: string;
    readonly label: string;
}

export const isCard: P.Refinement<unknown, Card> =
    pipe(
        Refinement_struct({
            cardType: P.isString,
            label: P.isString,
        }),

        Refinement_and(EQ.isEqual),
        Refinement_and(Show_isShow),
    );

export const Equivalence: EQV.Equivalence<Card> = ST.getEquivalence({
    cardType: S.Equivalence,
    label: S.Equivalence,
});

export const create = (
    cardType: string,
    label: string,
): E.Either<string, Card> =>
    // TODO maybe actually validate the cards?
    E.right({
        cardType,
        label,

        [Show_symbol](): string {
           return `Card '${this.label}' (${this.cardType})`
        },
    
        [EQ.symbol](that: EQ.Equal): boolean {
            return isCard(that)
                && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });
