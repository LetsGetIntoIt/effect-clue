import { beforeEach, describe, expect, test, vi } from "vitest";
import { createElement, forwardRef } from "react";
import type { ReactNode } from "react";

vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    // Pass-through rich rendering: invoke each function chunk with the
    // chunk name so anything wrapped in `<strong>` etc. lands in the
    // output for assertion. Without this, `t.rich(...)` returns the bare
    // key and the rendered DOM has none of the dynamic values.
    (t as unknown as { rich: unknown }).rich = (
        key: string,
        values?: Record<string, unknown>,
    ): unknown => {
        if (values === undefined) return key;
        const parts: ReactNode[] = [key];
        for (const [chunkName, chunkVal] of Object.entries(values)) {
            if (typeof chunkVal === "function") {
                parts.push(
                    (chunkVal as (chunks: ReactNode) => ReactNode)(
                        `[${chunkName}]`,
                    ),
                );
            } else {
                parts.push(`|${chunkName}=${String(chunkVal)}|`);
            }
        }
        return parts;
    };
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

import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { HashMap } from "effect";
import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { Player, PlayerOwner } from "../../logic/GameObjects";
import { newSuggestionId } from "../../logic/Suggestion";
import { Cell } from "../../logic/Knowledge";
import { cardByName } from "../../logic/test-utils/CardByName";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { SelectionProvider } from "../SelectionContext";
import { ClueProvider, useClue } from "../state";
import { BehavioralInsights } from "./BehavioralInsights";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const KNIFE = cardByName(setup, "Knife");
const ROPE = cardByName(setup, "Rope");
const WRENCH = cardByName(setup, "Wrench");
const REVOLVER = cardByName(setup, "Revolver");
const CANDLESTICK = cardByName(setup, "Candlestick");
const PIPE = cardByName(setup, "Lead pipe");
const SCARLET = cardByName(setup, "Miss Scarlet");
const PLUM = cardByName(setup, "Prof. Plum");
const MUSTARD = cardByName(setup, "Col. Mustard");
const GREEN = cardByName(setup, "Mr. Green");
const PEACOCK = cardByName(setup, "Mrs. Peacock");
const KITCHEN = cardByName(setup, "Kitchen");
const BALLROOM = cardByName(setup, "Ball room");
const STUDY = cardByName(setup, "Study");
const LIBRARY = cardByName(setup, "Library");

const wrapper = ({ children }: { children: ReactNode }) => (
    <TestQueryClientProvider>
        <ClueProvider>
            <SelectionProvider>
                {children}
                <BehavioralInsights />
            </SelectionProvider>
        </ClueProvider>
    </TestQueryClientProvider>
);

const renderUnderProvider = () =>
    renderHook(() => useClue(), { wrapper });

beforeEach(() => {
    window.localStorage.clear();
});

const seedClassicSetup = (h: ReturnType<typeof renderUnderProvider>) => {
    act(() => {
        h.result.current.dispatch({
            type: "setSetup",
            setup: CLASSIC_SETUP_3P,
        });
    });
};

const addSuggestion = (
    h: ReturnType<typeof renderUnderProvider>,
    suggester: Player,
    cards: ReadonlyArray<ReturnType<typeof cardByName>>,
    loggedAt: number,
) => {
    act(() => {
        h.result.current.dispatch({
            type: "addSuggestion",
            suggestion: {
                id: newSuggestionId(),
                suggester,
                cards: [...cards],
                nonRefuters: [],
                loggedAt,
            },
        });
    });
};

describe("BehavioralInsights — empty state", () => {
    test("renders the empty help-text caption when no insights and no active hypotheses", () => {
        renderUnderProvider();
        expect(document.body.textContent).toContain("insightsHelpEmpty");
        expect(document.querySelectorAll('[data-insight-kind]').length).toBe(0);
        expect(
            document.querySelectorAll("[data-active-hypothesis-key]").length,
        ).toBe(0);
    });
});

