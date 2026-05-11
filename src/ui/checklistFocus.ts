/**
 * Cross-component signal for the Cmd/Ctrl+J shortcut. The global
 * keyboard listener lives in `ClueProvider`, but the focus action has
 * to land on a cell inside `Checklist`. A module-scoped bus with a
 * last-focused memo bridges the gap — pressing ⌘J returns the user to
 * wherever they last were in the grid, or to the first interactive
 * cell if they've never been there.
 *
 * The Hypotheses panel also feeds this bus via the `{ cell }` Target
 * variant: clicking an active-hypothesis row asks Checklist to focus
 * the corresponding cell, scroll it into view, and open its
 * explanation popover (the popover open is owned by `SelectionContext`
 * and dispatched alongside the focus call from the panel side).
 *
 * Parallels `suggestionFormFocus.ts`.
 */

import type { Cell } from "../logic/Knowledge";

type ChecklistFocusTarget =
    | { row: number; col: number }
    | { cell: Cell }
    | "last"
    | "first";
type Handler = (target: ChecklistFocusTarget) => void;

let current: Handler | null = null;
let lastFocused: { row: number; col: number } | null = null;

export function rememberChecklistCell(row: number, col: number): void {
    lastFocused = { row, col };
}

export function registerChecklistFocusHandler(h: Handler): () => void {
    current = h;
    return () => {
        if (current === h) current = null;
    };
}

export function requestFocusChecklistCell(target?: ChecklistFocusTarget): void {
    if (!current) return;
    if (target !== undefined) {
        current(target);
        return;
    }
    // eslint-disable-next-line i18next/no-literal-string -- sentinel, not user copy
    current(lastFocused ?? "first");
}
