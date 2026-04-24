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
 * Cross-highlight state:
 *  - **Suggestion log → checklist cells:** `hoveredSuggestionIndex`
 *    (mouse hover, desktop-only) + `selectedSuggestionIndex` (tap/click
 *    pin). `activeSuggestionIndex = selected ?? hovered`.
 *  - **Checklist cells → suggestion log:** `popoverCell` is the cell
 *    whose "why" popover is currently visible (opened by delayed hover,
 *    click, tap, or keyboard activation, closed by the hover-intent
 *    decay or explicit dismiss). `activeCell = popoverCell` — we
 *    deliberately do NOT highlight suggestions on raw cell hover, only
 *    when the user has signalled intent by causing the popover to open.
 */
interface SelectionContextValue {
    readonly hoveredSuggestionIndex: number | null;
    readonly setHoveredSuggestion: (i: number | null) => void;
    readonly selectedSuggestionIndex: number | null;
    readonly setSelectedSuggestion: (i: number | null) => void;
    readonly popoverCell: Cell | null;
    readonly setPopoverCell: (c: Cell | null) => void;
    /** Selection takes precedence over hover (suggestion log only). */
    readonly activeSuggestionIndex: number | null;
    /**
     * The cell whose "why" popover is currently visible. Drives the
     * suggestion→cell cross-highlight. `null` when no popover is open.
     */
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
    const [selectedSuggestionIndex, setSelectedSuggestion] = useState<
        number | null
    >(null);
    const [popoverCell, setPopoverCellState] = useState<Cell | null>(null);

    const setHoveredSuggestion = useCallback((i: number | null) => {
        setHovered(i);
    }, []);
    const setPopoverCell = useCallback((c: Cell | null) => {
        setPopoverCellState(c);
    }, []);

    const value = useMemo<SelectionContextValue>(
        () => ({
            hoveredSuggestionIndex,
            setHoveredSuggestion,
            selectedSuggestionIndex,
            setSelectedSuggestion,
            popoverCell,
            setPopoverCell,
            activeSuggestionIndex:
                selectedSuggestionIndex ?? hoveredSuggestionIndex,
            activeCell: popoverCell,
        }),
        [
            hoveredSuggestionIndex,
            setHoveredSuggestion,
            selectedSuggestionIndex,
            popoverCell,
            setPopoverCell,
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
