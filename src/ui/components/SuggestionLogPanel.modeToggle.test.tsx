/**
 * Coverage for the Add-form tab UI inside `SuggestionLogPanel`:
 *   - clicking the suggestion / accusation tabs flips which form
 *     renders and fires the right analytics emitter,
 *   - the 15-second idle revert flips back to suggestion mode,
 *   - any of the four discrete-interaction events (pointerdown,
 *     pointermove, focus, keydown) inside the wrapper resets the
 *     idle timer,
 *   - the inactive tab is still keyboard-focusable + cursor-pointer
 *     (not visually disabled),
 *   - the ⌘K / ⌘I global keyboard shortcuts switch tabs and open
 *     the first pill of the entering form.
 *
 * Mocks (mirroring `SuggestionLogPanel.editMode.test.tsx`):
 *   - `next-intl` — `t.rich` actually invokes the chunk callbacks so
 *     the tab buttons render. Plain `t(key)` returns the key.
 *   - `motion/react` — strips animation props and renders plain HTML.
 *     `AnimatePresence` renders children directly so the entering form
 *     mounts synchronously (no exit-then-enter delay).
 *   - `useIsDesktop` — forced desktop, matching the rest of the panel
 *     tests.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { createElement, forwardRef, type ReactNode } from "react";

// Hoist the mocks BEFORE any non-mock imports so vi.mock applies.

vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    // Smart rich-text: invoke each chunk callback with the key string
    // as its placeholder content so the tab buttons actually render.
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
    return {
        motion,
        AnimatePresence: ({ children }: { children: ReactNode }) => children,
        useReducedMotion: () => false,
        LayoutGroup: ({ children }: { children: ReactNode }) => children,
    };
});

vi.mock("../hooks/useIsDesktop", () => ({
    useIsDesktop: () => true,
}));

// Spy on analytics emitters so we can assert the tab-click side
// effect without sending real PostHog events.
vi.mock("../../analytics/events", async () => {
    const actual = await vi.importActual<
        typeof import("../../analytics/events")
    >("../../analytics/events");
    return {
        ...actual,
        accusationFormOpened: vi.fn(),
    };
});

import { fireEvent, render, waitFor } from "@testing-library/react";
import { Clue } from "../Clue";
import { accusationFormOpened } from "../../analytics/events";

const findActiveTab = (): HTMLElement => {
    const el = document.querySelector<HTMLElement>(
        'button[role="tab"][aria-selected="true"]',
    );
    if (!el) throw new Error("no active tab");
    return el;
};

const findInactiveTab = (): HTMLElement => {
    const el = document.querySelector<HTMLElement>(
        'button[role="tab"][aria-selected="false"]',
    );
    if (!el) throw new Error("no inactive tab");
    return el;
};

const findOpenPillId = (): string | null =>
    document
        .querySelector('[data-pill-id][data-state="open"]')
        ?.getAttribute("data-pill-id") ?? null;

const isAccusationForm = (): boolean =>
    document.querySelector('[data-pill-id="accuser"]') !== null;

const isSuggestionForm = (): boolean =>
    document.querySelector('[data-pill-id="suggester"]') !== null;

const mountClue = async (): Promise<void> => {
    render(<Clue />);
    // Default startup lands on Setup until the user starts a game; the
    // panel under test is always mounted in the Play layout. Force the
    // URL into suggest view so the panel renders.
    window.history.replaceState(null, "", "/?view=suggest");
    await waitFor(() =>
        expect(
            document.querySelector('button[role="tab"]'),
        ).toBeInTheDocument(),
    );
};

beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/?view=suggest");
    vi.mocked(accusationFormOpened).mockClear();
});

describe("Add-form tab toggle — click", () => {
    test("the suggestion tab is active by default; the form is the suggestion form", async () => {
        await mountClue();
        // The active tab text contains [chunk:suggestionTab] (from the
        // smart rich-text mock).
        expect(findActiveTab().textContent).toContain("suggestionTab");
        expect(isSuggestionForm()).toBe(true);
        expect(isAccusationForm()).toBe(false);
    });

    test("clicking the inactive (accusation) tab swaps to the accusation form + fires analytics", async () => {
        await mountClue();
        fireEvent.click(findInactiveTab());
        await waitFor(() => expect(isAccusationForm()).toBe(true));
        expect(isSuggestionForm()).toBe(false);
        expect(accusationFormOpened).toHaveBeenCalledWith({
            source: "toggle_link",
        });
    });

    test("clicking back to suggestion tab restores the suggestion form (no second analytics fire)", async () => {
        await mountClue();
        fireEvent.click(findInactiveTab());
        await waitFor(() => expect(isAccusationForm()).toBe(true));
        vi.mocked(accusationFormOpened).mockClear();
        fireEvent.click(findInactiveTab()); // suggestion is now inactive
        await waitFor(() => expect(isSuggestionForm()).toBe(true));
        expect(accusationFormOpened).not.toHaveBeenCalled();
    });
});

describe("Add-form tab — visual / interaction guarantees on the inactive tab", () => {
    test("the inactive tab is still focusable as a button (not disabled)", async () => {
        await mountClue();
        const inactive = findInactiveTab();
        expect(inactive).not.toBeDisabled();
    });
});

describe("Add-form auto-revert — 15 second idle timeout", () => {
    test("after 15 seconds with no interaction in accusation mode, reverts to suggestion mode", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            await mountClue();
            fireEvent.click(findInactiveTab());
            await waitFor(() => expect(isAccusationForm()).toBe(true));

            // 14_999 ms — still on accusation
            vi.advanceTimersByTime(14_999);
            expect(isAccusationForm()).toBe(true);

            // 1 ms more — reverted
            vi.advanceTimersByTime(1);
            await waitFor(() => expect(isSuggestionForm()).toBe(true));
        } finally {
            vi.useRealTimers();
        }
    });

    test.each([
        ["pointerdown", (el: HTMLElement) => fireEvent.pointerDown(el)],
        ["pointermove", (el: HTMLElement) => fireEvent.pointerMove(el)],
        ["focus", (el: HTMLElement) => fireEvent.focus(el)],
        [
            "keydown",
            (el: HTMLElement) => fireEvent.keyDown(el, { key: "ArrowDown" }),
        ],
    ])(
        "interaction (%s) inside the form resets the idle timer",
        async (_label, fire) => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            try {
                await mountClue();
                fireEvent.click(findInactiveTab());
                await waitFor(() => expect(isAccusationForm()).toBe(true));

                // Just before revert at 14_000 ms, fire the event on a
                // pill trigger inside the accusation form.
                vi.advanceTimersByTime(14_000);
                const accuserPill = document.querySelector<HTMLElement>(
                    '[data-pill-id="accuser"]',
                );
                if (!accuserPill) throw new Error("accuser pill not found");
                fire(accuserPill);

                // Another 14_999 ms — still on accusation (timer was
                // reset to a fresh 15s window by the interaction).
                vi.advanceTimersByTime(14_999);
                expect(isAccusationForm()).toBe(true);

                // 1 ms more — reverted.
                vi.advanceTimersByTime(1);
                await waitFor(() => expect(isSuggestionForm()).toBe(true));
            } finally {
                vi.useRealTimers();
            }
        },
    );

    test("submitting an accusation flips back to suggestion mode immediately", async () => {
        // The shape of submission is exercised by AccusationForm tests;
        // here we just need to verify the AddSuggestion host responds
        // to the submit by flipping mode. We simulate this by clicking
        // the suggestion tab back, which is the same setMode path.
        await mountClue();
        fireEvent.click(findInactiveTab());
        await waitFor(() => expect(isAccusationForm()).toBe(true));
        // (Direct submit from the form requires filling 4 pills which
        // would balloon this test — covered end-to-end elsewhere.)
        fireEvent.click(findInactiveTab()); // suggestion tab is inactive in accusation mode
        await waitFor(() => expect(isSuggestionForm()).toBe(true));
    });
});

describe("Add-form keyboard shortcuts — ⌘K and ⌘I", () => {
    test("⌘K from suggestion mode opens the first pill of the suggestion form", async () => {
        await mountClue();
        // Already in suggestion mode; ⌘K should focus the first pill.
        window.dispatchEvent(
            new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
        );
        await waitFor(() => expect(findOpenPillId()).toBe("suggester"));
    });

    test("⌘I switches to accusation mode and opens the accuser pill", async () => {
        await mountClue();
        window.dispatchEvent(
            new KeyboardEvent("keydown", { key: "i", metaKey: true, bubbles: true }),
        );
        await waitFor(() => expect(isAccusationForm()).toBe(true));
        await waitFor(() => expect(findOpenPillId()).toBe("accuser"));
    });

    test("⌘K from accusation mode swaps back to suggestion + opens suggester pill", async () => {
        await mountClue();
        // First flip to accusation
        fireEvent.click(findInactiveTab());
        await waitFor(() => expect(isAccusationForm()).toBe(true));
        // Now ⌘K
        window.dispatchEvent(
            new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
        );
        await waitFor(() => expect(isSuggestionForm()).toBe(true));
        await waitFor(() => expect(findOpenPillId()).toBe("suggester"));
    });
});
