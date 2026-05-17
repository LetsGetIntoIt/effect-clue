import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { PlayerOwner } from "../../logic/GameObjects";
import { Cell, Y } from "../../logic/Knowledge";
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
    // Unmount React trees so each component's `useEffect` cleanup
    // fires — critical for the window-keydown listener, which would
    // otherwise accumulate across tests and fire the analytics spy
    // multiple times on a single press.
    cleanup();
    document.body.innerHTML = "";
});

describe("TeachModeCellCheck — C keyboard shortcut", () => {
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
        expect(document.body.textContent).not.toContain("checkThisCellButton");
    });

    test("uppercase C is also accepted (case-insensitive binding)", () => {
        renderPanel();
        act(() => {
            fireEvent.keyDown(window, { key: "C" });
        });
        expect(teachModeCellCheckUsed).toHaveBeenCalledTimes(1);
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

    test("changing the mark (via reducer dispatch) collapses the reveal so C is live again", () => {
        const { h } = renderPanel();
        act(() => {
            fireEvent.keyDown(window, { key: "c" });
        });
        expect(teachModeCellCheckUsed).toHaveBeenCalledTimes(1);
        expect(document.body.textContent).not.toContain("checkThisCellButton");

        // Dispatch a fresh mark via the reducer (mirrors what
        // Checklist's window-level Y/N/O handler does on a key
        // press — the dispatch happens OUTSIDE this component, not
        // through its local `setMark`).
        act(() => {
            h.result.current.dispatch({
                type: "setUserDeduction",
                cell,
                value: Y,
            });
        });
        // The mark-reset effect collapses the verdict on any change
        // to `userMark` (whether via local `setMark` or external
        // dispatch), so the Check button is back.
        expect(document.body.textContent).toContain("checkThisCellButton");

        // C re-fires now that the panel is back to its pre-reveal
        // state.
        act(() => {
            fireEvent.keyDown(window, { key: "c" });
        });
        expect(teachModeCellCheckUsed).toHaveBeenCalledTimes(2);
    });

    test("clicking a MarkPicker option also collapses the reveal", () => {
        renderPanel();
        act(() => {
            fireEvent.keyDown(window, { key: "c" });
        });
        expect(teachModeCellCheckUsed).toHaveBeenCalledTimes(1);
        expect(document.body.textContent).not.toContain("checkThisCellButton");

        // Local `setMark` path: clicking the Y MarkPicker button (index
        // 1) flips userDeductions from empty → {cell: Y}. The
        // mark-reset effect detects the change and collapses the
        // verdict. (Clicking Off (index 0) on an already-empty mark
        // would be a no-op and not exercise the effect.)
        const yButton = Array.from(
            document.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
        )[1];
        act(() => {
            yButton?.click();
        });
        expect(document.body.textContent).toContain("checkThisCellButton");
    });

    test("C targeted at a text input is ignored", () => {
        renderPanel();
        // Mount a stray text input — simulates the SuggestionLogPanel
        // text input sitting alongside the panel on desktop.
        const input = document.createElement("input");
        input.type = "text";
        document.body.appendChild(input);
        input.focus();

        act(() => {
            fireEvent.keyDown(input, { key: "c" });
        });
        // Analytics never fired and the Check button is still present.
        expect(teachModeCellCheckUsed).toHaveBeenCalledTimes(0);
        expect(document.body.textContent).toContain("checkThisCellButton");
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
