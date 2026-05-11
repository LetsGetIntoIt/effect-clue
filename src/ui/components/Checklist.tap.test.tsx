import { beforeEach, describe, expect, test, vi } from "vitest";
import { forwardRef, createElement } from "react";
import type { ReactNode } from "react";

// -----------------------------------------------------------------------
// Mocks — same shape as Checklist.deduce.test.tsx so the Clue shell
// mounts cleanly under jsdom without animations or i18n loaders.
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

import { fireEvent, render, waitFor } from "@testing-library/react";
import { Clue } from "../Clue";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { seedOnboardingDismissed } from "../../test-utils/onboardingSeed";

// Session shape pinned by `effect-clue.session.v6`: Player 1 holds 5
// of 6 suspects, so the case-file deduces Plum, every Player 1 suspect
// cell deduces Y, every non-P1 suspect cell deduces N, and every
// non-Plum case-file cell deduces N. Net effect: all cells in the 6
// suspect rows are popover-interactive, giving us multiple cells per
// row (for same-row tests) and cells across distinct rows (for
// cross-row tests).
const SEEDED_SESSION = {
    version: 6,
    setup: {
        players: ["Player 1", "Player 2", "Player 3", "Player 4"],
        categories: [
            {
                id: "category-suspects",
                name: "Suspect",
                cards: [
                    { id: "card-miss-scarlet", name: "Miss Scarlet" },
                    { id: "card-col-mustard", name: "Col. Mustard" },
                    { id: "card-mrs-white", name: "Mrs. White" },
                    { id: "card-mr-green", name: "Mr. Green" },
                    { id: "card-mrs-peacock", name: "Mrs. Peacock" },
                    { id: "card-prof-plum", name: "Prof. Plum" },
                ],
            },
            {
                id: "category-weapons",
                name: "Weapon",
                cards: [
                    { id: "card-candlestick", name: "Candlestick" },
                    { id: "card-knife", name: "Knife" },
                    { id: "card-lead-pipe", name: "Lead pipe" },
                    { id: "card-revolver", name: "Revolver" },
                    { id: "card-rope", name: "Rope" },
                    { id: "card-wrench", name: "Wrench" },
                ],
            },
            {
                id: "category-rooms",
                name: "Room",
                cards: [
                    { id: "card-kitchen", name: "Kitchen" },
                    { id: "card-ball-room", name: "Ball room" },
                    { id: "card-conservatory", name: "Conservatory" },
                    { id: "card-dining-room", name: "Dining room" },
                    { id: "card-billiard-room", name: "Billiard room" },
                    { id: "card-library", name: "Library" },
                    { id: "card-lounge", name: "Lounge" },
                    { id: "card-hall", name: "Hall" },
                    { id: "card-study", name: "Study" },
                ],
            },
        ],
    },
    hands: [
        {
            player: "Player 1",
            cards: [
                "card-miss-scarlet",
                "card-col-mustard",
                "card-mrs-white",
                "card-mr-green",
                "card-mrs-peacock",
            ],
        },
    ],
    handSizes: [
        { player: "Player 1", size: 5 },
        { player: "Player 2", size: 5 },
        { player: "Player 3", size: 4 },
        { player: "Player 4", size: 4 },
    ],
    suggestions: [],
    accusations: [],
};

beforeEach(() => {
    window.localStorage.clear();
    seedOnboardingDismissed();
    window.history.replaceState(null, "", "/?view=checklist");
    window.localStorage.setItem(
        "effect-clue.session.v6",
        JSON.stringify(SEEDED_SESSION),
    );
});

const waitForChecklist = async () => {
    await waitFor(() => {
        expect(
            document.querySelector("[data-cell-row='0'][data-cell-col='0']"),
        ).toBeInTheDocument();
    });
};

// Always re-query the cell from the DOM — React replaces the cell's
// node on re-render (the `motion.td` is re-created with a different
// ref identity), so caching a `cell = getCell(...)` reference will
// read a stale detached node after the first state change.
const getCell = (row: number, col: number): HTMLElement => {
    const el = document.querySelector<HTMLElement>(
        `[data-cell-row='${row}'][data-cell-col='${col}']`,
    );
    if (!el) throw new Error(`cell (${row},${col}) not found`);
    return el;
};

