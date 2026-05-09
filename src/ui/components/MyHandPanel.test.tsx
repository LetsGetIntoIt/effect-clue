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

beforeEach(() => {
    window.localStorage.clear();
    seedOnboardingDismissed();
    window.history.replaceState(null, "", "/?view=checklist");
});

const findMyHand = (): HTMLElement | null =>
    document.querySelector("[data-my-hand-panel]");

describe("MyHandPanel — visibility", () => {
    test("does NOT mount when selfPlayerId is null (default state)", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        // Wait for play layout to mount
        await waitFor(() => {
            expect(document.getElementById("checklist")).toBeInTheDocument();
        });
        expect(findMyHand()).toBeNull();
    });

    test("does NOT mount when self is set but no cards are marked", async () => {
        // Seed a session with selfPlayerId set but hands empty.
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
        await waitFor(() => {
            expect(document.getElementById("checklist")).toBeInTheDocument();
        });
        expect(findMyHand()).toBeNull();
    });

    test("mounts when self is set AND cards are marked", async () => {
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
                        cards: [
                            { id: "card-knife", name: "Knife" },
                        ],
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
        const panel = await waitFor(() => {
            const found = findMyHand();
            if (!found) throw new Error("panel not mounted");
            return found;
        });
        // Both cards visible, grouped by category.
        expect(panel.textContent).toContain("Miss Scarlet");
        expect(panel.textContent).toContain("Knife");
        expect(panel.textContent).toContain("Suspect");
        expect(panel.textContent).toContain("Weapon");
    });
});

describe("RefuteHint", () => {
    const seedSessionWithDraft = (
        suggestedCards: ReadonlyArray<string>,
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
                    cards: [
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
                suggester: "Bob",
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

    test("hides when selfPlayerId is null", async () => {
        // Default session has selfPlayerId === null.
        window.history.replaceState(null, "", "/?view=suggest");
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            expect(
                document.getElementById("prior-suggestions"),
            ).toBeInTheDocument();
        });
        expect(document.querySelector("[data-refute-hint]")).toBeNull();
    });

    test("'You can refute with' lists intersection cards", async () => {
        seedSessionWithDraft([
            "card-miss-scarlet", // in hand
            "card-rope", // not in hand
            "card-library", // in hand
        ]);
        window.history.replaceState(null, "", "/?view=suggest");
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const hint = await waitFor(() => {
            const found = document.querySelector("[data-refute-hint]");
            if (!found) throw new Error("hint not rendered");
            return found;
        });
        expect(hint.textContent).toContain("Miss Scarlet");
        expect(hint.textContent).toContain("Library");
        expect(hint.textContent).not.toContain("Rope");
    });

    test("'You can't refute' shows when no cards intersect", async () => {
        seedSessionWithDraft([
            "card-col-mustard", // not in hand
            "card-rope", // not in hand
            "card-kitchen", // not in hand
        ]);
        window.history.replaceState(null, "", "/?view=suggest");
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const hint = await waitFor(() => {
            const found = document.querySelector("[data-refute-hint]");
            if (!found) throw new Error("hint not rendered");
            return found;
        });
        expect(hint.textContent).toContain("refuteHint.cannotRefute");
    });
});

describe("MyHandPanel — collapse toggle", () => {
    test("toggle hides the cards and persists to localStorage", async () => {
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
            hands: [
                { player: "Alice", cards: ["card-miss-scarlet"] },
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
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const panel = await waitFor(() => {
            const found = findMyHand();
            if (!found) throw new Error("panel not mounted");
            return found;
        });

        // Cards visible by default.
        expect(panel.textContent).toContain("Miss Scarlet");

        const hideBtn = Array.from(panel.querySelectorAll("button")).find(
            b => b.textContent === "myHand.toggleHide",
        );
        if (!hideBtn) throw new Error("no hide button");
        await user.click(hideBtn);

        await waitFor(() => {
            expect(panel.textContent).not.toContain("Miss Scarlet");
        });
        expect(
            window.localStorage.getItem(
                "effect-clue.my-hand-panel.collapsed.v1",
            ),
        ).toBe("1");
    });
});
