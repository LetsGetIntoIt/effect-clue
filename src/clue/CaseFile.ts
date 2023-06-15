import * as E from '@effect/data/Either';
import * as H from '@effect/data/Hash';
import * as EQ from "@effect/data/Equal";
import * as ST from "@effect/data/Struct";
import * as S from '@effect/data/String';
import * as P from '@effect/data/Predicate';
import * as EQV from '@effect/data/typeclass/Equivalence';
import { Equals_getRefinement, Refinement_and, Refinement_struct, Show, Show_isShow, Show_show, Show_symbol } from '../utils/ShouldBeBuiltin';
import { pipe } from '@effect/data/Function';

type RawCaseFile = {
    readonly label: string;
}

export type CaseFile = EQ.Equal & Show & RawCaseFile & {
    readonly _clueTag: 'CaseFile';
};

export const isCaseFile: P.Refinement<unknown, CaseFile> =
    pipe(
        Refinement_struct({
            _clueTag: Equals_getRefinement('CaseFile'),
            label: P.isString,
        }),

        Refinement_and(EQ.isEqual),
        Refinement_and(Show_isShow),
    );

export const Equivalence: EQV.Equivalence<CaseFile> = ST.getEquivalence({
    _clueTag: S.Equivalence,
    label: S.Equivalence,
});

export const create = (
    casefile: RawCaseFile,
): E.Either<string, CaseFile> =>
    E.right({
        _clueTag: 'CaseFile',
        ...casefile,

        [Show_symbol](): string {
            return `${Show_show(this.label)}`;
        },

        [EQ.symbol](that: EQ.Equal): boolean {
            return isCaseFile(that) && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });
