"use client";

import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useMemo,
    useState,
} from "react";
import type { Cell } from "../logic/Knowledge";

/**
 * Ephemeral, cross-panel hover state. Separate from `ClueState` because
 * it's purely presentational — we don't want hover to flood the undo
 * history or the localStorage payload, and we don't want it to
 * re-trigger the deducer memo chain in ClueProvider.
 *
 * Two directions of cross-highlight:
 *  - `hoveredSuggestionIndex`: set by `PriorSuggestions` on row hover;
 *    `Checklist` reads it to ring cells whose provenance chain
 *    references that suggestion.
 *  - `hoveredCell`: set by `Checklist` cells on hover; `PriorSuggestions`
 *    reads it and walks the chain in reverse, highlighting any
 *    suggestion rows the cell's deduction depends on.
 */
interface HoverContextValue {
    readonly hoveredSuggestionIndex: number | null;
    readonly setHoveredSuggestion: (i: number | null) => void;
    readonly hoveredCell: Cell | null;
    readonly setHoveredCell: (c: Cell | null) => void;
}

const HoverContext = createContext<HoverContextValue | undefined>(undefined);

export function HoverProvider({ children }: { children: ReactNode }) {
    const [hoveredSuggestionIndex, setHovered] = useState<number | null>(null);
    const [hoveredCell, setHoveredCellState] = useState<Cell | null>(null);
    const setHoveredSuggestion = useCallback((i: number | null) => {
        setHovered(i);
    }, []);
    const setHoveredCell = useCallback((c: Cell | null) => {
        setHoveredCellState(c);
    }, []);
    const value = useMemo<HoverContextValue>(
        () => ({
            hoveredSuggestionIndex,
            setHoveredSuggestion,
            hoveredCell,
            setHoveredCell,
        }),
        [
            hoveredSuggestionIndex,
            setHoveredSuggestion,
            hoveredCell,
            setHoveredCell,
        ],
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
