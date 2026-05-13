import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { DraftSuggestion } from "../../logic/ClueState";
import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { newSuggestionId } from "../../logic/Suggestion";
import { cardByName } from "../../logic/test-utils/CardByName";
import { ClueProvider, useClue } from "../state";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { PlayCTAButton } from "./PlayCTAButton";

// PostHog event capture spy. Mirrors the pattern from SplashModal.test.tsx
// so the `playCtaClicked` analytics call is asserted on click.
const captureCalls: Array<{
    event: string;
    props: Record<string, unknown> | undefined;
}> = [];

vi.mock("../../analytics/posthog", () => ({
    posthog: {
        __loaded: true,
        capture: (event: string, props?: Record<string, unknown>) => {
            captureCalls.push({ event, props });
        },
    },
}));

// Light i18n shim — preserves namespace + key so assertions can match
// on string fragments.
vi.mock("next-intl", () => ({
    useTranslations: (ns?: string) => (key: string, vars?: Record<string, string>) => {
        const base = ns ? `${ns}.${key}` : key;
        // Interpolate {shortcut} so the keyboard-suffix assertions can
        // distinguish "with" / "without" shortcut.
        if (vars && "shortcut" in vars) {
            return `${base}${vars["shortcut"] ?? ""}`;
        }
        return base;
    },
}));

// useHasKeyboard reads navigator userAgent + various heuristics. Mock
// it directly so tests can toggle the keyboard-present / touch-only
// branches without juggling jsdom userAgent.
let hasKeyboardOverride = true;
vi.mock("../hooks/useHasKeyboard", () => ({
    useHasKeyboard: () => hasKeyboardOverride,
}));

beforeEach(() => {
    window.localStorage.clear();
    captureCalls.length = 0;
    hasKeyboardOverride = true;
});

afterEach(() => {
    // Reset the keyboard hook for any leftover renders.
    hasKeyboardOverride = true;
});

const wrapper = ({ children }: { children: ReactNode }) => (
    <TestQueryClientProvider>
        <ClueProvider>{children}</ClueProvider>
    </TestQueryClientProvider>
);

/**
 * Test harness that exposes the ClueProvider's `dispatch` while
 * rendering the PlayCTAButton inside the same provider. Tests seed
 * state by calling `dispatchRef.current` inside `act` blocks.
 */
function Harness({
    variant,
    onReady,
}: {
    readonly variant: "toolbar" | "bottomNav";
    readonly onReady: (
        dispatch: ReturnType<typeof useClue>["dispatch"],
    ) => void;
}) {
    const { dispatch } = useClue();
    // Latch the dispatch on first render so tests can drive it. React
    // re-renders won't change identity within a single ClueProvider
    // instance.
    onReady(dispatch);
    if (variant === "bottomNav") {
        return (
            <ul data-testid="bottom-nav-list">
                <PlayCTAButton variant="bottomNav" />
            </ul>
        );
    }
    return <PlayCTAButton variant="toolbar" />;
}

const mountToolbar = () => {
    let dispatchRef: ReturnType<typeof useClue>["dispatch"] | null = null;
    const onReady = (
        d: ReturnType<typeof useClue>["dispatch"],
    ) => {
        dispatchRef = d;
    };
    const utils = render(
        <Harness variant="toolbar" onReady={onReady} />,
        { wrapper },
    );
    return { ...utils, dispatch: () => dispatchRef! };
};

const mountBottomNav = () => {
    let dispatchRef: ReturnType<typeof useClue>["dispatch"] | null = null;
    const onReady = (
        d: ReturnType<typeof useClue>["dispatch"],
    ) => {
        dispatchRef = d;
    };
    const utils = render(
        <Harness variant="bottomNav" onReady={onReady} />,
        { wrapper },
    );
    return { ...utils, dispatch: () => dispatchRef! };
};

/**
 * Drive state into `setupCompleted`: load Classic 3-player setup and
 * set hand sizes for all three players.
 */
const seedSetupCompleted = (
    dispatch: ReturnType<typeof useClue>["dispatch"],
) => {
    act(() => {
        dispatch({ type: "setSetup", setup: CLASSIC_SETUP_3P });
    });
    for (const p of CLASSIC_SETUP_3P.players) {
        act(() => {
            dispatch({ type: "setHandSize", player: p, size: 6 });
        });
    }
};

/**
 * Drive state into `gameStarted` by adding a suggestion to a
 * setupCompleted state.
 */
