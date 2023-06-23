import { D, B, S, O, E, P } from '../utils/EffectImports';
import { flow, constant, pipe } from '@effect/data/Function';
import { Brand_refined, Either_fromPredicate, Option_fromRefinement, Struct_get } from '../utils/Effect';

export interface CaseFile extends D.Case {
    _tag: "CaseFile";
    readonly label: string;
};

export const CaseFile = D.tagged<CaseFile>("CaseFile");

export type ValidatedCaseFile = CaseFile & B.Brand<'ValidatedCaseFile'>;

export const ValidatedCaseFile = Brand_refined<ValidatedCaseFile>([
    Either_fromPredicate(
        P.contramap(S.isNonEmpty, Struct_get('label')),
        constant(B.error(`label should be a non-empty string`)),
    ),
]);

export const standard: ValidatedCaseFile =
    pipe(
        CaseFile({ label: 'Murder' }),
        ValidatedCaseFile,
        E.getOrThrow,
    );
