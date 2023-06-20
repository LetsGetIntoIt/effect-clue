import * as D from '@effect/data/Data';
import * as HS from '@effect/data/HashSet';
import * as CTX from '@effect/data/Context';

import * as CardSet from "./CardSet";
import * as PlayerSet from "./PlayerSet";
import * as CaseFile from './CaseFile';
import * as CardOwner from './CardOwner';

export interface Game extends D.Case {
    _tag: 'Game';
    readonly cards: CardSet.ValidatedCardSet;
    readonly players: PlayerSet.ValidatedPlayerSet;
    readonly caseFile: CaseFile.ValidatedCaseFile;
};

export const Game = D.tagged<Game>("Game");

export const Tag = CTX.Tag<Game>();

export const emptyStandard: Game = Game({
    cards: CardSet.empty,
    players: PlayerSet.empty,
    caseFile: CaseFile.standard,
});

// TODO how to make this a cached and calculated prop on the object itself?
export const owners = (game: Game): HS.HashSet<CardOwner.CardOwner> => {
    const playerOwners = HS.map(game.players, player => CardOwner.CardOwnerPlayer({
        player,
    }));

    const caseFileOwner = CardOwner.CardOwnerCaseFile({
        caseFile: game.caseFile,
    });

    return HS.add<CardOwner.CardOwner>(playerOwners, caseFileOwner);
}
