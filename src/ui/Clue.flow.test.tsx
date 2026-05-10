import { beforeEach, describe, expect, test, vi } from "vitest";
import { createElement, forwardRef } from "react";
import type { ReactNode } from "react";

// -----------------------------------------------------------------------
// Umbrella user-flow test. Walks one realistic session end-to-end:
// setup mode → Start Playing → submit a suggestion via the form →
// switch to the Accusation tab → submit an accusation. The point is
// catching integration regressions where each transition is fine in
// isolation but the chain breaks at a seam (URL handoff, pane mount,
// log re-render, tab mode flip).
//
// Edge-case coverage of each individual surface stays in the focused
// per-component test: SuggestionForm.ui.test.tsx, AccusationForm.test.tsx,
// SuggestionLogPanel.modeToggle.test.tsx, Checklist.setup.test.tsx,
// Checklist.deduce.test.tsx. The umbrella only exercises happy paths.
// -----------------------------------------------------------------------

vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    // Smart rich-text: invoke each chunk callback with the key string
    // so the tab buttons (rendered via `t.rich("addTitle", { suggestionTab,
    // accusationTab, kbd })` in SuggestionLogPanel) actually mount.
    // Without this, the tabs would never reach the DOM.
    (t as unknown as { rich: unknown }).rich = (
        key: string,
        values?: Record<string, unknown>,
    ): unknown => {
        if (values === undefined) return key;
        const out: ReactNode[] = [key];
        for (const [chunkName, chunkFn] of Object.entries(values)) {
            if (typeof chunkFn !== "function") continue;
            const node = (chunkFn as (chunks: ReactNode) => ReactNode)(
                `[chunk:${chunkName}]`,
            );
            out.push(node);
        }
        return out;
    };
    return {
        useTranslations: () => t,
        useLocale: () => "en",
    };
});

vi.mock("motion/react", () => {
    // Memoize per tag so React sees a stable component type across
    // renders — without this, every access to `motion.<tag>` returns
    // a fresh forwardRef and the row's DOM nodes unmount/remount,
    // wiping focus state between interactions.
    const motionCache: Record<string, React.ComponentType<unknown>> = {};
    const motion = new Proxy(
        {},
        {
            get: (_t, tag: string) => {
                if (motionCache[tag] === undefined) {
                    motionCache[tag] = forwardRef(
                        (
                            props: Record<string, unknown>,
                            ref: React.Ref<HTMLElement>,
                        ) => {
                            const {
                                layout: _layout,
                                layoutId: _layoutId,
                                initial: _initial,
                                animate: _animate,
                                exit: _exit,
                                transition: _transition,
                                variants: _variants,
                                custom: _custom,
                                whileHover: _whileHover,
                                whileTap: _whileTap,
                                ...rest
                            } = props;
                            return createElement(tag, { ...rest, ref });
                        },
                    ) as React.ComponentType<unknown>;
                }
                return motionCache[tag];
            },
        },
    );
    // Reorder.Group → ul; Reorder.Item → li. The flow test goes
    // through the wizard which mounts PlayerListReorder + the
    // customize sub-flow — both use Reorder. The test layer doesn't
    // need real drag behavior, only that children render.
    const ReorderGroup = forwardRef(
        (props: Record<string, unknown>, ref: React.Ref<HTMLElement>) => {
            const {
                axis: _axis,
                values: _values,
                onReorder: _onReorder,
                ...rest
            } = props;
            return createElement("ul", { ...rest, ref });
        },
    ) as React.ComponentType<unknown>;
    const ReorderItem = forwardRef(
        (props: Record<string, unknown>, ref: React.Ref<HTMLElement>) => {
            const {
                value: _value,
                onDragEnd: _onDragEnd,
                drag: _drag,
                ...rest
            } = props;
            return createElement("li", { ...rest, ref });
        },
    ) as React.ComponentType<unknown>;
    return {
        motion,
        AnimatePresence: ({ children }: { children: ReactNode }) => children,
        useReducedMotion: () => false,
        LayoutGroup: ({ children }: { children: ReactNode }) => children,
        Reorder: { Group: ReorderGroup, Item: ReorderItem },
    };
});

