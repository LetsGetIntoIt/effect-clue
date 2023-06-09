import * as Player from "./Player";

export type CardHolder =
    | {
        _cardHolderTag: 'player',
        player: Player.Player;
    }
    | {
        _cardHolderTag: 'player',
    };
