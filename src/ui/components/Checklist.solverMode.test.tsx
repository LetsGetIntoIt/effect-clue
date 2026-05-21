import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { HashMap } from "effect";
import { createElement, forwardRef } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// -----------------------------------------------------------------------
// Mocks — same shape as Checklist.deduce.test.tsx, plus stubs for the
// tour and teach-mode-check providers so we don't have to mount the
// full Clue shell. We only care that `<Checklist />` installs its
// window keydown listener under our ClueProvider + SelectionProvider.
// -----------------------------------------------------------------------

vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    (t as unknown as { rich: unknown }).rich = (key: string): string => key;
    return {
        useTranslations: () => t,
        useLocale: () => "en",
    };
});

vi.mock("../hooks/useIsDesktop", () => ({
    useIsDesktop: () => true,
}));

vi.mock("../hooks/useHasKeyboard", () => ({
    useHasKeyboard: () => true,
}));

vi.mock("../hooks/useConfetti", () => ({
    useConfetti: () => ({ fireConfetti: () => {} }),
}));

vi.mock("../hooks/useReducedTransition", () => ({
    useReducedTransition: () => false,
}));

vi.mock("motion/react", () => {
    const motion = new Proxy(
        {},
        {
            get: (_t, tag: string) =>
                forwardRef(
                    (
                        props: Record<string, unknown>,
                        ref: React.Ref<HTMLElement>,
                    ) => {
                        const {
                            layout: _layout,
                            layoutId: _layoutId,
                            initial: _initial,
                            animate: _animate,
                            exit: _exit,
                            transition: _transition,
                            variants: _variants,
                            custom: _custom,
                            whileHover: _whileHover,
                            whileTap: _whileTap,
                            ...rest
                        } = props;
                        return createElement(tag, { ...rest, ref });
                    },
                ),
        },
    );
    return {
        motion,
        AnimatePresence: ({ children }: { children: ReactNode }) => children,
        useReducedMotion: () => false,
        LayoutGroup: ({ children }: { children: ReactNode }) => children,
    };
});

// Stub the tour provider — Checklist reads `currentStep` for cell-tour
// gating, but the keydown gates under test don't depend on any tour
// state.
vi.mock("../tour/TourProvider", () => ({
    useTour: () => ({ currentStep: undefined }),
}));

// Stub the teach-mode-check context — Checklist calls
// `useCheckBanner()` for the toolbar's "Check my work" flow, which
// is unrelated to the keydown gates this file verifies.
vi.mock("./CheckBannerContext", () => ({
    useCheckBanner: () => ({
        verdictForCell: () => undefined,
        runCheck: () => {},
        banner: null,
        clearBanner: () => {},
    }),
}));

import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { PlayerOwner } from "../../logic/GameObjects";
import { Cell, N, Y } from "../../logic/Knowledge";
import { cardByName } from "../../logic/test-utils/CardByName";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { SelectionProvider, useSelection } from "../SelectionContext";
import { ClueProvider, useClue } from "../state";
import { Checklist } from "./Checklist";

const setup = CLASSIC_SETUP_3P;
const PLAYER_1 = setup.players[0]!;
const KNIFE = cardByName(setup, "Knife");
const cell = Cell(PlayerOwner(PLAYER_1), KNIFE);

const makeWrapper = () => {
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <TestQueryClientProvider>
            <ClueProvider>
                <SelectionProvider>
                    {children}
                    <Checklist />
                </SelectionProvider>
            </ClueProvider>
        </TestQueryClientProvider>
    );
    return Wrapper;
};

const renderUnderProvider = () => {
    const wrapper = makeWrapper();
    return renderHook(
        () => ({
            clue: useClue(),
            sel: useSelection(),
        }),
        { wrapper },
    );
};

