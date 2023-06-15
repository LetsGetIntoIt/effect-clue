import * as E from '@effect/data/Either';
import * as H from '@effect/data/Hash';
import * as EQ from "@effect/data/Equal";
import * as ST from "@effect/data/Struct";
import * as S from '@effect/data/String';
import * as EQV from '@effect/data/typeclass/Equivalence';
import { Refinement_struct, Refinement_and, Show, Show_isShow, Show_symbol, Show_show } from '../utils/ShouldBeBuiltin';
import * as P from '@effect/data/Predicate';
import { pipe } from '@effect/data/Function';

type RawCard = {
    readonly cardType: string;
    readonly label: string;
};

export type Card = EQ.Equal & Show & RawCard;

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
    card: RawCard,
): E.Either<string, Card> =>
    E.right({
        ...card,

        [Show_symbol](): string {
           return `Card '${Show_show(this.label)}' (${Show_show(this.cardType)})`
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
