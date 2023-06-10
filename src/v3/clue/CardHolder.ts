import * as M from '@effect/match';
import * as EQ from '@effect/data/Equal';
import * as P from '@effect/data/Predicate';
import * as S from '@effect/data/String';
import * as H from '@effect/data/Hash';
import * as ST from '@effect/data/Struct';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as O from '@effect/data/Option';
import { constant, pipe } from '@effect/data/Function';

import { Predicate_Refinement_struct, Refinement_and, Show, Show_isShow, Show_show, Show_symbol } from '../utils/ShouldBeBuiltin';

import * as Player from "./Player";

type RawCardHolder =
    | {
        _cardHolderTag: 'player',
        player: Player.Player;
    }
    | {
        _cardHolderTag: 'caseFile',
    };

export type CardHolder = EQ.Equal & Show & RawCardHolder;

export const isCardHolder: P.Refinement<unknown, CardHolder> =
    pipe(
        // TODO fix this
        Predicate_Refinement_struct({
            _cardHolderTag: P.isString,
            player: Player.isPlayer,
        }),

        Refinement_and(EQ.isEqual),
        Refinement_and(Show_isShow),
    );

// TODO fix this
export const Equivalence: EQV.Equivalence<CardHolder> = ST.getEquivalence({
    _cardHolderTag: S.Equivalence,
    player: EQV.contramap(
        O.getEquivalence(Player.Equivalence),
        O.fromNullable<Player.Player | undefined>,
    ),
});

const create = (cardHolder: RawCardHolder): CardHolder =>
    ({
        ...cardHolder,

        [Show_symbol]: constant(pipe(
            M.value(cardHolder),
            M.when({ _cardHolderTag: 'player' }, ({ player }) => Show_show(player)),
            M.when({ _cardHolderTag: 'caseFile' }, () => `CaseFile`),
            M.exhaustive,
        )),

        [EQ.symbol](that: EQ.Equal): boolean {
            return isCardHolder(that) && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });

export const createPlayer = (player: Player.Player): CardHolder =>
    create({
        _cardHolderTag: 'player',
        player,
    });

export const caseFile: CardHolder =
    create({
        _cardHolderTag: 'caseFile',
    });
