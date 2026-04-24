import { describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Card, Player, PlayerOwner } from "../logic/GameObjects";
import { Cell } from "../logic/Knowledge";
import { SelectionProvider, useSelection } from "./SelectionContext";

const wrapper = ({ children }: { children: ReactNode }) => (
    <SelectionProvider>{children}</SelectionProvider>
);

const cell = Cell(PlayerOwner(Player("P")), Card("w:rope"));

describe("SelectionContext — popoverCell drives activeCell", () => {
    test("defaults to null", () => {
        const { result } = renderHook(() => useSelection(), { wrapper });
        expect(result.current.popoverCell).toBeNull();
        expect(result.current.activeCell).toBeNull();
    });

    test("setPopoverCell(cell) → popoverCell === activeCell === cell", () => {
        const { result } = renderHook(() => useSelection(), { wrapper });
        act(() => result.current.setPopoverCell(cell));
        expect(result.current.popoverCell).toEqual(cell);
        expect(result.current.activeCell).toEqual(cell);
    });

    test("setPopoverCell(null) clears both", () => {
        const { result } = renderHook(() => useSelection(), { wrapper });
        act(() => result.current.setPopoverCell(cell));
        act(() => result.current.setPopoverCell(null));
        expect(result.current.popoverCell).toBeNull();
        expect(result.current.activeCell).toBeNull();
    });
});

describe("SelectionContext — suggestion-log cross-highlight is unchanged", () => {
    test("activeSuggestionIndex = selected ?? hovered, selected wins", () => {
        const { result } = renderHook(() => useSelection(), { wrapper });
        act(() => result.current.setHoveredSuggestion(2));
        expect(result.current.activeSuggestionIndex).toBe(2);
        act(() => result.current.setSelectedSuggestion(5));
        expect(result.current.activeSuggestionIndex).toBe(5);
        act(() => result.current.setSelectedSuggestion(null));
        expect(result.current.activeSuggestionIndex).toBe(2);
    });
});
