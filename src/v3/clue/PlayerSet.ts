import * as E from '@effect/data/Either';
import * as HS from "@effect/data/HashSet";
import * as ST from "@effect/data/Struct";
import * as CTX from '@effect/data/Context';

import * as Player from './Player';

export interface PlayerSet {
    readonly players: HS.HashSet<Player.Player>;
}

export const Tag = CTX.Tag<PlayerSet>();

export const empty: PlayerSet =
    Object.freeze({
        players: HS.empty(),
    });

export const add = (newPlayer: Player.Player) =>
                (initialSet: PlayerSet):
                PlayerSet =>
    ST.evolve(initialSet, {
        players: HS.add(newPlayer)
    });

export interface ValidatedPlayerSet extends PlayerSet {
    validated: true;
}

export const validate = (playerSet: PlayerSet): E.Either<string[], ValidatedPlayerSet> =>
    E.right(
        // TODO validate the Player set for real

        Object.freeze({
            ...playerSet,
            validated: true,
        })
    );
