import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next-intl", () => {
    const useTranslations = (ns?: string) => {
        const t = (key: string, values?: Record<string, unknown>): string => {
            const full = ns ? `${ns}.${key}` : key;
            return values ? `${full}:${JSON.stringify(values)}` : full;
        };
        (t as unknown as { rich: unknown }).rich = (
            key: string,
            values?: Record<string, unknown>,
        ): unknown => {
            const full = ns ? `${ns}.${key}` : key;
            if (values === undefined) return full;
            // For rich-text calls, build a React-node array including
            // each named value so textContent assertions can match on
            // card names even when wrapped in tag callbacks.
            const out: Array<unknown> = [`${full}:`];
            for (const [chunkName, val] of Object.entries(values)) {
                if (typeof val === "function") {
                    out.push((val as () => unknown)());
                } else {
                    out.push(`[${chunkName}=${String(val)}]`);
                }
            }
            return out;
        };
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

beforeEach(() => {
    window.localStorage.clear();
    seedOnboardingDismissed();
    window.history.replaceState(null, "", "/?view=checklist");
    // Project 3: MyHandPanel renders only on desktop (≥800px); the
    // mobile entry point is MyCardsFAB (tested separately). Mock
    // matchMedia to desktop so `useIsDesktop` returns true.
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
});

const findMyHand = (): HTMLElement | null =>
    document.querySelector("[data-my-hand-panel]");

const waitForPanel = async (): Promise<HTMLElement> => {
    return await waitFor(() => {
        const found = findMyHand();
        if (!found) throw new Error("panel not mounted");
        return found;
    });
};

describe("MyHandPanel — always-on rendering", () => {
    test("mounts even when selfPlayerId is null (null state A)", async () => {
        // Default session has selfPlayerId === null AND a default
        // setup with players present (so the pill row can render).
        const session = {
            version: 9,
            setup: {
                players: ["Alice", "Bob", "Cho"],
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
            hands: [],
            handSizes: [],
            suggestions: [],
            accusations: [],
            hypotheses: [],
            pendingSuggestion: null,
            selfPlayerId: null,
            firstDealtPlayerId: null,
        };
        window.localStorage.setItem(
            "effect-clue.session.v9",
            JSON.stringify(session),
        );
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const panel = await waitForPanel();
        // Null state A copy + identity picker present.
        expect(panel.textContent).toContain("myHand.nullStateAPrompt");
        const pickerWrap = panel.querySelector(
            "[data-tour-anchor~='my-cards-identity-picker']",
        );
        expect(pickerWrap).not.toBeNull();
        // One pill per player.
        const pills = pickerWrap?.querySelectorAll("button");
        expect(pills?.length).toBe(3);
    });

    test("mounts when identity is set but no cards marked (null state B)", async () => {
        const session = {
            version: 9,
            setup: {
                players: ["Alice", "Bob", "Cho"],
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
            hands: [],
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
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const panel = await waitForPanel();
        expect(panel.textContent).toContain("myHand.nullStateBPrompt");
        expect(
            panel.querySelector("[data-tour-anchor~='my-cards-add-button']"),
        ).not.toBeNull();
    });

    test("mounts in populated state (identity + cards)", async () => {
        const session = {
            version: 9,
            setup: {
                players: ["Alice", "Bob", "Cho"],
                categories: [
                    {
                        id: "category-suspects",
                        name: "Suspect",
                        cards: [
                            { id: "card-miss-scarlet", name: "Miss Scarlet" },
                            { id: "card-col-mustard", name: "Col. Mustard" },
                        ],
                    },
                    {
                        id: "category-weapons",
                        name: "Weapon",
                        cards: [{ id: "card-knife", name: "Knife" }],
                    },
                ],
            },
            hands: [
                {
                    player: "Alice",
                    cards: ["card-miss-scarlet", "card-knife"],
                },
            ],
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
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const panel = await waitForPanel();
        expect(panel.textContent).toContain("Miss Scarlet");
        expect(panel.textContent).toContain("Knife");
        expect(panel.textContent).toContain("Suspect");
        expect(panel.textContent).toContain("Weapon");
    });
});

describe("MyHandPanel — collapse toggle", () => {
    test("chevron toggles aria-expanded + aria-hides the body and persists to localStorage", async () => {
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
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const panel = await waitForPanel();

        const chevron = panel.querySelector<HTMLButtonElement>(
            "button[aria-expanded]",
        );
        if (!chevron) throw new Error("no chevron button");
        // Default expanded.
        expect(chevron.getAttribute("aria-expanded")).toBe("true");

        const bodyWrapper = panel.querySelector<HTMLElement>(
            "[data-my-hand-panel-body]",
        );
        if (!bodyWrapper) throw new Error("no body wrapper");
        expect(bodyWrapper.getAttribute("aria-hidden")).toBe("false");

        await user.click(chevron);

        // After collapse: aria-expanded flips, body wrapper aria-hides
        // (the body remains in the DOM so motion can animate height
        // from auto → 0 instead of unmounting; the user-observable
        // change is the aria + visual height, not removal).
        await waitFor(() => {
            expect(chevron.getAttribute("aria-expanded")).toBe("false");
        });
        expect(bodyWrapper.getAttribute("aria-hidden")).toBe("true");
        expect(
            window.localStorage.getItem(
                "effect-clue.my-hand-panel.collapsed.v1",
            ),
        ).toBe("1");
    });
});

describe("MyHandPanel — banner integration", () => {
    const seedSessionWithDraft = (
        suggestedCards: ReadonlyArray<string>,
        opts: { selfHand?: ReadonlyArray<string>; suggester?: string } = {},
    ): void => {
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
                            { id: "card-col-mustard", name: "Col. Mustard" },
                        ],
                    },
                    {
                        id: "category-weapons",
                        name: "Weapon",
                        cards: [
                            { id: "card-knife", name: "Knife" },
                            { id: "card-rope", name: "Rope" },
                        ],
                    },
                    {
                        id: "category-rooms",
                        name: "Room",
                        cards: [
                            { id: "card-library", name: "Library" },
                            { id: "card-kitchen", name: "Kitchen" },
                        ],
                    },
                ],
            },
            hands: [
                {
                    player: "Alice",
                    cards: opts.selfHand ?? [
                        "card-miss-scarlet",
                        "card-knife",
                        "card-library",
                    ],
                },
            ],
            handSizes: [],
            suggestions: [],
            accusations: [],
            hypotheses: [],
            pendingSuggestion: {
                id: "draft-1",
                suggester: opts.suggester ?? "Bob",
                cards: suggestedCards,
                nonRefutersDecided: false,
                nonRefutersIsNobody: false,
                nonRefuters: [],
                refuterDecided: false,
                refuterIsNobody: false,
                refuter: null,
                seenCardDecided: false,
                seenCardIsNobody: false,
                seenCard: null,
            },
            selfPlayerId: "Alice",
            firstDealtPlayerId: null,
        };
        window.localStorage.setItem(
            "effect-clue.session.v9",
            JSON.stringify(session),
        );
    };

    const findBanner = (): HTMLElement | null =>
        document.querySelector("[data-tour-anchor~='my-cards-banner']");

    test("banner mounts inside the My Cards section when intersection has matches", async () => {
        seedSessionWithDraft([
            "card-miss-scarlet", // in hand
            "card-rope", // not in hand
            "card-library", // in hand
        ]);
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForPanel();
        await waitFor(() => {
            const banner = findBanner();
            if (!banner) throw new Error("banner not rendered");
            expect(banner.textContent).toContain("Miss Scarlet");
        });
    });

    test("banner stays hidden on partial draft with empty intersection", async () => {
        // Only 1 slot filled, not in hand. Banner should NOT show
        // (per the partial-draft hide rule).
        seedSessionWithDraft([
            "card-col-mustard", // not in hand
            null as unknown as string,
            null as unknown as string,
        ]);
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForPanel();
        // Give it a beat to settle.
        await new Promise(r => setTimeout(r, 50));
        expect(findBanner()).toBeNull();
    });

    test("'You can't refute' shows on a complete draft with no intersection", async () => {
        seedSessionWithDraft([
            "card-col-mustard", // not in hand
            "card-rope", // not in hand
            "card-kitchen", // not in hand
        ]);
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForPanel();
        await waitFor(() => {
            const banner = findBanner();
            if (!banner) throw new Error("banner not rendered");
            expect(banner.getAttribute("data-banner-kind")).toBe("cannotRefute");
        });
    });
});
