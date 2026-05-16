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

describe("MyCardsModal — opens from null state B", () => {
    test("clicking 'Select cards in your hand' pushes the modal with a single-column grid for the self player", async () => {
        // Null state B: identity is set, no cards marked.
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
                    {
                        id: "category-weapons",
                        name: "Weapon",
                        cards: [{ id: "card-knife", name: "Knife" }],
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
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });

        const button = await waitFor(() => {
            const found = document.querySelector<HTMLButtonElement>(
                "[data-tour-anchor~='my-cards-add-button']",
            );
            if (!found) throw new Error("Select-cards button not mounted");
            return found;
        });

        await user.click(button);

        // Modal mounts; the grid renders Alice's card-by-card column.
        await waitFor(() => {
            // The Radix Dialog content is portaled to document.body.
            const dialogTitle = document.querySelector("[role='dialog']");
            if (!dialogTitle) throw new Error("dialog not mounted");
        });

        // The grid shows a header row containing the self player's
        // name as the single column.
        const dialog = document.querySelector("[role='dialog']");
        expect(dialog?.textContent).toContain("Alice");
        // The grid lists each card name as a row.
        expect(dialog?.textContent).toContain("Miss Scarlet");
        expect(dialog?.textContent).toContain("Knife");
        // Other players are NOT included as columns.
        expect(dialog?.textContent ?? "").not.toContain("Bob");
        expect(dialog?.textContent ?? "").not.toContain("Cho");

        // Modal chrome matches the standard pattern: a visible
        // Dialog.Title, an X close button in the header, and a Done
        // CTA with the standard primary-button styling in a padded
        // footer band.
        const title = dialog?.querySelector("h2, [id^='radix-']");
        expect(dialog?.textContent).toContain("myHand.modalTitle");
        const closeButton =
            dialog?.querySelector<HTMLButtonElement>(
                "button[aria-label='common.close']",
            );
        expect(closeButton).not.toBeNull();
        const doneButton = Array.from(
            dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [],
        ).find((b) => b.textContent === "myHand.modalDone");
        expect(doneButton).toBeDefined();
        expect(doneButton?.className).toContain("tap-target");
        expect(doneButton?.className).toContain("text-tap");
        expect(doneButton?.className).toContain("border-accent");
        expect(doneButton?.className).toContain("bg-accent");
        // Compact variant must NOT be present.
        expect(doneButton?.className).not.toContain("tap-target-compact");

        // Suppress unused-var lint on the optional title handle.
        void title;
    });

    test("clicking Done closes the modal", async () => {
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
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });

        const openButton = await waitFor(() => {
            const found = document.querySelector<HTMLButtonElement>(
                "[data-tour-anchor~='my-cards-add-button']",
            );
            if (!found) throw new Error("Select-cards button not mounted");
            return found;
        });
        await user.click(openButton);

        await waitFor(() => {
            if (!document.querySelector("[role='dialog']")) {
                throw new Error("dialog not mounted");
            }
        });

        const doneButton = Array.from(
            document.querySelectorAll<HTMLButtonElement>(
                "[role='dialog'] button",
            ),
        ).find((b) => b.textContent === "myHand.modalDone");
        if (!doneButton) throw new Error("Done button not mounted");
        await user.click(doneButton);

        await waitFor(() => {
            if (document.querySelector("[role='dialog']")) {
                throw new Error("dialog still mounted after Done");
            }
        });
    });
});
