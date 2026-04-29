import { beforeEach, describe, expect, test, vi } from "vitest";
import { forwardRef, createElement } from "react";
import type { ReactNode } from "react";

// -----------------------------------------------------------------------
// Mocks — same shape as Clue.test.tsx.
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

// Pin desktop layout so the SuggestionLogPanel pairing tests below see
// the side-by-side two-pane structure. On mobile only the active pane
// is mounted, so a checklist-mode mobile render wouldn't include the
// SuggestionLogPanel — that's the point of the breakpoint split.
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

import { render, screen, waitFor } from "@testing-library/react";
import { Clue } from "../Clue";

beforeEach(() => {
    window.localStorage.clear();
    // Enter deduce mode via the hydration URL param — matches how
    // real users would land here (via ⌘J or a shared `?view=…` link).
    window.history.replaceState(null, "", "/?view=checklist");
});

// Wait until Clue's hydration effect has dispatched the uiMode swap
// and the PlayGrid has painted the Checklist. `data-cell-row="0"`
// fires on the first body cell in both modes, so assert something
// deduce-specific like the case-file body cells.
const waitForDeduceChecklist = async () => {
    await waitFor(() => {
        expect(window.location.search).toContain("view=checklist");
    });
    // Fresh session has no suggestions, so we're in deduce mode on an
    // empty checklist. The `[data-cell-row="0"][data-cell-col="0"]`
    // cell is the first player body cell and must be present.
    await waitFor(() => {
        expect(
            document.querySelector("[data-cell-row='0'][data-cell-col='0']"),
        ).toBeInTheDocument();
    });
};

describe("Checklist — deduce mode — top-level structure", () => {
    test("renders with the URL-hydrated `?view=checklist`", async () => {
        render(<Clue />);
        await waitForDeduceChecklist();
    });

    test("does NOT render the Start Playing CTA (that's setup-only)", async () => {
        render(<Clue />);
        await waitForDeduceChecklist();
        expect(document.querySelector("[data-setup-cta]")).toBeNull();
    });

    test("does NOT render the add-player column header", async () => {
        render(<Clue />);
        await waitForDeduceChecklist();
        expect(screen.queryByText("addPlayerLabel")).toBeNull();
    });
});

describe("Checklist — deduce mode — cell affordances", () => {
    test("body cells are popover triggers (no native checkboxes in the Checklist)", async () => {
        render(<Clue />);
        await waitForDeduceChecklist();
        // Checklist has no native-checkbox cells in deduce mode. (The
        // SuggestionForm and other parts of the shell can still have
        // native inputs, so we narrow to the Checklist's player body
        // cells.)
        const bodyCells = document.querySelectorAll(
            "[data-cell-row='0'][data-cell-col]",
        );
        for (const cell of bodyCells) {
            expect(
                cell.querySelector("input[type='checkbox']"),
            ).toBeNull();
        }
        // At least one body cell exists.
        expect(bodyCells.length).toBeGreaterThan(0);
    });
});

describe("Checklist — deduce mode — scope of rendered controls", () => {
    test("no hand-size `<input type=number>` appears in the Checklist body", async () => {
        render(<Clue />);
        await waitForDeduceChecklist();
        // The hand-size row sits at `data-cell-row="-1"`, which is
        // hidden in deduce mode. Assert no row -1 cells.
        expect(document.querySelectorAll("[data-cell-row='-1']").length).toBe(0);
    });

    test("no player-name row cells (`data-cell-row=\"-2\"`) in deduce mode", async () => {
        render(<Clue />);
        await waitForDeduceChecklist();
        expect(document.querySelectorAll("[data-cell-row='-2']").length).toBe(0);
    });

    test("no `data-cell-col=\"-1\"` card-name edit column in deduce mode", async () => {
        render(<Clue />);
        await waitForDeduceChecklist();
        expect(document.querySelectorAll("[data-cell-col='-1']").length).toBe(0);
    });
});

describe("Checklist — deduce mode — body layout", () => {
    test("body cells render across multiple player columns", async () => {
        render(<Clue />);
        await waitForDeduceChecklist();
        // DEFAULT_SETUP has 4 players, and `data-cell-col="0"` through
        // `"3"` map to the player body cells regardless of whether the
        // case-file column advertises its own `data-cell-col`. Asserting
        // ≥4 distinct player columns keeps this test stable against
        // small layout tweaks in the case-file rendering.
        const row0 = document.querySelectorAll("[data-cell-row='0']");
        const colSet = new Set(
            Array.from(row0).map(el => el.getAttribute("data-cell-col")),
        );
        expect(colSet.size).toBeGreaterThanOrEqual(4);
    });
});

describe("Checklist — deduce mode — SuggestionLogPanel pairing (desktop)", () => {
    test("the desktop play layout mounts SuggestionLogPanel alongside the Checklist", async () => {
        render(<Clue />);
        await waitForDeduceChecklist();
        // SuggestionLogPanel renders a section with header id
        // `prior-suggestions` — the ⌘L shortcut scrolls to it.
        const priorHeader = document.getElementById("prior-suggestions");
        expect(priorHeader).toBeInTheDocument();
    });

    test("the Checklist and the SuggestionLogPanel are both in the DOM simultaneously", async () => {
        render(<Clue />);
        await waitForDeduceChecklist();
        // Sanity: body cell count > 0 (Checklist) and the suggestions
        // header is present (SuggestionLogPanel).
        expect(
            document.querySelectorAll("[data-cell-row='0']").length,
        ).toBeGreaterThan(0);
        expect(document.getElementById("prior-suggestions"))
            .toBeInTheDocument();
    });
});
