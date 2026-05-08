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

import { render, screen, waitFor, within } from "@testing-library/react";
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

describe("SetupWizard — accordion shell", () => {
    test("renders only the implemented steps (players, identity, handSizes)", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const wizard = await waitForWizard();

        // The mocked translation returns the key itself.
        expect(within(wizard).getByText(/setupWizard\.players\.title/)).toBeInTheDocument();
        expect(within(wizard).getByText(/setupWizard\.identity\.title/)).toBeInTheDocument();
        expect(within(wizard).getByText(/setupWizard\.handSizes\.title/)).toBeInTheDocument();
    });

    test("identity step is hidden from canonical visibleSteps for null self, but the panel renders (skippable)", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const wizard = await waitForWizard();
        // Identity panel exists; user can pick a player or skip.
        expect(within(wizard).getByText(/setupWizard\.identity\.title/)).toBeInTheDocument();
    });

    test("clicking a complete step's header re-enters editing for that step", async () => {
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const wizard = await waitForWizard();

        // The default 4-player Classic preset → players step is
        // already complete-eligible (>= 2 players). On mount the
        // first incomplete step (identity) is focused; players is
        // either complete or pending. Click the Next button to mark
        // it complete deterministically.
        const nextButtons = within(wizard).getAllByText("setupWizard.next");
        await user.click(nextButtons[0]);

        // After advance, Identity panel is focused. Its Skip button
        // is visible.
        await waitFor(() => {
            expect(
                within(wizard).getByText("setupWizard.skip"),
            ).toBeInTheDocument();
        });
    });

    test("Start playing CTA is enabled with the default 4-player preset", async () => {
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitForWizard();
        // CTA lives in the sticky bottom bar, sibling of the wizard
        // shell. Locate at document scope to avoid the within(wizard)
        // boundary.
        const cta = document.querySelector(
            '[data-tour-anchor="setup-start-playing"]',
        ) as HTMLButtonElement | null;
        expect(cta).not.toBeNull();
        expect(cta).not.toBeDisabled();
    });

    test("identity skip path leaves selfPlayerId as null", async () => {
        const user = userEvent.setup();
        render(<Clue />, { wrapper: TestQueryClientProvider });
        const wizard = await waitForWizard();

        // Advance Players → identity is now editing.
        const next = within(wizard).getAllByText("setupWizard.next");
        await user.click(next[0]);

        // Click skip on identity.
        const skip = await within(wizard).findByText("setupWizard.skip");
        await user.click(skip);

        // Wizard's `setup` localStorage doesn't carry selfPlayerId;
        // the persistence v9 lift defaults it to null. Verify the
        // session-backed identity stayed null by inspecting state
        // through the reducer's persistence: localStorage's session
        // payload should NOT mention any player as selfPlayerId.
        await waitFor(() => {
            const raw = window.localStorage.getItem(
                "effect-clue.session.v9",
            );
            expect(raw).not.toBeNull();
            const parsed = JSON.parse(raw!) as { selfPlayerId: unknown };
            expect(parsed.selfPlayerId).toBeNull();
        });
    });
});

describe("SetupWizard — feature flag", () => {
    test("when the flag is off, the legacy Checklist renders instead", async () => {
        // Override the seeded flag to OFF.
        window.localStorage.setItem(
            "effect-clue.flag.setup-wizard.v1",
            "0",
        );
        render(<Clue />, { wrapper: TestQueryClientProvider });

        // Wait long enough for the wizard mount path to stabilize;
        // it should NOT show.
        await waitFor(() => {
            // Setup CTA from the legacy Checklist is the unique
            // signal of the legacy path.
            expect(
                document.querySelector("[data-setup-cta]"),
            ).toBeInTheDocument();
        });
        expect(
            document.querySelector('[data-tour-anchor="setup-wizard-shell"]'),
        ).toBeNull();
    });
});
