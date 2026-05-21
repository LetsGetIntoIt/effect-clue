import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, createElement } from "react";
import type { ReactNode } from "react";
import { Result } from "effect";
import type { SolverMode } from "../../logic/ClueState";

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
const B = Player("Bob");
const C = Player("Cho");
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
    readonly solverMode?: SolverMode;
    readonly knowledge?: Knowledge;
}

const setMockContext = (opts: MockOpts): void => {
    useClueOptionalMock.mockReturnValue({
        state: {
            selfPlayerId: opts.selfPlayerId,
            solverMode: opts.solverMode ?? "solve",
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
    test("still renders badges when self player is unset (M2: per-player evidence)", async () => {
        setMockContext({
            selfPlayerId: null,
            knowledge: withCells([[A, MUSTARD, "Y"]]),
        });
        const user = userEvent.setup();
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);

        // Pick a suggester (Bob) + a card (Mustard) so the engine
        // fires on every player with relevant Knowledge. Anisha holds
        // Mustard — Anisha's row should carry "Can refute" even
        // though selfPlayerId is null.
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
        expect(anishaRow.textContent).toMatch(/pillBadgeCanRefute/);
    });

    test("renders no help badges when teach mode is on", async () => {
        setMockContext({
            selfPlayerId: A,
            solverMode: "check",
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
        expect(anishaRow.textContent).not.toMatch(/pillBadgeCanRefute/);
        expect(anishaRow.textContent).not.toMatch(/pillBadgeCannotRefute/);
    });

    test("suggester row carries no badge (own suggestion is not refutable)", async () => {
        // Self is Anisha and Anisha holds Mustard. Then Bob is picked
        // as the suggester. Bob's row should NOT carry a badge — the
        // suggester can't refute their own suggestion.
        setMockContext({
            selfPlayerId: A,
            knowledge: withCells([[B, MUSTARD, "Y"]]),
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
        const bobRow = within(pp).getByRole("option", { name: /Bob/ });
        expect(bobRow.textContent).not.toMatch(/pillBadgeCanRefute/);
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
        expect(anishaRow.textContent).toMatch(/pillBadgeCanRefute/);
        // Other players (no info) get no badge.
        const choRow = within(pp).getByRole("option", { name: /Cho/ });
        expect(choRow.textContent).not.toMatch(/pillBadgeCanRefute/);
    });

    test("non-self player row shows 'Can refute' when Knowledge proves they hold one of the cards", async () => {
        // Cho has the Knife. The user opens Passers — Cho's row should
        // carry the warning badge even though Cho is not self.
        setMockContext({
            selfPlayerId: A,
            knowledge: withCells([[C, KNIFE, "Y"]]),
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
        const cp2 = document.querySelector<HTMLElement>(
            "[data-suggestion-form-popover='true']",
        )!;
        await user.click(within(cp2).getByRole("option", { name: /Knife/ }));
        await user.keyboard("{Escape}");
        const pp = await openPopover(user, /pillPassers/);
        const choRow = within(pp).getByRole("option", { name: /Cho/ });
        expect(choRow.textContent).toMatch(/pillBadgeCanRefute/);
        const anishaRow = within(pp).getByRole("option", { name: /Anisha/ });
        expect(anishaRow.textContent).not.toMatch(/pillBadgeCanRefute/);
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
        expect(anishaRow.textContent).toMatch(/pillBadgeCannotRefute/);
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

// -----------------------------------------------------------------------
// Badge elevation styling — option-row badges stay muted until the pill
// itself is in the matching error / warning state due to that option
// being committed. Same precedence as the pill (error > warning > muted).
// -----------------------------------------------------------------------

type Elevation = "error" | "warning" | "muted";

const findBadge = (row: HTMLElement, labelKey: RegExp): HTMLElement | null => {
    const spans = Array.from(row.querySelectorAll<HTMLElement>("span"));
    return (
        spans.find(
            s =>
                labelKey.test(s.textContent ?? "") &&
                /\bborder\b/.test(s.className),
        ) ?? null
    );
};

const elevationOf = (badge: HTMLElement): Elevation => {
    const cls = badge.className;
    if (cls.includes("bg-danger-bg")) return "error";
    if (cls.includes("bg-warning-bg")) return "warning";
    return "muted";
};

const hasAlertIcon = (badge: HTMLElement): boolean =>
    badge.querySelector("svg") !== null;

describe("SuggestionForm — badge elevation tracks pill state", () => {
    test("hard-conflict preview is muted; elevates to error on commit", async () => {
        // Cross-role conflict: pick Bob as Refuter. Before committing
        // him as Suggester, his row in the Suggester dropdown should
        // show a muted "Refuter" preview. After committing him as
        // Suggester too, the same row should elevate to error.
        setMockContext({
            selfPlayerId: A,
            knowledge: emptyKnowledge,
        });
        const user = userEvent.setup();
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);

        // Stage 1: only Refuter committed.
        // Skip suggester first by clicking elsewhere; instead navigate
        // straight to refuter via tab keys is fragile in jsdom — easier
        // to first commit a suggester (Anisha), then refuter (Bob),
        // then RE-OPEN suggester and verify Bob's row.
        const sp1 = await openPopover(user, /pillSuggester/);
        await user.click(within(sp1).getByRole("option", { name: /Anisha/ }));
        // close downstream popovers if any.
        await user.keyboard("{Escape}");
        const rp = await openPopover(user, /pillRefuter/);
        await user.click(within(rp).getByRole("option", { name: /Bob/ }));
        await user.keyboard("{Escape}");

        // Re-open Suggester: Bob is currently the Refuter (preview
        // conflict), but Bob is NOT yet the suggester — muted.
        const sp2 = await openPopover(user, /pillSuggester/);
        const bobRow = within(sp2).getByRole("option", { name: /Bob/ });
        const previewBadge = findBadge(bobRow, /pillBadgeRoleRefuter/);
        expect(previewBadge).not.toBeNull();
        expect(elevationOf(previewBadge!)).toBe("muted");
        expect(hasAlertIcon(previewBadge!)).toBe(false);

        // Stage 2: commit Bob as Suggester too — both pills go error.
        await user.click(bobRow);
        await user.keyboard("{Escape}");
        const sp3 = await openPopover(user, /pillSuggester/);
        const bobRow2 = within(sp3).getByRole("option", { name: /Bob/ });
        const errorBadge = findBadge(bobRow2, /pillBadgeRoleRefuter/);
        expect(errorBadge).not.toBeNull();
        expect(elevationOf(errorBadge!)).toBe("error");
        expect(hasAlertIcon(errorBadge!)).toBe(true);
    });

    test("Passers 'Can refute' is muted before pill warning, elevates after commit", async () => {
        // Anisha holds Mustard. Open Passers without checking Anisha:
        // her row shows the "Can refute" info chip in muted style.
        // After checking her into passers, the pill warns and her chip
        // elevates to warning.
        setMockContext({
            selfPlayerId: A,
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

        // Before commit: muted "Can refute" on Anisha's row.
        const pp1 = await openPopover(user, /pillPassers/);
        const anishaRow1 = within(pp1).getByRole("option", { name: /Anisha/ });
        const mutedBadge = findBadge(anishaRow1, /pillBadgeCanRefute/);
        expect(mutedBadge).not.toBeNull();
        expect(elevationOf(mutedBadge!)).toBe("muted");
        expect(hasAlertIcon(mutedBadge!)).toBe(false);

        // Check Anisha as passer → pill warns → re-open and verify.
        await user.click(anishaRow1);
        await user.keyboard("{Escape}");
        const pp2 = await openPopover(user, /pillPassers/);
        const anishaRow2 = within(pp2).getByRole("option", { name: /Anisha/ });
        const warnBadge = findBadge(anishaRow2, /pillBadgeCanRefute/);
        expect(warnBadge).not.toBeNull();
        expect(elevationOf(warnBadge!)).toBe("warning");
        expect(hasAlertIcon(warnBadge!)).toBe(true);
    });

    test("Refuter 'Cannot refute' is muted before commit, elevates to warning after", async () => {
        // Self (Anisha) holds NONE of the suggested cards. Picking
        // Anisha as refuter fires `refuterCannotRefute`. Before the
        // commit, her row in the Refuter dropdown shows muted
        // "Cannot refute"; after commit it elevates to warning.
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
        await user.click(
            within(c3).getByRole("option", { name: /^Kitchen$/ }),
        );
        await user.keyboard("{Escape}");

        // Open Refuter — Anisha's row shows muted "Cannot refute".
        const rp1 = await openPopover(user, /pillRefuter/);
        const anishaRow1 = within(rp1).getByRole("option", { name: /Anisha/ });
        const mutedBadge = findBadge(anishaRow1, /pillBadgeCannotRefute/);
        expect(mutedBadge).not.toBeNull();
        expect(elevationOf(mutedBadge!)).toBe("muted");
        expect(hasAlertIcon(mutedBadge!)).toBe(false);

        // Pick Anisha → pill warns → re-open and verify elevation.
        await user.click(anishaRow1);
        await user.keyboard("{Escape}");
        const rp2 = await openPopover(user, /pillRefuter/);
        const anishaRow2 = within(rp2).getByRole("option", { name: /Anisha/ });
        const warnBadge = findBadge(anishaRow2, /pillBadgeCannotRefute/);
        expect(warnBadge).not.toBeNull();
        expect(elevationOf(warnBadge!)).toBe("warning");
        expect(hasAlertIcon(warnBadge!)).toBe(true);
    });

    test("only the committed cause elevates — other rows stay muted", async () => {
        // Both Anisha and Cho hold cards that could refute. Only
        // Anisha is added as a passer. Anisha's "Can refute" badge
        // should be warning; Cho's should stay muted.
        setMockContext({
            selfPlayerId: A,
            knowledge: withCells([
                [A, MUSTARD, "Y"],
                [C, KNIFE, "Y"],
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
        await user.keyboard("{Escape}");

        // Check only Anisha as passer.
        const pp1 = await openPopover(user, /pillPassers/);
        const anishaRowOpen = within(pp1).getByRole("option", {
            name: /Anisha/,
        });
        await user.click(anishaRowOpen);
        await user.keyboard("{Escape}");

        // Re-open and verify per-row elevation.
        const pp2 = await openPopover(user, /pillPassers/);
        const anishaRow = within(pp2).getByRole("option", { name: /Anisha/ });
        const choRow = within(pp2).getByRole("option", { name: /Cho/ });

        const anishaBadge = findBadge(anishaRow, /pillBadgeCanRefute/);
        const choBadge = findBadge(choRow, /pillBadgeCanRefute/);
        expect(anishaBadge).not.toBeNull();
        expect(choBadge).not.toBeNull();
        expect(elevationOf(anishaBadge!)).toBe("warning");
        expect(elevationOf(choBadge!)).toBe("muted");
        expect(hasAlertIcon(anishaBadge!)).toBe(true);
        expect(hasAlertIcon(choBadge!)).toBe(false);
    });

    test("Passers error elevation when committed passer is also the suggester", async () => {
        // Bob is suggester. Reopen suggester pill while bob is also
        // checked as a passer → both pills carry `suggesterInPassers`.
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
        await user.keyboard("{Escape}");

        // Open Passers and check Bob (who is the current suggester).
        const pp1 = await openPopover(user, /pillPassers/);
        const bobRowOpen = within(pp1).getByRole("option", { name: /Bob/ });
        // Preview "Suggester" badge should be muted before commit.
        const previewBadge = findBadge(bobRowOpen, /pillBadgeRoleSuggester/);
        expect(previewBadge).not.toBeNull();
        expect(elevationOf(previewBadge!)).toBe("muted");

        await user.click(bobRowOpen);
        await user.keyboard("{Escape}");

        // Re-open and verify Bob's badge is now error.
        const pp2 = await openPopover(user, /pillPassers/);
        const bobRow = within(pp2).getByRole("option", { name: /Bob/ });
        const errorBadge = findBadge(bobRow, /pillBadgeRoleSuggester/);
        expect(errorBadge).not.toBeNull();
        expect(elevationOf(errorBadge!)).toBe("error");
        expect(hasAlertIcon(errorBadge!)).toBe(true);
    });

    test("muted baseline: 'Cannot refute' on Passers row uses muted class without AlertIcon", async () => {
        // Self has no card in the suggestion (all N, all categories
        // filled) — no pill warning fires on Passers (since Anisha is
        // not selected as passer), so her "Cannot refute" badge should
        // be muted with no AlertIcon.
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
        await user.click(
            within(c3).getByRole("option", { name: /^Kitchen$/ }),
        );
        await user.keyboard("{Escape}");

        const pp = await openPopover(user, /pillPassers/);
        const anishaRow = within(pp).getByRole("option", { name: /Anisha/ });
        const badge = findBadge(anishaRow, /pillBadgeCannotRefute/);
        expect(badge).not.toBeNull();
        expect(elevationOf(badge!)).toBe("muted");
        expect(hasAlertIcon(badge!)).toBe(false);
        // Visible framing — the muted class carries `bg-control` so it
        // contrasts against the dropdown's `bg-panel` background.
        expect(badge!.className).toMatch(/bg-control/);
    });
});
