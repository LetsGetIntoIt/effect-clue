/**
 * Cross-component signal for the Cmd/Ctrl+J shortcut. The global
 * keyboard listener lives in `ClueProvider`, but the focus action has
 * to land on a cell inside `Checklist`. A module-scoped bus with a
 * last-focused memo bridges the gap — pressing ⌘J returns the user to
 * wherever they last were in the grid, or to the first interactive
 * cell if they've never been there.
 *
 * Parallels `suggestionFormFocus.ts`.
 */

type Target = { row: number; col: number } | "last" | "first";
type Handler = (target: Target) => void;

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

export function requestFocusChecklistCell(): void {
    if (!current) return;
    // eslint-disable-next-line i18next/no-literal-string -- sentinel, not user copy
    current(lastFocused ?? "first");
}
