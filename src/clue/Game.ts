import * as EQ from '@effect/data/Equal';
import * as P from '@effect/data/Predicate';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as ST from '@effect/data/Struct';
import * as H from '@effect/data/Hash';
import * as CTX from '@effect/data/Context';
import { pipe } from '@effect/data/Function';
import * as HS from '@effect/data/HashSet';

import { Refinement_and, Refinement_struct, Show, Show_isShow, Show_show, Show_symbol } from '../utils/ShouldBeBuiltin';

import * as Card from './Card';
import * as GameSetup from "./GameSetup";
import * as GuessSet from "./GuessSet";
import * as CardOwner from './CardOwner';

type RawGame = {
    gameSetup: GameSetup.GameSetup;
    guessSet: GuessSet.GuessSet;
};

export type Game = EQ.Equal & Show & RawGame;

export const Tag = CTX.Tag<Game>();

export const isGame: P.Refinement<unknown, Game> =
    pipe(
        Refinement_struct({
            gameSetup: GameSetup.isGameSetup,
            guessSet: GuessSet.isGuessSet,
        }),

        Refinement_and(EQ.isEqual),
        Refinement_and(Show_isShow),
    );

export const Equivalence: EQV.Equivalence<Game> = ST.getEquivalence({
    gameSetup: GameSetup.Equivalence,
    guessSet: GuessSet.Equivalence,
});

export const create = (game: RawGame): Game =>
    ({
        ...game,

        [Show_symbol](): string {
            return `Game with setup ${Show_show(this.gameSetup)} and guesses ${Show_show(this.guessSet)}`;
        },

        [EQ.symbol](that: EQ.Equal): boolean {
            return isGame(that) && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });

export const empty: Game =
    create({
        gameSetup: GameSetup.empty,
        guessSet: GuessSet.empty,
    });

// TODO does this short-hand make sense? Can we reduce the number of properties in each object instead?
export const getCards = (game: Game): HS.HashSet<Card.Card> =>
    game.gameSetup.cards.cards;

// TODO does this short-hand make sense? Can we reduce the number of properties in each object instead?
export const getCardOwners = (game: Game): HS.HashSet<CardOwner.CardOwner> =>
    game.gameSetup.owners.owners;
