import * as EQ from '@effect/data/Equal';
import * as P from '@effect/data/Predicate';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as ST from '@effect/data/Struct';
import * as H from '@effect/data/Hash';
import { pipe } from '@effect/data/Function';

import { Refinement_and, Refinement_struct, Show, Show_isShow, Show_show, Show_symbol } from '../utils/ShouldBeBuiltin';

import * as CardSet from "./CardSet";
import * as PlayerSet from "./PlayerSet";

type RawGameSetup = {
    cardSet: CardSet.CardSet;
    playerSet: PlayerSet.PlayerSet;
};

export type GameSetup = EQ.Equal & Show & RawGameSetup;

export const isGameSetup: P.Refinement<unknown, GameSetup> =
    pipe(
        Refinement_struct({
            cardSet: CardSet.isCardSet,
            playerSet: PlayerSet.isPlayerSet,
        }),

        Refinement_and(EQ.isEqual),
        Refinement_and(Show_isShow),
    );

export const Equivalence: EQV.Equivalence<GameSetup> = ST.getEquivalence({
    cardSet: CardSet.Equivalence,
    playerSet: PlayerSet.Equivalence,
});

const create = (gameSetup: RawGameSetup): GameSetup =>
    ({
        ...gameSetup,

        [Show_symbol](): string {
            return `Game setup with cards ${Show_show(this.cardSet)} and players ${Show_show(this.playerSet)}`;
        },

        [EQ.symbol](that: EQ.Equal): boolean {
            return isGameSetup(that) && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });
