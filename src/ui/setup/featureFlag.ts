"use client";

import { useEffect, useState } from "react";

/**
 * Feature flag for the M6 setup wizard. **On by default** as of PR-A4
 * — the wizard is the live setup surface for everyone. The legacy
 * `<Checklist inSetup>` path remains in the codebase and is gated
 * behind the same flag set to `"0"`, both for explicit opt-out and
 * to give us a runtime fallback during the rollout window before the
 * legacy path is removed in PR-B.
 *
 * Override channels:
 *
 * - **localStorage:** `effect-clue.flag.setup-wizard.v1 = "0"`
 *   disables (forces the legacy Checklist path); `"1"` enables.
 *   Useful for users who hit a wizard regression and need to fall
 *   back temporarily.
 * - **Module default:** `WIZARD_DEFAULT_ENABLED` constant. PR-B
 *   removes the legacy path entirely; this constant goes away with
 *   the legacy code.
 *
 * The hook is SSR-safe — returns `WIZARD_DEFAULT_ENABLED` on the
 * server and the first client render, then re-renders to pick up the
 * localStorage override after mount. This avoids hydration mismatches
 * between SSR and the client.
 */

const STORAGE_KEY = "effect-clue.flag.setup-wizard.v1";
const ENABLED_VALUE = "1";
const DISABLED_VALUE = "0";

const WIZARD_DEFAULT_ENABLED = true;

function readFlag(): boolean {
    if (typeof window === "undefined") return WIZARD_DEFAULT_ENABLED;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === ENABLED_VALUE) return true;
        if (raw === DISABLED_VALUE) return false;
        return WIZARD_DEFAULT_ENABLED;
    } catch {
        return WIZARD_DEFAULT_ENABLED;
    }
}

export function useSetupWizardEnabled(): boolean {
    const [enabled, setEnabled] = useState(WIZARD_DEFAULT_ENABLED);
    useEffect(() => {
        setEnabled(readFlag());
    }, []);
    return enabled;
}
