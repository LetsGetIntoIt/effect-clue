import { beforeEach, describe, expect, test, vi } from "vitest";
import { createElement, forwardRef } from "react";
import type { ReactNode } from "react";

// -----------------------------------------------------------------------
// Mocks — same shape as the other Clue tests. `motion/react` becomes
// plain DOM elements (jsdom can't run real animations); `next-intl`
// passes keys through verbatim.
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

// `useIsDesktop` is module-mocked at the top so each describe block
// can swap its return value via `beforeEach` (mirrors the pattern in
// `SuggestionLogPanel.editMode.test.tsx`).
vi.mock("../hooks/useIsDesktop", () => ({
    useIsDesktop: () => true,
}));

import { render, waitFor } from "@testing-library/react";
import { Clue } from "../Clue";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { seedOnboardingDismissed } from "../../test-utils/onboardingSeed";

const setIsDesktop = async (value: boolean): Promise<void> => {
    const mod = await import("../hooks/useIsDesktop");
    (mod as { useIsDesktop: () => boolean }).useIsDesktop = () => value;
};

// Two stable selectors that pin which pane is mounted in the DOM:
// - `#checklist` is on the Checklist `<section>`.
// - `#prior-suggestions` is the heading id inside SuggestionLogPanel.
const findChecklist = (): HTMLElement | null =>
    document.getElementById("checklist");
const findSuggestionLog = (): HTMLElement | null =>
    document.getElementById("prior-suggestions");

beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    // Suppress the splash, tour, and install-prompt auto-fires so
    // they don't stack on top of the underlying PlayLayout under test.
    // (Without this, the combined `checklistSuggest` tour would
    // dispatch `setUiMode` mid-render and clobber the `?view=` param.)
    seedOnboardingDismissed();
});

describe("PlayLayout — desktop renders both panes side-by-side", () => {
    beforeEach(async () => {
        await setIsDesktop(true);
    });

    test("checklist mode mounts the Checklist AND the SuggestionLogPanel", async () => {
        window.history.replaceState(null, "", "/?view=checklist");
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            expect(findChecklist()).toBeInTheDocument();
        });
        // On desktop, switching to either play sub-mode keeps both panes
        // visible — the breakpoint owns the layout, not the sub-mode.
        // This is `DesktopPlayLayout` rendering Checklist + the sticky
        // SuggestionLogPanel column at all times.
        expect(findSuggestionLog()).toBeInTheDocument();
    });

    test("suggest mode also mounts both panes (no breakpoint-level slide)", async () => {
        window.history.replaceState(null, "", "/?view=suggest");
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            expect(findSuggestionLog()).toBeInTheDocument();
        });
        expect(findChecklist()).toBeInTheDocument();
    });
});

describe("PlayLayout — mobile mounts only the active pane", () => {
    beforeEach(async () => {
        await setIsDesktop(false);
    });

    test("checklist mode: Checklist is mounted, SuggestionLogPanel is NOT", async () => {
        window.history.replaceState(null, "", "/?view=checklist");
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            expect(findChecklist()).toBeInTheDocument();
        });
        // The whole point of the mobile restructure: on mobile there's
        // no inactive pane lurking off-screen, so horizontal page scroll
        // on a wide setup table never reveals a hidden Suggest column,
        // and SuggestionLogPanel's pill row doesn't drag main's
        // max-content sizing while the user is on the Checklist tab.
        expect(findSuggestionLog()).not.toBeInTheDocument();
    });

    test("suggest mode: SuggestionLogPanel is mounted, Checklist is NOT", async () => {
        window.history.replaceState(null, "", "/?view=suggest");
        render(<Clue />, { wrapper: TestQueryClientProvider });
        await waitFor(() => {
            expect(findSuggestionLog()).toBeInTheDocument();
        });
        expect(findChecklist()).not.toBeInTheDocument();
    });
});
