import * as E from '@effect/data/Either';
import * as HS from "@effect/data/HashSet";
import * as ST from "@effect/data/Struct";
import * as EQ from '@effect/data/Equal';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as P from '@effect/data/Predicate';
import * as H from '@effect/data/Hash';
import { pipe } from '@effect/data/Function';

import { HashSet_every, HashSet_getEquivalence, Refinement_and, Refinement_struct, Show, Show_isShow, Show_showHashSet, Show_symbol } from '../utils/ShouldBeBuiltin';

import * as Player from './Player';

type RawPlayerSet = {
    readonly players: HS.HashSet<Player.Player>;
}

export type PlayerSet = EQ.Equal & Show & RawPlayerSet;

export const isPlayerSet: P.Refinement<unknown, PlayerSet> =
    pipe(
        Refinement_struct({
            players: pipe(
                HS.isHashSet,
                P.compose(HashSet_every(Player.isPlayer)),
            ),
        }),

        Refinement_and(EQ.isEqual),
        Refinement_and(Show_isShow),
    );

export const Equivalence: EQV.Equivalence<PlayerSet> = ST.getEquivalence({
    players: HashSet_getEquivalence(Player.Equivalence),
});

export const empty: PlayerSet =
    Object.freeze({
        players: HS.empty(),

        [Show_symbol](): string {
            return Show_showHashSet(this.players);
        },

        [EQ.symbol](that: EQ.Equal): boolean {
            return isPlayerSet(that) && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });

export const add = (newPlayer: Player.Player) =>
                (initialSet: PlayerSet):
                PlayerSet =>
    ST.evolve(initialSet, {
        players: HS.add(newPlayer)
    });

export interface ValidatedPlayerSet extends PlayerSet {
    validated: true;
}

export const validate = (playerSet: PlayerSet): E.Either<string[], ValidatedPlayerSet> =>
    E.right(
        Object.freeze({
            ...playerSet,
            validated: true,
        })
    );
