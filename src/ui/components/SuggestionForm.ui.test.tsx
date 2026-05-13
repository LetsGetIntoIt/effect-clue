import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, createElement } from "react";
import type { ReactNode } from "react";

// -----------------------------------------------------------------------
// ESM mocks. Vitest hoists `vi.mock` calls to the top of the file, so
// regular top-level imports below see the mocked modules — no deferred-
// import dance required.
// -----------------------------------------------------------------------

vi.mock("next-intl", () => {
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
        // useReducedMotion is consulted by `src/ui/motion.ts` helpers.
        // Always return false — the real hook reads `matchMedia`, which
        // jsdom partially stubs.
        useReducedMotion: () => false,
        LayoutGroup: ({ children }: { children: ReactNode }) => children,
    };
});

import { SuggestionForm } from "./SuggestionForm";
import { TooltipProvider } from "./Tooltip";
import { CLASSIC_SETUP_3P as setup } from "../../logic/GameSetup";
import { SuggestionId } from "../../logic/Suggestion";
import { Player } from "../../logic/GameObjects";
import { cardByName } from "../../logic/test-utils/CardByName";

const renderForm = (
    ui: React.ReactElement,
): ReturnType<typeof render> =>
    render(<TooltipProvider>{ui}</TooltipProvider>);

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
    test("renders triggers for every pill, including the disabled Shown-card", () => {
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);
        // Disabled pills are now focusable buttons (keyboard users can
        // Tab to them and the popover explains the reason). All seven
        // pills surface as data-pill-id triggers.
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
            "seenCard",
        ]);
    });

    test("Add button is aria-disabled until all required slots are filled", () => {
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);
        const submit = screen.getByRole("button", { name: /submit/ });
        // Uses aria-disabled (not the `disabled` attribute) so the
        // button stays in the tab order and can surface its
        // tooltip-driven explanation to keyboard users.
        expect(submit).toHaveAttribute("aria-disabled", "true");
    });

    test("Shown-card trigger is rendered but aria-disabled until a refuter is picked", () => {
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);
        const seenTrigger = document.querySelector(
            "[data-pill-id='seenCard']",
        );
        expect(seenTrigger).not.toBeNull();
        expect(seenTrigger).toHaveAttribute("aria-disabled", "true");
    });
});

// -----------------------------------------------------------------------
// Happy-path: fill out + submit
// -----------------------------------------------------------------------

