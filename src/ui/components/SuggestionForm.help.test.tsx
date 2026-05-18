import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, createElement } from "react";
import type { ReactNode } from "react";
import { Result } from "effect";

// -----------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------

// Return the i18n key (and stringified values) so assertions can match
// stable keys without pulling in the full message catalog.
vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    (t as unknown as { rich: unknown }).rich = (key: string) => key;
    return { useTranslations: () => t };
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
                            initial: _initial,
                            animate: _animate,
                            exit: _exit,
                            transition: _transition,
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

// Mock `useClueOptional` to feed the help layer a hand-rolled Clue
// context. The real provider is heavy (hydration, QueryClient, deducer);
// the hook only reads four fields so a thin shim is fine.
const useClueOptionalMock = vi.fn();
vi.mock("../state", () => ({
    useClueOptional: () => useClueOptionalMock(),
    useClue: () => useClueOptionalMock(),
}));

import { SuggestionForm } from "./SuggestionForm";
import { TooltipProvider } from "./Tooltip";
import { CLASSIC_SETUP_3P as setup } from "../../logic/GameSetup";
import { Player, PlayerOwner } from "../../logic/GameObjects";
import { cardByName } from "../../logic/test-utils/CardByName";
import {
    Cell,
    emptyKnowledge,
    setCell,
    type Knowledge,
    type CellValue,
} from "../../logic/Knowledge";

const A = Player("Anisha");
const MUSTARD = cardByName(setup, "Col. Mustard");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");

const withCells = (
    cells: ReadonlyArray<readonly [Player, ReturnType<typeof cardByName>, CellValue]>,
): Knowledge => {
    let k = emptyKnowledge;
    for (const [player, card, value] of cells) {
        k = setCell(k, Cell(PlayerOwner(player), card), value);
    }
    return k;
};

interface MockOpts {
    readonly selfPlayerId: Player | null;
    readonly teachMode?: boolean;
    readonly knowledge?: Knowledge;
}

const setMockContext = (opts: MockOpts): void => {
    useClueOptionalMock.mockReturnValue({
        state: {
            selfPlayerId: opts.selfPlayerId,
            teachMode: opts.teachMode ?? false,
            setup,
            suggestions: [],
        },
        derived: {
            deductionResult:
                opts.knowledge !== undefined
                    ? Result.succeed(opts.knowledge)
                    : Result.succeed(emptyKnowledge),
            perspectives: new Map(),
        },
    });
};

const renderForm = (ui: React.ReactElement) =>
    render(<TooltipProvider>{ui}</TooltipProvider>);

const openPopover = async (
    user: ReturnType<typeof userEvent.setup>,
    pillLabel: RegExp,
): Promise<HTMLElement> => {
    const trigger = screen.getByRole("button", { name: pillLabel });
    await user.click(trigger);
    const popover = document.querySelector<HTMLElement>(
        "[data-suggestion-form-popover='true']",
    );
    if (popover === null) throw new Error("no popover open");
    return popover;
};

