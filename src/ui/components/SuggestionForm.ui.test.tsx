import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom/jest-globals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, createElement } from "react";
import type { ReactNode } from "react";

// -----------------------------------------------------------------------
// ESM mocks — must go through `jest.unstable_mockModule` because ts-jest
// under ESM does not hoist classic `jest.mock` calls. Modules that depend
// on the mocks get imported dynamically inside `beforeAll` below.
// -----------------------------------------------------------------------

jest.unstable_mockModule("next-intl", () => {
    // Return the translation key so assertions can look for stable
    // strings (`pillSuggester`, `pillPassers`, …) without pulling in
    // the full message catalog.
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    (t as unknown as { rich: unknown }).rich = (
        key: string,
        _values?: Record<string, unknown>,
    ): string => key;
    return { useTranslations: () => t };
});

// motion/react uses requestAnimationFrame / layout measurement APIs that
// don't play well in jsdom. Replace every `motion.<tag>` with a plain
// DOM element and make `AnimatePresence` a passthrough — we care about
// DOM structure, not animations, for these tests.
jest.unstable_mockModule("motion/react", () => {
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
        // useReducedMotion is consulted by `src/ui/motion.ts` helpers.
        // Always return false — the real hook reads `matchMedia`, which
        // jsdom partially stubs.
        useReducedMotion: () => false,
        LayoutGroup: ({ children }: { children: ReactNode }) => children,
    };
});

// Deferred imports: resolved after mocks are registered, below.
type Deferred = {
    readonly SuggestionForm: typeof import("./SuggestionForm").SuggestionForm;
    readonly TooltipProvider: typeof import("./Tooltip").TooltipProvider;
    readonly setup: typeof import("../../logic/GameSetup").CLASSIC_SETUP_3P;
    readonly SuggestionId: typeof import(
        "../../logic/Suggestion"
    ).SuggestionId;
    readonly Player: typeof import("../../logic/GameObjects").Player;
    readonly cardByName: typeof import(
        "../../logic/test-utils/CardByName"
    ).cardByName;
};
let deferred: Deferred;

const renderForm = (
    ui: React.ReactElement,
): ReturnType<typeof render> =>
    render(<deferred.TooltipProvider>{ui}</deferred.TooltipProvider>);

beforeAll(async () => {
    // Sequential awaits — Jest 29's VM ESM linker can't resolve
    // transitive `effect` dependencies when multiple imports race.
    const { SuggestionForm } = await import("./SuggestionForm");
    const { TooltipProvider } = await import("./Tooltip");
    const { CLASSIC_SETUP_3P } = await import("../../logic/GameSetup");
    const { SuggestionId } = await import("../../logic/Suggestion");
    const { Player } = await import("../../logic/GameObjects");
    const { cardByName } = await import("../../logic/test-utils/CardByName");
    deferred = {
        SuggestionForm,
        TooltipProvider,
        setup: CLASSIC_SETUP_3P,
        SuggestionId,
        Player,
        cardByName,
    };
});

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

// Open a pill's popover by clicking its trigger. Radix portals the
// popover and tags it with `data-suggestion-form-popover="true"`; we
// locate it via that attribute so the caller doesn't have to care
// which pill is visually associated with the popover.
const openPopover = async (
    user: ReturnType<typeof userEvent.setup>,
    pillLabel: RegExp,
): Promise<HTMLElement> => {
    const trigger = screen.getByRole("button", { name: pillLabel });
    await user.click(trigger);
    return getCurrentPopover();
};

// Grab whichever popover is currently open. Auto-advance means
// committing one pill opens the next one without an extra click,
// so tests can chain commits and re-query the open popover.
const getCurrentPopover = (): HTMLElement => {
    const popover = document.querySelector<HTMLElement>(
        "[data-suggestion-form-popover='true']",
    );
    if (popover === null) throw new Error("no popover open");
    return popover;
};

// -----------------------------------------------------------------------
// Rendering + basic structure
// -----------------------------------------------------------------------

