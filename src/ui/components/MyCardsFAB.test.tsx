import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next-intl", () => {
    const useTranslations = (ns?: string) => {
        const t = (key: string, values?: Record<string, unknown>): string => {
            const full = ns ? `${ns}.${key}` : key;
            return values ? `${full}:${JSON.stringify(values)}` : full;
        };
        (t as unknown as { rich: unknown }).rich = (key: string): string =>
            ns ? `${ns}.${key}` : key;
        return t;
    };
    return {
        useTranslations,
        useLocale: () => "en",
    };
});

import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Clue } from "../Clue";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { seedOnboardingDismissed } from "../../test-utils/onboardingSeed";

const seedDefaultSession = (): void => {
    const session = {
        version: 9,
        setup: {
            players: ["Alice", "Bob"],
            categories: [
                {
                    id: "category-suspects",
                    name: "Suspect",
                    cards: [
                        { id: "card-miss-scarlet", name: "Miss Scarlet" },
                    ],
                },
            ],
        },
        hands: [{ player: "Alice", cards: ["card-miss-scarlet"] }],
        handSizes: [],
        suggestions: [],
        accusations: [],
        hypotheses: [],
        pendingSuggestion: null,
        selfPlayerId: "Alice",
        firstDealtPlayerId: null,
    };
    window.localStorage.setItem(
        "effect-clue.session.v9",
        JSON.stringify(session),
    );
};

const seedMobileViewport = (): void => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: (query: string): MediaQueryList =>
            ({
                // Always false → not desktop → mobile path.
                matches: false,
                media: query,
                onchange: null,
                addListener: () => {},
                removeListener: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
                dispatchEvent: () => false,
            }) as unknown as MediaQueryList,
    });
};

const seedDesktopViewport = (): void => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: (query: string): MediaQueryList =>
            ({
                matches: query.includes("min-width: 800px"),
                media: query,
                onchange: null,
                addListener: () => {},
                removeListener: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
                dispatchEvent: () => false,
            }) as unknown as MediaQueryList,
    });
};

beforeEach(() => {
    window.localStorage.clear();
    seedOnboardingDismissed();
    window.history.replaceState(null, "", "/?view=checklist");
});

const findFab = (): HTMLElement | null =>
    document.querySelector("[data-tour-anchor~='my-cards-fab']");

const findPanel = (): HTMLElement | null =>
    document.querySelector("[data-my-cards-panel]");

describe("MyCardsFAB — viewport gating", () => {
    test("mounts on mobile play mode", async () => {
        seedMobileViewport();
        seedDefaultSession();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            expect(findFab()).not.toBeNull();
        });
        // The desktop section is NOT rendered on mobile (different
        // wrapper); only the FAB is the entry point.
        expect(document.querySelector("[data-my-hand-panel]")).toBeNull();
    });

    test("does NOT mount on desktop", async () => {
        seedDesktopViewport();
        seedDefaultSession();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            expect(document.querySelector("[data-my-hand-panel]")).not.toBeNull();
        });
        expect(findFab()).toBeNull();
    });

    test("does NOT mount in mobile setup mode", async () => {
        seedMobileViewport();
        seedDefaultSession();
        window.history.replaceState(null, "", "/?view=setup");
        render(<Clue />, { wrapper: TestQueryClientProvider });
        // Wait for the page to settle into setup mode.
        await waitFor(() => {
            expect(
                document.querySelector("[data-tour-anchor~='setup-wizard-header']"),
            ).not.toBeNull();
        });
        expect(findFab()).toBeNull();
    });
});

describe("MyCardsFAB — open / close", () => {
    test("clicking the FAB opens the panel and hides the FAB", async () => {
        seedMobileViewport();
        seedDefaultSession();
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const fab = await waitFor(() => {
            const found = findFab();
            if (!found) throw new Error("FAB not mounted");
            return found as HTMLButtonElement;
        });
        await user.click(fab);
        await waitFor(() => {
            const panel = findPanel();
            if (!panel) throw new Error("panel not mounted");
            return panel;
        });
        // FAB is hidden while the panel is open.
        await waitFor(() => {
            expect(findFab()).toBeNull();
        });
    });

    test("chevron in the panel header closes the panel and returns the FAB", async () => {
        seedMobileViewport();
        seedDefaultSession();
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const fab = await waitFor(() => {
            const found = findFab();
            if (!found) throw new Error("FAB not mounted");
            return found as HTMLButtonElement;
        });
        await user.click(fab);
        const panel = await waitFor(() => {
            const found = findPanel();
            if (!found) throw new Error("panel not mounted");
            return found;
        });
        const close = panel.querySelector<HTMLButtonElement>(
            "button[aria-label='myHand.panelCloseAriaLabel']",
        );
        if (!close) throw new Error("no close button");
        await user.click(close);
        await waitFor(() => {
            expect(findPanel()).toBeNull();
        });
        // FAB returns.
        await waitFor(() => {
            expect(findFab()).not.toBeNull();
        });
    });
});
