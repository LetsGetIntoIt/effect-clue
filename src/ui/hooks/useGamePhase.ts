"use client";

import { getGamePhase, type GamePhase } from "../../logic/GamePhase";
import { useClue } from "../state";

/**
 * Hook over the central game-phase state machine. Returns one of
 * `"new" | "dirty" | "setupCompleted" | "gameStarted"` derived
 * synchronously from the live `ClueState`. Cheap — `getGamePhase` is
 * a handful of length checks, no memoisation needed.
 *
 * See {@link getGamePhase} for the phase semantics.
 */
export function useGamePhase(): GamePhase {
    const { state } = useClue();
    return getGamePhase(state);
}
