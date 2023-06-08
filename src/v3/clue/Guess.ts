import * as H from '@effect/data/Hash';
import * as HS from "@effect/data/HashSet";
import * as E from '@effect/data/Either';
import * as EQ from "@effect/data/Equal";
import * as ST from "@effect/data/Struct";
import * as O from '@effect/data/Option';
import * as EQV from '@effect/data/typeclass/Equivalence';

import * as Player from './Player';
import * as Card from './Card';
import { getHashSetEquivalence } from '../utils/ShouldBeBuiltin';

export interface Guess {
    readonly cards: HS.HashSet<Card.Card>;

    readonly guesser: Player.Player;

    readonly nonRefuters: HS.HashSet<Player.Player>;

    readonly refutation: O.Option<{
        refuter: Player.Player;
        card: O.Option<Card.Card>;
    }>;
}

export const Equivalence: EQV.Equivalence<Guess> = ST.getEquivalence({
    cards: getHashSetEquivalence(Card.Equivalence),
    guesser: Player.Equivalence,
    nonRefuters: getHashSetEquivalence(Player.Equivalence),
    refutation: O.getEquivalence(ST.getEquivalence({
        refuter: Player.Equivalence,
        card: O.getEquivalence(Card.Equivalence),
    })),
});

class GuessImpl implements Guess, EQ.Equal {
    public static readonly _tag: unique symbol = Symbol("Guess");

    constructor(
        public readonly cards: HS.HashSet<Card.Card>,
        public readonly guesser: Player.Player,
        public readonly nonRefuters: HS.HashSet<Player.Player>,
        public readonly refutation: O.Option<{
            refuter: Player.Player;
            card: O.Option<Card.Card>;
        }>,
    ) {
    }

    [EQ.symbol](that: EQ.Equal): boolean {
        return (that instanceof GuessImpl) // TODO use a refinement based on the interface, not the class
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
    guesser,
    nonRefuters,
    refutation,
}: {
    readonly cards: HS.HashSet<Card.Card>;
    readonly guesser: Player.Player;
    readonly nonRefuters: HS.HashSet<Player.Player>;
    readonly refutation: O.Option<{
        refuter: Player.Player;
        card: O.Option<Card.Card>;
    }>;
}): E.Either<string, Guess> =>
    // TODO maybe actually validate the cards?
    E.right(new GuessImpl(
        cards,
        guesser,
        nonRefuters,
        refutation,
    ));