describe("SuggestionForm — submit flow", () => {
    test("picking suggester + one card per category enables submit and dispatches the draft", async () => {
        const A = Player("Anisha");
        const MUSTARD = cardByName(setup, "Col. Mustard");
        const KNIFE = cardByName(setup, "Knife");
        const KITCHEN = cardByName(setup, "Kitchen");

        const user = userEvent.setup();
        const onSubmit = vi.fn();
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
        const B = Player("Bob");
        const C = Player("Cho");

        const user = userEvent.setup();
        const onSubmit = vi.fn();
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
        const user = userEvent.setup();
        const onSubmit = vi.fn();
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
                onSubmit={vi.fn()}
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

// -----------------------------------------------------------------------
// Auto-advance: focus must land on the now-enabled Shown-card pill after
// picking a refuter. Regression for a stale-closure bug where the advance
// read the pre-commit `isPillDisabled` and skipped straight to the Add
// button.
// -----------------------------------------------------------------------

describe("SuggestionForm — auto-advance after picking a refuter", () => {
    test("focus lands on Shown-card (not Add) once a refuter is chosen", async () => {
        const user = userEvent.setup();
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);

        // Drive a full suggestion: suggester + 3 cards.
        const pSug = await openPopover(user, /pillSuggester/);
        await user.click(
            within(pSug).getByRole("option", { name: /Anisha/ }),
        );
        const pC0 = getCurrentPopover();
        await user.click(
            within(pC0).getByRole("option", { name: /Col\. Mustard/ }),
        );
        const pC1 = getCurrentPopover();
        await user.click(within(pC1).getByRole("option", { name: /Knife/ }));
        const pC2 = getCurrentPopover();
        await user.click(
            within(pC2).getByRole("option", { name: /^Kitchen$/ }),
        );

        // Passers is auto-opened; close it so we can move deliberately
        // to the refuter.
        await user.keyboard("{Escape}");

        // Open refuter and pick Bob. Auto-advance MUST see the
        // post-commit form (refuter resolved) and open the Shown-card
        // popover — not skip to the Add button.
        const refuter = screen.getByRole("button", { name: /pillRefuter/ });
        await user.click(refuter);
        const pRef = getCurrentPopover();
        await user.click(within(pRef).getByRole("option", { name: /Bob/ }));

        // After the commit, the open popover should be the Shown-card
        // one — proven by the presence of the Shown-card trigger's
        // aria-expanded=true (Radix pins it while its popover is open).
        const seenTrigger = document.querySelector(
            "[data-pill-id='seenCard']",
        );
        expect(seenTrigger).not.toBeNull();
        expect(seenTrigger).toHaveAttribute("aria-expanded", "true");
        // And the submit button is NOT the currently-open target.
        const submit = screen.getByRole("button", { name: /submit/ });
        expect(submit).not.toHaveFocus();
    });
});

// -----------------------------------------------------------------------
// Internal-consistency error state on the Shown-card pill.
// -----------------------------------------------------------------------

describe("SuggestionForm — stale Shown card error state", () => {
    test("swapping the weapon after setting a shown card flags Shown card as invalid", async () => {
        const A = Player("Anisha");
        const B = Player("Bob");
        const MUSTARD = cardByName(setup, "Col. Mustard");
        const KNIFE = cardByName(setup, "Knife");
        const KITCHEN = cardByName(setup, "Kitchen");
        const user = userEvent.setup();
        // Seed an already-valid suggestion with seenCard=Knife so the
        // test can focus on the stale-after-edit behavior.
        renderForm(
            <SuggestionForm
                setup={setup}
                suggestion={{
                    id: SuggestionId("stale-seen"),
                    suggester: A,
                    cards: [MUSTARD, KNIFE, KITCHEN],
                    nonRefuters: [],
                    refuter: B,
                    seenCard: KNIFE,
                }}
                onSubmit={vi.fn()}
            />,
        );

        // Before swap: the Shown-card trigger is NOT aria-invalid.
        const seenBefore = document.querySelector(
            "[data-pill-id='seenCard']",
        );
        expect(seenBefore).not.toHaveAttribute("aria-invalid");

        // Change the weapon from Knife to Rope. seenCard stays Knife,
        // which is no longer one of the suggested cards.
        // (Two pills display "Knife": the Weapon pill and the Shown-card
        // pill. Disambiguate by data-pill-id.)
        const weaponPill = document.querySelector(
            "[data-pill-id='card-1']",
        ) as HTMLElement;
        await user.click(weaponPill);
        const popWeapon = getCurrentPopover();
        await user.click(
            within(popWeapon).getByRole("option", { name: /Rope/ }),
        );
        // Auto-advance moved focus to Room; close the open popover so
        // the DOM settles.
        await user.keyboard("{Escape}");

        // After: Shown-card pill carries aria-invalid and, when opened,
        // the popover includes an error banner.
        const seenAfter = document.querySelector(
            "[data-pill-id='seenCard']",
        );
        expect(seenAfter).toHaveAttribute("aria-invalid", "true");
        await user.click(seenAfter as HTMLElement);
        const seenPop = getCurrentPopover();
        const banner = within(seenPop).getByRole("alert");
        expect(banner).toHaveTextContent(/pillErrorSeenCardNotSuggested/);
    });
});

// -----------------------------------------------------------------------
// Cross-role conflicts surface as dual-pill errors. The role-move helpers
// intentionally do NOT auto-clear conflicting roles, so the validator
// marks both offending pills and the user picks which one to fix.
// -----------------------------------------------------------------------

describe("SuggestionForm — dual-pill cross-role errors", () => {
    test("same player as Suggester and Refuter flags BOTH pills", async () => {
        const A = Player("Anisha");
        const MUSTARD = cardByName(setup, "Col. Mustard");
        const KNIFE = cardByName(setup, "Knife");
        const KITCHEN = cardByName(setup, "Kitchen");
        const user = userEvent.setup();
        renderForm(
            <SuggestionForm
                setup={setup}
                suggestion={{
                    id: SuggestionId("suggester-is-refuter"),
                    suggester: A,
                    cards: [MUSTARD, KNIFE, KITCHEN],
                    nonRefuters: [],
                    refuter: A,
                    seenCard: undefined,
                }}
                onSubmit={vi.fn()}
            />,
        );

        const suggester = document.querySelector(
            "[data-pill-id='suggester']",
        );
        const refuter = document.querySelector(
            "[data-pill-id='refuter']",
        );
        expect(suggester).toHaveAttribute("aria-invalid", "true");
        expect(refuter).toHaveAttribute("aria-invalid", "true");

        // Opening EITHER popover surfaces the same warning.
        await user.click(suggester as HTMLElement);
        const sugPop = getCurrentPopover();
        expect(
            within(sugPop).getByRole("alert"),
        ).toHaveTextContent(/pillErrorSuggesterIsRefuter/);
        await user.keyboard("{Escape}");

        await user.click(refuter as HTMLElement);
        const refPop = getCurrentPopover();
        expect(
            within(refPop).getByRole("alert"),
        ).toHaveTextContent(/pillErrorSuggesterIsRefuter/);
    });

    test("same player as Suggester and a Passer flags BOTH pills", () => {
        const A = Player("Anisha");
        const MUSTARD = cardByName(setup, "Col. Mustard");
        const KNIFE = cardByName(setup, "Knife");
        const KITCHEN = cardByName(setup, "Kitchen");
        renderForm(
            <SuggestionForm
                setup={setup}
                suggestion={{
                    id: SuggestionId("suggester-in-passers"),
                    suggester: A,
                    cards: [MUSTARD, KNIFE, KITCHEN],
                    nonRefuters: [A],
                    refuter: undefined,
                    seenCard: undefined,
                }}
                onSubmit={vi.fn()}
            />,
        );
        expect(
            document.querySelector("[data-pill-id='suggester']"),
        ).toHaveAttribute("aria-invalid", "true");
        expect(
            document.querySelector("[data-pill-id='passers']"),
        ).toHaveAttribute("aria-invalid", "true");
    });

    test("same player as Refuter and a Passer flags BOTH pills", () => {
        const A = Player("Anisha");
        const B = Player("Bob");
        const MUSTARD = cardByName(setup, "Col. Mustard");
        const KNIFE = cardByName(setup, "Knife");
        const KITCHEN = cardByName(setup, "Kitchen");
        renderForm(
            <SuggestionForm
                setup={setup}
                suggestion={{
                    id: SuggestionId("refuter-in-passers"),
                    suggester: A,
                    cards: [MUSTARD, KNIFE, KITCHEN],
                    nonRefuters: [B],
                    refuter: B,
                    seenCard: undefined,
                }}
                onSubmit={vi.fn()}
            />,
        );
        expect(
            document.querySelector("[data-pill-id='refuter']"),
        ).toHaveAttribute("aria-invalid", "true");
        expect(
            document.querySelector("[data-pill-id='passers']"),
        ).toHaveAttribute("aria-invalid", "true");
    });

    test("submit is blocked while a cross-role conflict is active", () => {
        const A = Player("Anisha");
        const MUSTARD = cardByName(setup, "Col. Mustard");
        const KNIFE = cardByName(setup, "Knife");
        const KITCHEN = cardByName(setup, "Kitchen");
        renderForm(
            <SuggestionForm
                setup={setup}
                suggestion={{
                    id: SuggestionId("submit-blocked"),
                    suggester: A,
                    cards: [MUSTARD, KNIFE, KITCHEN],
                    nonRefuters: [],
                    refuter: A,
                    seenCard: undefined,
                }}
                onSubmit={vi.fn()}
            />,
        );
        // Edit mode renders an "updateAction" button (not "submit").
        const submit = screen.getByRole("button", { name: /updateAction/ });
        expect(submit).toHaveAttribute("aria-disabled", "true");
    });
});

// -----------------------------------------------------------------------
// Disabled-pill popover: focusable + shows the disabled reason.
// -----------------------------------------------------------------------

describe("SuggestionForm — disabled pill popover", () => {
    test("opening the disabled Shown-card pill shows its disabledHint", async () => {
        const user = userEvent.setup();
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);

        const seen = document.querySelector(
            "[data-pill-id='seenCard']",
        ) as HTMLElement;
        expect(seen).toHaveAttribute("aria-disabled", "true");
        await user.click(seen);
        const pop = getCurrentPopover();
        // The popover body shows the hint instead of a candidate list.
        expect(pop).toHaveTextContent(/pillSeenDisabledHint/);
        // No option rows.
        expect(within(pop).queryByRole("option")).toBeNull();
    });
});

// -----------------------------------------------------------------------
// Add-button disabled reason: switches to aria-disabled and the Tooltip
// surfaces a reason string.
// -----------------------------------------------------------------------

describe("SuggestionForm — disabled Add button", () => {
    test("empty form: Add button is aria-disabled and clicking is a no-op", async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        renderForm(<SuggestionForm setup={setup} onSubmit={onSubmit} />);
        const submit = screen.getByRole("button", { name: /submit/ });
        expect(submit).toHaveAttribute("aria-disabled", "true");
        await user.click(submit);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    test("filling required pills clears aria-disabled", async () => {
        const user = userEvent.setup();
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);
        const pSug = await openPopover(user, /pillSuggester/);
        await user.click(
            within(pSug).getByRole("option", { name: /Anisha/ }),
        );
        const pC0 = getCurrentPopover();
        await user.click(
            within(pC0).getByRole("option", { name: /Col\. Mustard/ }),
        );
        const pC1 = getCurrentPopover();
        await user.click(within(pC1).getByRole("option", { name: /Knife/ }));
        const pC2 = getCurrentPopover();
        await user.click(
            within(pC2).getByRole("option", { name: /^Kitchen$/ }),
        );
        await user.keyboard("{Escape}");

        const submit = screen.getByRole("button", { name: /submit/ });
        expect(submit).toHaveAttribute("aria-disabled", "false");
    });
});

// -----------------------------------------------------------------------
// Nobody sentinel mappings
// -----------------------------------------------------------------------

describe("SuggestionForm — Nobody sentinel", () => {
    // Fill suggester + all three required card pills; leaves focus
    // on the passers popover (auto-advance). Returns the fresh user
    // handle so the caller can drive the rest of the flow.
    const fillRequired = async (user: ReturnType<typeof userEvent.setup>) => {
        const p = await openPopover(user, /pillSuggester/);
        await user.click(within(p).getByRole("option", { name: /Anisha/ }));
        const p2 = getCurrentPopover();
        await user.click(within(p2).getByRole("option", { name: /Col\. Mustard/ }));
        const p3 = getCurrentPopover();
        await user.click(within(p3).getByRole("option", { name: /Knife/ }));
        const p4 = getCurrentPopover();
        await user.click(within(p4).getByRole("option", { name: /^Kitchen$/ }));
    };

    test("Nobody in the passers popover maps to an empty nonRefuters array", async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        renderForm(<SuggestionForm setup={setup} onSubmit={onSubmit} />);
        await fillRequired(user);

        // Passers popover is now open (auto-advance landed here).
        // Pick the Nobody row.
        const pPass = getCurrentPopover();
        await user.click(
            within(pPass).getByRole("option", { name: /popoverNobodyPassed/ }),
        );

        // Auto-advance lands on refuter; escape so we can click Submit.
        await user.keyboard("{Escape}");

        const submit = screen.getByRole("button", { name: /submit/ });
        await user.click(submit);
        expect(onSubmit).toHaveBeenCalledTimes(1);
        const draft = onSubmit.mock.calls[0]![0] as {
            readonly nonRefuters: ReadonlyArray<unknown>;
        };
        expect(draft.nonRefuters).toEqual([]);
    });

    test("Nobody in the refuter popover → submitted draft has no refuter field", async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        renderForm(<SuggestionForm setup={setup} onSubmit={onSubmit} />);
        await fillRequired(user);
        await user.keyboard("{Escape}"); // close passers

        // Open refuter popover and pick Nobody.
        await user.click(screen.getByRole("button", { name: /pillRefuter/ }));
        const pRef = getCurrentPopover();
        await user.click(
            within(pRef).getByRole("option", { name: /popoverNobodyRefuted/ }),
        );

        const submit = screen.getByRole("button", { name: /submit/ });
        await user.click(submit);
        expect(onSubmit).toHaveBeenCalledTimes(1);
        const draft = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
        // exactOptionalPropertyTypes: the `refuter` key is omitted, not set
        // to `undefined`, when nobody refuted.
        expect("refuter" in draft).toBe(false);
    });

    test("picking Nobody for refuter clears a previously-set seenCard (shown-card pill turns off)", async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        renderForm(<SuggestionForm setup={setup} onSubmit={onSubmit} />);
        await fillRequired(user);
        await user.keyboard("{Escape}"); // close passers

        // Pick Bob as refuter → shown-card pill enables.
        await user.click(screen.getByRole("button", { name: /pillRefuter/ }));
        const pRef = getCurrentPopover();
        await user.click(within(pRef).getByRole("option", { name: /Bob/ }));
        // Auto-advance opens the seen-card popover; pick Knife.
        const pSeen = getCurrentPopover();
        await user.click(within(pSeen).getByRole("option", { name: /Knife/ }));

        // Now flip the refuter back to Nobody — seenCard should clear
        // because the shown-card pill is disabled again.
        await user.click(screen.getByRole("button", { name: /pillRefuter/ }));
        const pRef2 = getCurrentPopover();
        await user.click(
            within(pRef2).getByRole("option", { name: /popoverNobodyRefuted/ }),
        );

        const submit = screen.getByRole("button", { name: /submit/ });
        await user.click(submit);
        const draft = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
        expect("refuter" in draft).toBe(false);
        expect("seenCard" in draft).toBe(false);
    });
});

