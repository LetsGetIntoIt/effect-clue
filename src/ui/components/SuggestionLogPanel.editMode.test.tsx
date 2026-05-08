import { beforeEach, describe, expect, test, vi } from "vitest";
import { createElement, forwardRef } from "react";
import type { ReactNode } from "react";

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
    // Memoize per tag — without this, every access to `motion.li` (etc.)
    // returns a *new* forwardRef component, so React sees a new
    // component type on every render and unmounts/remounts the DOM
    // node. That breaks anything that depends on a stable element
    // across renders, like keyboard focus on the row.
    const motionCache: Record<string, React.ComponentType<unknown>> = {};
    const motion = new Proxy(
        {},
        {
            get: (_t, tag: string) => {
                if (motionCache[tag] === undefined) {
                    motionCache[tag] = forwardRef(
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
                    ) as React.ComponentType<unknown>;
                }
                return motionCache[tag];
            },
        },
    );
    return {
        motion,
        AnimatePresence: ({ children }: { children: ReactNode }) => children,
        useReducedMotion: () => false,
        LayoutGroup: ({ children }: { children: ReactNode }) => children,
    };
});

// Force desktop layout for the prior-suggestion interactions below. The
// mobile two-tap path is exercised separately in a later describe
// block, which flips this mock to "mobile".
vi.mock("../hooks/useIsDesktop", () => ({
    useIsDesktop: () => true,
}));

// Force keyboard-bearing device. Hover-focus hint visibility on the
// prior log rows now follows this signal rather than viewport size,
// so the desktop-flavoured tests below need it pinned to true. The
// mobile describe block flips it to false to lock in the touch UX.
vi.mock("../hooks/useHasKeyboard", () => ({
    useHasKeyboard: () => true,
}));

import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { saveToLocalStorage } from "../../logic/Persistence";
import { emptyHypotheses } from "../../logic/Hypothesis";
import { Player } from "../../logic/GameObjects";
import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import {
    newSuggestionId,
    Suggestion,
} from "../../logic/Suggestion";
import { cardByName } from "../../logic/test-utils/CardByName";
import { Clue } from "../Clue";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { seedOnboardingDismissed } from "../../test-utils/onboardingSeed";

const getRow = (): HTMLElement => {
    const el = document.querySelector<HTMLElement>(
        "[data-suggestion-row='0']",
    );
    if (!el) throw new Error("suggestion row 0 not in DOM");
    return el;
};

const seedOneSuggestionAndMount = async (
    view: "checklist" | "suggest" = "checklist",
): Promise<void> => {
    const setup = CLASSIC_SETUP_3P;
    const mustard = cardByName(setup, "Col. Mustard");
    const knife = cardByName(setup, "Knife");
    const kitchen = cardByName(setup, "Kitchen");
    saveToLocalStorage({
        setup,
        hands: [],
        handSizes: [],
        suggestions: [
            Suggestion({
                id: newSuggestionId(),
                suggester: Player("Anisha"),
                cards: [mustard, knife, kitchen],
                nonRefuters: [],
            }),
        ],
        accusations: [],
        hypotheses: emptyHypotheses,
        pendingSuggestion: null,
    });
    if (view === "suggest") {
        // The mobile play layout only mounts the active pane, so
        // exercising PriorSuggestionItem on mobile requires landing
        // on the suggest pane explicitly. Desktop renders both panes
        // side-by-side regardless, so the default
        // (`view: "checklist"`) is fine for desktop tests.
        window.history.replaceState(null, "", "/?view=suggest");
    }
    render(<Clue />, { wrapper: TestQueryClientProvider });
    await waitFor(() => {
        expect(window.location.search).toContain(`view=${view}`);
    });
    await waitFor(() => {
        expect(
            document.querySelector("[data-suggestion-row='0']"),
        ).toBeInTheDocument();
    });
};

beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    // Suppress splash, tour, and install-prompt auto-fires so they
    // don't dispatch `setUiMode` mid-render or block click events.
    seedOnboardingDismissed();
});

const waitPillsVisible = async (): Promise<void> => {
    await waitFor(() =>
        expect(getRow().querySelector("[data-pill-id]")).not.toBeNull(),
    );
};

const waitPillsHidden = async (): Promise<void> => {
    await waitFor(() =>
        expect(getRow().querySelector("[data-pill-id]")).toBeNull(),
    );
};

describe("PriorSuggestionItem — idle state (no interaction)", () => {
    test("does not render pills or Update button when idle", async () => {
        await seedOneSuggestionAndMount();
        expect(getRow().querySelector("[data-pill-id]")).toBeNull();
        expect(within(getRow()).queryByRole("button", { name: /updateAction/ })).toBeNull();
        expect(
            within(getRow()).queryByRole("button", { name: "cancelEditAria" }),
        ).toBeNull();
    });

    test("remove button is hidden on idle rows (no hover, no focus)", async () => {
        await seedOneSuggestionAndMount();
        expect(
            within(getRow()).queryByRole("button", { name: "removeAction" }),
        ).toBeNull();
    });
});

