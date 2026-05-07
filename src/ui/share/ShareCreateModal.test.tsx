/**
 * Tests for the variant-driven `ShareCreateModal` (M22).
 *
 * Prior version verified the now-removed 4-toggle dependency rules.
 * Toggles are gone — the modal now picks one of three flows
 * (`pack` / `invite` / `transfer`) and the UI surface for each is
 * fixed, so the test focus shifts to:
 *
 *   - Each variant renders its own title + description.
 *   - The transfer-only privacy warning surfaces only for `transfer`.
 *   - The invite-only optional "include progress" checkbox surfaces
 *     only for `invite`, and only when the live state has logged
 *     suggestions.
 *   - The CTA reads "Sign in or create account to share" for anon
 *     users (universal rule, no kind/pack-custom conditional anymore)
 *     and "Copy link" otherwise.
 *   - The wire payload `createShare` receives carries the right `kind`
 *     for the variant (regression guard against the old toggle-shape
 *     payload silently coming back).
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { forwardRef, createElement, act } from "react";
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

vi.mock("next/navigation", () => ({
    usePathname: () => "/play",
    useSearchParams: () => new URLSearchParams("view=setup"),
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

const createShareMock = vi.fn();
vi.mock("../../server/actions/shares", () => ({
    createShare: (input: unknown) => createShareMock(input),
}));

const signInSocialMock = vi.fn();
vi.mock("../account/authClient", () => ({
    authClient: {
        signIn: {
            social: (input: unknown) => signInSocialMock(input),
        },
    },
}));

let mockSession: {
    data: { user: { id: string; isAnonymous: boolean } } | null;
} = { data: null };
vi.mock("../hooks/useSession", () => ({
    useSession: () => ({
        data: mockSession.data,
        isPending: false,
        error: null,
    }),
    sessionQueryKey: ["session"],
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClueProvider } from "../state";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { ShareCreateModal, pickProgressLabelKey } from "./ShareCreateModal";

const mountModal = (
    variant: "pack" | "invite" | "transfer",
) =>
    render(
        <ClueProvider>
            <ShareCreateModal
                open={true}
                onClose={() => {}}
                variant={variant}
            />
        </ClueProvider>,
        { wrapper: TestQueryClientProvider },
    );

const findCta = (): HTMLButtonElement => {
    const el = document.querySelector(
        "[data-share-cta]",
    ) as HTMLButtonElement | null;
    if (!el) throw new Error("Share CTA not found");
    return el;
};

beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
    });
    window.prompt = vi.fn();
    createShareMock.mockReset();
    createShareMock.mockResolvedValue({ id: "stub-share-id" });
    signInSocialMock.mockReset();
    signInSocialMock.mockResolvedValue({ data: null, error: null });
    mockSession = { data: null };
});

describe("ShareCreateModal — variant chrome", () => {
    test("pack variant renders pack title + description, no warning, no progress checkbox", () => {
        mountModal("pack");
        expect(screen.getByText("packTitle")).toBeTruthy();
        expect(screen.getByText("packDescription")).toBeTruthy();
        expect(
            document.querySelector("[data-share-transfer-warning]"),
        ).toBeNull();
        // No optional checkbox for pack variant.
        expect(
            document.querySelector("input[type='checkbox']"),
        ).toBeNull();
    });

    test("invite variant renders invite title + description, no warning", () => {
        mountModal("invite");
        expect(screen.getByText("inviteTitle")).toBeTruthy();
        expect(screen.getByText("inviteDescription")).toBeTruthy();
        expect(
            document.querySelector("[data-share-transfer-warning]"),
        ).toBeNull();
    });

    test("transfer variant renders transfer title + description + warning", () => {
        mountModal("transfer");
        expect(screen.getByText("transferTitle")).toBeTruthy();
        expect(screen.getByText("transferDescription")).toBeTruthy();
        const warning = document.querySelector(
            "[data-share-transfer-warning]",
        );
        expect(warning).not.toBeNull();
        expect(warning?.textContent).toContain("transferWarning");
    });

    test("shows the share expiry copy", () => {
        mountModal("pack");
        expect(
            screen.getByText('linkExpiresIn:{"duration":"ttl"}'),
        ).toBeTruthy();
    });

    test("invite variant with no logged progress hides the optional checkbox", () => {
        // Default ClueProvider state has zero suggestions and zero
        // accusations logged — checkbox is gated on either being > 0.
        mountModal("invite");
        expect(
            document.querySelector("input[type='checkbox']"),
        ).toBeNull();
    });
});

describe("pickProgressLabelKey", () => {
    test("returns null when there's no progress to include", () => {
        expect(pickProgressLabelKey(0, 0)).toBeNull();
    });

    test("suggestions only → suggestions-only key", () => {
        expect(pickProgressLabelKey(3, 0)).toEqual({
            key: "inviteIncludeProgressSuggestionsOnly",
            values: { count: 3 },
        });
    });

    test("accusations only → accusations-only key", () => {
        expect(pickProgressLabelKey(0, 2)).toEqual({
            key: "inviteIncludeProgressAccusationsOnly",
            values: { count: 2 },
        });
    });

    test("both → combined key with both counts", () => {
        expect(pickProgressLabelKey(5, 1)).toEqual({
            key: "inviteIncludeProgressBoth",
            values: { suggestions: 5, accusations: 1 },
        });
    });
});

describe("ShareCreateModal — universal sign-in CTA", () => {
    test("anonymous user sees 'Sign in to share' regardless of variant", () => {
        mockSession = { data: null };
        for (const variant of ["pack", "invite", "transfer"] as const) {
            const { unmount } = mountModal(variant);
            expect(findCta().textContent).toContain("signInToShare");
            unmount();
        }
    });

    test("anonymous-plugin user sees 'Sign in to share'", () => {
        mockSession = {
            data: { user: { id: "u1", isAnonymous: true } },
        };
        mountModal("pack");
        expect(findCta().textContent).toContain("signInToShare");
    });

    test("signed-in non-anon user sees 'Generate link'", () => {
        mockSession = {
            data: { user: { id: "u1", isAnonymous: false } },
        };
        mountModal("pack");
        expect(findCta().textContent).toContain("generateLink");
    });
});

describe("ShareCreateModal — wire payload by variant", () => {
    test("pack variant sends kind: 'pack' with only cardPackData", async () => {
        mockSession = {
            data: { user: { id: "u1", isAnonymous: false } },
        };
        mountModal("pack");
        await act(async () => {
            fireEvent.click(findCta());
        });
        await waitFor(() => {
            expect(createShareMock).toHaveBeenCalled();
        });
        const payload = createShareMock.mock.calls[0]?.[0];
        expect(payload.kind).toBe("pack");
        expect(payload.cardPackData).toBeTypeOf("string");
        expect(payload.playersData).toBeUndefined();
        expect(payload.knownCardsData).toBeUndefined();
        // Regression: no leftover `cardPackIsCustom` from the old shape.
        expect(payload.cardPackIsCustom).toBeUndefined();
    });

    test("invite variant sends kind: 'invite' with cardPack + players + handSizes", async () => {
        mockSession = {
            data: { user: { id: "u1", isAnonymous: false } },
        };
        mountModal("invite");
        await act(async () => {
            fireEvent.click(findCta());
        });
        await waitFor(() => {
            expect(createShareMock).toHaveBeenCalled();
        });
        const payload = createShareMock.mock.calls[0]?.[0];
        expect(payload.kind).toBe("invite");
        expect(payload.cardPackData).toBeTypeOf("string");
        expect(payload.playersData).toBeTypeOf("string");
        expect(payload.handSizesData).toBeTypeOf("string");
        // No progress logged → optional fields absent.
        expect(payload.suggestionsData).toBeUndefined();
        expect(payload.accusationsData).toBeUndefined();
        expect(payload.knownCardsData).toBeUndefined();
    });

    test("transfer variant sends kind: 'transfer' with all six fields", async () => {
        mockSession = {
            data: { user: { id: "u1", isAnonymous: false } },
        };
        mountModal("transfer");
        await act(async () => {
            fireEvent.click(findCta());
        });
        await waitFor(() => {
            expect(createShareMock).toHaveBeenCalled();
        });
        const payload = createShareMock.mock.calls[0]?.[0];
        expect(payload.kind).toBe("transfer");
        expect(payload.cardPackData).toBeTypeOf("string");
        expect(payload.playersData).toBeTypeOf("string");
        expect(payload.handSizesData).toBeTypeOf("string");
        expect(payload.knownCardsData).toBeTypeOf("string");
        expect(payload.suggestionsData).toBeTypeOf("string");
        expect(payload.accusationsData).toBeTypeOf("string");
    });

    test("invite variant embeds the loaded custom pack's name on the wire", async () => {
        // Pre-seed localStorage with a session whose live deck matches
        // a saved custom pack (with structurally distinct contents
        // from any built-in, so the built-in branch in
        // resolvePackLabel doesn't short-circuit). The modal's label
        // backfill should then embed "Pack X" in cardPack.name so the
        // receive modal renders "Card pack: Pack X (custom)" instead
        // of the unnamed branch.
        const { saveCustomCardSet } = await import(
            "../../logic/CustomCardSets"
        );
        const { recordCardPackUse } = await import(
            "../../logic/CardPackUsage"
        );
        const { saveToLocalStorage } = await import(
            "../../logic/Persistence"
        );
        const { GameSetup } = await import("../../logic/GameSetup");
        const { PlayerSet } = await import("../../logic/PlayerSet");
        const { CardSet, Category, CardEntry } = await import(
            "../../logic/CardSet"
        );
        const { Player, Card, CardCategory } = await import(
            "../../logic/GameObjects"
        );
        const { emptyHypotheses } = await import("../../logic/Hypothesis");

        const distinctDeck = CardSet({
            categories: [
                Category({
                    id: CardCategory("category-distinct"),
                    name: "Distinct",
                    cards: [
                        CardEntry({
                            id: Card("card-distinct-1"),
                            name: "Distinct 1",
                        }),
                        CardEntry({
                            id: Card("card-distinct-2"),
                            name: "Distinct 2",
                        }),
                    ],
                }),
            ],
        });
        const saved = saveCustomCardSet("Pack X", distinctDeck);
        recordCardPackUse(saved.id);
        saveToLocalStorage({
            setup: GameSetup({
                cardSet: distinctDeck,
                playerSet: PlayerSet({
                    players: [Player("Alice"), Player("Bob")],
                }),
            }),
            hands: [],
            handSizes: [
                { player: Player("Alice"), size: 1 },
                { player: Player("Bob"), size: 1 },
            ],
            suggestions: [],
            accusations: [],
            hypotheses: emptyHypotheses,
        });

        mockSession = {
            data: { user: { id: "u1", isAnonymous: false } },
        };
        mountModal("invite");
        await act(async () => {
            fireEvent.click(findCta());
        });
        await waitFor(() => {
            expect(createShareMock).toHaveBeenCalled();
        });
        const payload = createShareMock.mock.calls[0]?.[0];
        expect(payload.kind).toBe("invite");
        const decoded = JSON.parse(payload.cardPackData);
        expect(decoded.name).toBe("Pack X");
    });
});

describe("ShareCreateModal — Generate → Copy → Done CTA", () => {
    test("first CTA click generates the link without auto-copying", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        });
        mockSession = {
            data: { user: { id: "u1", isAnonymous: false } },
        };
        mountModal("pack");

        expect(findCta().textContent).toContain("generateLink");
        await act(async () => {
            fireEvent.click(findCta());
        });
        await waitFor(() => {
            expect(createShareMock).toHaveBeenCalledTimes(1);
        });
        expect(
            document.querySelector("[data-share-created-url]"),
        ).not.toBeNull();
        // Generation must NOT auto-copy. The user has to click the
        // CTA again (or the inline button) to copy.
        expect(writeText).not.toHaveBeenCalled();
        expect(findCta().textContent).toContain("copyLink");
    });

    test("CTA cycles Generate → Copy → Done and the third click closes", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        });
        mockSession = {
            data: { user: { id: "u1", isAnonymous: false } },
        };
        const onClose = vi.fn();
        render(
            <ClueProvider>
                <ShareCreateModal
                    open={true}
                    onClose={onClose}
                    variant="pack"
                />
            </ClueProvider>,
            { wrapper: TestQueryClientProvider },
        );

        // Generate.
        expect(findCta().textContent).toContain("generateLink");
        await act(async () => {
            fireEvent.click(findCta());
        });
        await waitFor(() => {
            expect(createShareMock).toHaveBeenCalledTimes(1);
        });

        // Copy (via the bottom CTA, second click).
        expect(findCta().textContent).toContain("copyLink");
        await act(async () => {
            fireEvent.click(findCta());
        });
        await waitFor(() => {
            expect(writeText).toHaveBeenCalledTimes(1);
        });

        // Done (third click closes the modal).
        expect(findCta().textContent).toContain("done");
        await act(async () => {
            fireEvent.click(findCta());
        });
        expect(onClose).toHaveBeenCalled();
        // Generation only happened once across the whole cycle.
        expect(createShareMock).toHaveBeenCalledTimes(1);
    });

    test("inline copy button flips the bottom CTA to 'Done'", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        });
        mockSession = {
            data: { user: { id: "u1", isAnonymous: false } },
        };
        mountModal("pack");

        await act(async () => {
            fireEvent.click(findCta());
        });
        await waitFor(() => {
            expect(createShareMock).toHaveBeenCalledTimes(1);
        });
        expect(findCta().textContent).toContain("copyLink");

        const inlineCopy = document.querySelector(
            "[data-share-copy-existing]",
        ) as HTMLButtonElement | null;
        expect(inlineCopy).not.toBeNull();
        await act(async () => {
            fireEvent.click(inlineCopy!);
        });

        await waitFor(() => {
            expect(writeText).toHaveBeenCalledTimes(1);
        });
        expect(findCta().textContent).toContain("done");
        expect(
            document.querySelector("[data-share-copy-check]"),
        ).not.toBeNull();
    });

    test("inline copy icon reverts from check to clipboard after 15s", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            const writeText = vi.fn().mockResolvedValue(undefined);
            Object.defineProperty(navigator, "clipboard", {
                configurable: true,
                value: { writeText },
            });
            mockSession = {
                data: { user: { id: "u1", isAnonymous: false } },
            };
            mountModal("pack");

            await act(async () => {
                fireEvent.click(findCta());
            });
            await waitFor(() => {
                expect(createShareMock).toHaveBeenCalledTimes(1);
            });

            // Default state: clipboard icon, no check.
            expect(
                document.querySelector("[data-share-copy-clipboard]"),
            ).not.toBeNull();
            expect(
                document.querySelector("[data-share-copy-check]"),
            ).toBeNull();

            const inlineCopy = document.querySelector(
                "[data-share-copy-existing]",
            ) as HTMLButtonElement;
            await act(async () => {
                fireEvent.click(inlineCopy);
            });
            await waitFor(() => {
                expect(writeText).toHaveBeenCalledTimes(1);
            });

            // After copy: check shown, clipboard hidden.
            expect(
                document.querySelector("[data-share-copy-check]"),
            ).not.toBeNull();

            // Just shy of 15s: still shown.
            await act(async () => {
                vi.advanceTimersByTime(14_900);
            });
            expect(
                document.querySelector("[data-share-copy-check]"),
            ).not.toBeNull();

            // Past 15s: reverted.
            await act(async () => {
                vi.advanceTimersByTime(200);
            });
            await waitFor(() => {
                expect(
                    document.querySelector("[data-share-copy-check]"),
                ).toBeNull();
            });
            expect(
                document.querySelector("[data-share-copy-clipboard]"),
            ).not.toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("ShareCreateModal — QR code", () => {
    test("Show QR code button is present after the link is generated", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        });
        mockSession = {
            data: { user: { id: "u1", isAnonymous: false } },
        };
        mountModal("invite");

        // Initially hidden — no link yet.
        expect(
            document.querySelector("[data-share-show-qr]"),
        ).toBeNull();

        await act(async () => {
            fireEvent.click(findCta());
        });
        await waitFor(() => {
            expect(createShareMock).toHaveBeenCalledTimes(1);
        });

        expect(
            document.querySelector("[data-share-show-qr]"),
        ).not.toBeNull();
        // QR canvas not yet rendered (one-way reveal pending click).
        expect(document.querySelector("[data-share-qr]")).toBeNull();
    });

    test("Clicking 'Show QR code' reveals the SVG and removes the link (one-way reveal)", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        });
        mockSession = {
            data: { user: { id: "u1", isAnonymous: false } },
        };
        mountModal("invite");

        await act(async () => {
            fireEvent.click(findCta());
        });
        await waitFor(() => {
            expect(createShareMock).toHaveBeenCalledTimes(1);
        });

        const showQr = document.querySelector(
            "[data-share-show-qr]",
        ) as HTMLButtonElement | null;
        expect(showQr).not.toBeNull();

        await act(async () => {
            fireEvent.click(showQr!);
        });

        const qr = document.querySelector(
            "[data-share-qr]",
        ) as HTMLDivElement | null;
        expect(qr).not.toBeNull();
        // SVG markup was injected and contains an actual <svg> root.
        expect(qr!.querySelector("svg")).not.toBeNull();
        // Show button is gone — one-way reveal.
        expect(
            document.querySelector("[data-share-show-qr]"),
        ).toBeNull();
    });
});

describe("ShareCreateModal — sign-in slide", () => {
    test("anonymous CTA opens the sign-in step without calling createShare", async () => {
        mockSession = { data: null };
        mountModal("pack");
        await act(async () => {
            fireEvent.click(findCta());
        });
        expect(createShareMock).not.toHaveBeenCalled();
        expect(screen.getByText("signInTitle")).toBeTruthy();
    });

    test("Google sign-in uses Better Auth client and stores pending share intent", async () => {
        mockSession = { data: null };
        mountModal("pack");
        await act(async () => {
            fireEvent.click(findCta());
        });
        const googleButton = await screen.findByRole("button", {
            name: "signInWithGoogle",
        });
        await act(async () => {
            fireEvent.click(googleButton);
        });

        await waitFor(() => {
            expect(signInSocialMock).toHaveBeenCalledWith({
                provider: "google",
                callbackURL: "/play?view=setup",
            });
        });
        expect(
            window.sessionStorage.getItem("effect-clue.pending-share.v1"),
        ).toContain("\"variant\":\"pack\"");
    });

    test("server ERR_SIGN_IN_REQUIRED slides to sign-in step", async () => {
        mockSession = {
            data: { user: { id: "u1", isAnonymous: false } },
        };
        createShareMock.mockRejectedValue(
            new Error("sign_in_required_to_share"),
        );
        mountModal("pack");
        await act(async () => {
            fireEvent.click(findCta());
        });
        await waitFor(() => {
            expect(screen.getByText("signInTitle")).toBeTruthy();
        });
    });

    test("resume intent creates the pending share after OAuth returns", async () => {
        mockSession = {
            data: { user: { id: "u1", isAnonymous: false } },
        };
        const payload = {
            kind: "pack" as const,
            cardPackData: JSON.stringify({
                name: "Classic",
                categories: [],
            }),
        };
        render(
            <ClueProvider>
                <ShareCreateModal
                    open={true}
                    onClose={() => {}}
                    variant="pack"
                    resumeIntent={{
                        variant: "pack",
                        payload,
                        packIsCustom: false,
                        includesProgress: false,
                    }}
                />
            </ClueProvider>,
            { wrapper: TestQueryClientProvider },
        );

        await waitFor(() => {
            expect(createShareMock).toHaveBeenCalledWith(payload);
        });
    });
});
