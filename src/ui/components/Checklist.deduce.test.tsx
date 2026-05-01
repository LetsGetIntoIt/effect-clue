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
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { seedOnboardingDismissed } from "../../test-utils/onboardingSeed";

beforeEach(() => {
    window.localStorage.clear();
    // Suppress splash / tour / install auto-fires so they don't
    // block click events on the deduce-mode UI under test.
    seedOnboardingDismissed();
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
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForDeduceChecklist();
    });

    test("does NOT render the Start Playing CTA (that's setup-only)", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForDeduceChecklist();
        expect(document.querySelector("[data-setup-cta]")).toBeNull();
    });

    test("does NOT render the add-player column header", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForDeduceChecklist();
        expect(screen.queryByText("addPlayerLabel")).toBeNull();
    });
});

describe("Checklist — deduce mode — cell affordances", () => {
    test("body cells are popover triggers (no native checkboxes in the Checklist)", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
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
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForDeduceChecklist();
        // The hand-size row sits at `data-cell-row="-1"`, which is
        // hidden in deduce mode. Assert no row -1 cells.
        expect(document.querySelectorAll("[data-cell-row='-1']").length).toBe(0);
    });

    test("no player-name row cells (`data-cell-row=\"-2\"`) in deduce mode", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForDeduceChecklist();
        expect(document.querySelectorAll("[data-cell-row='-2']").length).toBe(0);
    });

    test("no `data-cell-col=\"-1\"` card-name edit column in deduce mode", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForDeduceChecklist();
        expect(document.querySelectorAll("[data-cell-col='-1']").length).toBe(0);
    });
});

describe("Checklist — deduce mode — body layout", () => {
    test("body cells render across multiple player columns", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
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

// -----------------------------------------------------------------------
// Case-file body cells expose the same popover affordance as
// play-mode player cells when there's a deduction to explain — the
// case file's value is always derived (the column is read-only), so
// tooltipContent is the only thing the user sees, and they need a
// hover/click/keyboard path to it.
// -----------------------------------------------------------------------

describe("Checklist — case-file deduction popover", () => {
    test("a deduced case-file cell exposes role=button + aria-haspopup + data-cell-col, with no toggle handler", async () => {
        // Seed a session where the card-ownership slice can pin the
        // case file: every non-Plum suspect is dealt to Player 1, so
        // case_Plum gets deduced=Y and the popover should attach.
        const session = {
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
        window.localStorage.setItem(
            "effect-clue.session.v6",
            JSON.stringify(session),
        );

        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForDeduceChecklist();

        // Find the case-file body cell on the Plum row. The case-file
        // column is the rightmost data-cell-col on each row.
        const allBodyCells = Array.from(
            document.querySelectorAll<HTMLElement>("[data-cell-row][data-cell-col]"),
        );
        const colNumbers = allBodyCells
            .map(c => Number(c.getAttribute("data-cell-col")))
            .filter(n => !Number.isNaN(n) && n >= 0);
        const maxCol = Math.max(...colNumbers);
        // 4 players + 1 case-file = 5 columns (cols 0..4). Without my
        // change case-file wouldn't advertise data-cell-col at all.
        expect(maxCol).toBeGreaterThanOrEqual(4);

        // Pick a row where the case-file is deduced. Plum (index 5 in
        // suspects) is the only suspect not dealt — case_Plum=Y.
        const plumCells = allBodyCells.filter(c => c.getAttribute("data-cell-row") === "5");
        const caseFileCell = plumCells.find(
            c => c.getAttribute("data-cell-col") === String(maxCol),
        );
        expect(caseFileCell).toBeDefined();
        if (!caseFileCell) return;
        expect(caseFileCell.getAttribute("role")).toBe("button");
        expect(caseFileCell.getAttribute("aria-haspopup")).toBe("dialog");
        expect(caseFileCell.getAttribute("tabindex")).toBe("0");
        // Crucially: clicking a case-file cell must NOT toggle a
        // known-card entry — the column is read-only. The click /
        // toggle wiring lives on player cells only; for case-file we
        // mount InfoPopover but no onClick that mutates state.
        // Asserting the absence of `aria-pressed` (which is set on
        // setup-mode toggleable cells) is a stable proxy.
        expect(caseFileCell.getAttribute("aria-pressed")).toBeNull();

        // The focus indicator uses `ring-*` (box-shadow) instead of
        // `outline-*`. Outlines on `<td>` cells in
        // border-collapse:separate tables get sheared off at the left
        // column boundary; box-shadow doesn't. 3px width matches the
        // global *:focus-visible outline so it reads at the same
        // weight as every other focusable element on the page.
        // Pinned via classes so a future regression to outline-* (or
        // a thinner ring) trips the test.
        expect(caseFileCell.className).toMatch(/focus-visible:ring-\[3px\]/);
        expect(caseFileCell.className).toMatch(/focus-visible:ring-accent/);
        expect(caseFileCell.className).toMatch(/focus-visible:outline-none/);
        expect(caseFileCell.className).not.toMatch(
            /focus-visible:outline-1\b/,
        );
    });

    test("an undeduced case-file cell stays non-interactive (no popover affordance)", async () => {
        // Same session as above, but deuce-mode renders just the
        // empty checklist by default — no deductions firing. Look at
        // a row whose case-file cell has no value: it should NOT
        // expose role=button or aria-haspopup.
        // Reuse the empty fresh state by doing nothing extra.
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForDeduceChecklist();
        const allBodyCells = Array.from(
            document.querySelectorAll<HTMLElement>("[data-cell-row][data-cell-col]"),
        );
        // The case-file column won't advertise data-cell-col when
        // there's no deduction (it falls back to the plain-td path).
        // Check: at least one row exists with NO data-cell-col on its
        // last cell — i.e. the case-file column for an empty state.
        const lastTrs = Array.from(document.querySelectorAll<HTMLElement>("tr"));
        const anyRowWithUndeducedCaseFile = lastTrs.some(tr => {
            const tds = Array.from(tr.querySelectorAll("td"));
            const last = tds[tds.length - 1];
            // Plain td case-file cell — no data-cell-col set, no
            // role attribute.
            return (
                last !== undefined
                && last.getAttribute("data-cell-col") === null
                && last.getAttribute("role") === null
            );
        });
        expect(anyRowWithUndeducedCaseFile).toBe(true);
        // Sanity: the body cells we DID find still cover the player
        // columns (so the assertion above isn't accidentally passing
        // because of a totally empty grid).
        expect(allBodyCells.length).toBeGreaterThan(0);
    });
});

describe("Checklist — deduce mode — SuggestionLogPanel pairing (desktop)", () => {
    test("the desktop play layout mounts SuggestionLogPanel alongside the Checklist", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForDeduceChecklist();
        // SuggestionLogPanel renders a section with header id
        // `prior-suggestions` — the ⌘L shortcut scrolls to it.
        const priorHeader = document.getElementById("prior-suggestions");
        expect(priorHeader).toBeInTheDocument();
    });

    test("the Checklist and the SuggestionLogPanel are both in the DOM simultaneously", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
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