describe("SuggestionForm — help badge gating", () => {
    test("renders no help badges when self player is unset", async () => {
        setMockContext({
            selfPlayerId: null,
            knowledge: withCells([[A, MUSTARD, "Y"]]),
        });
        const user = userEvent.setup();
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);

        // Pick a suggester (Bob) + a card (Mustard) so the help engine
        // would fire if it were active. Then open Passers — A's row
        // should NOT carry a badge.
        const sp = await openPopover(user, /pillSuggester/);
        await user.click(within(sp).getByRole("option", { name: /Bob/ }));
        const cp = document.querySelector<HTMLElement>(
            "[data-suggestion-form-popover='true']",
        )!;
        await user.click(
            within(cp).getByRole("option", { name: /Col\. Mustard/ }),
        );
        // Skip the other category pills and jump to Passers via click.
        await user.keyboard("{Escape}");
        const pp = await openPopover(user, /pillPassers/);
        // Help is suppressed when selfPlayerId is null.
        const anishaRow = within(pp).getByRole("option", { name: /Anisha/ });
        expect(anishaRow.textContent).not.toMatch(/Can refute/);
    });

    test("renders no help badges when teach mode is on", async () => {
        setMockContext({
            selfPlayerId: A,
            teachMode: true,
            knowledge: withCells([[A, MUSTARD, "Y"]]),
        });
        const user = userEvent.setup();
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);

        const sp = await openPopover(user, /pillSuggester/);
        await user.click(within(sp).getByRole("option", { name: /Bob/ }));
        const cp = document.querySelector<HTMLElement>(
            "[data-suggestion-form-popover='true']",
        )!;
        await user.click(
            within(cp).getByRole("option", { name: /Col\. Mustard/ }),
        );
        await user.keyboard("{Escape}");
        const pp = await openPopover(user, /pillPassers/);
        const anishaRow = within(pp).getByRole("option", { name: /Anisha/ });
        expect(anishaRow.textContent).not.toMatch(/Can refute/);
        expect(anishaRow.textContent).not.toMatch(/Cannot refute/);
    });
});

describe("SuggestionForm — help badges on Passers self-row", () => {
    test("self-row shows 'Can refute' warning badge when self has any Y on a suggested card", async () => {
        setMockContext({
            selfPlayerId: A,
            knowledge: withCells([[A, MUSTARD, "Y"]]),
        });
        const user = userEvent.setup();
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);

        // Suggester=B, suspect=Mustard (the Y for self) — definiteYes
        // fires immediately, even without weapon/room.
        const sp = await openPopover(user, /pillSuggester/);
        await user.click(within(sp).getByRole("option", { name: /Bob/ }));
        const cp = document.querySelector<HTMLElement>(
            "[data-suggestion-form-popover='true']",
        )!;
        await user.click(
            within(cp).getByRole("option", { name: /Col\. Mustard/ }),
        );
        await user.keyboard("{Escape}");
        const pp = await openPopover(user, /pillPassers/);
        const anishaRow = within(pp).getByRole("option", { name: /Anisha/ });
        // The badge text is "pillBadgeCanRefuteSelf" via the i18n mock.
        expect(anishaRow.textContent).toMatch(/pillBadgeCanRefuteSelf/);
        // Other players (no info) get no badge.
        const choRow = within(pp).getByRole("option", { name: /Cho/ });
        expect(choRow.textContent).not.toMatch(/pillBadgeCanRefuteSelf/);
    });

    test("self-row shows muted 'Cannot refute' when all cards are N and all categories filled", async () => {
        setMockContext({
            selfPlayerId: A,
            knowledge: withCells([
                [A, MUSTARD, "N"],
                [A, KNIFE, "N"],
                [A, KITCHEN, "N"],
            ]),
        });
        const user = userEvent.setup();
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);

        const sp = await openPopover(user, /pillSuggester/);
        await user.click(within(sp).getByRole("option", { name: /Bob/ }));
        const c1 = document.querySelector<HTMLElement>(
            "[data-suggestion-form-popover='true']",
        )!;
        await user.click(
            within(c1).getByRole("option", { name: /Col\. Mustard/ }),
        );
        const c2 = document.querySelector<HTMLElement>(
            "[data-suggestion-form-popover='true']",
        )!;
        await user.click(within(c2).getByRole("option", { name: /Knife/ }));
        const c3 = document.querySelector<HTMLElement>(
            "[data-suggestion-form-popover='true']",
        )!;
        await user.click(within(c3).getByRole("option", { name: /^Kitchen$/ }));
        await user.keyboard("{Escape}");
        const pp = await openPopover(user, /pillPassers/);
        const anishaRow = within(pp).getByRole("option", { name: /Anisha/ });
        // Muted "Cannot refute" — consistent with passing, no warning icon.
        expect(anishaRow.textContent).toMatch(/pillBadgeCannotRefuteSelf/);
    });

    test("no badge when self-evidence is noInfo (partial categories, no Y)", async () => {
        setMockContext({
            selfPlayerId: A,
            knowledge: withCells([
                [A, MUSTARD, "N"],
            ]),
        });
        const user = userEvent.setup();
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);

        const sp = await openPopover(user, /pillSuggester/);
        await user.click(within(sp).getByRole("option", { name: /Bob/ }));
        const c1 = document.querySelector<HTMLElement>(
            "[data-suggestion-form-popover='true']",
        )!;
        await user.click(
            within(c1).getByRole("option", { name: /Col\. Mustard/ }),
        );
        // Only suspect filled; KNIFE and KITCHEN unfilled.
        await user.keyboard("{Escape}");
        const pp = await openPopover(user, /pillPassers/);
        const anishaRow = within(pp).getByRole("option", { name: /Anisha/ });
        expect(anishaRow.textContent).not.toMatch(/pillBadgeCanRefute/);
        expect(anishaRow.textContent).not.toMatch(/pillBadgeCannotRefute/);
    });
});

