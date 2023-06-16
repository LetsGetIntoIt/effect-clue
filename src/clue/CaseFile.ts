import * as D from '@effect/data/Data';
import * as B from '@effect/data/Brand';
import * as O from '@effect/data/Option';
import * as S from '@effect/data/String';
import { constant, flow } from '@effect/data/Function';
import { Brand_refined, Option_fromRefinement, Struct_get } from '../utils/ShouldBeBuiltin';

export interface CaseFile extends D.Case {
    _tag: "CaseFile";
    readonly label: string;
};

export const CaseFile = D.tagged<CaseFile>("CaseFile");

export type ValidatedCaseFile = CaseFile & B.Brand<'ValidatedCaseFile'>;

export const ValidatedCaseFile = Brand_refined<ValidatedCaseFile>([
    flow(
        Struct_get('label'),
        Option_fromRefinement(S.isEmpty),
        O.map(constant(B.error(`label should be a non-empty string`))),
    ),
]);
