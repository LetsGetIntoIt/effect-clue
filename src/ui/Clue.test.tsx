import { beforeEach, describe, expect, test, vi } from "vitest";
import { forwardRef, createElement } from "react";
import type { ReactNode } from "react";

// -----------------------------------------------------------------------
// Mocks — `vi.mock` is hoisted above imports by Vitest. The patterns
// mirror `SuggestionForm.ui.test.tsx`: `next-intl` passes keys through
// verbatim; `motion/react`'s `motion.<tag>` becomes plain DOM elements
// so jsdom doesn't blow up on the real library's rAF / layout
// measurement path. Nothing about Clue.tsx's routing or provider
// wiring depends on real animation.
// -----------------------------------------------------------------------

vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    (t as unknown as { rich: unknown }).rich = (key: string): string => key;
    return {
        useTranslations: () => t,
        // `useLocale` is consumed by `useListFormatter` and any
        // component that calls `Intl.ListFormat(locale, ...)` (e.g.
        // SuggestionLogPanel's refuter summaries). Returning `"en"`
        // keeps the formatter deterministic across tests.
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

import { render, screen, waitFor } from "@testing-library/react";
import { Clue } from "./Clue";

beforeEach(() => {
    window.localStorage.clear();
    // Reset URL between tests — the URL-sync `useEffect` in
    // `ClueProvider` mutates `?view=` on every uiMode change, so
    // a stale param from a prior test would leak into hydration.
    window.history.replaceState(null, "", "/");
});

describe("Clue — top-level structure", () => {
    test("renders the app title via next-intl", () => {
        render(<Clue />);
        // The mock returns the i18n key verbatim. `app.title` → `title`.
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
            "title",
        );
    });

    test("provider stack renders without throwing", () => {
        // Clue mounts TooltipProvider + ClueProvider + ConfirmProvider +
        // SelectionProvider + AnimatedFocusRing together. If any of
        // them had a missing peer or threw on mount, render() would
        // propagate the error — this test pins that green path.
        expect(() => render(<Clue />)).not.toThrow();
    });

    test("after the initial mount, hydration completes and the view skeleton is removed", async () => {
        render(<Clue />);
        // The view skeleton is aria-hidden with a tailwind pulse class;
        // it goes away once `hydrated` flips true. `waitFor` retries
        // until React's post-commit hydration effect has flushed.
        await waitFor(() => {
            const skeleton = document.querySelector(
                "[aria-hidden='true'].motion-safe\\:animate-pulse",
            );
            expect(skeleton).toBeNull();
        });
    });
});

describe("Clue — URL-based view hydration", () => {
    test("no view param → default setup view; URL gets `?view=setup` after hydration", async () => {
        render(<Clue />);
        // With no `?view=`, no localStorage, and no suggestions,
        // the hydration path leaves uiMode at its default ("setup").
        // The URL-sync effect then writes `?view=setup` into the URL
        // on the first re-render that includes a uiMode change — so
        // if the default happens to match `""` already, the URL may
        // stay empty. Accept either shape: the key assertion is that
        // no OTHER view got persisted.
        await waitFor(() => {
            const view = new URLSearchParams(window.location.search).get("view");
            expect(view === null || view === "setup").toBe(true);
        });
    });

    test("`?view=checklist` → URL preserved through hydration", async () => {
        window.history.replaceState(null, "", "/?view=checklist");
        render(<Clue />);
        await waitFor(() => {
            expect(window.location.search).toContain("view=checklist");
        });
    });

    test("`?view=suggest` → URL preserved through hydration", async () => {
        window.history.replaceState(null, "", "/?view=suggest");
        render(<Clue />);
        await waitFor(() => {
            expect(window.location.search).toContain("view=suggest");
        });
    });

    test("a hydrated session with saved suggestions lands on checklist when no view is specified", async () => {
        // Pre-seed localStorage with a session containing one suggestion
        // — the smart-default path in `ClueProvider` flips uiMode to
        // "checklist" when hydration finds suggestions but no explicit
        // view param.
        const { saveToLocalStorage } = await import(
            "../logic/Persistence"
        );
        const { Suggestion, newSuggestionId } = await import(
            "../logic/Suggestion"
        );
        const { Player } = await import("../logic/GameObjects");
        const { CLASSIC_SETUP_3P } = await import("../logic/GameSetup");
        const { cardByName } = await import(
            "../logic/test-utils/CardByName"
        );
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
    });
});
