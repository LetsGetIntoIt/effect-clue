import { beforeEach, describe, expect, test, vi } from "vitest";
import { forwardRef, createElement } from "react";
import type { ReactNode } from "react";

vi.mock("next-intl", () => {
    // Namespace-prefixing mock so tests can target a specific key
    // via the `setupWizard.players.title` style. `t.rich` ignores
    // chunks and just emits the key, same as the simple version.
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

vi.mock("motion/react", () => {
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
                                drag: _drag,
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
    // Reorder.Group → ul; Reorder.Item → li; the test layer doesn't
    // need real drag behavior, only that the children render.
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

import { render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Clue } from "../Clue";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { seedOnboardingDismissed } from "../../test-utils/onboardingSeed";

const enableWizardFlag = () => {
    window.localStorage.setItem("effect-clue.flag.setup-wizard.v1", "1");
};

beforeEach(() => {
    window.localStorage.clear();
    seedOnboardingDismissed();
    enableWizardFlag();
    window.history.replaceState(null, "", "/?view=setup");
});

const waitForWizard = async (): Promise<HTMLElement> => {
    await waitFor(() => {
        expect(
            document.querySelector('[data-tour-anchor="setup-wizard-shell"]'),
        ).toBeInTheDocument();
    });
    return document.querySelector(
        '[data-tour-anchor="setup-wizard-shell"]',
    ) as HTMLElement;
};

// The Next / Start playing button lives in the page-fixed sticky CTA
// bar, sibling of the wizard shell. Next now handles both required-
// step advance and optional-step "accept defaults" (the previous Skip
// button was removed since its semantics overlapped on every
// non-blocked step).
const stickyNext = (): HTMLButtonElement => {
    const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
    );
    const found = buttons.find(b => b.textContent === "setupWizard.next");
    if (!found) throw new Error("Next button not found in sticky bar");
    return found;
};

describe("SetupWizard — accordion shell", () => {
    test("renders all five default visible steps (cardPack, players, identity, handSizes, knownCards)", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const wizard = await waitForWizard();

        // Default state has selfPlayerId === null, so myCards is
        // hidden by visibleSteps(). The other five render.
        expect(within(wizard).getByText(/setupWizard\.cardPack\.title/)).toBeInTheDocument();
        expect(within(wizard).getByText(/setupWizard\.players\.title/)).toBeInTheDocument();
        expect(within(wizard).getByText(/setupWizard\.identity\.title/)).toBeInTheDocument();
        expect(within(wizard).getByText(/setupWizard\.handSizes\.title/)).toBeInTheDocument();
        expect(within(wizard).getByText(/setupWizard\.knownCards\.title/)).toBeInTheDocument();
        // myCards is hidden until selfPlayerId is set.
        expect(within(wizard).queryByText(/setupWizard\.myCards\.title/)).toBeNull();
    });

    test("identity step is hidden from canonical visibleSteps for null self, but the panel renders (skippable)", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const wizard = await waitForWizard();
        // Identity panel exists; user can pick a player or skip.
        expect(within(wizard).getByText(/setupWizard\.identity\.title/)).toBeInTheDocument();
    });

    test("clicking a player pill in identity reveals the myCards step", async () => {
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const wizard = await waitForWizard();

        // myCards is hidden initially (selfPlayerId === null).
        expect(
            within(wizard).queryByText(/setupWizard\.myCards\.title/),
        ).toBeNull();

        // Default flow: advance through cardPack and players to
        // reach identity (the wizard always lands on cardPack now,
        // not the first incomplete step).
        await user.click(stickyNext()); // cardPack → players
        await user.click(stickyNext()); // players → identity

        // Click the first player pill in identity to set selfPlayerId.
        const player1 = within(wizard).getByRole("button", {
            name: /^Player 1$/,
        });
        await user.click(player1);

        // myCards step should now appear in the accordion.
        await waitFor(() => {
            expect(
                within(wizard).getByText(/setupWizard\.myCards\.title/),
            ).toBeInTheDocument();
        });
    });

    test("first-time flow lands the user on the wizard's last-step 'Start playing' CTA — no global Play CTA visible mid-flow", async () => {
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForWizard();
        // Walk every step via Next (which now handles optional steps
        // too — the prior Skip button was removed because its semantic
        // collapsed into Next on every non-blocked step). The wizard's
        // `inviteOtherPlayers` step (last in the visible order with
        // selfPlayerId null) carries the final
        // `data-tour-anchor="setup-start-playing"` CTA; that's the
        // only path out of first-time setup. The global PlayCTAButton
        // stays hidden during this walkthrough — the walkthrough-done
        // flag (in GameLifecycleState) hasn't been set yet, so the
        // chrome's CTA is gated off.
        await user.click(stickyNext()); // cardPack → players
        await user.click(stickyNext()); // players → identity
        await user.click(stickyNext()); // identity → handSizes
        await user.click(stickyNext()); // handSizes → knownCards
        await user.click(stickyNext()); // knownCards → teachMode
        await user.click(stickyNext()); // teachMode → inviteOtherPlayers
        // No global PlayCTA at any point in the walkthrough.
        expect(
            document.querySelector('[data-tour-anchor="play-cta"]'),
        ).toBeNull();
        // The wizard's last-step CTA is what the user clicks.
        await waitFor(() => {
            const cta = document.querySelector(
                '[data-tour-anchor="setup-start-playing"]',
            ) as HTMLButtonElement | null;
            expect(cta).not.toBeNull();
            expect(cta).not.toBeDisabled();
        });
    });

    test("identity skip path leaves selfPlayerId as null", async () => {
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForWizard();

        // Advance cardPack → players → identity, then through
        // identity without selecting a pill.
        await user.click(stickyNext()); // cardPack → players
        await user.click(stickyNext()); // players → identity
        await user.click(stickyNext()); // identity → handSizes

        // Wizard's `setup` localStorage doesn't carry selfPlayerId;
        // the persistence v9→v10 lift defaults it to null. Verify the
        // session-backed identity stayed null by inspecting state
        // through the reducer's persistence: localStorage's session
        // payload should NOT mention any player as selfPlayerId.
        await waitFor(() => {
            const raw = window.localStorage.getItem(
                "effect-clue.session.v12",
            );
            expect(raw).not.toBeNull();
            const parsed = JSON.parse(raw!) as { selfPlayerId: unknown };
            expect(parsed.selfPlayerId).toBeNull();
        });
    });
});

describe("SetupWizard — scroll-on-advance gate", () => {
    // The wizard scrolls the newly-focused step into view only when
    // that step's top edge sits in the bottom 20% of the viewport
    // (or below it). When the step is already in the top 80% of the
    // viewport, the scroll is suppressed so the page doesn't jump
    // while the user is mid-interaction. jsdom can't actually
    // measure layout, so these tests stub `getBoundingClientRect` +
    // `window.innerHeight` + `document.body.scrollTo` to drive both
    // branches of the gate explicitly.

    const STUBBED_VIEWPORT_HEIGHT = 1000;

    const installLayoutStubs = (topPx: number): {
        scrollSpy: ReturnType<typeof vi.fn>;
        restore: () => void;
    } => {
        const scrollSpy = vi.fn();
        const originalScrollTo = (
            document.body as unknown as { scrollTo?: unknown }
        ).scrollTo;
        Object.defineProperty(document.body, "scrollTo", {
            configurable: true,
            value: scrollSpy,
            writable: true,
        });
        const originalInnerHeight = window.innerHeight;
        Object.defineProperty(window, "innerHeight", {
            configurable: true,
            value: STUBBED_VIEWPORT_HEIGHT,
            writable: true,
        });
        const gbcrSpy = vi
            .spyOn(Element.prototype, "getBoundingClientRect")
            .mockReturnValue({
                top: topPx,
                bottom: topPx + 100,
                left: 0,
                right: 0,
                width: 0,
                height: 100,
                x: 0,
                y: topPx,
                toJSON: () => ({}),
            });
        return {
            scrollSpy,
            restore: () => {
                gbcrSpy.mockRestore();
                Object.defineProperty(document.body, "scrollTo", {
                    configurable: true,
                    value: originalScrollTo,
                    writable: true,
                });
                Object.defineProperty(window, "innerHeight", {
                    configurable: true,
                    value: originalInnerHeight,
                    writable: true,
                });
            },
        };
    };

    test("scrolls when the newly-focused step's top is in the bottom 20% of the viewport", async () => {
        // top = 900 of a 1000-px viewport → strictly greater than
        // 0.8 * 1000 = 800, so the gate falls through and scrollTo
        // fires.
        const { scrollSpy, restore } = installLayoutStubs(900);
        try {
            const user = userEvent.setup();
            render(<Clue />, { wrapper: TestQueryClientProvider });
            await waitForWizard();
            await user.click(stickyNext()); // cardPack → players
            await waitFor(
                () => {
                    expect(scrollSpy).toHaveBeenCalled();
                },
                { timeout: 1500 },
            );
        } finally {
            restore();
        }
    });

    test("does not scroll when the newly-focused step's top is in the top 80% of the viewport", async () => {
        // top = 100 of a 1000-px viewport → less than the 0.8 * 1000
        // = 800 threshold, so the gate short-circuits and scrollTo
        // is never invoked, even well past `PANE_SETTLE`.
        const { scrollSpy, restore } = installLayoutStubs(100);
        try {
            const user = userEvent.setup();
            render(<Clue />, { wrapper: TestQueryClientProvider });
            await waitForWizard();
            await user.click(stickyNext()); // cardPack → players
            // Wait well past PANE_SETTLE (210ms) so the deferred
            // measurement has definitely run.
            await new Promise((resolve) => {
                window.setTimeout(resolve, 600);
            });
            expect(scrollSpy).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });
});

