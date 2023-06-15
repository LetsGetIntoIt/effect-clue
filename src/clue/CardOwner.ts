import * as M from '@effect/match';
import * as EQ from '@effect/data/Equal';
import * as P from '@effect/data/Predicate';
import * as S from '@effect/data/String';
import * as H from '@effect/data/Hash';
import * as ST from '@effect/data/Struct';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as O from '@effect/data/Option';
import { constant, pipe } from '@effect/data/Function';

import { Refinement_struct, Refinement_and, Show, Show_isShow, Show_show, Show_symbol } from '../utils/ShouldBeBuiltin';

import * as Player from "./Player";
import * as CaseFile from './CaseFile';

type RawCardOwner =
    | {
        _cardOwnerTag: 'player',
        player: Player.Player;
    }
    | {
        _cardOwnerTag: 'caseFile',
        caseFile: CaseFile.CaseFile,
    };

export type CardOwner = EQ.Equal & Show & RawCardOwner;

export const isCardOwner: P.Refinement<unknown, CardOwner> =
    pipe(
        Refinement_struct({
            _cardOwnerTag: P.isString,
            player: Player.isPlayer,
            caseFile: CaseFile.isCaseFile,
        }),

        Refinement_and(EQ.isEqual),
        Refinement_and(Show_isShow),
    );

export const Equivalence: EQV.Equivalence<CardOwner> = ST.getEquivalence({
    _cardOwnerTag: S.Equivalence,
    player: EQV.contramap(
        O.getEquivalence(Player.Equivalence),
        O.fromNullable<Player.Player | undefined>,
    ),
    caseFile: EQV.contramap(
        O.getEquivalence(CaseFile.Equivalence),
        O.fromNullable<CaseFile.CaseFile | undefined>,
    ),
});

const create = (cardOwner: RawCardOwner): CardOwner =>
    ({
        ...cardOwner,

        [Show_symbol]: constant(pipe(
            M.value(cardOwner),
            M.when({ _cardOwnerTag: 'player' }, ({ player }) => Show_show(player)),
            M.when({ _cardOwnerTag: 'caseFile' }, () => `CaseFile`),
            M.exhaustive,
        )),

        [EQ.symbol](that: EQ.Equal): boolean {
            return isCardOwner(that) && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });

export const createPlayer = (player: Player.Player): CardOwner =>
    create({
        _cardOwnerTag: 'player',
        player,
    });

export const createCaseFile = (caseFile: CaseFile.CaseFile): CardOwner =>
    create({
        _cardOwnerTag: 'caseFile',
        caseFile,
    });
