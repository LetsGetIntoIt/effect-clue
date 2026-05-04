import { describe, expect, test, beforeEach, vi } from "vitest";

vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    return { useTranslations: () => t };
});

vi.mock("next/navigation", () => ({
    usePathname: () => "/play",
    useSearchParams: () => new URLSearchParams("view=setup"),
}));

const signInSocialMock = vi.fn();
const refetchMock = vi.fn();
let mockSessionData: {
    user: {
        id: string;
        email: string;
        name: string | null;
        image: string | null;
        isAnonymous?: boolean | null;
    };
    session: { expiresAt: string };
} | null = null;

vi.mock("./authClient", () => ({
    authClient: {
        useSession: () => ({
            data: mockSessionData,
            isPending: false,
            isRefetching: false,
            error: null,
            refetch: refetchMock,
        }),
        signIn: {
            social: (input: unknown) => signInSocialMock(input),
        },
    },
}));

const getMyCardPacksMock = vi.fn();
vi.mock("../../server/actions/packs", () => ({
    getMyCardPacks: () => getMyCardPacksMock(),
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountModal, mergeCardPacks } from "./AccountModal";
import { TestQueryClientProvider } from "../../test-utils/queryClient";

const renderModal = () =>
    render(<AccountModal open={true} onClose={() => {}} />, {
        wrapper: TestQueryClientProvider,
    });

beforeEach(() => {
    window.localStorage.clear();
    mockSessionData = null;
    signInSocialMock.mockReset();
    signInSocialMock.mockResolvedValue({ data: null, error: null });
    refetchMock.mockReset();
    refetchMock.mockResolvedValue(undefined);
    getMyCardPacksMock.mockReset();
    getMyCardPacksMock.mockResolvedValue([]);
});

describe("AccountModal — Better Auth client calls", () => {
    test("Google sign-in button calls authClient.signIn.social", async () => {
        renderModal();

        fireEvent.click(screen.getByText("signInWithGoogle"));

        await waitFor(() => {
            expect(signInSocialMock).toHaveBeenCalledWith({
                provider: "google",
                callbackURL: "/play?view=setup",
            });
        });
    });

    test("signed-in modal does not show session-management sign out", () => {
        mockSessionData = {
            user: {
                id: "u1",
                email: "alice@example.test",
                name: "Alice",
                image: null,
                isAnonymous: false,
            },
            session: { expiresAt: "2030-01-01T00:00:00.000Z" },
        };
        renderModal();

        expect(screen.getByText("titleSignedIn")).toBeInTheDocument();
        expect(screen.queryByText("signOut")).not.toBeInTheDocument();
    });

    test("signed-in modal lists My card packs", async () => {
        mockSessionData = {
            user: {
                id: "u1",
                email: "alice@example.test",
                name: "Alice",
                image: null,
                isAnonymous: false,
            },
            session: { expiresAt: "2030-01-01T00:00:00.000Z" },
        };
        getMyCardPacksMock.mockResolvedValue([
            {
                id: "pack-1",
                clientGeneratedId: "custom-1",
                label: "Office Edition",
                cardSetData: "{}",
            },
        ]);

        renderModal();

        expect(screen.getByText("myCardPacksTitle")).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByText("Office Edition")).toBeInTheDocument();
        });
    });

    test("signed-in modal includes local packs before server sync catches up", async () => {
        window.localStorage.setItem(
            "effect-clue.custom-presets.v1",
            JSON.stringify({
                version: 1,
                presets: [
                    {
                        id: "custom-local-1",
                        label: "My Mansion",
                        categories: [],
                    },
                ],
            }),
        );
        mockSessionData = {
            user: {
                id: "u1",
                email: "alice@example.test",
                name: "Alice",
                image: null,
                isAnonymous: false,
            },
            session: { expiresAt: "2030-01-01T00:00:00.000Z" },
        };

        renderModal();

        expect(screen.getByText("My Mansion")).toBeInTheDocument();
    });
});

describe("mergeCardPacks", () => {
    test("dedupes server packs that came from local clientGeneratedId", () => {
        expect(
            mergeCardPacks(
                [{ id: "custom-1", label: "Local name" }],
                [
                    {
                        id: "server-1",
                        clientGeneratedId: "custom-1",
                        label: "Server name",
                    },
                ],
            ),
        ).toEqual([
            {
                id: "server-1",
                clientGeneratedId: "custom-1",
                label: "Server name",
            },
        ]);
    });
});