// Force desktop layout — both Checklist and SuggestionLogPanel mount
// side-by-side, so the suggestion log is observable without a
// pane-swap step.
vi.mock("./hooks/useIsDesktop", () => ({
    useIsDesktop: () => true,
}));

// Force keyboard-bearing device so pill triggers behave the same way
// the desktop tests pin (no two-tap touch path mid-flow).
vi.mock("./hooks/useHasKeyboard", () => ({
    useHasKeyboard: () => true,
}));

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { saveToLocalStorage } from "../logic/Persistence";
import { emptyHypotheses } from "../logic/Hypothesis";
import { CLASSIC_SETUP_3P } from "../logic/GameSetup";
import { Clue } from "./Clue";
import { TestQueryClientProvider } from "../test-utils/queryClient";
import { seedOnboardingDismissed } from "../test-utils/onboardingSeed";

const setup = CLASSIC_SETUP_3P;

const seedSetupSession = (): void => {
    saveToLocalStorage({
        setup,
        hands: [],
        handSizes: [],
        suggestions: [],
        accusations: [],
        hypotheses: emptyHypotheses,
        pendingSuggestion: null,
        selfPlayerId: null,
        firstDealtPlayerId: null,
    });
};

const getCurrentPopover = (): HTMLElement => {
    const popover = document.querySelector<HTMLElement>(
        "[data-suggestion-form-popover='true']",
    );
    if (popover === null) throw new Error("no popover open");
    return popover;
};

beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    seedOnboardingDismissed();
});

