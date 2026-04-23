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
 * Ephemeral, cross-panel selection + hover state. Separate from
 * `ClueState` because it's purely presentational — we don't want
 * pin/hover to flood the undo history or the localStorage payload, and
 * we don't want it to re-trigger the deducer memo chain in ClueProvider.
 *
 * Two kinds of cross-highlight state live here:
 *  - **Selection (pin)**: persistent on tap. Works on touch and mouse.
 *    `selectedCell` / `selectedSuggestionIndex`. Primary driver of the
 *    ring effect on both devices.
 *  - **Hover (preview)**: transient on mouse hover. Only fires on
 *    `pointerType === 'mouse'` (touch never sets these). `hoveredCell`
 *    / `hoveredSuggestionIndex`.
 *
 * Consumers pick the *active* value — the selection if one is pinned,
 * otherwise the hover — via `activeCell` / `activeSuggestionIndex`,
 * which are derived and returned from the hook for convenience.
 */
interface SelectionContextValue {
    readonly hoveredSuggestionIndex: number | null;
    readonly setHoveredSuggestion: (i: number | null) => void;
    readonly hoveredCell: Cell | null;
    readonly setHoveredCell: (c: Cell | null) => void;
    readonly selectedSuggestionIndex: number | null;
    readonly setSelectedSuggestion: (i: number | null) => void;
    readonly selectedCell: Cell | null;
    readonly setSelectedCell: (c: Cell | null) => void;
    /** Selection takes precedence over hover. */
    readonly activeSuggestionIndex: number | null;
    readonly activeCell: Cell | null;
}

const SelectionContext = createContext<SelectionContextValue | undefined>(
    undefined,
);

export function SelectionProvider({
    children,
}: {
    readonly children: ReactNode;
}) {
    const [hoveredSuggestionIndex, setHovered] = useState<number | null>(null);
    const [hoveredCell, setHoveredCellState] = useState<Cell | null>(null);
    const [selectedSuggestionIndex, setSelectedSuggestion] = useState<
        number | null
    >(null);
    const [selectedCell, setSelectedCell] = useState<Cell | null>(null);

    const setHoveredSuggestion = useCallback((i: number | null) => {
        setHovered(i);
    }, []);
    const setHoveredCell = useCallback((c: Cell | null) => {
        setHoveredCellState(c);
    }, []);

    const value = useMemo<SelectionContextValue>(
        () => ({
            hoveredSuggestionIndex,
            setHoveredSuggestion,
            hoveredCell,
            setHoveredCell,
            selectedSuggestionIndex,
            setSelectedSuggestion,
            selectedCell,
            setSelectedCell,
            activeSuggestionIndex:
                selectedSuggestionIndex ?? hoveredSuggestionIndex,
            activeCell: selectedCell ?? hoveredCell,
        }),
        [
            hoveredSuggestionIndex,
            setHoveredSuggestion,
            hoveredCell,
            setHoveredCell,
            selectedSuggestionIndex,
            selectedCell,
        ],
    );
    return (
        <SelectionContext.Provider value={value}>
            {children}
        </SelectionContext.Provider>
    );
}

export const useSelection = (): SelectionContextValue => {
    const ctx = useContext(SelectionContext);
    if (!ctx) {
        throw new Error(
            // eslint-disable-next-line i18next/no-literal-string
            "useSelection must be used inside <SelectionProvider>",
        );
    }
    return ctx;
};