// -----------------------------------------------------------------------
// Cmd/Ctrl+Enter keyboard submission
// -----------------------------------------------------------------------

describe("SuggestionForm — Cmd/Ctrl+Enter submission", () => {
    test("Cmd+Enter submits a completed form from anywhere in the document", async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        renderForm(<SuggestionForm setup={setup} onSubmit={onSubmit} />);

        // Fill required fields.
        const p1 = await openPopover(user, /pillSuggester/);
        await user.click(within(p1).getByRole("option", { name: /Anisha/ }));
        const p2 = getCurrentPopover();
        await user.click(within(p2).getByRole("option", { name: /Col\. Mustard/ }));
        const p3 = getCurrentPopover();
        await user.click(within(p3).getByRole("option", { name: /Knife/ }));
        const p4 = getCurrentPopover();
        await user.click(within(p4).getByRole("option", { name: /^Kitchen$/ }));
        // Passers popover is open; Cmd+Enter should submit even with it open.
        await user.keyboard("{Meta>}{Enter}{/Meta}");
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    test("Cmd+Enter on an incomplete form is a no-op", async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        renderForm(<SuggestionForm setup={setup} onSubmit={onSubmit} />);
        await user.keyboard("{Meta>}{Enter}{/Meta}");
        expect(onSubmit).not.toHaveBeenCalled();
    });
});

