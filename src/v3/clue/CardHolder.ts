import * as M from '@effect/match';
import * as EQ from '@effect/data/Equal';
import { constant, pipe } from '@effect/data/Function';

import * as Player from "./Player";
import { Show, Show_show, Show_symbol } from '../utils/ShouldBeBuiltin';

type RawCardHolder =
    | {
        _cardHolderTag: 'player',
        player: Player.Player;
    }
    | {
        _cardHolderTag: 'caseFile',
    };

export type CardHolder = EQ.Equal & Show & RawCardHolder;

const createInternal = (cardHolder: RawCardHolder): CardHolder =>
    ({
        ...cardHolder,

        [Show_symbol](): string {
            return pipe(
                M.value(cardHolder),
                M.when({ _cardHolderTag: 'player' }, ({ player }) => Show_show(player)),
                M.when({ _cardHolderTag: 'caseFile' }, () => `CaseFile`),
                M.exhaustive,
            )
        },

        [EQ.symbol](that: EQ.Equal): boolean {
            return true;
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });

export const createPlayer = (player: Player.Player): CardHolder =>
    createInternal({
        _cardHolderTag: 'player',
        player,
    });

export const caseFile: CardHolder =
    createInternal({
        _cardHolderTag: 'caseFile',
    });
