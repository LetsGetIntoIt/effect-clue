import * as H from '@effect/data/Hash';
import * as HS from "@effect/data/HashSet";
import * as E from '@effect/data/Either';
import * as EQ from "@effect/data/Equal";
import * as ST from "@effect/data/Struct";
import * as O from '@effect/data/Option';
import * as P from '@effect/data/Predicate';
import * as EQV from '@effect/data/typeclass/Equivalence';
import { pipe } from '@effect/data/Function';

import { HashSet_every, Option_getRefinement, Refinement_and, Refinement_struct } from '../utils/ShouldBeBuiltin';

import * as Player from './Player';
import * as Card from './Card';

type RawGuess = {
    readonly cards: HS.HashSet<Card.Card>;

    readonly guesser: Player.Player;

    readonly nonRefuters: HS.HashSet<Player.Player>;

    readonly refutation: O.Option<{
        refuter: Player.Player;
        card: O.Option<Card.Card>;
    }>;
}

export type Guess = EQ.Equal & RawGuess;

export const isGuess: P.Refinement<unknown, Guess> =
    pipe(
        Refinement_struct({
            cards: pipe(
                HS.isHashSet,
                P.compose(HashSet_every(Card.isCard)),
            ),
            
            guesser: Player.isPlayer,
            
            nonRefuters: pipe(
                HS.isHashSet,
                P.compose(HashSet_every(Player.isPlayer)),
            ),

            refutation: pipe(
                O.isOption,
                P.compose(Option_getRefinement(Refinement_struct({
                    refuter: Player.isPlayer,
                    card: pipe(
                        O.isOption,
                        P.compose(Option_getRefinement(Card.isCard)),
                    ),
                }))),
            ),
        }),

        Refinement_and(EQ.isEqual),
    );

export const Equivalence: EQV.Equivalence<Guess> = ST.getEquivalence({
    cards: EQ.equivalence(),
    guesser: Player.Equivalence,
    nonRefuters: EQ.equivalence(),
    refutation: O.getEquivalence(ST.getEquivalence({
        refuter: Player.Equivalence,
        card: O.getEquivalence(Card.Equivalence),
    })),
});

export const create = (guess: RawGuess): E.Either<string, Guess> =>
    E.right({
        ...guess,

        toString() {
            return `Guess by ${this.guesser} of ${this.cards} NOT refuted by ${this.nonRefuters} with refutation ${this.refutation}`;
        },

        [EQ.symbol](that: EQ.Equal): boolean {
            return isGuess(that) && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        }
    });
