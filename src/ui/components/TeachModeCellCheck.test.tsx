import { act, fireEvent, renderHook } from "@testing-library/react";
import { HashMap } from "effect";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { PlayerOwner } from "../../logic/GameObjects";
import { Cell, N, Y } from "../../logic/Knowledge";
import { cardByName } from "../../logic/test-utils/CardByName";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { ClueProvider, useClue } from "../state";
import { TeachModeCellCheck } from "./TeachModeCellCheck";

// Light i18n shim — preserves namespace + key + interpolated values so
// the test can assert on the rendered button label including the
// `{shortcut}` suffix.
vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string => {
        if (!values) return key;
        // Render in a deterministic form. The Check-button assertions
        // care about the `shortcut` placeholder specifically, so when
        // present we splice it in directly; other values append as
        // `:{json}` for easy contains-checks.
        if ("shortcut" in values) {
            const { shortcut, ...rest } = values;
            const restJson = Object.keys(rest).length
                ? `:${JSON.stringify(rest)}`
                : "";
            return `${key}${restJson}${String(shortcut ?? "")}`;
        }
        return `${key}:${JSON.stringify(values)}`;
    };
    (t as unknown as { rich: unknown }).rich = (
        key: string,
        values?: Record<string, unknown>,
    ): unknown => (values === undefined ? key : key);
    return { useTranslations: () => t };
});

// useHasKeyboard is mocked via a mutable flag so each test can toggle
// the keyboard / touch path without juggling jsdom userAgent.
let hasKeyboardOverride = true;
vi.mock("../hooks/useHasKeyboard", () => ({
    useHasKeyboard: () => hasKeyboardOverride,
}));

// Spy on the analytics emitter so we can assert how many times Check
// fired (zero, one, etc.) without sending real PostHog events.
vi.mock("../../analytics/events", async () => {
    const actual = await vi.importActual<
        typeof import("../../analytics/events")
    >("../../analytics/events");
    return {
        ...actual,
        teachModeCellCheckUsed: vi.fn(),
    };
});

import { teachModeCellCheckUsed } from "../../analytics/events";

const setup = CLASSIC_SETUP_3P;
const PLAYER_1 = setup.players[0]!;
const KNIFE = cardByName(setup, "Knife");
const cell = Cell(PlayerOwner(PLAYER_1), KNIFE);

// Single provider hosts BOTH the renderHook (so the test can read /
// dispatch via `useClue`) AND the panel under test, so the panel's
// `useClue()` sees the same state object the test mutates.
const makeWrapper = () => {
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <TestQueryClientProvider>
            <ClueProvider>
                {children}
                <TeachModeCellCheck cell={cell} setup={setup} />
            </ClueProvider>
        </TestQueryClientProvider>
    );
    return Wrapper;
};

const renderPanel = () => {
    const wrapper = makeWrapper();
    const h = renderHook(() => useClue(), { wrapper });
    act(() => {
        h.result.current.dispatch({ type: "setSetup", setup });
    });
    act(() => {
        h.result.current.dispatch({ type: "setTeachMode", enabled: true });
    });
    return { h };
};

beforeEach(() => {
    window.localStorage.clear();
    hasKeyboardOverride = true;
    vi.mocked(teachModeCellCheckUsed).mockClear();
});

afterEach(() => {
    // Make sure the window keydown listener installed by the panel
    // doesn't leak across tests.
    document.body.innerHTML = "";
});

describe("TeachModeCellCheck — keyboard shortcuts", () => {
    test("Y dispatches setUserDeduction(cell, Y)", () => {
        const { h } = renderPanel();
        act(() => {
            fireEvent.keyDown(window, { key: "y" });
        });
        const mark = HashMap.get(h.result.current.state.userDeductions, cell);
        expect(mark).toMatchObject({ _tag: "Some", value: Y });
    });

    test("N dispatches setUserDeduction(cell, N)", () => {
        const { h } = renderPanel();
        act(() => {
            fireEvent.keyDown(window, { key: "n" });
        });
        const mark = HashMap.get(h.result.current.state.userDeductions, cell);
        expect(mark).toMatchObject({ _tag: "Some", value: N });
    });

    test("O clears any existing mark", () => {
        const { h } = renderPanel();
        // Seed an existing Y mark first.
        act(() => {
            h.result.current.dispatch({
                type: "setUserDeduction",
                cell,
                value: Y,
            });
        });
        expect(
            HashMap.get(h.result.current.state.userDeductions, cell),
        ).toMatchObject({ _tag: "Some", value: Y });

        act(() => {
            fireEvent.keyDown(window, { key: "o" });
        });
        expect(
            HashMap.get(h.result.current.state.userDeductions, cell),
        ).toMatchObject({ _tag: "None" });
    });

    test("uppercase letters fire the same shortcuts (case-insensitive)", () => {
        const { h } = renderPanel();
        act(() => {
            fireEvent.keyDown(window, { key: "Y" });
        });
        const mark = HashMap.get(h.result.current.state.userDeductions, cell);
        expect(mark).toMatchObject({ _tag: "Some", value: Y });
    });

    test("C reveals the verdict and fires analytics once", () => {
        renderPanel();
        // Pre-reveal: Check button is visible.
        expect(document.body.textContent).toContain("checkThisCellButton");

        act(() => {
            fireEvent.keyDown(window, { key: "c" });
        });

        expect(teachModeCellCheckUsed).toHaveBeenCalledTimes(1);
        // Post-reveal: the Check button is replaced by the verdict
        // banner — its label string is no longer present in the body.
        // (The actual verdict for a fresh game with no marks is
        // "unknown", which the panel renders without the
        // "checkThisCellButton" string.)
        expect(document.body.textContent).not.toContain("checkThisCellButton");
    });

    test("C is a no-op while already revealed (does not re-fire analytics)", () => {
        renderPanel();
        // First press reveals.
        act(() => {
            fireEvent.keyDown(window, { key: "c" });
        });
        expect(teachModeCellCheckUsed).toHaveBeenCalledTimes(1);

        // Second press while still revealed.
        act(() => {
            fireEvent.keyDown(window, { key: "c" });
        });
        expect(teachModeCellCheckUsed).toHaveBeenCalledTimes(1);
    });

    test("setting a new mark via keyboard collapses the verdict so C is live again", () => {
        renderPanel();
        act(() => {
            fireEvent.keyDown(window, { key: "c" });
        });
        expect(teachModeCellCheckUsed).toHaveBeenCalledTimes(1);
        // The Check button is gone now.
        expect(document.body.textContent).not.toContain("checkThisCellButton");

        // Setting a fresh mark collapses the reveal, restoring the
        // Check button and re-arming the C shortcut.
        act(() => {
            fireEvent.keyDown(window, { key: "y" });
        });
        expect(document.body.textContent).toContain("checkThisCellButton");

        act(() => {
            fireEvent.keyDown(window, { key: "c" });
        });
        expect(teachModeCellCheckUsed).toHaveBeenCalledTimes(2);
    });

    test("keystroke targeted at a text input is ignored", () => {
        const { h } = renderPanel();
        // Mount a stray text input — simulates the SuggestionLogPanel
        // text input sitting alongside the panel on desktop.
        const input = document.createElement("input");
        input.type = "text";
        document.body.appendChild(input);
        input.focus();

        act(() => {
            fireEvent.keyDown(input, { key: "y" });
        });
        const mark = HashMap.get(h.result.current.state.userDeductions, cell);
        expect(mark).toMatchObject({ _tag: "None" });
    });
});

describe("TeachModeCellCheck — keyboard hint visibility", () => {
    test("renders the shortcut hint when useHasKeyboard returns true", () => {
        hasKeyboardOverride = true;
        renderPanel();
        expect(document.body.textContent).toContain("shortcutHint");
    });

    test("does NOT render the shortcut hint when useHasKeyboard returns false", () => {
        hasKeyboardOverride = false;
        renderPanel();
        expect(document.body.textContent).not.toContain("shortcutHint");
    });

    test("Check button label includes the (C) suffix when useHasKeyboard returns true", () => {
        hasKeyboardOverride = true;
        renderPanel();
        // The next-intl mock splices `shortcut` directly into the
        // returned string. `shortcutSuffix` returns ` (C)` on keyboard.
        expect(document.body.textContent).toContain("checkThisCellButton");
        expect(document.body.textContent).toContain(" (C)");
    });

    test("Check button label omits the (C) suffix when useHasKeyboard returns false", () => {
        hasKeyboardOverride = false;
        renderPanel();
        expect(document.body.textContent).toContain("checkThisCellButton");
        expect(document.body.textContent).not.toContain(" (C)");
    });
});
