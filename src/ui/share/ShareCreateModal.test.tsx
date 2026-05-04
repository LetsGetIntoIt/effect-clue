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

    test("signed-in non-anon user sees 'Copy link'", () => {
        mockSession = {
            data: { user: { id: "u1", isAnonymous: false } },
        };
        mountModal("pack");
        expect(findCta().textContent).toContain("copyLink");
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
});

describe("ShareCreateModal — copy existing share URL", () => {
    test("successful create stores the URL and recopy does not create another share", async () => {
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
        expect(
            document.querySelector("[data-share-created-url]"),
        ).not.toBeNull();
        expect(writeText).toHaveBeenCalledTimes(1);

        const copyButton = document.querySelector(
            "[data-share-copy-existing]",
        ) as HTMLButtonElement | null;
        expect(copyButton).not.toBeNull();
        await act(async () => {
            fireEvent.click(copyButton!);
        });

        expect(createShareMock).toHaveBeenCalledTimes(1);
        expect(writeText).toHaveBeenCalledTimes(2);
        expect(
            document.querySelector("[data-share-copy-check]"),
        ).not.toBeNull();
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
        await act(async () => {
            fireEvent.click(screen.getByText("signInWithGoogle"));
        });

        expect(signInSocialMock).toHaveBeenCalledWith({
            provider: "google",
            callbackURL: "/play?view=setup",
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