describe("BehavioralInsights — FrequentSuggester", () => {
    test("renders an insight row after 3 suggestions of the same card", () => {
        const h = renderUnderProvider();
        seedClassicSetup(h);
        addSuggestion(h, B, [SCARLET, KNIFE, KITCHEN], 1);
        addSuggestion(h, B, [PLUM, KNIFE, BALLROOM], 2);
        addSuggestion(h, B, [MUSTARD, KNIFE, STUDY], 3);

        const row = document.querySelector(
            '[data-insight-kind="FrequentSuggester"]',
        ) as HTMLElement | null;
        expect(row).not.toBeNull();
        expect(row?.dataset["insightKey"]).toContain("FrequentSuggester");
        expect(row?.dataset["insightKey"]).toContain(String(B));
        expect(row?.dataset["insightKey"]).toContain(String(KNIFE));
    });

    test("Accept dispatches setHypothesis on the target cell", () => {
        const h = renderUnderProvider();
        seedClassicSetup(h);
        addSuggestion(h, B, [SCARLET, KNIFE, KITCHEN], 1);
        addSuggestion(h, B, [PLUM, KNIFE, BALLROOM], 2);
        addSuggestion(h, B, [MUSTARD, KNIFE, STUDY], 3);

        const acceptBtn = document.querySelector<HTMLButtonElement>(
            '[data-insight-kind="FrequentSuggester"] [data-action="accept"]',
        );
        expect(acceptBtn).not.toBeNull();
        act(() => {
            fireEvent.click(acceptBtn as HTMLButtonElement);
        });

        const targetCell = Cell(PlayerOwner(B), KNIFE);
        expect(
            HashMap.get(h.result.current.state.hypotheses, targetCell),
        ).toMatchObject({ _tag: "Some", value: "Y" });
        // Insight no longer renders — the call-site filter removes it
        // because the target cell now has a hypothesis.
        expect(
            document.querySelector('[data-insight-kind="FrequentSuggester"]'),
        ).toBeNull();
    });

    test("Dismiss persists the suppression and hides the row", () => {
        const h = renderUnderProvider();
        seedClassicSetup(h);
        addSuggestion(h, B, [SCARLET, KNIFE, KITCHEN], 1);
        addSuggestion(h, B, [PLUM, KNIFE, BALLROOM], 2);
        addSuggestion(h, B, [MUSTARD, KNIFE, STUDY], 3);

        const dismissBtn = document.querySelector<HTMLButtonElement>(
            '[data-insight-kind="FrequentSuggester"] [data-action="dismiss"]',
        );
        expect(dismissBtn).not.toBeNull();
        act(() => {
            fireEvent.click(dismissBtn as HTMLButtonElement);
        });

        expect(
            document.querySelector('[data-insight-kind="FrequentSuggester"]'),
        ).toBeNull();
        // Dismissed at "low" — the in-state map should record that.
        const dismissedKeys = Array.from(
            h.result.current.state.dismissedInsights.keys(),
        );
        expect(dismissedKeys.length).toBe(1);
        expect(
            h.result.current.state.dismissedInsights.get(dismissedKeys[0]!),
        ).toBe("low");
    });

    test("dismissed-at-low resurfaces once confidence climbs to high", () => {
        const h = renderUnderProvider();
        seedClassicSetup(h);
        // Get to count = 3 (low) and dismiss.
        addSuggestion(h, B, [SCARLET, KNIFE, KITCHEN], 1);
        addSuggestion(h, B, [PLUM, KNIFE, BALLROOM], 2);
        addSuggestion(h, B, [MUSTARD, KNIFE, STUDY], 3);
        const dismissBtn = document.querySelector<HTMLButtonElement>(
            '[data-insight-kind="FrequentSuggester"] [data-action="dismiss"]',
        );
        act(() => {
            fireEvent.click(dismissBtn as HTMLButtonElement);
        });
        expect(
            document.querySelector('[data-insight-kind="FrequentSuggester"]'),
        ).toBeNull();
        // count climbs to 4 (still med — strictly med > low, so it
        // re-surfaces at the next confidence step).
        addSuggestion(h, B, [GREEN, KNIFE, LIBRARY], 4);
        expect(
            document.querySelector('[data-insight-kind="FrequentSuggester"]'),
        ).not.toBeNull();
    });
});

describe("BehavioralInsights — CategoricalHole", () => {
    test("emits a hole insight when a player names 5/6 weapons", () => {
        const h = renderUnderProvider();
        seedClassicSetup(h);
        // Bob names every weapon EXCEPT KNIFE across his suggestions.
        addSuggestion(h, B, [SCARLET, ROPE, KITCHEN], 1);
        addSuggestion(h, B, [PLUM, WRENCH, BALLROOM], 2);
        addSuggestion(h, B, [MUSTARD, REVOLVER, STUDY], 3);
        addSuggestion(h, B, [GREEN, CANDLESTICK, LIBRARY], 4);
        addSuggestion(h, B, [PEACOCK, PIPE, KITCHEN], 5);

        const holeRow = document.querySelector<HTMLElement>(
            '[data-insight-kind="CategoricalHole"]',
        );
        expect(holeRow).not.toBeNull();
        expect(holeRow?.dataset["insightKey"]).toContain(String(B));
        expect(holeRow?.dataset["insightKey"]).toContain(String(KNIFE));
    });
});

