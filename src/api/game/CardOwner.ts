import { D, M, P } from '../utils/effect/EffectImports';
import { constFalse, constTrue, pipe } from '@effect/data/Function';

import { Player, CaseFile } from '../objects';

export interface CardOwnerPlayer extends D.Case {
    _tag: "CardOwnerPlayer";
    readonly player: Player.Player;
};

export const CardOwnerPlayer = D.tagged<CardOwnerPlayer>("CardOwnerPlayer");

export interface CardOwnerCaseFile extends D.Case {
    _tag: "CardOwnerCaseFile";
    readonly caseFile: CaseFile.CaseFile;
};

export const CardOwnerCaseFile = D.tagged<CardOwnerCaseFile>("CardOwnerCaseFile");

export type CardOwner = CardOwnerPlayer | CardOwnerCaseFile;

// TODO can Data.Case give this for free?
// https://discord.com/channels/795981131316985866/1080904799857418430/threads/1128729195623751690
export const isPlayer: P.Refinement<CardOwner, CardOwnerPlayer> =
    (ownership): ownership is CardOwnerPlayer =>
        pipe(
            M.value(ownership),
            M.tag('CardOwnerPlayer', constTrue),
            M.tag('CardOwnerCaseFile', constFalse),
            M.exhaustive,
        );

// TODO can Data.Case give this for free?
// https://discord.com/channels/795981131316985866/1080904799857418430/threads/1128729195623751690
export const isCaseFile: P.Refinement<CardOwner, CardOwnerCaseFile> =
    (ownership): ownership is CardOwnerCaseFile =>
        pipe(
            M.value(ownership),
            M.tag('CardOwnerPlayer', constFalse),
            M.tag('CardOwnerCaseFile', constTrue),
            M.exhaustive,
        );
