import * as M from '@effect/match';
import { pipe } from '@effect/data/Function';

import * as Player from "./Player";
import { Show_show } from '../utils/ShouldBeBuiltin';

export type CardHolder =
    | {
        _cardHolderTag: 'player',
        player: Player.Player;
    }
    | {
        _cardHolderTag: 'caseFile',
    };

export const show: (cardHolder: CardHolder) => string =
    pipe(
        M.type<CardHolder>(),
        M.when({ _cardHolderTag: 'player' }, ({ player }) => Show_show(player)),
        M.when({ _cardHolderTag: 'caseFile' }, () => `CaseFile`),
        M.exhaustive,
    );
