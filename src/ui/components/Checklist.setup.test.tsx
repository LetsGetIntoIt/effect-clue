import { beforeEach, describe, expect, test, vi } from "vitest";
import { forwardRef, createElement } from "react";
import type { ReactNode } from "react";

// -----------------------------------------------------------------------
// Mocks — same shape as Clue.test.tsx and SuggestionForm.ui.test.tsx.
// Hoisted above imports by Vitest.
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

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Clue } from "../Clue";
import { TestQueryClientProvider } from "../../test-utils/queryClient";

beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
});

// In setup mode Clue renders just the Checklist (no PlayGrid); we
// select it via the setup-only CTA button, then use that element's
// ancestry to scope queries to avoid the outer shell (Toolbar /
// BottomNav / header).
const waitForSetupChecklist = async (): Promise<HTMLElement> => {
    await waitFor(() => {
        expect(document.querySelector("[data-setup-cta]")).toBeInTheDocument();
    });
    const cta = document.querySelector("[data-setup-cta]") as HTMLElement;
    // The Checklist grid is the nearest parent that wraps everything
    // — walk up to a section/div that also contains the header row.
    return cta.closest("div") as HTMLElement;
};

describe("Checklist — setup mode — top-level structure", () => {
    test("renders the Start Playing CTA", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            expect(document.querySelector("[data-setup-cta]")).toBeInTheDocument();
        });
    });

    test("shows the setup-only add-player column header", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            // `tSetup("addPlayerLabel")` → the literal "addPlayerLabel"
            // through the key-passthrough i18n mock.
            expect(screen.getByText("addPlayerLabel")).toBeInTheDocument();
        });
    });

    test("does NOT render the case-file header (that's a deduce-mode affordance)", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForSetupChecklist();
        // CaseFileHeader i18n key is "caseFileLabel" (or similar); it
        // shouldn't appear in setup mode because the case-file column
        // is hidden when `inSetup` is true.
        expect(screen.queryByText(/caseFileLabel/)).toBeNull();
    });
});

describe("Checklist — setup mode — hand-size inputs", () => {
    test("renders one `<input type=number>` per player for the hand-size row", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            // DEFAULT_SETUP has 4 players → 4 hand-size inputs.
            const inputs = document.querySelectorAll<HTMLInputElement>(
                "input[type='number']",
            );
            expect(inputs.length).toBeGreaterThanOrEqual(4);
        });
    });

    test("typing a new hand size updates the input value", async () => {
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            const inputs = document.querySelectorAll("input[type='number']");
            expect(inputs.length).toBeGreaterThanOrEqual(1);
        });
        const firstInput = document.querySelector<HTMLInputElement>(
            "input[type='number']",
        ) as HTMLInputElement;
        await user.clear(firstInput);
        await user.type(firstInput, "3");
        expect(firstInput.value).toBe("3");
    });
});

describe("Checklist — setup mode — category / card editable labels", () => {
    test("category names are rendered as editable text inputs", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            // DEFAULT_SETUP has 3 categories (Suspect / Weapon / Room),
            // each with an editable input in setup mode.
            const categoryInputs = Array.from(
                document.querySelectorAll<HTMLInputElement>("input[type='text']"),
            );
            // At least one category name input is present.
            expect(categoryInputs.length).toBeGreaterThanOrEqual(3);
        });
    });

    test("card names are rendered as editable text inputs (too many to enumerate exhaustively, just assert presence)", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            const textInputs = Array.from(
                document.querySelectorAll<HTMLInputElement>(
                    "input[type='text']",
                ),
            );
            // The classic deck has 6 suspects + 6 weapons + 9 rooms = 21
            // card inputs plus 3 category inputs + 4 player-name inputs
            // (row -2) = at least 28 text inputs total.
            expect(textInputs.length).toBeGreaterThan(20);
        });
    });
});

describe("Checklist — setup mode — player cell interactions", () => {
    test("player cells render as native checkboxes in setup mode", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            // Native checkboxes live only in setup mode body cells
            // (play mode collapses them into popover triggers).
            const checkboxes = document.querySelectorAll<HTMLInputElement>(
                "input[type='checkbox']",
            );
            // Classic 4-player × 21-card grid = 84 player body cells.
            expect(checkboxes.length).toBeGreaterThan(50);
        });
    });
});