describe("SuggestionForm — rendering", () => {
    test("renders triggers for every enabled pill", () => {
        const { SuggestionForm, setup } = deferred;
        renderForm(<SuggestionForm setup={setup} onSubmit={jest.fn()} />);
        // Initial state: suggester + 3 categories + passers + refuter = 6
        // triggers. The shown-card pill is disabled until a refuter is
        // picked (see separate test) and so renders as a non-button.
        const pillIds = Array.from(
            document.querySelectorAll("[data-pill-id]"),
        ).map(el => el.getAttribute("data-pill-id"));
        expect(pillIds).toEqual([
            "suggester",
            "card-0",
            "card-1",
            "card-2",
            "passers",
            "refuter",
        ]);
    });

    test("Add button is disabled until all required slots are filled", () => {
        const { SuggestionForm, setup } = deferred;
        renderForm(<SuggestionForm setup={setup} onSubmit={jest.fn()} />);
        const submit = screen.getByRole("button", { name: /submit/ });
        expect(submit).toBeDisabled();
    });

    test("Shown-card pill is disabled until a refuter is picked", () => {
        const { SuggestionForm, setup } = deferred;
        renderForm(<SuggestionForm setup={setup} onSubmit={jest.fn()} />);
        // The Shown-card pill renders as a span wrapper when disabled
        // (not a button trigger) — assert no `data-pill-id="seenCard"`
        // trigger exists in the initial render.
        const seenTrigger = document.querySelector(
            "[data-pill-id='seenCard']",
        );
        expect(seenTrigger).toBeNull();
    });
});

// -----------------------------------------------------------------------
// Happy-path: fill out + submit
// -----------------------------------------------------------------------

describe("SuggestionForm — submit flow", () => {
    test("picking suggester + one card per category enables submit and dispatches the draft", async () => {
        const { SuggestionForm, setup, Player, cardByName } = deferred;
        const A = Player("Anisha");
        const MUSTARD = cardByName(setup, "Col. Mustard");
        const KNIFE = cardByName(setup, "Knife");
        const KITCHEN = cardByName(setup, "Kitchen");

        const user = userEvent.setup();
        const onSubmit = jest.fn();
        renderForm(<SuggestionForm setup={setup} onSubmit={onSubmit} />);

        // Click the first pill; auto-advance opens each subsequent
        // popover after a commit, so we re-query the current popover
        // instead of clicking again.
        const pop1 = await openPopover(user, /pillSuggester/);
        await user.click(within(pop1).getByRole("option", { name: /Anisha/ }));

        const pop2 = getCurrentPopover();
        await user.click(
            within(pop2).getByRole("option", { name: /Col\. Mustard/ }),
        );

        const pop3 = getCurrentPopover();
        await user.click(within(pop3).getByRole("option", { name: /Knife/ }));

        const pop4 = getCurrentPopover();
        await user.click(
            within(pop4).getByRole("option", { name: /^Kitchen$/ }),
        );

        // Auto-advance lands on the passers pill; skip past it by
        // closing the popover so Submit is the one with focus.
        await user.keyboard("{Escape}");

        const submit = screen.getByRole("button", { name: /submit/ });
        expect(submit).toBeEnabled();
        await user.click(submit);

        expect(onSubmit).toHaveBeenCalledTimes(1);
        const draft = onSubmit.mock.calls[0]![0] as {
            readonly suggester: unknown;
            readonly cards: ReadonlyArray<unknown>;
            readonly nonRefuters: ReadonlyArray<unknown>;
            readonly refuter?: unknown;
            readonly seenCard?: unknown;
        };
        expect(draft.suggester).toBe(A);
        expect(draft.cards).toEqual([MUSTARD, KNIFE, KITCHEN]);
        expect(draft.nonRefuters).toEqual([]);
        expect("refuter" in draft).toBe(false);
        expect("seenCard" in draft).toBe(false);
    });
});

// -----------------------------------------------------------------------
// Passers pill — regression focus
// -----------------------------------------------------------------------