// Locate a checklist cell (`<td>`) by the (cell card, owner index). The
// `data-cell-row` / `data-cell-col` attributes are written by the
// Checklist render so the test can target the same cell the production
// keydown handler reads via `document.activeElement`. We pick the
// first interactive cell on the Knife row + Player 1 column.
//
// jsdom doesn't resolve implicit ARIA roles on `<th>`, so we walk
// `<tr>` elements directly and match on the first cell's text.
const findKnifePlayer1Cell = (): HTMLElement | null => {
    const rows = document.querySelectorAll<HTMLTableRowElement>("tr");
    for (const tr of rows) {
        const firstTh = tr.querySelector<HTMLTableCellElement>("th");
        if (firstTh?.textContent?.includes("Knife")) {
            return tr.querySelector<HTMLElement>(
                "[data-cell-row][data-cell-col='0']",
            );
        }
    }
    return null;
};

const enableTeachMode = (
    h: ReturnType<typeof renderUnderProvider>,
    teach: boolean,
) => {
    act(() => {
        h.result.current.clue.dispatch({ type: "setSetup", setup });
    });
    act(() => {
        h.result.current.clue.dispatch({
            type: "setSolverMode",
            mode: teach ? "check" : "solve",
        });
    });
    // Move out of setup mode so the focused-cell fallback gate
    // (`uiMode !== "setup"`) lets through Y/N/O on the focused cell.
    act(() => {
        h.result.current.clue.dispatch({
            type: "setUiMode",
            mode: "checklist",
        });
    });
};

beforeEach(() => {
    window.localStorage.clear();
    // The URL drives `setUiMode` via the ClueProvider hydration
    // effect — without clearing it, a previous test's setUiMode call
    // bleeds the `?view=` param into the next mount.
    window.history.replaceState(null, "", "/");
});

afterEach(() => {
    // Defensive unmount + DOM clear so stale Checklists from previous
    // renders can't shadow the `findKnifePlayer1Cell` lookup.
    cleanup();
    document.body.innerHTML = "";
});

describe("Checklist keyboard — teach mode dispatches setUserDeduction (not setHypothesis)", () => {
    test("Y with the popover open in teach mode sets a USER DEDUCTION, not a hypothesis", () => {
        const h = renderUnderProvider();
        enableTeachMode(h, true);
        act(() => {
            h.result.current.sel.setPopoverCell(cell);
        });

        act(() => {
            fireEvent.keyDown(window, { key: "y" });
        });

        expect(HashMap.size(h.result.current.clue.state.hypotheses)).toBe(0);
        expect(
            HashMap.get(h.result.current.clue.state.userDeductions, cell),
        ).toMatchObject({ _tag: "Some", value: Y });
    });

    test("N with the popover open in teach mode sets the user mark to N", () => {
        const h = renderUnderProvider();
        enableTeachMode(h, true);
        act(() => {
            h.result.current.sel.setPopoverCell(cell);
        });

        act(() => {
            fireEvent.keyDown(window, { key: "n" });
        });

        expect(
            HashMap.get(h.result.current.clue.state.userDeductions, cell),
        ).toMatchObject({ _tag: "Some", value: N });
    });

    test("O with the popover open in teach mode clears any existing user mark", () => {
        const h = renderUnderProvider();
        enableTeachMode(h, true);
        // Seed a Y mark on the cell.
        act(() => {
            h.result.current.clue.dispatch({
                type: "setUserDeduction",
                cell,
                value: Y,
            });
        });
        act(() => {
            h.result.current.sel.setPopoverCell(cell);
        });

        act(() => {
            fireEvent.keyDown(window, { key: "o" });
        });

        expect(
            HashMap.get(h.result.current.clue.state.userDeductions, cell),
        ).toMatchObject({ _tag: "None" });
    });
});

