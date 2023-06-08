import * as E from '@effect/data/Either';
import * as HS from "@effect/data/HashSet";
import * as ST from "@effect/data/Struct";

import * as Player from './Player';

export interface PlayerSetup {
    readonly players: HS.HashSet<Player.Player>;
}

export const empty: PlayerSetup =
    Object.freeze({
        players: HS.empty(),
    });

export const add = (newPlayer: Player.Player) =>
                (initialSetup: PlayerSetup):
                PlayerSetup =>
    ST.evolve(initialSetup, {
        players: HS.add(newPlayer)
    });

export interface ValidatedPlayerSetup extends PlayerSetup {
    validated: true;
}

export const validate = (playerSetup: PlayerSetup): E.Either<string[], ValidatedPlayerSetup> =>
    E.right(
        // TODO validate the Player setup for real

        Object.freeze({
            ...playerSetup,
            validated: true,
        })
    );