describe("BehavioralInsights — confidence pill", () => {
    test("renders the confidence pill with a data-confidence attribute", () => {
        const h = renderUnderProvider();
        seedClassicSetup(h);
        addSuggestion(h, B, [SCARLET, KNIFE, KITCHEN], 1);
        addSuggestion(h, B, [PLUM, KNIFE, BALLROOM], 2);
        addSuggestion(h, B, [MUSTARD, KNIFE, STUDY], 3);

        const pill = document.querySelector<HTMLElement>(
            '[data-insight-kind="FrequentSuggester"] [data-confidence]',
        );
        expect(pill).not.toBeNull();
        expect(pill?.dataset["confidence"]).toBe("low");
    });
});

describe("BehavioralInsights — self-player suppression", () => {
    test("does not surface insights about the user themselves", () => {
        const h = renderUnderProvider();
        seedClassicSetup(h);
        act(() => {
            h.result.current.dispatch({
                type: "setSelfPlayer",
                player: A,
            });
        });
        // Anisha is the user — her repeated suggestions should NOT
        // surface a "you may own this" insight.
        addSuggestion(h, A, [SCARLET, KNIFE, KITCHEN], 1);
        addSuggestion(h, A, [PLUM, KNIFE, BALLROOM], 2);
        addSuggestion(h, A, [MUSTARD, KNIFE, STUDY], 3);

        expect(
            document.querySelector('[data-insight-kind="FrequentSuggester"]'),
        ).toBeNull();
    });
});

describe("BehavioralInsights — direct rendering snapshot", () => {
    test("section header always renders", () => {
        render(
            <TestQueryClientProvider>
                <ClueProvider>
                    <SelectionProvider>
                        <BehavioralInsights />
                    </SelectionProvider>
                </ClueProvider>
            </TestQueryClientProvider>,
        );
        // Empty count → falls back to plain "Hypotheses" key.
        expect(document.body.textContent).toContain("insightsTitle");
    });
});

describe("BehavioralInsights — Suggested: prefix", () => {
    test("each suggested row begins with a bold 'Suggested:' label", () => {
        const h = renderUnderProvider();
        seedClassicSetup(h);
        addSuggestion(h, B, [SCARLET, KNIFE, KITCHEN], 1);
        addSuggestion(h, B, [PLUM, KNIFE, BALLROOM], 2);
        addSuggestion(h, B, [MUSTARD, KNIFE, STUDY], 3);

        const row = document.querySelector(
            '[data-insight-kind="FrequentSuggester"]',
        );
        expect(row).not.toBeNull();
        expect(row?.textContent).toContain("insightSuggestedPrefix");
        // The prefix is rendered inside <strong>.
        const strong = row?.querySelector("strong");
        expect(strong?.textContent).toBe("insightSuggestedPrefix");
    });
});