describe("PriorSuggestionItem — keyboard focus (Tab)", () => {
    test("focusing the row shows 'Press Enter to edit' hint without entering edit mode", async () => {
        await seedOneSuggestionAndMount();
        getRow().focus();
        await waitFor(() => {
            expect(
                within(getRow()).queryByText("priorRowHintDesktop"),
            ).toBeInTheDocument();
        });
        expect(getRow().querySelector("[data-pill-id]")).toBeNull();
    });

    test("focusing the row reveals the remove button", async () => {
        await seedOneSuggestionAndMount();
        getRow().focus();
        await waitFor(() => {
            expect(
                within(getRow()).getByRole("button", { name: "removeAction" }),
            ).toBeInTheDocument();
        });
    });
});

describe("PriorSuggestionItem — entering edit mode (desktop)", () => {
    test("Enter on focused row enters edit mode (pills + Update + ×)", async () => {
        await seedOneSuggestionAndMount();
        getRow().focus();
        fireEvent.keyDown(getRow(), { key: "Enter", code: "Enter" });
        await waitPillsVisible();
        expect(within(getRow()).getByRole("button", { name: /updateAction/ })).toBeInTheDocument();
        expect(
            within(getRow()).getByRole("button", { name: "cancelEditAria" }),
        ).toBeInTheDocument();
    });

    test("clicking the row enters edit mode", async () => {
        await seedOneSuggestionAndMount();
        fireEvent.click(getRow());
        await waitPillsVisible();
    });

    test("remove (×) button is replaced by cancelEditAria during edit", async () => {
        await seedOneSuggestionAndMount();
        fireEvent.click(getRow());
        await waitPillsVisible();
        expect(
            within(getRow()).queryByRole("button", { name: "removeAction" }),
        ).toBeNull();
        expect(
            within(getRow()).getByRole("button", { name: "cancelEditAria" }),
        ).toBeInTheDocument();
    });
});

describe("PriorSuggestionItem — exiting edit mode", () => {
    test("clicking × (cancel) exits edit mode without dispatching", async () => {
        await seedOneSuggestionAndMount();
        fireEvent.click(getRow());
        await waitPillsVisible();
        fireEvent.click(
            within(getRow()).getByRole("button", { name: "cancelEditAria" }),
        );
        await waitPillsHidden();
    });

    test("Esc key exits edit mode", async () => {
        await seedOneSuggestionAndMount();
        fireEvent.click(getRow());
        await waitPillsVisible();
        getRow().focus();
        fireEvent.keyDown(getRow(), { key: "Escape", code: "Escape" });
        await waitPillsHidden();
    });

    test("clicking a checklist cell (outside) cancels the edit", async () => {
        await seedOneSuggestionAndMount();
        fireEvent.click(getRow());
        await waitPillsVisible();
        const cell = document.querySelector<HTMLElement>(
            "[data-cell-row='0'][data-cell-col='0']",
        );
        expect(cell).not.toBeNull();
        fireEvent.pointerDown(cell!);
        fireEvent.click(cell!);
        await waitPillsHidden();
    });
});

describe("PriorSuggestionItem — focus restoration after edit ends", () => {
    test("clicking Update returns focus to the row", async () => {
        await seedOneSuggestionAndMount();
        fireEvent.click(getRow());
        await waitPillsVisible();
        fireEvent.click(
            within(getRow()).getByRole("button", { name: /updateAction/ }),
        );
        await waitPillsHidden();
        await waitFor(() => {
            expect(document.activeElement).toBe(getRow());
        });
    });

    test("clicking the × cancel button returns focus to the row", async () => {
        await seedOneSuggestionAndMount();
        fireEvent.click(getRow());
        await waitPillsVisible();
        fireEvent.click(
            within(getRow()).getByRole("button", { name: "cancelEditAria" }),
        );
        await waitPillsHidden();
        await waitFor(() => {
            expect(document.activeElement).toBe(getRow());
        });
    });
});

describe("PriorSuggestionItem — keyboard navigation across disabled pills", () => {
    test("ArrowRight from refuter (no value) opens the disabled seenCard pill, then Update", async () => {
        // Bug repro: edit a suggestion whose refuter is unset, so
        // PILL_SEEN ("Shown card") is disabled. With the old bespoke
        // nav handler, ArrowRight skipped the disabled pill and never
        // landed on Update. Sharing SuggestionForm fixes both: the
        // disabled pill IS focusable (its popover shows the "why
        // disabled" hint), and Update is the terminal target.
        await seedOneSuggestionAndMount();
        fireEvent.click(getRow());
        await waitPillsVisible();
        const refuterTrigger = getRow().querySelector<HTMLElement>(
            "[data-pill-id='refuter']",
        );
        expect(refuterTrigger).not.toBeNull();
        refuterTrigger!.focus();
        fireEvent.keyDown(document, {
            key: "ArrowRight",
            code: "ArrowRight",
        });
        const seenTrigger = getRow().querySelector<HTMLElement>(
            "[data-pill-id='seenCard']",
        );
        expect(seenTrigger).not.toBeNull();
        await waitFor(() => {
            expect(seenTrigger!.getAttribute("data-state")).toBe("open");
        });
        // ArrowRight again → Update button.
        fireEvent.keyDown(document, {
            key: "ArrowRight",
            code: "ArrowRight",
        });
        const updateBtn = within(getRow()).getByRole("button", {
            name: /updateAction/,
        });
        await waitFor(() => {
            expect(document.activeElement).toBe(updateBtn);
        });
    });
});

