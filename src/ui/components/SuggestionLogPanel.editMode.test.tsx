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

// Force desktop layout for the prior-suggestion interactions below. The
// mobile two-tap path is exercised separately in a later describe
// block, which flips this mock to "mobile".
vi.mock("../hooks/useIsDesktop", () => ({
    useIsDesktop: () => true,
}));

import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { saveToLocalStorage } from "../../logic/Persistence";
import { Player } from "../../logic/GameObjects";
import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import {
    newSuggestionId,
    Suggestion,
} from "../../logic/Suggestion";
import { cardByName } from "../../logic/test-utils/CardByName";
import { Clue } from "../Clue";

const getRow = (): HTMLElement => {
    const el = document.querySelector<HTMLElement>(
        "[data-suggestion-row='0']",
    );
    if (!el) throw new Error("suggestion row 0 not in DOM");
    return el;
};

const seedOneSuggestionAndMount = async (): Promise<void> => {
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
    });
    render(<Clue />);
    await waitFor(() => {
        expect(window.location.search).toContain("view=checklist");
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

    test("remove button (×) is rendered for idle rows", async () => {
        await seedOneSuggestionAndMount();
        expect(
            within(getRow()).getByRole("button", { name: "removeAction" }),
        ).toBeInTheDocument();
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
    });

    test("first tap reveals the Edit button without entering edit mode", async () => {
        await seedOneSuggestionAndMount();
        fireEvent.click(getRow());
        await waitFor(() => {
            expect(
                within(getRow()).queryByText("editAction"),
            ).toBeInTheDocument();
        });
        expect(getRow().querySelector("[data-pill-id]")).toBeNull();
    });

    test("tapping the Edit button enters edit mode", async () => {
        await seedOneSuggestionAndMount();
        fireEvent.click(getRow());
        await waitFor(() => {
            expect(
                within(getRow()).queryByText("editAction"),
            ).toBeInTheDocument();
        });
        fireEvent.click(within(getRow()).getByText("editAction"));
        await waitPillsVisible();
    });
});
