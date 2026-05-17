/**
 * Registers `teach_mode_active` as a PostHog super-property so EVERY
 * event after this mount carries the user's current teach-mode state
 * as a property. PostHog attaches super-properties to subsequent
 * `capture()` calls automatically — no per-event wiring required.
 *
 * This is what lets the PostHog dashboard slice any funnel by teach
 * mode: case-file solve rate, suggestion-logging frequency, $pageview
 * counts, etc. all carry the dimension once it's registered.
 *
 * Re-registers on every change so toggling teach-mode mid-session
 * updates the super-property before the next event ships. The first
 * registration may briefly miss an event fired in the same tick as
 * mount (`useEffect` runs after the first paint); that's acceptable —
 * the dashboard backfills from the second event onward and the
 * `appLoaded` event already carries enough context to identify the
 * boot tick.
 */
"use client";

import { useEffect } from "react";
import { useClue } from "../ui/state";
import { registerSuperProperties } from "./posthog";

export function useTeachModeSuperProperty(): null {
    const { state, hydrated } = useClue();
    useEffect(() => {
        // Wait for hydration so the registered value reflects the
        // user's persisted teach-mode state, not the reducer's
        // pre-hydration default of `false`. Registering before
        // hydration would let a brief `false` ride on the first
        // event after load for a user whose persisted state is `true`.
        if (!hydrated) return;
        registerSuperProperties({ teach_mode_active: state.teachMode });
    }, [hydrated, state.teachMode]);
    return null;
}