describe("PriorSuggestionItem — Update commits the draft", () => {
    test("clicking Update closes edit mode and the row remains rendered", async () => {
        await seedOneSuggestionAndMount();
        fireEvent.click(getRow());
        await waitPillsVisible();
        fireEvent.click(within(getRow()).getByRole("button", { name: /updateAction/ }));
        await waitPillsHidden();
        // Row is still present; suggestion not removed.
        expect(
            document.querySelector("[data-suggestion-row='0']"),
        ).toBeInTheDocument();
    });

    test("Cmd/Ctrl+Enter from inside the row commits and exits edit mode", async () => {
        await seedOneSuggestionAndMount();
        fireEvent.click(getRow());
        await waitPillsVisible();
        // The row's own elements don't have their own keydown; dispatch
        // at document so the global listener picks it up.
        getRow().focus();
        fireEvent.keyDown(document, {
            key: "Enter",
            code: "Enter",
            metaKey: true,
        });
        await waitPillsHidden();
    });
});

// Re-run a slim subset of the entry tests under the mobile layout to
// lock in the two-tap interaction path. `useIsDesktop` is module-level
// mocked above; we swap its implementation for this describe block.
describe("PriorSuggestionItem — entering edit mode (mobile two-tap)", () => {
    beforeEach(async () => {
        const mod = await import("../hooks/useIsDesktop");
        (mod as { useIsDesktop: () => boolean }).useIsDesktop = () => false;
        const kbd = await import("../hooks/useHasKeyboard");
        (kbd as { useHasKeyboard: () => boolean }).useHasKeyboard = () => false;
    });

    test("first tap reveals the Edit button without entering edit mode", async () => {
        await seedOneSuggestionAndMount("suggest");
        fireEvent.click(getRow());
        await waitFor(() => {
            expect(
                within(getRow()).queryByText("editAction"),
            ).toBeInTheDocument();
        });
        expect(getRow().querySelector("[data-pill-id]")).toBeNull();
    });

    test("remove button is hidden before first tap, visible after", async () => {
        await seedOneSuggestionAndMount("suggest");
        expect(
            within(getRow()).queryByRole("button", { name: "removeAction" }),
        ).toBeNull();
        fireEvent.click(getRow());
        await waitFor(() => {
            expect(
                within(getRow()).getByRole("button", { name: "removeAction" }),
            ).toBeInTheDocument();
        });
    });

    test("tapping the Edit button enters edit mode", async () => {
        await seedOneSuggestionAndMount("suggest");
        fireEvent.click(getRow());
        await waitFor(() => {
            expect(
                within(getRow()).queryByText("editAction"),
            ).toBeInTheDocument();
        });
        fireEvent.click(within(getRow()).getByText("editAction"));
        await waitPillsVisible();
    });

    test("tapping outside while the Edit button is visible cancels pre-edit mode", async () => {
        await seedOneSuggestionAndMount("suggest");
        fireEvent.click(getRow());
        await waitFor(() => {
            expect(
                within(getRow()).queryByText("editAction"),
            ).toBeInTheDocument();
        });
        // Pre-edit, no pills yet.
        expect(getRow().querySelector("[data-pill-id]")).toBeNull();
        // Pointerdown outside the row → pre-edit dismisses, Edit
        // button hides.
        fireEvent.pointerDown(document.body);
        await waitFor(() => {
            expect(
                within(getRow()).queryByText("editAction"),
            ).not.toBeInTheDocument();
        });
    });

    test("tapping inside the row while in pre-edit mode does NOT dismiss it", async () => {
        await seedOneSuggestionAndMount("suggest");
        fireEvent.click(getRow());
        await waitFor(() => {
            expect(
                within(getRow()).queryByText("editAction"),
            ).toBeInTheDocument();
        });
        // pointerdown on the row itself (e.g. user's finger glances
        // back onto the row before tapping the Edit button) — must
        // not collapse pre-edit.
        fireEvent.pointerDown(getRow());
        // Give the effect a tick.
        await new Promise(r => setTimeout(r, 0));
        expect(
            within(getRow()).queryByText("editAction"),
        ).toBeInTheDocument();
    });
});
