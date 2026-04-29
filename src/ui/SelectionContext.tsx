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
 *  - **Accusation log → checklist cells:** `hoveredAccusationIndex`
 *    (mouse hover, desktop-only). `activeAccusationIndex = hovered`
 *    today — accusations don't have a tap/click pin yet because the
 *    only deductions they drive are case-file Ns and the row→cells
 *    mapping is unambiguous.
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
    readonly hoveredAccusationIndex: number | null;
    readonly setHoveredAccusation: (i: number | null) => void;
    readonly popoverCell: Cell | null;
    readonly setPopoverCell: (c: Cell | null) => void;
    /** Selection takes precedence over hover (suggestion log only). */
    readonly activeSuggestionIndex: number | null;
    /**
     * Active accusation index for the cross-highlight. No selection
     * pin yet, so this just mirrors hover.
     */
    readonly activeAccusationIndex: number | null;
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
    const [hoveredAccusationIndex, setHoveredAccusationState] = useState<
        number | null
    >(null);
    const [popoverCell, setPopoverCellState] = useState<Cell | null>(null);

    const setHoveredSuggestion = useCallback((i: number | null) => {
        setHovered(i);
    }, []);
    const setHoveredAccusation = useCallback((i: number | null) => {
        setHoveredAccusationState(i);
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
            hoveredAccusationIndex,
            setHoveredAccusation,
            popoverCell,
            setPopoverCell,
            activeSuggestionIndex:
                selectedSuggestionIndex ?? hoveredSuggestionIndex,
            activeAccusationIndex: hoveredAccusationIndex,
            activeCell: popoverCell,
        }),
        [
            hoveredSuggestionIndex,
            setHoveredSuggestion,
            selectedSuggestionIndex,
            hoveredAccusationIndex,
            setHoveredAccusation,
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