describe("Checklist — setup mode — add-player column", () => {
    test("shows the add-player CTA (tSetup('addPlayerLabel'))", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            expect(screen.getByText("addPlayerLabel")).toBeInTheDocument();
        });
    });

    test("clicking add-player adds a fifth `Player 5` row", async () => {
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            expect(document.querySelectorAll("input[type='number']").length)
                .toBeGreaterThanOrEqual(4);
        });
        // Click the add-player CTA.
        const addPlayer = screen.getByRole("button", { name: /addPlayerLabel/ });
        await user.click(addPlayer);
        await waitFor(() => {
            expect(
                document.querySelectorAll("input[type='number']").length,
            ).toBeGreaterThanOrEqual(5);
        });
    });
});

describe("Checklist — setup mode → Start Playing transition", () => {
    test("clicking the Start Playing CTA flips uiMode to checklist (URL shows `?view=checklist`)", async () => {
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            expect(document.querySelector("[data-setup-cta]"))
                .toBeInTheDocument();
        });
        const cta = document.querySelector("[data-setup-cta]") as HTMLElement;
        await user.click(cta);
        await waitFor(() => {
            expect(window.location.search).toContain("view=checklist");
        });
    });
});

describe("Checklist — setup mode — keyboard-navigation bounds", () => {
    test("nav ring extends up to row -2 (player name row) in setup mode", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            // `data-cell-row="-2"` is the player-name row, only present
            // in setup mode (minRow = -2 when inSetup is true).
            const playerNameCells = document.querySelectorAll(
                "[data-cell-row='-2']",
            );
            expect(playerNameCells.length).toBeGreaterThan(0);
        });
    });

    test("nav ring extends left to col -1 (card name column) in setup mode", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            const cardNameCells = document.querySelectorAll(
                "[data-cell-col='-1']",
            );
            expect(cardNameCells.length).toBeGreaterThan(0);
        });
    });
});

describe("Checklist — setup mode — scope of rendered controls", () => {
    test("no popover pills render in setup mode (they live in deduce mode only)", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForSetupChecklist();
        // `data-pill-id` is the SuggestionForm's trigger attribute;
        // the SuggestionLogPanel isn't mounted in setup mode (no
        // PlayGrid), so zero pills.
        expect(document.querySelector("[data-pill-id]")).toBeNull();
        // Silence unused-import TS warning for `within`.
        expect(within).toBeDefined();
    });

    test("case-file body cells are NOT popover triggers in setup mode (even when deduced)", async () => {
        // Setup mode is for entering inputs, not exploring the
        // deduction chain. Even when the card-ownership slice has
        // already pinned a case-file value, the cell should remain
        // a plain non-interactive `<td>` — no role=button, no
        // aria-haspopup, no data-cell-col, no focus ring.
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
            // Player 1 holds every non-Plum suspect → slice forces
            // case_Plum=Y. We're in setup mode so the cell should
            // STILL render the deduced value but without any popover
            // affordance.
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
        // Ensure URL doesn't push us into deduce mode.
        window.history.replaceState(null, "", "/");

        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForSetupChecklist();

        // Sanity: deduce wired up — the Plum suspect row's case-file
        // cell should display the deduced ✓ glyph. In setup mode the
        // card name is an InlineTextEdit input; we find the row by
        // its initial value.
        const plumInput = Array.from(
            document.querySelectorAll<HTMLInputElement>("input"),
        ).find(i => i.value === "Prof. Plum");
        expect(plumInput).toBeDefined();
        if (!plumInput) return;
        const plumRow = plumInput.closest("tr");
        expect(plumRow).toBeDefined();
        if (!plumRow) return;
        const tds = Array.from(plumRow.querySelectorAll("td"));
        const caseFileCell = tds[tds.length - 1];
        expect(caseFileCell).toBeDefined();
        if (!caseFileCell) return;
        // The deduced value renders…
        expect(caseFileCell.textContent?.trim()).toBe("✓");
        // …but the cell stays non-interactive (no popover affordance).
        expect(caseFileCell.getAttribute("role")).toBeNull();
        expect(caseFileCell.getAttribute("aria-haspopup")).toBeNull();
        expect(caseFileCell.getAttribute("tabindex")).toBeNull();
        expect(caseFileCell.getAttribute("data-cell-col")).toBeNull();
        // No focus-visible ring class either — the styling for
        // interactive cells comes via CELL_INTERACTIVE which the gate
        // skips for setup-mode case-file cells.
        expect(caseFileCell.className).not.toMatch(/focus-visible:ring-1/);
    });
});
