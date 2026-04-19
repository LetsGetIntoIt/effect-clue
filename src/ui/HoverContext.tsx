"use client";

import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useMemo,
    useState,
} from "react";

/**
 * Ephemeral, cross-panel hover state. Separate from `ClueState` because
 * it's purely presentational — we don't want hover to flood the undo
 * history or the localStorage payload, and we don't want it to
 * re-trigger the deducer memo chain in ClueProvider.
 *
 * Currently just tracks a single "hovered suggestion index" (the one the
 * user's pointer is over, anywhere in the UI). ChecklistGrid cells read
 * this to decide whether to render a highlight ring when the cell's
 * provenance chain references that suggestion; PriorSuggestions writes
 * it on mouseenter / mouseleave.
 */
interface HoverContextValue {
    readonly hoveredSuggestionIndex: number | null;
    readonly setHoveredSuggestion: (i: number | null) => void;
}

const HoverContext = createContext<HoverContextValue | undefined>(undefined);

export function HoverProvider({ children }: { children: ReactNode }) {
    const [hoveredSuggestionIndex, setHovered] = useState<number | null>(null);
    const setHoveredSuggestion = useCallback((i: number | null) => {
        setHovered(i);
    }, []);
    const value = useMemo<HoverContextValue>(
        () => ({ hoveredSuggestionIndex, setHoveredSuggestion }),
        [hoveredSuggestionIndex, setHoveredSuggestion],
    );
    return (
        <HoverContext.Provider value={value}>
            {children}
        </HoverContext.Provider>
    );
}

export const useHover = (): HoverContextValue => {
    const ctx = useContext(HoverContext);
    if (!ctx) {
        throw new Error("useHover must be used inside <HoverProvider>");
    }
    return ctx;
};
