import * as D from '@effect/data/Data';
import * as CTX from '@effect/data/Context';

import * as CardSet from "./CardSet";
import * as CardOwnerSet from "./CardOwnerSet";

export interface GameSetup extends D.Case {
    _tag: 'GameSetup';
    readonly cards: CardSet.ValidatedCardSet;
    readonly owners: CardOwnerSet.ValidatedCardOwnerSet;
};

export const GameSetup = D.tagged<GameSetup>("GameSetup");

export const Tag = CTX.Tag<GameSetup>();

export const empty: GameSetup = GameSetup({
    cards: CardSet.empty,
    owners: CardOwnerSet.empty,
});