// -----------------------------------------------------------------------
// Cancel button
// -----------------------------------------------------------------------

describe("SuggestionForm — cancel button", () => {
    test("no Cancel button when `onCancel` is not provided", () => {
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);
        expect(
            screen.queryByRole("button", { name: /cancelAction/ }),
        ).toBeNull();
    });

    test("Cancel button renders and fires `onCancel` without calling `onSubmit`", async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        const onCancel = vi.fn();
        renderForm(
            <SuggestionForm
                setup={setup}
                onSubmit={onSubmit}
                onCancel={onCancel}
            />,
        );
        const cancel = screen.getByRole("button", { name: /cancelAction/ });
        await user.click(cancel);
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onSubmit).not.toHaveBeenCalled();
    });
});

// -----------------------------------------------------------------------
// Edit-mode re-seeding on suggestion prop change
// -----------------------------------------------------------------------

describe("SuggestionForm — re-seed when `suggestion` prop id changes", () => {
    test("swapping the `suggestion` prop to a different id re-populates the pills", () => {
        const A = Player("Anisha");
        const B = Player("Bob");
        const MUSTARD = cardByName(setup, "Col. Mustard");
        const KNIFE = cardByName(setup, "Knife");
        const KITCHEN = cardByName(setup, "Kitchen");
        const PLUM = cardByName(setup, "Prof. Plum");
        const ROPE = cardByName(setup, "Rope");
        const HALL = cardByName(setup, "Hall");

        const { rerender } = render(
            <TooltipProvider>
                <SuggestionForm
                    setup={setup}
                    suggestion={{
                        id: SuggestionId("first"),
                        suggester: A,
                        cards: [MUSTARD, KNIFE, KITCHEN],
                        nonRefuters: [],
                    }}
                    onSubmit={vi.fn()}
                />
            </TooltipProvider>,
        );
        // Pills show the first draft's values.
        expect(
            screen.getByRole("button", { name: /pillSuggester.*Anisha/ }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Col\. Mustard/ }))
            .toBeInTheDocument();

        rerender(
            <TooltipProvider>
                <SuggestionForm
                    setup={setup}
                    suggestion={{
                        id: SuggestionId("second"),
                        suggester: B,
                        cards: [PLUM, ROPE, HALL],
                        nonRefuters: [],
                    }}
                    onSubmit={vi.fn()}
                />
            </TooltipProvider>,
        );
        // Pills now show the second draft's values.
        expect(
            screen.getByRole("button", { name: /pillSuggester.*Bob/ }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Prof\. Plum/ }))
            .toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Rope/ }))
            .toBeInTheDocument();
        // And the old values are gone.
        expect(
            screen.queryByRole("button", { name: /Col\. Mustard/ }),
        ).toBeNull();
    });

    test("re-rendering with the same suggestion id does NOT wipe user edits", async () => {
        const user = userEvent.setup();
        const A = Player("Anisha");
        const B = Player("Bob");
        const MUSTARD = cardByName(setup, "Col. Mustard");
        const KNIFE = cardByName(setup, "Knife");
        const KITCHEN = cardByName(setup, "Kitchen");
        const existing = {
            id: SuggestionId("stable"),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN] as const,
            nonRefuters: [] as const,
        };
        const { rerender } = render(
            <TooltipProvider>
                <SuggestionForm
                    setup={setup}
                    suggestion={existing}
                    onSubmit={vi.fn()}
                />
            </TooltipProvider>,
        );
        // Edit the suggester from Anisha → Bob in-place.
        await user.click(
            screen.getByRole("button", { name: /pillSuggester/ }),
        );
        const pop = getCurrentPopover();
        await user.click(within(pop).getByRole("option", { name: /Bob/ }));
        // Same prop (same id, same values) — re-seed guard must not fire.
        rerender(
            <TooltipProvider>
                <SuggestionForm
                    setup={setup}
                    suggestion={existing}
                    onSubmit={vi.fn()}
                />
            </TooltipProvider>,
        );
        expect(
            screen.getByRole("button", { name: /pillSuggester.*Bob/ }),
        ).toBeInTheDocument();
        expect(B).toBeDefined(); // touch B to keep the import tidy
    });
});

