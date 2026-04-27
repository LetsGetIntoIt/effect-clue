import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, createElement } from "react";
import type { ReactNode } from "react";

// -----------------------------------------------------------------------
// ESM mocks. vitest hoists `vi.mock` to the top of the file, so the
// regular imports below see the mocked modules.
// -----------------------------------------------------------------------

vi.mock("next-intl", () => {
    // Return the i18n key verbatim so assertions can match stable
    // identifiers (`pillAccuser`, `submit`, …) without pulling in the
    // full message catalog.
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    (t as unknown as { rich: unknown }).rich = (key: string): string => key;
    return { useTranslations: () => t };
});

vi.mock("motion/react", () => {
    // Pass-through every motion.X — jsdom doesn't grok requestAnimationFrame
    // / layout measurement well, and these tests only care about DOM
    // structure, not animations.
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

import { AccusationForm } from "./AccusationForm";
import { TooltipProvider } from "./Tooltip";
import { CLASSIC_SETUP_3P as setup } from "../../logic/GameSetup";
import { AccusationId } from "../../logic/Accusation";
import type { DraftAccusation } from "../../logic/ClueState";
import { Player } from "../../logic/GameObjects";
import { cardByName } from "../../logic/test-utils/CardByName";

const PLUM = cardByName(setup, "Prof. Plum");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");

const renderForm = (
    ui: React.ReactElement,
): ReturnType<typeof render> =>
    render(<TooltipProvider>{ui}</TooltipProvider>);

const openPopover = async (
    user: ReturnType<typeof userEvent.setup>,
    pillLabel: RegExp,
): Promise<HTMLElement> => {
    const trigger = screen.getByRole("button", { name: pillLabel });
    await user.click(trigger);
    return getCurrentPopover();
};

// Auto-advance opens each subsequent popover after a commit, so tests
// can chain commits and re-query whichever popover is currently open.
const getCurrentPopover = (): HTMLElement => {
    const popover = document.querySelector<HTMLElement>(
        "[data-suggestion-form-popover='true']",
    );
    if (popover === null) throw new Error("no popover open");
    return popover;
};

describe("AccusationForm", () => {
    test("happy path: pick accuser + one card per category, submit fires onSubmit with a fresh-id draft", async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn<(draft: DraftAccusation) => void>();
        renderForm(<AccusationForm setup={setup} onSubmit={onSubmit} />);

        // Open the accuser pill — Suggester-style label is shared with
        // the pill primitive so the role/name matcher hits "pillAccuser".
        const pop1 = await openPopover(user, /pillAccuser/);
        await user.click(
            within(pop1).getByRole("option", { name: /Anisha/ }),
        );

        const pop2 = getCurrentPopover();
        await user.click(
            within(pop2).getByRole("option", { name: /Prof\. Plum/ }),
        );

        const pop3 = getCurrentPopover();
        await user.click(within(pop3).getByRole("option", { name: /Knife/ }));

        const pop4 = getCurrentPopover();
        await user.click(
            within(pop4).getByRole("option", { name: /^Kitchen$/ }),
        );

        const submit = screen.getByRole("button", { name: /^submit$/ });
        await user.click(submit);

        expect(onSubmit).toHaveBeenCalledTimes(1);
        const draft = onSubmit.mock.calls[0]?.[0];
        expect(draft).toBeDefined();
        if (!draft) return;
        expect(String(draft.accuser)).toBe("Anisha");
        expect(draft.cards).toHaveLength(3);
        expect(draft.cards).toContain(PLUM);
        expect(draft.cards).toContain(KNIFE);
        expect(draft.cards).toContain(KITCHEN);
        // Fresh ids start with `accusation-`.
        expect(String(draft.id)).toMatch(/^accusation-/);
    });

    test("submit stays disabled until every required pill is filled", async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        renderForm(<AccusationForm setup={setup} onSubmit={onSubmit} />);

        const submit = screen.getByRole("button", { name: /^submit$/ });
        expect(submit).toHaveAttribute("aria-disabled", "true");

        const pop1 = await openPopover(user, /pillAccuser/);
        await user.click(
            within(pop1).getByRole("option", { name: /Anisha/ }),
        );
        // Still missing all three cards.
        expect(submit).toHaveAttribute("aria-disabled", "true");

        const pop2 = getCurrentPopover();
        await user.click(
            within(pop2).getByRole("option", { name: /Prof\. Plum/ }),
        );
        expect(submit).toHaveAttribute("aria-disabled", "true");

        const pop3 = getCurrentPopover();
        await user.click(within(pop3).getByRole("option", { name: /Knife/ }));
        expect(submit).toHaveAttribute("aria-disabled", "true");

        const pop4 = getCurrentPopover();
        await user.click(
            within(pop4).getByRole("option", { name: /^Kitchen$/ }),
        );
        expect(submit).not.toHaveAttribute("aria-disabled", "true");
    });

    test("edit mode: pre-populates from the accusation prop and submits with the same id", async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn<(draft: DraftAccusation) => void>();
        const existing: DraftAccusation = {
            id: AccusationId("accusation-existing-id"),
            accuser: Player("Bob"),
            cards: [PLUM, KNIFE, KITCHEN],
        };
        renderForm(
            <AccusationForm
                setup={setup}
                accusation={existing}
                onSubmit={onSubmit}
            />,
        );

        // Submit reads "updateAction" in edit mode, and the form is
        // pre-populated so it's enabled immediately.
        const updateBtn = screen.getByRole("button", {
            name: /^updateAction$/,
        });
        expect(updateBtn).not.toHaveAttribute("aria-disabled", "true");

        await user.click(updateBtn);

        expect(onSubmit).toHaveBeenCalledTimes(1);
        const draft = onSubmit.mock.calls[0]?.[0];
        if (!draft) throw new Error("draft missing");
        // The same id round-trips.
        expect(String(draft.id)).toBe("accusation-existing-id");
        expect(String(draft.accuser)).toBe("Bob");
        expect(draft.cards).toContain(PLUM);
    });

    test("onCancel button only appears when onCancel prop is provided", async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        const { rerender } = renderForm(
            <AccusationForm setup={setup} onSubmit={onSubmit} />,
        );
        expect(
            screen.queryByRole("button", { name: /^cancelAction$/ }),
        ).toBeNull();

        const onCancel = vi.fn();
        rerender(
            <TooltipProvider>
                <AccusationForm
                    setup={setup}
                    onSubmit={onSubmit}
                    onCancel={onCancel}
                />
            </TooltipProvider>,
        );
        const cancelBtn = screen.getByRole("button", {
            name: /^cancelAction$/,
        });
        expect(cancelBtn).toBeInTheDocument();
        await user.click(cancelBtn);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    test("renders one pill per category plus the accuser pill", () => {
        renderForm(<AccusationForm setup={setup} onSubmit={vi.fn()} />);
        const pillIds = Array.from(
            document.querySelectorAll("[data-pill-id]"),
        ).map(el => el.getAttribute("data-pill-id"));
        expect(pillIds).toEqual([
            "accuser",
            "card-0",
            "card-1",
            "card-2",
        ]);
    });
});
