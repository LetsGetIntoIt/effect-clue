import { Data } from "effect";
import { Player } from "./GameObjects";

/**
 * The "who's playing" half of a game setup. Separate from `CardSet`
 * (categories + cards) so user-saved card-pack presets can persist
 * only the deck and the player roster can flex freely across games.
 */
class PlayerSetImpl extends Data.Class<{
    readonly players: ReadonlyArray<Player>;
}> {}

export type PlayerSet = PlayerSetImpl;

export const PlayerSet = (params: {
    readonly players: ReadonlyArray<Player>;
}): PlayerSet => new PlayerSetImpl(params);
