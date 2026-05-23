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

vi.mock("../hooks/useIsDesktop", () => ({
    useIsDesktop: () => true,
}));

vi.mock("../hooks/useHasKeyboard", () => ({
    useHasKeyboard: () => true,
}));

import { render, waitFor, within } from "@testing-library/react";
import { saveToLocalStorage } from "../../logic/Persistence";
import { emptyHypotheses } from "../../logic/Hypothesis";
import { emptyUserDeductions } from "../../logic/SolverMode";
import { Player } from "../../logic/GameObjects";
import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { newSuggestionId, Suggestion } from "../../logic/Suggestion";
import { cardByName } from "../../logic/test-utils/CardByName";
import { Clue } from "../Clue";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { seedOnboardingDismissed } from "../../test-utils/onboardingSeed";

const SETUP = CLASSIC_SETUP_3P;
const MUSTARD = cardByName(SETUP, "Col. Mustard");
const KNIFE = cardByName(SETUP, "Knife");
const KITCHEN = cardByName(SETUP, "Kitchen");

const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

const mountWithSuggestion = async (
    overrides: Partial<Parameters<typeof Suggestion>[0]> = {},
): Promise<void> => {
    saveToLocalStorage({
        setup: SETUP,
        hands: [],
        handSizes: [],
        suggestions: [
            Suggestion({
                id: newSuggestionId(),
                suggester: A,
                cards: [MUSTARD, KNIFE, KITCHEN],
                nonRefuters: [B],
                refuter: C,
                seenCard: KNIFE,
                ...overrides,
            }),
        ],
        accusations: [],
        hypotheses: emptyHypotheses,
        hypothesisOrder: [],
        pendingSuggestion: null,
        selfPlayerId: null,
        firstDealtPlayerId: null,
        dismissedInsights: new Map(),
        solverMode: "solve",
        userDeductions: emptyUserDeductions,
    });
    render(<Clue />, { wrapper: TestQueryClientProvider });
    await waitFor(() => {
        expect(
            document.querySelector("[data-suggestion-row='0']"),
        ).toBeInTheDocument();
    });
};

const getRow = (): HTMLElement => {
    const el = document.querySelector<HTMLElement>(
        "[data-suggestion-row='0']",
    );
    if (!el) throw new Error("suggestion row 0 not in DOM");
    return el;
};

beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    seedOnboardingDismissed();
});

describe("PriorSuggestionItem — chip-based layout", () => {
    test("renders the three suggested cards in canonical category order (suspect → weapon → room) regardless of input order", async () => {
        // Submit cards in room → weapon → suspect order. The chip strip
        // should still read suspect → weapon → room.
        await mountWithSuggestion({ cards: [KITCHEN, KNIFE, MUSTARD] });
        const row = getRow();
        const cardChips = within(row)
            .queryAllByText(/^(Col\. Mustard|Knife|Kitchen)$/)
            .filter(el => el.tagName === "SPAN");
        expect(cardChips.map(el => el.textContent?.trim())).toEqual([
            "Col. Mustard",
            "Knife",
            "Kitchen",
        ]);
    });

    test("renders Passed and Refuted label rows with values", async () => {
        await mountWithSuggestion();
        const row = getRow();
        expect(
            within(row).getByText("priorOutcomeLabelPassed"),
        ).toBeInTheDocument();
        expect(
            within(row).getByText("priorOutcomeLabelRefuted"),
        ).toBeInTheDocument();
        // Passer "Bob" and refuter "Cho" both appear as plain text.
        expect(within(row).getByText("Bob")).toBeInTheDocument();
        expect(within(row).getByText("Cho")).toBeInTheDocument();
    });

    test("renders 'Nobody' placeholder when there are no passers and no refuter", async () => {
        await mountWithSuggestion({
            nonRefuters: [],
            refuter: undefined,
            seenCard: undefined,
        });
        const row = getRow();
        const nobodyMarkers = within(row).getAllByText("priorOutcomeNobody");
        // One for Passed, one for Refuted.
        expect(nobodyMarkers).toHaveLength(2);
    });

    test("the chip whose card the refuter showed is marked with the data attribute, accent border, and eye icon", async () => {
        await mountWithSuggestion(); // seenCard = KNIFE
        const row = getRow();
        const shownChip = row.querySelector<HTMLElement>(
            "[data-prior-card-shown='true']",
        );
        expect(shownChip).not.toBeNull();
        expect(shownChip?.textContent?.trim()).toBe("Knife");
        expect(shownChip?.className).toContain("border-accent");
        expect(shownChip?.className).toContain("text-accent");
        // Eye icon SVG renders inside the marked chip.
        expect(shownChip?.querySelector("svg")).not.toBeNull();
        // The other two chips do not carry the shown marker.
        const otherChips = within(row)
            .queryAllByText(/^(Col\. Mustard|Kitchen)$/)
            .filter(el => el.tagName === "SPAN");
        for (const chip of otherChips) {
            expect(chip.getAttribute("data-prior-card-shown")).toBeNull();
            expect(chip.querySelector("svg")).toBeNull();
        }
    });

    test("Refuted row prints the shown card as plain text inside the muted prose, not as a chip", async () => {
        await mountWithSuggestion(); // seenCard = KNIFE
        const row = getRow();
        const dd = row.querySelectorAll("dd")[1];
        expect(dd).toBeDefined();
        // The dd contains the i18n key with values serialized in the
        // mocked translator, which embeds the card name inside the
        // JSON-stringified args. Asserting on textContent keeps the
        // test resilient to whitespace.
        expect(dd?.textContent).toContain("priorShowedCard");
        expect(dd?.textContent).toContain("Knife");
        // No chip-style border lives inside the dd.
        expect(dd?.querySelector("[data-prior-card-shown]")).toBeNull();
    });

    test("when the refuter did not show a card, the Refuted row reads 'card not seen' and no chip is marked", async () => {
        await mountWithSuggestion({ seenCard: undefined });
        const row = getRow();
        const dd = row.querySelectorAll("dd")[1];
        expect(dd?.textContent).toContain("priorCardNotSeen");
        expect(
            row.querySelector("[data-prior-card-shown='true']"),
        ).toBeNull();
    });
});