const isOpen = (row: number, col: number): boolean =>
    getCell(row, col).getAttribute("aria-expanded") === "true";

// Simulate a touch tap on the cell at (row, col). The browser's
// natural ordering on touch is: pointerdown (with pre-tap focus
// still in effect) → focus moves to the cell → pointerup → click.
// We replay that order, and re-focus AFTER the click to mimic the
// browser keeping focus on the tap target — React may replace the
// cell's DOM node during the click handler's setState, and the
// fresh node has no focus until something re-focuses it. Without
// the trailing re-focus, the next tap's pointerdown sees
// activeElement === document.body and the two-tap pre-focus check
// misfires.
const tapTouch = (row: number, col: number): void => {
    const el = getCell(row, col);
    fireEvent.pointerDown(el, {
        pointerType: "touch",
        clientX: 0,
        clientY: 0,
    });
    el.focus();
    fireEvent.pointerUp(el, {
        pointerType: "touch",
        clientX: 0,
        clientY: 0,
    });
    fireEvent.click(el);
    getCell(row, col).focus();
};

describe("Checklist — touch tap protocol", () => {
    test("first tap on a cold cell focuses but does not open the panel", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForChecklist();
        tapTouch(0, 0);
        // jsdom flushes state synchronously, but waitFor handles the
        // theoretical case where React schedules across microtasks.
        await waitFor(() => {
            expect(isOpen(0, 0)).toBe(false);
        });
    });

    test("second tap on the same focused cell opens its panel", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForChecklist();
        tapTouch(0, 0);
        tapTouch(0, 0);
        await waitFor(() => {
            expect(isOpen(0, 0)).toBe(true);
        });
    });

    test("third tap on the open cell closes the panel", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForChecklist();
        tapTouch(0, 0);
        tapTouch(0, 0);
        await waitFor(() => expect(isOpen(0, 0)).toBe(true));
        tapTouch(0, 0);
        await waitFor(() => expect(isOpen(0, 0)).toBe(false));
    });

    test("same-row tap swaps the panel anchor in a single tap (Issue 1)", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForChecklist();
        // Two deduced cells sharing the same `card` row but different
        // owner columns — cells (0, 0) and (0, 1) are both
        // popover-interactive (Player 1 owns Scarlet = Y; Player 2
        // does not = N).
        tapTouch(0, 0);
        tapTouch(0, 0);
        await waitFor(() => expect(isOpen(0, 0)).toBe(true));
        // ONE tap on the sibling column should re-anchor — no
        // two-tap dance.
        tapTouch(0, 1);
        await waitFor(() => {
            expect(isOpen(0, 1)).toBe(true);
            expect(isOpen(0, 0)).toBe(false);
        });
    });

    test("cross-row tap closes the open row; a second tap on the new row opens it", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForChecklist();
        tapTouch(0, 0);
        tapTouch(0, 0);
        await waitFor(() => expect(isOpen(0, 0)).toBe(true));
        // First cross-row tap: closes (0,0), doesn't open (1,0).
        tapTouch(1, 0);
        await waitFor(() => {
            expect(isOpen(0, 0)).toBe(false);
            expect(isOpen(1, 0)).toBe(false);
        });
        // Second tap on (1,0): opens.
        tapTouch(1, 0);
        await waitFor(() => {
            expect(isOpen(1, 0)).toBe(true);
        });
    });

    test("clicking the parchment outside any cell dismisses the open panel", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForChecklist();
        tapTouch(0, 0);
        tapTouch(0, 0);
        await waitFor(() => expect(isOpen(0, 0)).toBe(true));
        fireEvent.click(document.body);
        await waitFor(() => expect(isOpen(0, 0)).toBe(false));
    });

    test("mouse path: single-action toggle (no two-tap)", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForChecklist();
        // Click (0,0) with mouse → opens immediately.
        fireEvent.pointerDown(getCell(0, 0), { pointerType: "mouse" });
        fireEvent.click(getCell(0, 0));
        await waitFor(() => expect(isOpen(0, 0)).toBe(true));
        // Click (0,1) with mouse → swaps immediately (no two-tap).
        fireEvent.pointerDown(getCell(0, 1), { pointerType: "mouse" });
        fireEvent.click(getCell(0, 1));
        await waitFor(() => {
            expect(isOpen(0, 1)).toBe(true);
            expect(isOpen(0, 0)).toBe(false);
        });
        // Click (0,1) again → closes.
        fireEvent.pointerDown(getCell(0, 1), { pointerType: "mouse" });
        fireEvent.click(getCell(0, 1));
        await waitFor(() => expect(isOpen(0, 1)).toBe(false));
    });
});

