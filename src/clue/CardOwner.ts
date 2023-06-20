import { D } from '../utils/EffectImports';

import * as Player from './Player';
import * as CaseFile from './CaseFile';

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