// -----------------------------------------------------------------------
// Esc-to-clear in create mode
// -----------------------------------------------------------------------

describe("SuggestionForm — Esc-to-clear (create mode)", () => {
    test("Esc with a popover open closes the popover and leaves committed pills intact", async () => {
        const user = userEvent.setup();
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);

        // Commit suggester → auto-advance opens the card-0 popover.
        const pop1 = await openPopover(user, /pillSuggester/);
        await user.click(within(pop1).getByRole("option", { name: /Anisha/ }));
        // A popover is open at this point (auto-advanced to card-0).
        expect(
            document.querySelector("[data-pill-id][data-state='open']"),
        ).not.toBeNull();

        await user.keyboard("{Escape}");

        // The popover closed (Radix). The previously-committed
        // suggester value is preserved.
        expect(
            document.querySelector("[data-pill-id][data-state='open']"),
        ).toBeNull();
        expect(
            screen.getByRole("button", { name: /pillSuggester.*Anisha/ }),
        ).toBeInTheDocument();
    });

    test("Esc with no popover open clears every pill", async () => {
        const user = userEvent.setup();
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);

        // Commit suggester then dismiss the auto-advanced popover so
        // no dropdown is open when we hit Esc the second time.
        const pop1 = await openPopover(user, /pillSuggester/);
        await user.click(within(pop1).getByRole("option", { name: /Anisha/ }));
        await user.keyboard("{Escape}"); // close auto-advanced popover
        expect(
            screen.getByRole("button", { name: /pillSuggester.*Anisha/ }),
        ).toBeInTheDocument();

        // Move focus inside the form. After auto-advance, focus is on
        // a pill trigger already; the pill row counts as "inside the
        // form" for the Esc handler. Press Esc → onClearInputs fires.
        await user.keyboard("{Escape}");

        // The suggester pill no longer displays Anisha — it reads as
        // the plain unfilled label.
        expect(
            screen.queryByRole("button", { name: /pillSuggester.*Anisha/ }),
        ).toBeNull();
        expect(
            screen.getByRole("button", { name: /pillSuggester/ }),
        ).toBeInTheDocument();
    });

    test("Esc inside an open popover with no committed values is a no-op (Radix closes the popover; nothing to clear)", async () => {
        const user = userEvent.setup();
        renderForm(<SuggestionForm setup={setup} onSubmit={vi.fn()} />);

        // Open the suggester popover without committing anything.
        await openPopover(user, /pillSuggester/);

        await user.keyboard("{Escape}");

        // Popover closed.
        expect(
            document.querySelector("[data-pill-id][data-state='open']"),
        ).toBeNull();
        // No committed values either way — the suggester pill still
        // renders the unfilled label.
        expect(
            screen.getByRole("button", { name: /pillSuggester/ }),
        ).toBeInTheDocument();
    });
});