describe("Clue — full user-journey umbrella", () => {
    test("setup → Start Playing → submit a suggestion → switch to Accusation tab → submit an accusation", async () => {
        seedSetupSession();
        window.history.replaceState(null, "", "/?view=setup");

        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });

        // 1. Setup mode lands on cardPack. Walk Next through every
        //    step (skipping identity to keep myCards hidden) until
        //    the sticky CTA flips to "Start playing" with
        //    `data-setup-cta` set. The next-intl mock above strips
        //    namespaces, so the button text is just "next" / "skip".
        const stickyByText = (text: string): HTMLButtonElement => {
            const btns = Array.from(
                document.querySelectorAll<HTMLButtonElement>("button"),
            );
            const found = btns.find(b => b.textContent === text);
            if (!found) throw new Error(`button "${text}" not found`);
            return found;
        };
        await waitFor(() => stickyByText("next"));
        await user.click(stickyByText("next")); // cardPack → players
        await user.click(stickyByText("next")); // players → identity
        await user.click(stickyByText("skip")); // identity skipped
        await user.click(stickyByText("next")); // handSizes → knownCards
        await user.click(stickyByText("next")); // knownCards → inviteOtherPlayers
        await waitFor(() => {
            expect(
                document.querySelector("[data-setup-cta]"),
            ).toBeInTheDocument();
        });

        // 2. Clicking Start Playing flips the URL to checklist view.
        const cta = document.querySelector<HTMLElement>("[data-setup-cta]");
        if (!cta) throw new Error("Start Playing CTA missing");
        await user.click(cta);
        await waitFor(() => {
            expect(window.location.search).toContain("view=checklist");
        });

        // 3. The SuggestionForm is visible (suggester pill present).
        await waitFor(() => {
            expect(
                document.querySelector("[data-pill-id='suggester']"),
            ).toBeInTheDocument();
        });

        // 4. Drive the SuggestionForm via its popovers — auto-advance
        //    means each commit opens the next pill, so we re-query the
        //    open popover instead of clicking each trigger explicitly.
        const suggesterTrigger = document.querySelector<HTMLElement>(
            "[data-pill-id='suggester']",
        );
        if (!suggesterTrigger) throw new Error("suggester trigger missing");
        await user.click(suggesterTrigger);
        await user.click(
            within(getCurrentPopover()).getByRole("option", {
                name: /Anisha/,
            }),
        );
        await user.click(
            within(getCurrentPopover()).getByRole("option", {
                name: /Col\. Mustard/,
            }),
        );
        await user.click(
            within(getCurrentPopover()).getByRole("option", { name: /Knife/ }),
        );
        await user.click(
            within(getCurrentPopover()).getByRole("option", {
                name: /^Kitchen$/,
            }),
        );
        await user.keyboard("{Escape}");

        // 5. Submit the suggestion.
        const suggestionSubmit = screen.getByRole("button", {
            name: /^submit/,
        });
        await user.click(suggestionSubmit);

        // 6. Suggestion log shows the new entry.
        await waitFor(() => {
            expect(
                document.querySelector("[data-suggestion-row='0']"),
            ).toBeInTheDocument();
        });

        // 7. Switch to the Accusation tab. BottomNav also uses
        //    role="tab" buttons (hidden by CSS on desktop but still in
        //    DOM), so a bare `[role="tab"]` selector would race the
        //    nav. Pick the SuggestionLogPanel tab by matching its
        //    accusation-tab i18n key in the text content.
        const accusationTab = Array.from(
            document.querySelectorAll<HTMLElement>(
                'button[role="tab"][aria-selected="false"]',
            ),
        ).find(el => el.textContent?.includes("AccusationTab"));
        if (!accusationTab) throw new Error("accusation tab missing");
        await user.click(accusationTab);
        await waitFor(() => {
            expect(
                document.querySelector("[data-pill-id='accuser']"),
            ).toBeInTheDocument();
        });

        // 8. Drive the AccusationForm — same popover/auto-advance path,
        //    different starting pill (accuser instead of suggester).
        const accuserTrigger = document.querySelector<HTMLElement>(
            "[data-pill-id='accuser']",
        );
        if (!accuserTrigger) throw new Error("accuser trigger missing");
        await user.click(accuserTrigger);
        await user.click(
            within(getCurrentPopover()).getByRole("option", {
                name: /Anisha/,
            }),
        );
        await user.click(
            within(getCurrentPopover()).getByRole("option", {
                name: /Prof\. Plum/,
            }),
        );
        await user.click(
            within(getCurrentPopover()).getByRole("option", {
                name: /Rope/,
            }),
        );
        await user.click(
            within(getCurrentPopover()).getByRole("option", {
                name: /Library/,
            }),
        );
        // Pop the popover off so the submit button is what gets clicked,
        // not the open popover's trapped focus.
        await user.keyboard("{Escape}");

        const accusationSubmit = screen.getByRole("button", {
            name: /^submit/,
        });
        await user.click(accusationSubmit);

        // 9. Accusation log surfaces the new entry. The
        //    SuggestionLogPanel's accusation row carries
        //    `data-accusation-row` (mirroring the suggestion row's
        //    `data-suggestion-row`).
        await waitFor(() => {
            expect(
                document.querySelector("[data-accusation-row='0']"),
            ).toBeInTheDocument();
        });

        // 10. Submitting an accusation flips the host back to
        //    suggestion mode (SuggestionLogPanel.tsx:302's
        //    `setMode(SUGGESTION_MODE)`). After submit, the next
        //    thing the user types is a regular suggestion, so the
        //    suggester pill must be present and the accuser pill gone.
        //    SuggestionLogPanel.modeToggle.test.tsx#submitting-an-
        //    accusation-flips-back simulates this via a tab click;
        //    here we exercise the real form-submit path.
        await waitFor(() => {
            expect(
                document.querySelector("[data-pill-id='suggester']"),
            ).toBeInTheDocument();
        });
        expect(
            document.querySelector("[data-pill-id='accuser']"),
        ).toBeNull();
    });
});
