import * as E from '@effect/data/Either';
import * as H from '@effect/data/Hash';
import * as EQ from "@effect/data/Equal";
import * as ST from "@effect/data/Struct";
import * as S from '@effect/data/String';

export interface Card {
    readonly cardType: string;
    readonly label: string;
}

class CardImpl implements Card, EQ.Equal {
    public static readonly _tag: unique symbol = Symbol("Card");

    constructor(
        public readonly cardType: string,
        public readonly label: string
    ) {
        this.cardType = cardType;
        this.label = label;
    }

    [EQ.symbol](that: EQ.Equal): boolean {
        return (that instanceof CardImpl)
            && ST.getEquivalence({
                cardType: S.Equivalence,
                label: S.Equivalence,
            })(this, that);
    }

    [H.symbol](): number {
        return H.structure({
            ...this
        });
    }
}

export const create = (
    cardType: string,
    label: string,
): E.Either<string, Card> =>
    // TODO maybe actually validate the cards?
    E.right(new CardImpl(
        cardType,
        label,
    ));
