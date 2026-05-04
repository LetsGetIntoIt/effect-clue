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
import { TestQueryClientProvider } from "../test-utils/queryClient";
import { seedOnboardingDismissed } from "../test-utils/onboardingSeed";

const seedStartupDismissedWithSharingEligible = (): void => {
    const recent = new Date().toISOString();
    window.localStorage.setItem(
        "effect-clue.splash.v1",
        JSON.stringify({
            version: 1,
            lastVisitedAt: recent,
            lastDismissedAt: recent,
        }),
    );
    window.localStorage.setItem(
        "effect-clue.install-prompt.v1",
        JSON.stringify({ version: 1, visits: 0 }),
    );
    const primaryTourSeed = JSON.stringify({
        version: 1,
        lastVisitedAt: recent,
        lastDismissedAt: recent,
    });
    window.localStorage.setItem("effect-clue.tour.setup.v1", primaryTourSeed);
    window.localStorage.setItem(
        "effect-clue.tour.checklistSuggest.v1",
        primaryTourSeed,
    );
};

beforeEach(() => {
    window.localStorage.clear();
    // Reset URL between tests — the URL-sync `useEffect` in
    // `ClueProvider` mutates `?view=` on every uiMode change, so
    // a stale param from a prior test would leak into hydration.
    window.history.replaceState(null, "", "/");
    // Suppress the splash, tour, and install-prompt auto-fires so
    // they don't stack on top of the underlying app under test.
    seedOnboardingDismissed();
});

describe("Clue — top-level structure", () => {
    test("renders the app title via next-intl", () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        // The mock returns the i18n key verbatim. `app.title` → `title`.
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
            "title",
        );
    });

    test("provider stack renders without throwing", () => {
        // Clue mounts TooltipProvider + ClueProvider + ConfirmProvider +
        // SelectionProvider together. If any of them had a missing peer
        // or threw on mount, render() would propagate the error — this
        // test pins that green path.
        expect(() => render(<Clue />, { wrapper: TestQueryClientProvider })).not.toThrow();
    });

    test("after the initial mount, hydration completes and the view skeleton is removed", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
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
        render(<Clue />, { wrapper: TestQueryClientProvider });
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
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            expect(window.location.search).toContain("view=checklist");
        });
    });

    test("`?view=suggest` → URL preserved through hydration", async () => {
        window.history.replaceState(null, "", "/?view=suggest");
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            expect(window.location.search).toContain("view=suggest");
        });
    });

    test("clicking the overflow menu's Game setup item from Suggest flips uiMode back to setup", async () => {
        // Regression: when CardPackUsage's RQ-cache entry was rehydrated
        // from the persister into a plain object, `usage.entries()` in
        // CardPackRow threw on the next render — which manifested as
        // "can't go back to Game setup" because the Setup screen
        // crashed on mount. Even without the persister, the dispatch
        // path itself must reliably flip `?view=setup`.
        const { default: userEvent } = await import("@testing-library/user-event");
        window.history.replaceState(null, "", "/?view=suggest");
        render(<Clue />, { wrapper: TestQueryClientProvider });
        // Wait for hydration so the Setup ↔ Play split has settled.
        await waitFor(() => {
            expect(window.location.search).toContain("view=suggest");
        });
        const user = userEvent.setup();
        // jsdom doesn't run a layout engine, so `offsetParent`
        // can't distinguish between the desktop Toolbar trigger and
        // the mobile BottomNav trigger. Both wire the same dispatch
        // callback, so clicking the first one is sufficient for the
        // regression — what matters is that the menu item's onClick
        // actually flips `uiMode` and doesn't crash on the way.
        const triggers = document.querySelectorAll<HTMLElement>(
            "[data-tour-anchor='overflow-menu']",
        );
        expect(triggers.length).toBeGreaterThan(0);
        await user.click(triggers[0]!);
        // The next-intl mock at the top of this file returns the
        // i18n key verbatim (with values JSON-appended), so the menu
        // label renders as `gameSetup:{"shortcut":...}` rather than
        // the production "Game setup (⌘H)" text. Match the prefix.
        const item = await screen.findByRole("button", {
            name: /^gameSetup/,
        });
        await user.click(item);
        await waitFor(() => {
            expect(window.location.search).toContain("view=setup");
        });
    });

    test("returning to setup after primary tours does not auto-fire the sharing follow-up mid-session", async () => {
        const { default: userEvent } = await import("@testing-library/user-event");
        window.localStorage.clear();
        seedStartupDismissedWithSharingEligible();
        window.history.replaceState(null, "", "/?view=checklist");

        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            expect(window.location.search).toContain("view=checklist");
        });
        expect(screen.queryByText("sharing.pack.title")).toBeNull();

        const user = userEvent.setup();
        const triggers = document.querySelectorAll<HTMLElement>(
            "[data-tour-anchor='overflow-menu']",
        );
        expect(triggers.length).toBeGreaterThan(0);
        await user.click(triggers[0]!);
        const item = await screen.findByRole("button", {
            name: /^gameSetup/,
        });
        await user.click(item);

        await waitFor(() => {
            expect(window.location.search).toContain("view=setup");
        });
        expect(screen.queryByText("sharing.pack.title")).toBeNull();
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
            accusations: [],
        });
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            expect(window.location.search).toContain("view=checklist");
        });
    });
});