describe("Checklist — touch long-press protocol", () => {
    // Use REAL timers — vi.useFakeTimers (even with `toFake` narrowed
    // to setTimeout/clearTimeout) blocks React's scheduler enough that
    // the initial Clue render doesn't finish. Real-time + a 550 ms
    // wait per long-press is the simpler path; the suite still
    // completes in under 10 s.
    const LONG_PRESS_WAIT = 550;

    // Long-press: pointerdown (touch) → wait > 500 ms → pointerup →
    // trailing synthesized click. Same re-focus-after-the-click
    // discipline as `tapTouch` (see its comment).
    const longPressTouch = async (
        row: number,
        col: number,
    ): Promise<void> => {
        const el = getCell(row, col);
        fireEvent.pointerDown(el, {
            pointerType: "touch",
            clientX: 0,
            clientY: 0,
        });
        await new Promise(resolve => setTimeout(resolve, LONG_PRESS_WAIT));
        fireEvent.pointerUp(el, {
            pointerType: "touch",
            clientX: 0,
            clientY: 0,
        });
        fireEvent.click(el);
        getCell(row, col).focus();
    };

    test("long-press from cold opens the panel directly (Issue 2)", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForChecklist();
        await longPressTouch(0, 0);
        await waitFor(() => expect(isOpen(0, 0)).toBe(true));
    });

    test("long-press swap, same row, with another cell already open", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForChecklist();
        tapTouch(0, 0);
        tapTouch(0, 0);
        await waitFor(() => expect(isOpen(0, 0)).toBe(true));
        await longPressTouch(0, 1);
        await waitFor(() => {
            expect(isOpen(0, 1)).toBe(true);
            expect(isOpen(0, 0)).toBe(false);
        });
    });

    test("long-press swap, cross-row, with another cell already open", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForChecklist();
        tapTouch(0, 0);
        tapTouch(0, 0);
        await waitFor(() => expect(isOpen(0, 0)).toBe(true));
        await longPressTouch(1, 0);
        await waitFor(() => {
            expect(isOpen(1, 0)).toBe(true);
            expect(isOpen(0, 0)).toBe(false);
        });
    });

    test("long-press on the already-open cell toggles it closed", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForChecklist();
        tapTouch(0, 0);
        tapTouch(0, 0);
        await waitFor(() => expect(isOpen(0, 0)).toBe(true));
        await longPressTouch(0, 0);
        await waitFor(() => expect(isOpen(0, 0)).toBe(false));
    });

    test("pointermove past the tolerance threshold cancels the long-press timer", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForChecklist();
        const a = getCell(0, 0);
        fireEvent.pointerDown(a, {
            pointerType: "touch",
            clientX: 0,
            clientY: 0,
        });
        // Move > 10 px from the start — should clear the timer.
        fireEvent.pointerMove(a, {
            pointerType: "touch",
            clientX: 50,
            clientY: 0,
        });
        await new Promise(resolve => setTimeout(resolve, LONG_PRESS_WAIT));
        fireEvent.pointerUp(a, {
            pointerType: "touch",
            clientX: 50,
            clientY: 0,
        });
        // No click — the would-be-tap was canceled by the move. Panel
        // stays closed.
        expect(isOpen(0, 0)).toBe(false);
    });

    test("trailing click after a long-press is a no-op (does not close the just-opened panel)", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForChecklist();
        // longPressTouch already fires the trailing click; assert the
        // panel remains open afterward (not toggled back closed).
        await longPressTouch(0, 0);
        await waitFor(() => expect(isOpen(0, 0)).toBe(true));
        // And a follow-up real tap should still close it via the
        // normal path (sanity-check the state machine isn't wedged).
        tapTouch(0, 0);
        await waitFor(() => expect(isOpen(0, 0)).toBe(false));
    });
});
