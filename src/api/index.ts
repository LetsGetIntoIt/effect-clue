import type {
    Card as CardInternal,
    Player as PlayerInternal,
    CaseFile as CaseFileInternal,
    Guess as  GuessInternal,
} from './objects';

type Card = CardInternal.Serialized;
type Player = PlayerInternal.Serialized;
type CaseFile = CaseFileInternal.Serialized;
type Guess =  GuessInternal.Serialized;

export type {
    Card,
    Player,
    CaseFile,
    Guess,
};

import type {
    DeductionRule as DeductionRuleInternal
} from './logic';

type DeductionRule = DeductionRuleInternal.Name;

export type {
    DeductionRule,
};

export {
    type ApiOutput,
    run,
} from './Api';
