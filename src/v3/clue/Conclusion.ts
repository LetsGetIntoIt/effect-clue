import * as H from '@effect/data/Hash';
import * as HS from "@effect/data/HashSet";
import * as E from '@effect/data/Either';
import * as EQ from "@effect/data/Equal";
import * as ST from "@effect/data/Struct";
import * as O from '@effect/data/Option';
import * as EQV from '@effect/data/typeclass/Equivalence';

import { HashSet_getEquivalence, Show } from '../utils/ShouldBeBuiltin';

import * as Player from './Player';
import * as Card from './Card';
import * as CardHolder from './CardHolder';

interface Reason extends EQ.Equal, Show {
    level: 'observed' | 'inferred';
    description: string;
}

type Conclusion = EQ.Equal & Show & (
    | {
        _conclusionTag: 'numOwned';
        player: Player.Player;
        numOwned: number;
    }
    | {
        _conclusionTag: 'cardOwnedBy';
        holder: CardHolder.CardHolder;
        card: Card.Card;
    }
);

export const Equivalence: EQV.Equivalence<Conclusion> = ST.getEquivalence({
    cards: HashSet_getEquivalence(Card.Equivalence),
    Conclusioner: Player.Equivalence,
    nonRefuters: HashSet_getEquivalence(Player.Equivalence),
    refutation: O.getEquivalence(ST.getEquivalence({
        refuter: Player.Equivalence,
        card: O.getEquivalence(Card.Equivalence),
    })),
});

class ConclusionImpl implements Conclusion, EQ.Equal {
    public static readonly _tag: unique symbol = Symbol("Conclusion");

    constructor(
        public readonly cards: HS.HashSet<Card.Card>,
        public readonly Conclusioner: Player.Player,
        public readonly nonRefuters: HS.HashSet<Player.Player>,
        public readonly refutation: O.Option<{
            refuter: Player.Player;
            card: O.Option<Card.Card>;
        }>,
    ) {
    }

    [EQ.symbol](that: EQ.Equal): boolean {
        return (that instanceof ConclusionImpl) // TODO use a refinement based on the interface, not the class
                && Equivalence(this, that);
    }

    [H.symbol](): number {
        return H.structure({
            ...this
        });
    }
}

export const create = ({
    cards,
    Conclusioner,
    nonRefuters,
    refutation,
}: {
    readonly cards: HS.HashSet<Card.Card>;
    readonly Conclusioner: Player.Player;
    readonly nonRefuters: HS.HashSet<Player.Player>;
    readonly refutation: O.Option<{
        refuter: Player.Player;
        card: O.Option<Card.Card>;
    }>;
}): E.Either<string, Conclusion> =>
    // TODO maybe actually validate the cards?
    E.right(new ConclusionImpl(
        cards,
        Conclusioner,
        nonRefuters,
        refutation,
    ));
