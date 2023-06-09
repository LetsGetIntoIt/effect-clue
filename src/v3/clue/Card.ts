import * as E from '@effect/data/Either';
import * as H from '@effect/data/Hash';
import * as EQ from "@effect/data/Equal";
import * as ST from "@effect/data/Struct";
import * as S from '@effect/data/String';
import * as EQV from '@effect/data/typeclass/Equivalence';
import { Show, Show_symbol } from '../utils/ShouldBeBuiltin';

export interface Card extends EQ.Equal, Show {
    readonly cardType: string;
    readonly label: string;
}

export const Equivalence: EQV.Equivalence<Card> = ST.getEquivalence({
    cardType: S.Equivalence,
    label: S.Equivalence,
});

class CardImpl implements Card {
    public static readonly _tag: unique symbol = Symbol("Card");

    constructor(
        public readonly cardType: string,
        public readonly label: string
    ) {
        this.cardType = cardType;
        this.label = label;
    }

    [Show_symbol](): string {
       return `Card '${this.label}' (${this.cardType})`
    }

    [EQ.symbol](that: EQ.Equal): boolean {
        return (that instanceof CardImpl)  // TODO use a refinement based on the interface, not the class
            && Equivalence(this, that);
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
