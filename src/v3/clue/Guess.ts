import * as H from '@effect/data/Hash';
import * as HS from "@effect/data/HashSet";
import * as E from '@effect/data/Either';
import * as EQ from "@effect/data/Equal";
import * as ST from "@effect/data/Struct";
import * as O from '@effect/data/Option';
import * as P from '@effect/data/Predicate';
import * as EQV from '@effect/data/typeclass/Equivalence';
import { pipe } from '@effect/data/Function';

import { Equal_isEqual, HashSet_every, HashSet_getEquivalence, Predicate_Refinement_struct, Show, Show_isShow, Show_show, Show_showHashSet, Show_showOption, Show_symbol } from '../utils/ShouldBeBuiltin';

import * as Player from './Player';
import * as Card from './Card';

export interface Guess extends EQ.Equal, Show {
    readonly cards: HS.HashSet<Card.Card>;

    readonly guesser: Player.Player;

    readonly nonRefuters: HS.HashSet<Player.Player>;

    readonly refutation: O.Option<{
        refuter: Player.Player;
        card: O.Option<Card.Card>;
    }>;
}

export const isGuess: P.Refinement<unknown, Guess> =
    pipe(
        Predicate_Refinement_struct({
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
                
                // TODO
            ),
        }),

        P.compose(Equal_isEqual),
        P.compose(Show_isShow),
    );

export const Equivalence: EQV.Equivalence<Guess> = ST.getEquivalence({
    cards: HashSet_getEquivalence(Card.Equivalence),
    guesser: Player.Equivalence,
    nonRefuters: HashSet_getEquivalence(Player.Equivalence),
    refutation: O.getEquivalence(ST.getEquivalence({
        refuter: Player.Equivalence,
        card: O.getEquivalence(Card.Equivalence),
    })),
});

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
    E.right({
        cards,
        guesser,
        nonRefuters,
        refutation,

        [Show_symbol](): string {
            return `Guess by ${Show_show(this.guesser)} of ${Show_showHashSet(this.cards)} NOT refuted by ${Show_showHashSet(this.nonRefuters)} with refutation ${Show_showOption(this.refutation)}`
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