const seedGameStarted = (
    dispatch: ReturnType<typeof useClue>["dispatch"],
) => {
    seedSetupCompleted(dispatch);
    const suggester = CLASSIC_SETUP_3P.players[0]!;
    const suggestion: DraftSuggestion = {
        id: newSuggestionId(),
        suggester,
        cards: [
            cardByName(CLASSIC_SETUP_3P, "Prof. Plum"),
            cardByName(CLASSIC_SETUP_3P, "Lead pipe"),
            cardByName(CLASSIC_SETUP_3P, "Study"),
        ],
        nonRefuters: [],
    };
    act(() => {
        dispatch({ type: "addSuggestion", suggestion });
    });
};

describe("PlayCTAButton — toolbar variant", () => {
    test("renders nothing in phase 'new'", () => {
        const { container } = mountToolbar();
        expect(container.querySelector("button")).toBeNull();
    });

    test("renders 'Start playing' when phase becomes setupCompleted", () => {
        const { dispatch } = mountToolbar();
        seedSetupCompleted(dispatch());
        const button = screen.getByRole("button");
        // i18n shim returns "playCta.startPlaying" + shortcut suffix.
        expect(button.textContent).toContain("playCta.startPlaying");
    });

    test("renders 'Continue playing' once a suggestion is logged", () => {
        const { dispatch } = mountToolbar();
        seedGameStarted(dispatch());
        const button = screen.getByRole("button");
        expect(button.textContent).toContain("playCta.continuePlaying");
    });

    test("renders shortcut suffix when keyboard is present", () => {
        hasKeyboardOverride = true;
        const { dispatch } = mountToolbar();
        seedSetupCompleted(dispatch());
        const button = screen.getByRole("button");
        // shortcutSuffix produces " (⌘J)" — match the parens.
        expect(button.textContent).toMatch(/\(.*J\)/);
    });

    test("hides shortcut suffix on touch-only devices", () => {
        hasKeyboardOverride = false;
        const { dispatch } = mountToolbar();
        seedSetupCompleted(dispatch());
        const button = screen.getByRole("button");
        expect(button.textContent).not.toMatch(/\(.*\)/);
    });

    test("clicking dispatches setUiMode('checklist') and emits play_cta_clicked", async () => {
        const user = userEvent.setup();
        const { dispatch } = mountToolbar();
        seedSetupCompleted(dispatch());
        const button = screen.getByRole("button");
        await user.click(button);
        // PostHog spy receives the typed event with the right props.
        const playCta = captureCalls.find((c) => c.event === "play_cta_clicked");
        expect(playCta).toBeDefined();
        expect(playCta?.props).toMatchObject({
            phase: "setupCompleted",
            variant: "toolbar",
        });
    });

    test("carries the data-tour-anchor='play-cta' attribute", () => {
        const { dispatch } = mountToolbar();
        seedSetupCompleted(dispatch());
        const button = screen.getByRole("button");
        expect(button.getAttribute("data-tour-anchor")).toBe("play-cta");
    });
});

describe("PlayCTAButton — bottomNav variant", () => {
    test("renders empty <li> spacer in phase 'new' to preserve the BottomNav grid", () => {
        const { container } = mountBottomNav();
        const list = container.querySelector("[data-testid='bottom-nav-list']");
        const li = list?.querySelector("li");
        expect(li).not.toBeNull();
        expect(li?.querySelector("button")).toBeNull();
        // Spacer has the spacer testid.
        expect(li?.getAttribute("data-testid")).toBe("play-cta-spacer");
    });

    test("renders an <li> with a button when phase is setupCompleted", () => {
        const { dispatch, container } = mountBottomNav();
        seedSetupCompleted(dispatch());
        const list = container.querySelector("[data-testid='bottom-nav-list']");
        const li = list?.querySelector("li");
        expect(li).not.toBeNull();
        const button = li?.querySelector("button");
        expect(button).not.toBeNull();
        expect(button?.textContent).toContain("playCta.startPlaying");
    });

    test("emits play_cta_clicked with variant='bottomNav'", async () => {
        const user = userEvent.setup();
        const { dispatch } = mountBottomNav();
        seedGameStarted(dispatch());
        const button = screen.getByRole("button");
        await user.click(button);
        const playCta = captureCalls.find((c) => c.event === "play_cta_clicked");
        expect(playCta?.props).toMatchObject({
            phase: "gameStarted",
            variant: "bottomNav",
        });
    });
});
