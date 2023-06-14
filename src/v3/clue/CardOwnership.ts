import * as E from '@effect/data/Either';
import * as H from '@effect/data/Hash';
import * as EQ from "@effect/data/Equal";
import * as ST from "@effect/data/Struct";
import * as S from '@effect/data/String';
import * as EQV from '@effect/data/typeclass/Equivalence';
import { Refinement_struct, Refinement_and, Show, Show_isShow, Show_symbol, Show_show } from '../utils/ShouldBeBuiltin';
import * as P from '@effect/data/Predicate';
import { pipe } from '@effect/data/Function';

import * as Card from "./Card";
import * as CardOwner from "./CardOwner";

type RawCardOnwership = {
    readonly owner: CardOwner.CardOwner;
    readonly card: Card.Card;
};

export type CardOwnership = EQ.Equal & Show & RawCardOnwership;

export const isCardOwnership: P.Refinement<unknown, CardOwnership> =
    pipe(
        Refinement_struct({
            owner: CardOwner.isCardOwner,
            card: Card.isCard,
        }),

        Refinement_and(EQ.isEqual),
        Refinement_and(Show_isShow),
    );

export const Equivalence: EQV.Equivalence<CardOwnership> = ST.getEquivalence({
    owner: CardOwner.Equivalence,
    card: Card.Equivalence,
});

export const create = (
    cardOwnership: RawCardOnwership,
): E.Either<string, CardOwnership> =>
    E.right({
        ...cardOwnership,

        [Show_symbol](): string {
           return `('${Show_show(this.owner)}', ${Show_show(this.card)})`
        },
    
        [EQ.symbol](that: EQ.Equal): boolean {
            return isCardOwnership(that) && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });
