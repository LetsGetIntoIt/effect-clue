import { act, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HashMap, Option } from "effect";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// next-intl + motion/react mocks. The latter so jsdom doesn't choke on
// the modal animation; the former so the modal button text is the raw
// key (lets us click "midGameOptionKeepExplicit" etc. without
// translation indirection).
vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    (t as unknown as { rich: unknown }).rich = (key: string): string => key;
    return {
        useTranslations: () => t,
        useLocale: () => "en",
    };
});

vi.mock("motion/react", async () => {
    const { forwardRef, createElement } = await import("react");
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
                            drag: _drag,
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

// Imports below the mocks. Vitest hoists vi.mock to the top, so this
// order doesn't matter at runtime — it just keeps the file readable.
import { emptyHypotheses } from "../../logic/Hypothesis";
import { Cell, N as N_VAL, Y as Y_VAL } from "../../logic/Knowledge";
import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { PlayerOwner } from "../../logic/GameObjects";
import { cardByName } from "../../logic/test-utils/CardByName";
import { emptyUserDeductions } from "../../logic/TeachMode";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { ClueProvider, useClue } from "../state";
import { ConfirmProvider } from "../hooks/useConfirm";
import { ModalStackProvider, ModalStackShell } from "./ModalStack";
import { useTeachModeToggle } from "./useTeachModeToggle";

function getOrFail<K, V>(map: HashMap.HashMap<K, V>, key: K): V {
    return Option.getOrThrow(HashMap.get(map, key));
}

const silenceConsoleError = () =>
    vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
    window.localStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// Renders the provider tree needed for the toggle hook: state, modal
// stack, confirm. ModalStackShell renders any pushed modal into the
// DOM so the test can click confirm/cancel buttons via userEvent.
const Wrapper = ({ children }: { readonly children: ReactNode }) => (
    <TestQueryClientProvider>
        <ClueProvider>
            <ModalStackProvider>
                <ConfirmProvider>
                    <ModalStackShell />
                    {children}
                </ConfirmProvider>
            </ModalStackProvider>
        </ClueProvider>
    </TestQueryClientProvider>
);

// Renders both the toggle and a state observer in the same provider
// tree so we can drive the toggle and read the resulting state.
const renderToggle = () => {
    const harness = renderHook(
        () => ({
            requestSetTeachMode: useTeachModeToggle(),
            clue: useClue(),
        }),
        { wrapper: Wrapper },
    );
    return harness;
};

// Seed a known game session with two players, one card per known-card
// list. Lets us populate `userDeductions` / `hypotheses` deterministically
// in each test.
const seedSession = (clue: ReturnType<typeof useClue>) => {
    const setup = CLASSIC_SETUP_3P;
    const [first, second] = setup.players;
    const knife = cardByName(setup, "Knife");
    const rope = cardByName(setup, "Rope");
    if (
        first === undefined
        || second === undefined
        || knife === undefined
        || rope === undefined
    ) {
        throw new Error("CLASSIC_SETUP_3P missing expected fixtures");
    }
    clue.dispatch({
        type: "replaceSession",
        session: {
            setup,
            hands: [{ player: first, cards: [knife] }],
            handSizes: [],
            suggestions: [],
            accusations: [],
            hypotheses: emptyHypotheses,
            hypothesisOrder: [],
            pendingSuggestion: null,
            selfPlayerId: null,
            firstDealtPlayerId: null,
            dismissedInsights: new Map(),
            teachMode: false,
            userDeductions: emptyUserDeductions,
        },
    });
    return { first, second, knife, rope };
};

describe("useTeachModeToggle — entry", () => {
    test("wizard source: seeds from own hand, does NOT merge hypotheses", () => {
        silenceConsoleError();
        const { result } = renderToggle();
        const setup = CLASSIC_SETUP_3P;
        const [first, second] = setup.players;
        const knife = cardByName(setup, "Knife");
        if (first === undefined || second === undefined || knife === undefined) {
            throw new Error("missing fixtures");
        }

        // Seed: self is `first`, holds Knife, has a hypothesis on
        // (second, Rope) = Y. The wizard path replaces userDeductions
        // wholesale from seedFromOwnHand and never reads hypotheses.
        const rope = cardByName(setup, "Rope")!;
        act(() => {
            result.current.clue.dispatch({
                type: "replaceSession",
                session: {
                    setup,
                    hands: [{ player: first, cards: [knife] }],
                    handSizes: [],
                    suggestions: [],
                    accusations: [],
                    hypotheses: HashMap.set(
                        emptyHypotheses,
                        Cell(PlayerOwner(second), rope),
                        Y_VAL,
                    ),
                    hypothesisOrder: [Cell(PlayerOwner(second), rope)],
                    pendingSuggestion: null,
                    selfPlayerId: first,
                    firstDealtPlayerId: null,
                    dismissedInsights: new Map(),
                    teachMode: false,
                    userDeductions: emptyUserDeductions,
                },
            });
        });

        act(() => result.current.requestSetTeachMode(true, "wizard"));

        // teachMode flipped on.
        expect(result.current.clue.state.teachMode).toBe(true);
        // userDeductions has the own-hand seed (Y on first's column for
        // Knife, N elsewhere), and does NOT contain the rope hypothesis.
        expect(
            HashMap.get(
                result.current.clue.state.userDeductions,
                Cell(PlayerOwner(second), rope),
            )._tag,
        ).toBe("None");
        // The hypothesis itself is still present in state.
        expect(
            HashMap.size(result.current.clue.state.hypotheses),
        ).toBe(1);
    });

    test("overflowMenu + keep-explicit: folds active hypotheses into userDeductions", async () => {
        silenceConsoleError();
        const user = userEvent.setup();
        const { result } = renderToggle();
        const setup = CLASSIC_SETUP_3P;
        const [first, second] = setup.players;
        const knife = cardByName(setup, "Knife");
        const rope = cardByName(setup, "Rope");
        if (
            first === undefined
            || second === undefined
            || knife === undefined
            || rope === undefined
        ) {
            throw new Error("missing fixtures");
        }
        const cellSecondRope = Cell(PlayerOwner(second), rope);

        act(() => {
            result.current.clue.dispatch({
                type: "replaceSession",
                session: {
                    setup,
                    hands: [],
                    handSizes: [],
                    suggestions: [],
                    accusations: [],
                    hypotheses: HashMap.set(
                        emptyHypotheses,
                        cellSecondRope,
                        N_VAL,
                    ),
                    hypothesisOrder: [cellSecondRope],
                    pendingSuggestion: null,
                    selfPlayerId: null,
                    firstDealtPlayerId: null,
                    dismissedInsights: new Map(),
                    teachMode: false,
                    userDeductions: emptyUserDeductions,
                },
            });
        });

        act(() =>
            result.current.requestSetTeachMode(true, "overflowMenu"),
        );

        // Modal is now in the DOM with the i18n key as button text.
        const keepBtn = await screen.findByText(
            "midGameOptionKeepExplicit",
        );
        await act(async () => {
            await user.click(keepBtn);
        });

        // teachMode on, userDeductions now includes the (second, rope)
        // hypothesis as a mark.
        expect(result.current.clue.state.teachMode).toBe(true);
        expect(
            getOrFail(
                result.current.clue.state.userDeductions,
                cellSecondRope,
            ),
        ).toBe(N_VAL);
    });

    test("overflowMenu + keep-explicit + empty hypotheses: no merge dispatch (userDeductions unchanged)", async () => {
        silenceConsoleError();
        const user = userEvent.setup();
        const { result } = renderToggle();
        const { first, knife } = seedSession(result.current.clue);

        // Pre-populate userDeductions with an unrelated mark to verify
        // it's preserved.
        const cellFirstKnife = Cell(PlayerOwner(first), knife);
        act(() => {
            result.current.clue.dispatch({
                type: "setUserDeduction",
                cell: cellFirstKnife,
                value: Y_VAL,
            });
        });
        const before = result.current.clue.state.userDeductions;

        act(() =>
            result.current.requestSetTeachMode(true, "overflowMenu"),
        );
        const keepBtn = await screen.findByText(
            "midGameOptionKeepExplicit",
        );
        await act(async () => {
            await user.click(keepBtn);
        });

        // Same reference — no replaceUserDeductions dispatch happened.
        expect(result.current.clue.state.userDeductions).toBe(before);
        expect(result.current.clue.state.teachMode).toBe(true);
    });

    test("overflowMenu + keep-explicit + conflicting hypothesis: hypothesis value wins", async () => {
        silenceConsoleError();
        const user = userEvent.setup();
        const { result } = renderToggle();
        const { first, knife } = seedSession(result.current.clue);
        const cell = Cell(PlayerOwner(first), knife);

        act(() => {
            result.current.clue.dispatch({
                type: "setUserDeduction",
                cell,
                value: Y_VAL,
            });
            result.current.clue.dispatch({
                type: "setHypothesis",
                cell,
                value: N_VAL,
            });
        });

        act(() =>
            result.current.requestSetTeachMode(true, "overflowMenu"),
        );
        const keepBtn = await screen.findByText(
            "midGameOptionKeepExplicit",
        );
        await act(async () => {
            await user.click(keepBtn);
        });

        expect(
            getOrFail(
                result.current.clue.state.userDeductions,
                cell,
            ),
        ).toBe(N_VAL);
    });

    test("overflowMenu + adopt-deductions: seeds from knowledge, hypotheses are NOT merged in", async () => {
        silenceConsoleError();
        const user = userEvent.setup();
        const { result } = renderToggle();
        const setup = CLASSIC_SETUP_3P;
        const [first, second] = setup.players;
        const knife = cardByName(setup, "Knife");
        const rope = cardByName(setup, "Rope");
        if (
            first === undefined
            || second === undefined
            || knife === undefined
            || rope === undefined
        ) {
            throw new Error("missing fixtures");
        }
        const cellSecondRope = Cell(PlayerOwner(second), rope);

        act(() => {
            result.current.clue.dispatch({
                type: "replaceSession",
                session: {
                    setup,
                    // Real knowledge: first holds Knife.
                    hands: [{ player: first, cards: [knife] }],
                    handSizes: [],
                    suggestions: [],
                    accusations: [],
                    hypotheses: HashMap.set(
                        emptyHypotheses,
                        cellSecondRope,
                        Y_VAL,
                    ),
                    hypothesisOrder: [cellSecondRope],
                    pendingSuggestion: null,
                    selfPlayerId: null,
                    firstDealtPlayerId: null,
                    dismissedInsights: new Map(),
                    teachMode: false,
                    userDeductions: emptyUserDeductions,
                },
            });
        });

        act(() =>
            result.current.requestSetTeachMode(true, "overflowMenu"),
        );
        const adoptBtn = await screen.findByText(
            "midGameOptionAdoptDeductions",
        );
        await act(async () => {
            await user.click(adoptBtn);
        });

        // adopt-deductions snapshots the deducer's checklist into
        // userDeductions and DOES NOT pull in the hypothesis on
        // (second, rope).
        expect(
            HashMap.get(
                result.current.clue.state.userDeductions,
                cellSecondRope,
            )._tag,
        ).toBe("None");
        // (first, Knife) is a real fact — seeded as Y.
        expect(
            getOrFail(
                result.current.clue.state.userDeductions,
                Cell(PlayerOwner(first), knife),
            ),
        ).toBe(Y_VAL);
    });
});

describe("useTeachModeToggle — exit", () => {
    test("wizard source: marks not proved by the deducer become hypotheses", () => {
        silenceConsoleError();
        const { result } = renderToggle();
        const { first, knife, rope } = seedSession(result.current.clue);
        const cellFirstKnife = Cell(PlayerOwner(first), knife);
        const cellFirstRope = Cell(PlayerOwner(first), rope);

        // Seeded session: first holds Knife (real fact). Solver knows
        // (first, Knife) = Y. We add a teach-mode mark on the same
        // cell (substantiated — skipped) AND on (first, Rope) = N
        // (unsubstantiated — should become a hypothesis).
        act(() => {
            result.current.clue.dispatch({
                type: "setTeachMode",
                enabled: true,
            });
            result.current.clue.dispatch({
                type: "setUserDeduction",
                cell: cellFirstKnife,
                value: Y_VAL,
            });
            result.current.clue.dispatch({
                type: "setUserDeduction",
                cell: cellFirstRope,
                value: N_VAL,
            });
        });
        expect(HashMap.size(result.current.clue.state.hypotheses)).toBe(0);

        act(() => result.current.requestSetTeachMode(false, "wizard"));

        // teachMode off.
        expect(result.current.clue.state.teachMode).toBe(false);
        // userDeductions preserved.
        expect(
            HashMap.size(result.current.clue.state.userDeductions),
        ).toBeGreaterThanOrEqual(2);
        // (first, Knife) substantiated by Knife being in first's hand
        // → NOT added as a hypothesis. (first, Rope) is unknown →
        // added.
        expect(
            HashMap.get(
                result.current.clue.state.hypotheses,
                cellFirstKnife,
            )._tag,
        ).toBe("None");
        expect(
            getOrFail(
                result.current.clue.state.hypotheses,
                cellFirstRope,
            ),
        ).toBe(N_VAL);
        expect(result.current.clue.state.hypothesisOrder).toContainEqual(
            cellFirstRope,
        );
    });

    test("wizard source + no userDeductions: no replaceHypotheses dispatch", () => {
        silenceConsoleError();
        const { result } = renderToggle();
        seedSession(result.current.clue);
        act(() => {
            result.current.clue.dispatch({
                type: "setTeachMode",
                enabled: true,
            });
        });
        const hypothesesBefore = result.current.clue.state.hypotheses;
        const orderBefore = result.current.clue.state.hypothesisOrder;

        act(() => result.current.requestSetTeachMode(false, "wizard"));

        // Same references — no replaceHypotheses fired.
        expect(result.current.clue.state.hypotheses).toBe(hypothesesBefore);
        expect(result.current.clue.state.hypothesisOrder).toBe(orderBefore);
        expect(result.current.clue.state.teachMode).toBe(false);
    });

    test("wizard source + mark conflicts with existing hypothesis: mark wins, order position preserved", () => {
        silenceConsoleError();
        const { result } = renderToggle();
        const { first, rope } = seedSession(result.current.clue);
        const cellFirstRope = Cell(PlayerOwner(first), rope);

        // Set hypothesis Y on (first, rope), then enter teach mode,
        // mark the same cell N, then exit.
        act(() => {
            result.current.clue.dispatch({
                type: "setHypothesis",
                cell: cellFirstRope,
                value: Y_VAL,
            });
            result.current.clue.dispatch({
                type: "setTeachMode",
                enabled: true,
            });
            result.current.clue.dispatch({
                type: "setUserDeduction",
                cell: cellFirstRope,
                value: N_VAL,
            });
        });
        const orderBefore =
            result.current.clue.state.hypothesisOrder;

        act(() => result.current.requestSetTeachMode(false, "wizard"));

        // Hypothesis value overwritten with the mark's value.
        expect(
            getOrFail(
                result.current.clue.state.hypotheses,
                cellFirstRope,
            ),
        ).toBe(N_VAL);
        // Order array reference preserved (no append happened).
        expect(result.current.clue.state.hypothesisOrder).toEqual(
            orderBefore,
        );
    });

    test("overflowMenu source + confirm: merge runs and teachMode flips off", async () => {
        silenceConsoleError();
        const user = userEvent.setup();
        const { result } = renderToggle();
        const { first, rope } = seedSession(result.current.clue);
        const cellFirstRope = Cell(PlayerOwner(first), rope);

        act(() => {
            result.current.clue.dispatch({
                type: "setTeachMode",
                enabled: true,
            });
            result.current.clue.dispatch({
                type: "setUserDeduction",
                cell: cellFirstRope,
                value: Y_VAL,
            });
        });

        act(() =>
            result.current.requestSetTeachMode(false, "overflowMenu"),
        );
        // useConfirm renders the confirm dialog with the i18n key as
        // its label.
        const confirmBtn = await screen.findByText(
            "exitPromptConfirm",
        );
        await act(async () => {
            await user.click(confirmBtn);
        });

        expect(result.current.clue.state.teachMode).toBe(false);
        expect(
            getOrFail(
                result.current.clue.state.hypotheses,
                cellFirstRope,
            ),
        ).toBe(Y_VAL);
    });

    test("overflowMenu source + cancel: nothing changes", async () => {
        silenceConsoleError();
        const user = userEvent.setup();
        const { result } = renderToggle();
        const { first, rope } = seedSession(result.current.clue);
        const cellFirstRope = Cell(PlayerOwner(first), rope);

        act(() => {
            result.current.clue.dispatch({
                type: "setTeachMode",
                enabled: true,
            });
            result.current.clue.dispatch({
                type: "setUserDeduction",
                cell: cellFirstRope,
                value: Y_VAL,
            });
        });
        const userDeductionsBefore =
            result.current.clue.state.userDeductions;
        const hypothesesBefore = result.current.clue.state.hypotheses;

        act(() =>
            result.current.requestSetTeachMode(false, "overflowMenu"),
        );
        const cancelBtn = await screen.findByText("cancel");
        await act(async () => {
            await user.click(cancelBtn);
        });

        // teachMode still on; nothing dispatched.
        expect(result.current.clue.state.teachMode).toBe(true);
        expect(result.current.clue.state.userDeductions).toBe(
            userDeductionsBefore,
        );
        expect(result.current.clue.state.hypotheses).toBe(hypothesesBefore);
    });
});
