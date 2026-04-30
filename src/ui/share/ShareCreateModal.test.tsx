/**
 * Tests for the M16 toggle dependency rules in `ShareCreateModal`.
 *
 * The DB-dependent paths (`createShare`, sign-in roundtrip) are
 * out of scope here — they need an integration harness against the
 * Docker Postgres + a mocked better-auth session, which is M19's
 * larger ask. This file covers the pure UI rules:
 *
 * - Default toggles render with cardPack + players on, others off.
 * - Enabling players forces cardPack on AND disables the toggle.
 * - Disabling players re-enables the cardPack toggle.
 * - knownCards / suggestions are gated on players.
 *
 * The mock pattern mirrors `src/ui/Clue.test.tsx`: `next-intl`
 * passes keys through verbatim, `motion/react` becomes plain DOM,
 * and the createShare server action is stubbed.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { forwardRef, createElement } from "react";
import type { ReactNode } from "react";

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

// Stub the server action — every test in this file exercises the
// pure-UI toggle dependency rules and never hits createShare.
vi.mock("../../server/actions/shares", () => ({
    createShare: vi.fn(),
}));

// useSession returns a stable null so the modal treats the user
// as anonymous — irrelevant to the toggle tests but required to
// avoid a network call from the real hook.
vi.mock("../hooks/useSession", () => ({
    useSession: () => ({ data: null, isPending: false, error: null }),
    sessionQueryKey: ["session"],
}));

import { fireEvent, render, screen } from "@testing-library/react";
import { ClueProvider } from "../state";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { ShareCreateModal } from "./ShareCreateModal";

const mountModal = () =>
    render(
        <ClueProvider>
            <ShareCreateModal open={true} onClose={() => {}} />
        </ClueProvider>,
        { wrapper: TestQueryClientProvider },
    );

const findToggle = (label: string): HTMLInputElement => {
    const span = screen.getByText(label);
    const lbl = span.closest("label");
    if (!lbl) throw new Error(`label not found for ${label}`);
    const input = lbl.querySelector(
        "input[type='checkbox']",
    ) as HTMLInputElement | null;
    if (!input) throw new Error(`checkbox not found for ${label}`);
    return input;
};

beforeEach(() => {
    window.localStorage.clear();
});

describe("ShareCreateModal — toggle dependency rules", () => {
    test("defaults: cardPack + players checked, knownCards + suggestions unchecked", () => {
        mountModal();
        expect(findToggle("toggleCardPack").checked).toBe(true);
        expect(findToggle("toggleCardPack").disabled).toBe(true);
        expect(findToggle("togglePlayers").checked).toBe(true);
        expect(findToggle("togglePlayers").disabled).toBe(false);
        expect(findToggle("toggleKnownCards").checked).toBe(false);
        expect(findToggle("toggleKnownCards").disabled).toBe(false);
        expect(findToggle("toggleSuggestions").checked).toBe(false);
        expect(findToggle("toggleSuggestions").disabled).toBe(false);
    });

    test("turning players off re-enables the cardPack toggle", () => {
        mountModal();
        const players = findToggle("togglePlayers");
        fireEvent.click(players);
        expect(findToggle("togglePlayers").checked).toBe(false);
        // cardPack stays checked (we don't auto-uncheck on
        // players-off; the user's free to keep it) but its disable
        // state lifts so the user can opt out if they want.
        expect(findToggle("toggleCardPack").disabled).toBe(false);
        // knownCards / suggestions force-reset to false AND disabled
        // when players is off.
        expect(findToggle("toggleKnownCards").disabled).toBe(true);
        expect(findToggle("toggleKnownCards").checked).toBe(false);
        expect(findToggle("toggleSuggestions").disabled).toBe(true);
        expect(findToggle("toggleSuggestions").checked).toBe(false);
    });

    test("turning players back on re-locks cardPack as required-checked", () => {
        mountModal();
        // Toggle players off → on.
        fireEvent.click(findToggle("togglePlayers"));
        // After turning players off, manually uncheck cardPack so we
        // can verify the players-on transition force-checks it again.
        fireEvent.click(findToggle("toggleCardPack"));
        expect(findToggle("toggleCardPack").checked).toBe(false);
        // Now toggle players back on — cardPack must come along.
        fireEvent.click(findToggle("togglePlayers"));
        expect(findToggle("togglePlayers").checked).toBe(true);
        expect(findToggle("toggleCardPack").checked).toBe(true);
        expect(findToggle("toggleCardPack").disabled).toBe(true);
    });
});