describe("SuggestionForm — submit button warning", () => {
    test("submit reads 'Add anyway' when a soft warning is active", async () => {
        setMockContext({
            selfPlayerId: A,
            knowledge: withCells([
                [A, MUSTARD, "N"],
                [A, KNIFE, "N"],
                [A, KITCHEN, "N"],
            ]),
        });
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        renderForm(<SuggestionForm setup={setup} onSubmit={onSubmit} />);

        // Bob suggests Mustard/Knife/Kitchen; self (A) is the refuter
        // but self has no card in the suggestion (all-N). The Refuter
        // pill warning fires.
        const sp = await openPopover(user, /pillSuggester/);
        await user.click(within(sp).getByRole("option", { name: /Bob/ }));
        const c1 = document.querySelector<HTMLElement>(
            "[data-suggestion-form-popover='true']",
        )!;
        await user.click(
            within(c1).getByRole("option", { name: /Col\. Mustard/ }),
        );
        const c2 = document.querySelector<HTMLElement>(
            "[data-suggestion-form-popover='true']",
        )!;
        await user.click(within(c2).getByRole("option", { name: /Knife/ }));
        const c3 = document.querySelector<HTMLElement>(
            "[data-suggestion-form-popover='true']",
        )!;
        await user.click(within(c3).getByRole("option", { name: /^Kitchen$/ }));
        // Skip passers (just close).
        await user.keyboard("{Escape}");
        // Open refuter and pick self.
        const rp = await openPopover(user, /pillRefuter/);
        await user.click(within(rp).getByRole("option", { name: /Anisha/ }));
        await user.keyboard("{Escape}");

        // Submit button now reads "Add anyway" (the warning label key).
        const submit = screen.getByRole("button", {
            name: /submitWithWarning/,
        });
        expect(submit).toBeEnabled();
        expect(submit).toHaveAttribute("aria-disabled", "false");
        // Click submits anyway.
        await user.click(submit);
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    test("submit stays 'submit' when no warnings fire", async () => {
        setMockContext({
            selfPlayerId: A,
            knowledge: emptyKnowledge,
        });
        const user = userEvent.setup();
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);

        const sp = await openPopover(user, /pillSuggester/);
        await user.click(within(sp).getByRole("option", { name: /Bob/ }));
        const c1 = document.querySelector<HTMLElement>(
            "[data-suggestion-form-popover='true']",
        )!;
        await user.click(
            within(c1).getByRole("option", { name: /Col\. Mustard/ }),
        );
        const c2 = document.querySelector<HTMLElement>(
            "[data-suggestion-form-popover='true']",
        )!;
        await user.click(within(c2).getByRole("option", { name: /Knife/ }));
        const c3 = document.querySelector<HTMLElement>(
            "[data-suggestion-form-popover='true']",
        )!;
        await user.click(within(c3).getByRole("option", { name: /^Kitchen$/ }));
        await user.keyboard("{Escape}");
        // The button still reads the regular submit label, not the
        // "Add anyway" warning label.
        expect(
            screen.queryByRole("button", { name: /submitWithWarning/ }),
        ).toBeNull();
    });
});
