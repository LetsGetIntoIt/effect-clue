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

export type CardOwnerCardPair = EQ.Equal & Show & RawCardOnwership;

export const isCardOwnerCardPair: P.Refinement<unknown, CardOwnerCardPair> =
    pipe(
        Refinement_struct({
            owner: CardOwner.isCardOwner,
            card: Card.isCard,
        }),

        Refinement_and(EQ.isEqual),
        Refinement_and(Show_isShow),
    );

export const Equivalence: EQV.Equivalence<CardOwnerCardPair> = ST.getEquivalence({
    owner: CardOwner.Equivalence,
    card: Card.Equivalence,
});

export const create = (
    CardOwnerCardPair: RawCardOnwership,
): E.Either<string, CardOwnerCardPair> =>
    E.right({
        ...CardOwnerCardPair,

        [Show_symbol](): string {
           return `('${Show_show(this.owner)}', ${Show_show(this.card)})`
        },
    
        [EQ.symbol](that: EQ.Equal): boolean {
            return isCardOwnerCardPair(that) && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });

// TODO does this short-hand make sense? Can we reduce the number of properties in each object instead?
export const getOwner = (CardOwnerCardPair: CardOwnerCardPair): CardOwner.CardOwner =>
    CardOwnerCardPair.owner;

// TODO does this short-hand make sense? Can we reduce the number of properties in each object instead?
export const getCard = (CardOwnerCardPair: CardOwnerCardPair): Card.Card =>
    CardOwnerCardPair.card;
