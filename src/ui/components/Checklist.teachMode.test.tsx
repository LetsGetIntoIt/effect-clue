import { act, fireEvent, renderHook } from "@testing-library/react";
import { HashMap } from "effect";
import { createElement, forwardRef } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// -----------------------------------------------------------------------
// Mocks — same shape as Checklist.deduce.test.tsx, plus stubs for the
// tour and teach-mode-check providers so we don't have to mount the
// full Clue shell. We only care that `<Checklist />` installs its
// window keydown listener under our ClueProvider + SelectionProvider.
// -----------------------------------------------------------------------

vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    (t as unknown as { rich: unknown }).rich = (key: string): string => key;
    return {
        useTranslations: () => t,
        useLocale: () => "en",
    };
});

vi.mock("../hooks/useIsDesktop", () => ({
    useIsDesktop: () => true,
}));

vi.mock("../hooks/useHasKeyboard", () => ({
    useHasKeyboard: () => true,
}));

vi.mock("../hooks/useConfetti", () => ({
    useConfetti: () => ({ fireConfetti: () => {} }),
}));

vi.mock("../hooks/useReducedTransition", () => ({
    useReducedTransition: () => false,
}));

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

// Stub the tour provider — Checklist reads `currentStep` for cell-tour
// gating, but the gate-under-test (the hypothesis-handler bail-out on
// teach mode) doesn't depend on any tour state.
vi.mock("../tour/TourProvider", () => ({
    useTour: () => ({ currentStep: undefined }),
}));

// Stub the teach-mode-check context — Checklist calls
// `useTeachModeCheck()` for the toolbar's "Check my work" flow, which
// is unrelated to the keydown gate this test verifies.
vi.mock("./TeachModeCheckContext", () => ({
    useTeachModeCheck: () => ({
        verdictForCell: () => undefined,
        runCheck: () => {},
        banner: null,
        clearBanner: () => {},
    }),
}));

import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { PlayerOwner } from "../../logic/GameObjects";
import { Cell } from "../../logic/Knowledge";
import { cardByName } from "../../logic/test-utils/CardByName";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { SelectionProvider, useSelection } from "../SelectionContext";
import { ClueProvider, useClue } from "../state";
import { Checklist } from "./Checklist";

const setup = CLASSIC_SETUP_3P;
const PLAYER_1 = setup.players[0]!;
const KNIFE = cardByName(setup, "Knife");
const cell = Cell(PlayerOwner(PLAYER_1), KNIFE);

const makeWrapper = () => {
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <TestQueryClientProvider>
            <ClueProvider>
                <SelectionProvider>
                    {children}
                    <Checklist />
                </SelectionProvider>
            </ClueProvider>
        </TestQueryClientProvider>
    );
    return Wrapper;
};

const renderUnderProvider = () => {
    const wrapper = makeWrapper();
    return renderHook(
        () => ({
            clue: useClue(),
            sel: useSelection(),
        }),
        { wrapper },
    );
};

beforeEach(() => {
    window.localStorage.clear();
});

describe("Checklist — hypothesis keydown listener is gated on teach mode", () => {
    test("pressing Y with the popover open in teach mode does NOT set a hypothesis", () => {
        const h = renderUnderProvider();
        act(() => {
            h.result.current.clue.dispatch({ type: "setSetup", setup });
        });
        act(() => {
            h.result.current.clue.dispatch({
                type: "setTeachMode",
                enabled: true,
            });
        });
        act(() => {
            h.result.current.sel.setPopoverCell(cell);
        });

        act(() => {
            fireEvent.keyDown(window, { key: "y" });
        });

        // Gate worked: no hypothesis was set.
        expect(HashMap.size(h.result.current.clue.state.hypotheses)).toBe(0);
    });

    test("pressing Y with the popover open OUTSIDE teach mode still sets a hypothesis (gate doesn't over-fire)", () => {
        const h = renderUnderProvider();
        act(() => {
            h.result.current.clue.dispatch({ type: "setSetup", setup });
        });
        // teachMode stays false (default).
        act(() => {
            h.result.current.sel.setPopoverCell(cell);
        });

        act(() => {
            fireEvent.keyDown(window, { key: "y" });
        });

        expect(
            HashMap.get(h.result.current.clue.state.hypotheses, cell),
        ).toMatchObject({ _tag: "Some", value: "Y" });
    });
});
