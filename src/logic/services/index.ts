import { Layer } from "effect";
import type { GameSetup } from "../GameSetup";
import {
    CardSetService,
    getCardSet,
    makeCardSetLayer,
} from "./CardSetService";
import {
    PlayerSetService,
    getPlayerSet,
    makePlayerSetLayer,
} from "./PlayerSetService";

export { CardSetService, getCardSet, makeCardSetLayer };
export { PlayerSetService, getPlayerSet, makePlayerSetLayer };

/**
 * One-stop layer: provides both setup halves from a concrete
 * GameSetup. Consumers that need the pair `yield*` both services
 * side-by-side in an `Effect.gen`. Pure helpers like `allOwners` and
 * `defaultHandSizes` stay in `GameSetup.ts` — they're one-liners
 * that don't benefit from DI, and the composite service this replaces
 * was just double-exposing them.
 */
export const makeSetupLayer = (setup: GameSetup) =>
    Layer.mergeAll(
        makeCardSetLayer(setup.cardSet),
        makePlayerSetLayer(setup.playerSet),
    );
