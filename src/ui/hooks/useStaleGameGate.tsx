/**
 * Owns the stale-game prompt's open/close logic. The
 * `<StartupCoordinatorProvider>` decides whether the slot is active
 * (eligibility + ordering); this hook just translates that into the
 * data the modal needs (variant, reference timestamp, "now") and
 * wires the two exit paths back to the coordinator.
 *
 * Two exit paths:
 *  - `setupNewGame()` — wipes the current game and switches to the
 *    setup pane. Calls `markGameCreated` via the dispatch wrapper so
 *    a fresh `createdAt` is stamped immediately.
 *  - `keepWorking()` — snoozes the gate for `STALE_GAME_SNOOZE` so
 *    we don't re-prompt on every page load.
 *
 * Both call `reportClosed("staleGame")` to advance the coordinator's
 * phase (which in turn re-evaluates tour and install).
 */
"use client";

import { DateTime } from "effect";
import { useCallback, useMemo } from "react";
import {
    loadGameLifecycleState,
    markStaleGameSnoozed,
} from "../../logic/GameLifecycleState";
import { useStartupCoordinator } from "../onboarding/StartupCoordinator";
import { useClue } from "../state";
import {
    STALE_GAME_VARIANT_STARTED,
    STALE_GAME_VARIANT_UNSTARTED,
    type StaleGameVariant,
} from "../components/StaleGameModal";

const SLOT_STALE_GAME = "staleGame" as const;

interface UseStaleGameGateValue {
    readonly open: boolean;
    readonly variant: StaleGameVariant;
    readonly referenceTimestamp: DateTime.Utc;
    readonly now: DateTime.Utc;
    readonly setupNewGame: () => void;
    readonly keepWorking: () => void;
}

export function useStaleGameGate(): UseStaleGameGateValue {
    const { phase, reportClosed } = useStartupCoordinator();
    const { state, dispatch } = useClue();

    const open = phase === SLOT_STALE_GAME;

    const gameStarted =
        state.knownCards.length > 0
        || state.suggestions.length > 0
        || state.accusations.length > 0;

    // Snapshot the lifecycle timestamps + "now" once per open. Memoize
    // on `open` so the modal's body copy doesn't re-stringify each
    // render while the prompt is up — that's load-bearing for the
    // `useMemo` inside `<StaleGameModal>` that consumes
    // `referenceTimestamp` + `now`.
    const snapshot = useMemo(() => {
        if (!open) return null;
        const now = DateTime.nowUnsafe();
        const lifecycle = loadGameLifecycleState();
        const variant: StaleGameVariant = gameStarted
            ? STALE_GAME_VARIANT_STARTED
            : STALE_GAME_VARIANT_UNSTARTED;
        const reference = gameStarted
            ? lifecycle.lastModifiedAt
            : lifecycle.createdAt;
        // Defensive — coordinator already checked these are defined,
        // but if lifecycle was wiped between the eligibility check
        // and this render, fall back to `now` so the modal still
        // renders coherent copy.
        return {
            variant,
            referenceTimestamp: reference ?? now,
            now,
        };
        // Snapshot is intentionally captured at the open-edge only;
        // re-running the memo when `gameStarted` flips mid-prompt
        // would change the body copy from under the user. The lint
        // for stale captures isn't enabled in this project — see
        // `eslint.config.mjs`.
    }, [open]);

    const keepWorking = useCallback(() => {
        markStaleGameSnoozed(DateTime.nowUnsafe());
        reportClosed(SLOT_STALE_GAME);
    }, [reportClosed]);

    const setupNewGame = useCallback(() => {
        // newGame's reducer resets state AND flips uiMode to setup
        // (setup is the default in the new state). The dispatch
        // wrapper in `state.tsx` calls `markGameCreated` so the
        // fresh createdAt is stamped immediately.
        dispatch({ type: "newGame" });
        dispatch({ type: "setUiMode", mode: "setup" });
        reportClosed(SLOT_STALE_GAME);
    }, [dispatch, reportClosed]);

    // Sentinel timestamps used only when `open === false` — the modal
    // renders nothing in that case, so the values never reach the DOM.
    const placeholder = DateTime.makeUnsafe(new Date(0));
    return {
        open,
        variant: snapshot?.variant ?? STALE_GAME_VARIANT_UNSTARTED,
        referenceTimestamp: snapshot?.referenceTimestamp ?? placeholder,
        now: snapshot?.now ?? placeholder,
        setupNewGame,
        keepWorking,
    };
}
