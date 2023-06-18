import * as D from '@effect/data/Data';
import * as CTX from '@effect/data/Context';

import * as CardSet from "./CardSet";
import * as CardOwnerSet from "./CardOwnerSet";

export interface Game extends D.Case {
    _tag: 'Game';
    readonly cards: CardSet.ValidatedCardSet;
    readonly owners: CardOwnerSet.ValidatedCardOwnerSet;
};

export const Game = D.tagged<Game>("Game");

export const Tag = CTX.Tag<Game>();

export const empty: Game = Game({
    cards: CardSet.empty,
    owners: CardOwnerSet.empty,
});