describe("Checklist keyboard — teach mode + focused-cell fallback (panel closed)", () => {
    test("Y on a focused cell with NO popover open marks that focused cell", () => {
        const h = renderUnderProvider();
        enableTeachMode(h, true);
        // No popover. Focus the Knife / Player 1 cell directly.
        const focusEl = findKnifePlayer1Cell();
        expect(focusEl).not.toBeNull();
        act(() => {
            focusEl!.focus();
        });
        expect(document.activeElement).toBe(focusEl);

        act(() => {
            fireEvent.keyDown(window, { key: "y" });
        });

        // The mark landed on the focused cell (Knife / Player 1).
        expect(
            HashMap.get(h.result.current.clue.state.userDeductions, cell),
        ).toMatchObject({ _tag: "Some", value: Y });
        // No hypothesis was set anywhere.
        expect(HashMap.size(h.result.current.clue.state.hypotheses)).toBe(0);
    });

    test("Y on a non-cell focused element is a no-op (focused-cell ref doesn't leak)", () => {
        const h = renderUnderProvider();
        enableTeachMode(h, true);
        // First focus a cell to populate `focusedCellRef`.
        const focusEl = findKnifePlayer1Cell();
        expect(focusEl).not.toBeNull();
        act(() => {
            focusEl!.focus();
        });
        // Now move focus off the cell onto a button — the handler
        // verifies activeElement is a checklist cell at keypress time,
        // so the ref's stale value must not bleed through.
        const stranger = document.createElement("button");
        document.body.appendChild(stranger);
        act(() => {
            stranger.focus();
        });
        expect(document.activeElement).toBe(stranger);

        act(() => {
            fireEvent.keyDown(window, { key: "y" });
        });

        expect(
            HashMap.size(h.result.current.clue.state.userDeductions),
        ).toBe(0);
        document.body.removeChild(stranger);
    });

    test("Y with no popover AND no focused cell is a no-op", () => {
        const h = renderUnderProvider();
        enableTeachMode(h, true);
        // Don't focus any cell. document.activeElement is body.

        act(() => {
            fireEvent.keyDown(window, { key: "y" });
        });

        expect(
            HashMap.size(h.result.current.clue.state.userDeductions),
        ).toBe(0);
        expect(HashMap.size(h.result.current.clue.state.hypotheses)).toBe(0);
    });

    test("Y on a focused cell in SETUP mode is a no-op (focused-cell fallback gated on uiMode)", () => {
        const h = renderUnderProvider();
        // Enable teach mode but leave uiMode at the default "setup".
        act(() => {
            h.result.current.clue.dispatch({ type: "setSetup", setup });
        });
        act(() => {
            h.result.current.clue.dispatch({
                type: "setSolverMode",
                mode: "check",
            });
        });
        // Explicitly assert we're in setup mode.
        expect(h.result.current.clue.state.uiMode).toBe("setup");

        const focusEl = findKnifePlayer1Cell();
        expect(focusEl).not.toBeNull();
        act(() => {
            focusEl!.focus();
        });

        act(() => {
            fireEvent.keyDown(window, { key: "y" });
        });

        expect(
            HashMap.size(h.result.current.clue.state.userDeductions),
        ).toBe(0);
    });
});

describe("Checklist keyboard — non-teach mode behavior unchanged", () => {
    test("Y with the popover open OUTSIDE teach mode still sets a hypothesis", () => {
        const h = renderUnderProvider();
        enableTeachMode(h, false);
        act(() => {
            h.result.current.sel.setPopoverCell(cell);
        });

        act(() => {
            fireEvent.keyDown(window, { key: "y" });
        });

        expect(
            HashMap.get(h.result.current.clue.state.hypotheses, cell),
        ).toMatchObject({ _tag: "Some", value: "Y" });
    });

    test("Y on a focused cell with no popover in NON-teach mode is a no-op (no fallback)", () => {
        const h = renderUnderProvider();
        enableTeachMode(h, false);
        const focusEl = findKnifePlayer1Cell();
        expect(focusEl).not.toBeNull();
        act(() => {
            focusEl!.focus();
        });

        act(() => {
            fireEvent.keyDown(window, { key: "y" });
        });

        // No hypothesis dispatched — the non-teach branch requires
        // popoverCell !== null. Focused-cell fallback is teach-mode only.
        expect(HashMap.size(h.result.current.clue.state.hypotheses)).toBe(0);
        expect(
            HashMap.size(h.result.current.clue.state.userDeductions),
        ).toBe(0);
    });
});
