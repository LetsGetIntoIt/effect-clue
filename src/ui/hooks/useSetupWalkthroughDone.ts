"use client";

import { useEffect, useState } from "react";
import {
    loadGameLifecycleState,
    WALKTHROUGH_EVENT,
} from "../../logic/GameLifecycleState";

/**
 * Reactive view over the per-game "user has finished the setup
 * walkthrough at least once" flag. Drives the wizard's flow → edit
 * mode flip and the global Play CTA's visibility:
 *
 * - First time through: `false`. Wizard runs in linear flow; chrome
 *   shows no Play CTA. The user reaches the wizard's last step
 *   (`inviteOtherPlayers`) and uses its in-card "Start playing"
 *   button to enter Play. That click writes the flag.
 * - Every visit after that: `true`. Wizard is in spot-check edit
 *   mode; the global PlayCTAButton is visible in the chrome.
 *
 * Resets to `false` on `newGame` (handled by
 * `markGameCreated`'s `clear` list).
 *
 * Reads localStorage on mount and on every `WALKTHROUGH_EVENT`
 * dispatched by `writeMerged` — same-tab writes (the common case)
 * propagate via the synthetic event; cross-tab writes propagate via
 * the native `storage` event.
 */
export function useSetupWalkthroughDone(): boolean {
    const [doneAt, setDoneAt] = useState(
        () => loadGameLifecycleState().setupWalkthroughDoneAt,
    );
    useEffect(() => {
        const refresh = () => {
            setDoneAt(loadGameLifecycleState().setupWalkthroughDoneAt);
        };
        window.addEventListener(WALKTHROUGH_EVENT, refresh);
        window.addEventListener("storage", refresh);
        return () => {
            window.removeEventListener(WALKTHROUGH_EVENT, refresh);
            window.removeEventListener("storage", refresh);
        };
    }, []);
    return doneAt !== undefined;
}
