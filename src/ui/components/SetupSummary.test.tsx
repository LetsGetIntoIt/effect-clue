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

import { render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Clue } from "../Clue";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { seedOnboardingDismissed } from "../../test-utils/onboardingSeed";

beforeEach(() => {
    window.localStorage.clear();
    seedOnboardingDismissed();
    window.history.replaceState(null, "", "/?view=checklist");
});

const findSummary = (): HTMLElement | null =>
    document.querySelector("[data-setup-summary]");

const waitForSummary = async (): Promise<HTMLElement> => {
    await waitFor(() => {
        expect(findSummary()).toBeInTheDocument();
    });
    return findSummary() as HTMLElement;
};

describe("SetupSummary — visibility", () => {
    test("mounts above the play layout in checklist mode", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForSummary();
    });

    test("does NOT mount in setup mode (only in play mode)", async () => {
        window.history.replaceState(null, "", "/?view=setup");
        render(<Clue />, { wrapper: TestQueryClientProvider });
        // Wait for setup wizard shell to render then ensure the
        // summary panel is absent from the page.
        await waitFor(() => {
            expect(
                document.querySelector('[data-tour-anchor="setup-wizard-shell"]'),
            ).toBeInTheDocument();
        });
        expect(findSummary()).toBeNull();
    });

    test("hides the My cards row when selfPlayerId is null", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const summary = await waitForSummary();
        expect(
            within(summary).queryByText(/setupSummary\.myCards\.label/),
        ).toBeNull();
    });
});

describe("SetupSummary — rows", () => {
    test("Card pack row shows category + card count for the default Classic deck", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const summary = await waitForSummary();
        // Classic deck has 3 categories and 21 cards (6+6+9). The
        // values get JSON-stringified by the test t() shim.
        expect(
            within(summary).getByText(
                /setupSummary\.cardPack\.summary:\{"categories":3,"cards":21\}/,
            ),
        ).toBeInTheDocument();
    });

    test("Players row shows the count for the default 4-player preset", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const summary = await waitForSummary();
        expect(
            within(summary).getByText(
                /setupSummary\.players\.summary:\{"count":4\}/,
            ),
        ).toBeInTheDocument();
    });

    test("Identity row reads as 'unset' on a fresh game", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const summary = await waitForSummary();
        expect(
            within(summary).getByText(/setupSummary\.identity\.summaryUnset/),
        ).toBeInTheDocument();
    });
});

describe("SetupSummary — collapse toggle", () => {
    test("clicking the toggle hides the rows and persists to localStorage", async () => {
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const summary = await waitForSummary();

        // Rows are visible by default.
        expect(
            within(summary).getByText(/setupSummary\.cardPack\.label/),
        ).toBeInTheDocument();

        const toggle = within(summary).getByRole("button", {
            name: /setupSummary\.toggleCollapse/,
        });
        await user.click(toggle);

        await waitFor(() => {
            expect(
                within(summary).queryByText(/setupSummary\.cardPack\.label/),
            ).toBeNull();
        });
        expect(
            window.localStorage.getItem("effect-clue.setup-summary.collapsed.v1"),
        ).toBe("1");
    });
});

describe("SetupSummary — inline identity edit", () => {
    test("clicking 'Set yourself' opens a popover with player options", async () => {
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const summary = await waitForSummary();

        const setSelf = within(summary).getByRole("button", {
            name: /setupSummary\.identity\.setSelf/,
        });
        await user.click(setSelf);

        // The Radix popover content is portaled — search at document
        // scope. Player 1 from the default preset should appear as a
        // radio.
        await waitFor(() => {
            const radios = document.querySelectorAll('[role="radio"]');
            expect(radios.length).toBeGreaterThan(0);
        });
    });

    test("picking a player updates the identity row summary", async () => {
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const summary = await waitForSummary();

        const setSelf = within(summary).getByRole("button", {
            name: /setupSummary\.identity\.setSelf/,
        });
        await user.click(setSelf);

        // Player 1 radio in the popover.
        const player1Radio = await waitFor(() => {
            const r = Array.from(
                document.querySelectorAll('[role="radio"]'),
            ).find(el => el.textContent === "Player 1");
            if (!r) throw new Error("Player 1 radio not found");
            return r as HTMLElement;
        });
        await user.click(player1Radio);

        // Identity row summary should now be the "summary" key with
        // Player 1 in the values payload (not summaryUnset).
        await waitFor(() => {
            expect(
                within(summary).getByText(
                    /setupSummary\.identity\.summary:\{"player":"Player 1"\}/,
                ),
            ).toBeInTheDocument();
        });
    });

    test("setting identity reveals the My cards row", async () => {
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const summary = await waitForSummary();

        // Self is unset → no My cards row.
        expect(
            within(summary).queryByText(/setupSummary\.myCards\.label/),
        ).toBeNull();

        const setSelf = within(summary).getByRole("button", {
            name: /setupSummary\.identity\.setSelf/,
        });
        await user.click(setSelf);

        const player1Radio = await waitFor(() => {
            const r = Array.from(
                document.querySelectorAll('[role="radio"]'),
            ).find(el => el.textContent === "Player 1");
            if (!r) throw new Error("Player 1 radio not found");
            return r as HTMLElement;
        });
        await user.click(player1Radio);

        await waitFor(() => {
            expect(
                within(summary).getByText(/setupSummary\.myCards\.label/),
            ).toBeInTheDocument();
        });
    });
});

describe("SetupSummary — jump to wizard", () => {
    test("'Change deck' switches the UI to setup mode", async () => {
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const summary = await waitForSummary();

        const changeDeck = within(summary).getByRole("button", {
            name: /setupSummary\.cardPack\.edit/,
        });
        await user.click(changeDeck);

        // After dispatch, the wizard mounts. The summary may still
        // briefly co-exist depending on AnimatePresence timing in
        // jsdom; the contract under test is "wizard appears."
        await waitFor(() => {
            expect(
                document.querySelector(
                    '[data-tour-anchor="setup-wizard-shell"]',
                ),
            ).toBeInTheDocument();
        });
    });

    test("'Add or remove' on the players row opens the wizard", async () => {
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const summary = await waitForSummary();

        const addOrRemove = within(summary).getByRole("button", {
            name: /setupSummary\.players\.addOrRemove/,
        });
        await user.click(addOrRemove);

        await waitFor(() => {
            expect(
                document.querySelector(
                    '[data-tour-anchor="setup-wizard-shell"]',
                ),
            ).toBeInTheDocument();
        });
    });
});
