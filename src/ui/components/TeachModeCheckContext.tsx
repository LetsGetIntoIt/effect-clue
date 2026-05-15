"use client";

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import type { Cell } from "../../logic/Knowledge";
import { cellKey } from "../../logic/TeachMode";

/**
 * Render-time state for the global teach-me Check feature.
 *
 * Two pieces:
 * - `bannerOpen` — is the vague-summary banner currently visible
 *   (between first press of "Check" and dismissing the banner).
 * - `revealActive` — has the user tapped "Show me where" to enable
 *   per-cell verdict outlines on the Checklist.
 *
 * The reveal is transient ephemeral UI — not persisted, dropped on
 * uiMode change or page reload. The reducer doesn't see it.
 *
 * The verdict map is keyed by a stable cell-key string (not the `Cell`
 * Data-class instance) because the producer (`TeachModeCheckBanner`)
 * and the consumer (`Checklist`) build their own Cell instances every
 * render. `Map<Cell, string>` would compare by reference, so the
 * lookup would always miss; the string key uses structural equality.
 */

interface TeachModeCheckState {
    readonly bannerOpen: boolean;
    readonly revealActive: boolean;
    readonly openBanner: () => void;
    readonly closeBanner: () => void;
    readonly enableReveal: () => void;
    readonly verdictForCell: (cell: Cell) => string | undefined;
    readonly setVerdictMap: (
        map: ReadonlyMap<string, string> | undefined,
    ) => void;
}

const Ctx = createContext<TeachModeCheckState | undefined>(undefined);

export function TeachModeCheckProvider({ children }: { readonly children: ReactNode }) {
    const [bannerOpen, setBannerOpen] = useState(false);
    const [revealActive, setRevealActive] = useState(false);
    const [verdictMap, setVerdictMap] = useState<
        ReadonlyMap<string, string> | undefined
    >(undefined);

    const openBanner = useCallback(() => {
        setBannerOpen(true);
        setRevealActive(false);
    }, []);
    const closeBanner = useCallback(() => {
        setBannerOpen(false);
        setRevealActive(false);
        setVerdictMap(undefined);
    }, []);
    const enableReveal = useCallback(() => {
        setRevealActive(true);
    }, []);

    const verdictForCell = useCallback(
        (cell: Cell): string | undefined => {
            if (!revealActive) return undefined;
            return verdictMap?.get(cellKey(cell));
        },
        [revealActive, verdictMap],
    );

    const value = useMemo<TeachModeCheckState>(
        () => ({
            bannerOpen,
            revealActive,
            openBanner,
            closeBanner,
            enableReveal,
            verdictForCell,
            setVerdictMap,
        }),
        [
            bannerOpen,
            revealActive,
            openBanner,
            closeBanner,
            enableReveal,
            verdictForCell,
        ],
    );

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Hoisted error message so the `i18next/no-literal-string` lint rule
// reads it as a code identifier rather than user-facing UI text.
const ERR_TEACH_MODE_CHECK_PROVIDER_MISSING =
     
    "useTeachModeCheck must be used inside <TeachModeCheckProvider>";

export function useTeachModeCheck(): TeachModeCheckState {
    const ctx = useContext(Ctx);
    if (!ctx) {
        throw new Error(ERR_TEACH_MODE_CHECK_PROVIDER_MISSING);
    }
    return ctx;
}
