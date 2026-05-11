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

// The Next / Skip / Start playing buttons live in the page-fixed
// sticky CTA bar, siblings of the wizard shell. Helpers query at
// document scope.
const stickyNext = (): HTMLButtonElement => {
    const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
    );
    const found = buttons.find(b => b.textContent === "setupWizard.next");
    if (!found) throw new Error("Next button not found in sticky bar");
    return found;
};
const stickySkip = (): HTMLButtonElement => {
    const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
    );
    const found = buttons.find(b => b.textContent === "setupWizard.skip");
    if (!found) throw new Error("Skip button not found in sticky bar");
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

    test("Skip button is visible on every step (including required steps)", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForWizard();
        // Skip is in the sticky bar; with default Classic + 4 players
        // valid, Skip on cardPack is enabled (acts as "accept defaults").
        const skip = stickySkip();
        expect(skip).not.toBeDisabled();
    });

    test("Start playing CTA appears on the last step and is enabled with defaults", async () => {
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForWizard();
        // Click Next through every step to reach the last one. With
        // selfPlayerId null on a fresh mount, visible steps are:
        // cardPack → players → identity → handSizes → knownCards →
        // inviteOtherPlayers.
        // We hit Skip on identity to skip past it (avoids setting
        // selfPlayerId, keeping myCards hidden).
        await user.click(stickyNext()); // cardPack → players
        await user.click(stickyNext()); // players → identity
        await user.click(stickySkip()); // identity → handSizes
        await user.click(stickyNext()); // handSizes → knownCards
        await user.click(stickyNext()); // knownCards → inviteOtherPlayers
        // We're now on the last step. The Next button's label is
        // "Start playing" or "Continue playing" and `data-setup-cta`
        // is set.
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

        // Advance cardPack → players → identity, then skip.
        await user.click(stickyNext()); // cardPack → players
        await user.click(stickyNext()); // players → identity
        await user.click(stickySkip()); // identity skipped

        // Wizard's `setup` localStorage doesn't carry selfPlayerId;
        // the persistence v9→v10 lift defaults it to null. Verify the
        // session-backed identity stayed null by inspecting state
        // through the reducer's persistence: localStorage's session
        // payload should NOT mention any player as selfPlayerId.
        await waitFor(() => {
            const raw = window.localStorage.getItem(
                "effect-clue.session.v11",
            );
            expect(raw).not.toBeNull();
            const parsed = JSON.parse(raw!) as { selfPlayerId: unknown };
            expect(parsed.selfPlayerId).toBeNull();
        });
    });
});