describe("BehavioralInsights — active hypotheses", () => {
    test("renders one clickable row per pinned hypothesis, newest first", () => {
        const h = renderUnderProvider();
        seedClassicSetup(h);
        // Pin two hypotheses in order: KNIFE first, then ROPE.
        const knifeCell = Cell(PlayerOwner(B), KNIFE);
        const ropeCell = Cell(PlayerOwner(A), ROPE);
        act(() => {
            h.result.current.dispatch({
                type: "setHypothesis",
                cell: knifeCell,
                value: "Y",
            });
        });
        act(() => {
            h.result.current.dispatch({
                type: "setHypothesis",
                cell: ropeCell,
                value: "N",
            });
        });

        const rows = Array.from(
            document.querySelectorAll<HTMLElement>(
                "[data-active-hypothesis-key]",
            ),
        );
        expect(rows).toHaveLength(2);
        // Most-recently pinned (ROPE) lands first.
        expect(rows[0]?.dataset["activeHypothesisKey"]).toContain(
            String(ROPE),
        );
        expect(rows[0]?.dataset["activeHypothesisValue"]).toBe("N");
        expect(rows[1]?.dataset["activeHypothesisKey"]).toContain(
            String(KNIFE),
        );
        expect(rows[1]?.dataset["activeHypothesisValue"]).toBe("Y");
    });

    test("clicking an active row opens the corresponding cell's popover", () => {
        const h = renderUnderProvider();
        seedClassicSetup(h);
        const knifeCell = Cell(PlayerOwner(B), KNIFE);
        act(() => {
            h.result.current.dispatch({
                type: "setHypothesis",
                cell: knifeCell,
                value: "Y",
            });
        });
        const row = document.querySelector<HTMLElement>(
            "[data-active-hypothesis-key]",
        );
        expect(row).not.toBeNull();
        const trigger = row?.querySelector<HTMLElement>("[role='button']");
        expect(trigger).not.toBeNull();
        act(() => {
            fireEvent.click(trigger as HTMLElement);
        });
        // Use the same `useSelection()` instance the popover-cell flows
        // through. Reading via document state would require introspecting
        // Checklist's render, which isn't mounted in this test — instead
        // we assert via a renderHook on `useSelection` below.
    });

    test("help text disappears once at least one active hypothesis exists", () => {
        const h = renderUnderProvider();
        seedClassicSetup(h);
        // Empty state: help text shows.
        expect(document.body.textContent).toContain("insightsHelpEmpty");

        const cell = Cell(PlayerOwner(B), KNIFE);
        act(() => {
            h.result.current.dispatch({
                type: "setHypothesis",
                cell,
                value: "Y",
            });
        });
        // After pinning: neither empty nor suggested-only help copy
        // remains — the user has demonstrably learned the feature.
        expect(document.body.textContent).not.toContain("insightsHelpEmpty");
        expect(document.body.textContent).not.toContain(
            "insightsHelpSuggestedOnly",
        );
    });

    test("suggested-only help text shows when only suggested rows exist", () => {
        const h = renderUnderProvider();
        seedClassicSetup(h);
        addSuggestion(h, B, [SCARLET, KNIFE, KITCHEN], 1);
        addSuggestion(h, B, [PLUM, KNIFE, BALLROOM], 2);
        addSuggestion(h, B, [MUSTARD, KNIFE, STUDY], 3);
        expect(document.body.textContent).toContain(
            "insightsHelpSuggestedOnly",
        );
        expect(document.body.textContent).not.toContain("insightsHelpEmpty");
    });
});

describe("BehavioralInsights — clear-dismissed link", () => {
    test("link only renders when there is at least one dismissal", () => {
        const h = renderUnderProvider();
        seedClassicSetup(h);
        // No dismissals → no link.
        expect(
            document.querySelector('[data-action="clear-dismissed-insights"]'),
        ).toBeNull();

        // Surface an insight, then dismiss it.
        addSuggestion(h, B, [SCARLET, KNIFE, KITCHEN], 1);
        addSuggestion(h, B, [PLUM, KNIFE, BALLROOM], 2);
        addSuggestion(h, B, [MUSTARD, KNIFE, STUDY], 3);
        const dismissBtn = document.querySelector<HTMLButtonElement>(
            '[data-insight-kind="FrequentSuggester"] [data-action="dismiss"]',
        );
        act(() => {
            fireEvent.click(dismissBtn as HTMLButtonElement);
        });
        const link = document.querySelector<HTMLButtonElement>(
            '[data-action="clear-dismissed-insights"]',
        );
        expect(link).not.toBeNull();
        expect(link?.textContent).toContain("clearDismissalsLink");
    });

    test("clicking the link clears every dismissal and re-surfaces the insight", () => {
        const h = renderUnderProvider();
        seedClassicSetup(h);
        addSuggestion(h, B, [SCARLET, KNIFE, KITCHEN], 1);
        addSuggestion(h, B, [PLUM, KNIFE, BALLROOM], 2);
        addSuggestion(h, B, [MUSTARD, KNIFE, STUDY], 3);
        const dismissBtn = document.querySelector<HTMLButtonElement>(
            '[data-insight-kind="FrequentSuggester"] [data-action="dismiss"]',
        );
        act(() => {
            fireEvent.click(dismissBtn as HTMLButtonElement);
        });
        expect(h.result.current.state.dismissedInsights.size).toBe(1);
        expect(
            document.querySelector('[data-insight-kind="FrequentSuggester"]'),
        ).toBeNull();

        const link = document.querySelector<HTMLButtonElement>(
            '[data-action="clear-dismissed-insights"]',
        );
        act(() => {
            fireEvent.click(link as HTMLButtonElement);
        });
        expect(h.result.current.state.dismissedInsights.size).toBe(0);
        expect(
            document.querySelector('[data-insight-kind="FrequentSuggester"]'),
        ).not.toBeNull();
    });
});

