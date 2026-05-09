"use client";

import { useEffect, useState } from "react";

/**
 * Feature flag for the M6 setup wizard. Off by default — the
 * `<Checklist inSetup>` legacy path keeps rendering. The flag exists
 * as a code-organization aid so PR-A2/A3 can ship the wizard plumbing
 * without exposing it; PR-A4 flips the default once the wizard is
 * complete.
 *
 * Two override channels for local development before that happens:
 *
 * - **localStorage:** `effect-clue.flag.setup-wizard.v1 = "1"` enables;
 *   `"0"` disables. Set this in DevTools and reload to test the wizard.
 *   The localStorage value wins over the default — useful for the
 *   "pause for me to test" workflow during PR-A2.
 *
 * - **Module default:** `WIZARD_DEFAULT_ENABLED` constant. Flipping it
 *   to `true` enables the wizard for everyone with no localStorage
 *   override. PR-A4 flips this.
 *
 * The hook is SSR-safe — returns `WIZARD_DEFAULT_ENABLED` on the
 * server and the first client render, then re-renders to pick up the
 * localStorage override after mount. This avoids hydration mismatches
 * between SSR and the client.
 */

const STORAGE_KEY = "effect-clue.flag.setup-wizard.v1";
const ENABLED_VALUE = "1";
const DISABLED_VALUE = "0";

const WIZARD_DEFAULT_ENABLED = false;

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