describe("SuggestionForm — passers (MultiSelect) pill", () => {
    test("toggling two players then pressing OK commits the full set", async () => {
        const { SuggestionForm, setup, Player } = deferred;
        const B = Player("Bob");
        const C = Player("Cho");

        const user = userEvent.setup();
        const onSubmit = jest.fn();
        renderForm(<SuggestionForm setup={setup} onSubmit={onSubmit} />);

        // Fill required fields first so we can submit and inspect the draft.
        const p1 = await openPopover(user, /pillSuggester/);
        await user.click(within(p1).getByRole("option", { name: /Anisha/ }));
        const p2 = getCurrentPopover();
        await user.click(
            within(p2).getByRole("option", { name: /Col\. Mustard/ }),
        );
        const p3 = getCurrentPopover();
        await user.click(within(p3).getByRole("option", { name: /Knife/ }));
        const p4 = getCurrentPopover();
        await user.click(
            within(p4).getByRole("option", { name: /^Kitchen$/ }),
        );

        // Passers popover auto-advanced; toggle Bob and Cho.
        const pPass = getCurrentPopover();
        await user.click(within(pPass).getByRole("option", { name: /Bob/ }));
        await user.click(within(pPass).getByRole("option", { name: /Cho/ }));
        // Commit via the list's OK button (same commit path as Enter).
        await user.click(within(pPass).getByRole("button", { name: /OK/i }));

        // Auto-advance lands on the refuter pill; close it before submit.
        await user.keyboard("{Escape}");

        const submit = screen.getByRole("button", { name: /submit/ });
        await user.click(submit);
        expect(onSubmit).toHaveBeenCalledTimes(1);
        const draft = onSubmit.mock.calls[0]![0] as {
            readonly nonRefuters: ReadonlyArray<unknown>;
        };
        expect(draft.nonRefuters).toEqual([B, C]);
    });

    test("does not infinite-loop when opening and closing the passers pill (regression)", async () => {
        // Even through the full SuggestionForm, opening + closing the
        // passers pill must not loop. Guards against re-introducing
        // the bug via a form callsite that passes a non-memoized
        // `onCommit` to MultiSelectList.
        const { SuggestionForm, setup } = deferred;
        const user = userEvent.setup();
        const onSubmit = jest.fn();
        expect(() =>
            renderForm(<SuggestionForm setup={setup} onSubmit={onSubmit} />),
        ).not.toThrow();
        await user.click(
            screen.getByRole("button", { name: /pillPassers/ }),
        );
        await user.keyboard("{Escape}");
        // Reaching this line = no loop.
        expect(true).toBe(true);
    });
});

// -----------------------------------------------------------------------
// Editing mode
// -----------------------------------------------------------------------

describe("SuggestionForm — edit mode", () => {
    test("pre-populates from the suggestion prop", () => {
        const { SuggestionForm, setup, Player, cardByName, SuggestionId } =
            deferred;
        const A = Player("Anisha");
        const B = Player("Bob");
        const C = Player("Cho");
        const MUSTARD = cardByName(setup, "Col. Mustard");
        const KNIFE = cardByName(setup, "Knife");
        const KITCHEN = cardByName(setup, "Kitchen");
        const existing = {
            id: SuggestionId("edit-1"),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [B],
            refuter: C,
            seenCard: KNIFE,
        };
        renderForm(
            <SuggestionForm
                setup={setup}
                suggestion={existing}
                onSubmit={jest.fn()}
            />,
        );
        // Each pill renders its value as `LABEL: display`; assert each
        // display is present via partial text match on the pill body.
        expect(
            screen.getByRole("button", { name: /pillSuggester.*Anisha/ }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /Col\. Mustard/ }),
        ).toBeInTheDocument();
        // Knife displays on both the Weapon pill and the Shown-card pill.
        expect(
            screen.getAllByRole("button", { name: /Knife/ }).length,
        ).toBe(2);
        expect(
            screen.getByRole("button", { name: /Kitchen/ }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /pillRefuter.*Cho/ }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /pillPassers.*Bob/ }),
        ).toBeInTheDocument();
    });
});
