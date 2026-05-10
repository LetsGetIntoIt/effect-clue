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
const saveCardPackMock = vi.fn();
const deleteCardPackMock = vi.fn();
vi.mock("../../server/actions/packs", () => ({
    getMyCardPacks: () => getMyCardPacksMock(),
    saveCardPack: (input: unknown) => saveCardPackMock(input),
    deleteCardPack: (input: unknown) => deleteCardPackMock(input),
}));

const openShareCardPackMock = vi.fn();
vi.mock("../share/ShareProvider", () => ({
    useShareContext: () => ({
        open: false,
        openShareCardPack: (opts: unknown) => openShareCardPackMock(opts),
        openInvitePlayer: () => {},
        openContinueOnAnotherDevice: () => {},
    }),
    ShareProvider: ({ children }: { readonly children: React.ReactNode }) =>
        children,
}));

import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DateTime } from "effect";
import { AccountModal, ACCOUNT_MODAL_ID, mergeCardPacks } from "./AccountModal";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import {
    ModalStackProvider,
    ModalStackShell,
    useModalStack,
} from "../components/ModalStack";
import { ConfirmProvider } from "../hooks/useConfirm";
import { PromptProvider } from "../hooks/usePrompt";

const Wrappers = ({ children }: { readonly children: React.ReactNode }) => (
    <TestQueryClientProvider>
        <ModalStackProvider>
            <ConfirmProvider>
                <PromptProvider>
                    {children}
                    {/* Shell mounted inside the providers so pushed
                        content can read confirm / prompt context. */}
                    <ModalStackShell />
                </PromptProvider>
            </ConfirmProvider>
        </ModalStackProvider>
    </TestQueryClientProvider>
);

/**
 * Push the AccountModal onto the stack on mount. The shell mounted by
 * `ModalStackProvider` then renders it. Tests query the rendered DOM
 * via `screen` exactly as before.
 */
const AccountModalSeeder = () => {
    const { push } = useModalStack();
    React.useEffect(() => {
        push({
            id: ACCOUNT_MODAL_ID,
            title: "Account",
            content: <AccountModal />,
        });
    }, [push]);
    return null;
};

const renderModal = () =>
    render(<AccountModalSeeder />, {
        wrapper: Wrappers,
    });

// A minimal-but-decodable `cardSetData` for `decodeServerPack`. Empty
// categories array is enough — the decoder only requires the shape,
// not non-empty contents.
const EMPTY_CARD_SET_DATA = JSON.stringify({ categories: [] });

const officeCategory = {
    id: "category-tv",
    name: "TV Shows",
    cards: [{ id: "card-office", name: "The Office" }],
};
const officeCardSetData = JSON.stringify({ categories: [officeCategory] });

beforeEach(() => {
    window.localStorage.clear();
    mockSessionData = null;
    signInSocialMock.mockReset();
    signInSocialMock.mockResolvedValue({ data: null, error: null });
    refetchMock.mockReset();
    refetchMock.mockResolvedValue(undefined);
    getMyCardPacksMock.mockReset();
    getMyCardPacksMock.mockResolvedValue([]);
    saveCardPackMock.mockReset();
    saveCardPackMock.mockImplementation(async (input: unknown) => {
        const i = input as {
            clientGeneratedId: string;
            label: string;
            cardSetData: string;
        };
        return {
            id: `server-${i.clientGeneratedId}`,
            clientGeneratedId: i.clientGeneratedId,
            label: i.label,
            cardSetData: i.cardSetData,
        };
    });
    deleteCardPackMock.mockReset();
    deleteCardPackMock.mockResolvedValue(undefined);
    openShareCardPackMock.mockReset();
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
                cardSetData: officeCardSetData,
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

describe("AccountModal — pack row actions", () => {
    const signInAlice = () => {
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
    };

    test("share button calls openShareCardPack with the decoded card set", async () => {
        signInAlice();
        getMyCardPacksMock.mockResolvedValue([
            {
                id: "pack-1",
                clientGeneratedId: "custom-1",
                label: "Office Edition",
                cardSetData: officeCardSetData,
            },
        ]);
        renderModal();
        await waitFor(() => {
            expect(screen.getByText("Office Edition")).toBeInTheDocument();
        });
        fireEvent.click(
            screen.getByLabelText(
                'sharePackAria:{"label":"Office Edition"}',
            ),
        );
        expect(openShareCardPackMock).toHaveBeenCalledTimes(1);
        const opts = openShareCardPackMock.mock.calls[0]?.[0] as {
            packLabel: string;
            forcedCardPack: { categories: ReadonlyArray<unknown> };
        };
        expect(opts.packLabel).toBe("Office Edition");
        expect(opts.forcedCardPack.categories).toHaveLength(1);
    });

    test("rename mirrors to both server and local for a synced pack", async () => {
        signInAlice();
        // Local copy mirrors the server pack — same `clientGeneratedId`.
        window.localStorage.setItem(
            "effect-clue.custom-presets.v1",
            JSON.stringify({
                version: 1,
                presets: [
                    {
                        id: "custom-1",
                        label: "Office Edition",
                        categories: [
                            { id: "category-tv", name: "TV Shows", cards: [
                                { id: "card-office", name: "The Office" },
                            ] },
                        ],
                    },
                ],
            }),
        );
        getMyCardPacksMock.mockResolvedValue([
            {
                id: "pack-1",
                clientGeneratedId: "custom-1",
                label: "Office Edition",
                cardSetData: officeCardSetData,
            },
        ]);
        renderModal();
        await waitFor(() => {
            expect(screen.getByText("Office Edition")).toBeInTheDocument();
        });
        fireEvent.click(
            screen.getByLabelText(
                'renamePackAria:{"label":"Office Edition"}',
            ),
        );
        // Prompt dialog renders.
        const input = (await screen.findByDisplayValue(
            "Office Edition",
        )) as HTMLInputElement;
        fireEvent.change(input, { target: { value: "Dunder Mifflin" } });
        fireEvent.click(screen.getByRole("button", { name: "save" }));

        await waitFor(() => {
            expect(saveCardPackMock).toHaveBeenCalledTimes(1);
        });
        const serverArg = saveCardPackMock.mock.calls[0]?.[0] as {
            clientGeneratedId: string;
            label: string;
            cardSetData: unknown;
        };
        expect(serverArg.clientGeneratedId).toBe("custom-1");
        expect(serverArg.label).toBe("Dunder Mifflin");
        // Pins the regression class: `cardSetData` is a JSON string
        // (Effect `Data.Class` instances do not survive Next.js RSC
        // argument serialisation, so we encode client-side).
        expect(typeof serverArg.cardSetData).toBe("string");
        // Local mutation also fired — the localStorage entry now has
        // the new label (synchronous rewrite via `saveCustomCardSet`).
        const raw = window.localStorage.getItem(
            "effect-clue.custom-presets.v1",
        );
        expect(raw).toContain("Dunder Mifflin");
    });

    test("rename of a local-only pack while signed in mirrors to server", async () => {
        // The pack is in localStorage but `getMyCardPacks` doesn't
        // return it yet — that's the "anon-era pack waiting for
        // first reconcile" case OR a brand-new pack created while
        // signed in but offline. Per the Flow 1 invariant in
        // `docs/shares-and-sync.md`, a signed-in mutation pushes to
        // the server even for a pack the server hasn't seen yet —
        // the unified `useSaveCardPack` handles the upsert and the
        // localStorage `lastSyncedSnapshot` stamp.
        signInAlice();
        window.localStorage.setItem(
            "effect-clue.custom-presets.v1",
            JSON.stringify({
                version: 1,
                presets: [
                    {
                        id: "custom-local-only",
                        label: "Local-only",
                        categories: [],
                    },
                ],
            }),
        );
        getMyCardPacksMock.mockResolvedValue([]);
        renderModal();
        await waitFor(() => {
            expect(screen.getByText("Local-only")).toBeInTheDocument();
        });
        fireEvent.click(
            screen.getByLabelText(
                'renamePackAria:{"label":"Local-only"}',
            ),
        );
        const input = (await screen.findByDisplayValue(
            "Local-only",
        )) as HTMLInputElement;
        fireEvent.change(input, { target: { value: "Renamed" } });
        fireEvent.click(screen.getByRole("button", { name: "save" }));

        await waitFor(() => {
            const raw = window.localStorage.getItem(
                "effect-clue.custom-presets.v1",
            );
            expect(raw).toContain("Renamed");
        });
        await waitFor(() => {
            expect(saveCardPackMock).toHaveBeenCalledTimes(1);
        });
        const serverArg = saveCardPackMock.mock.calls[0]?.[0] as {
            clientGeneratedId: string;
            label: string;
        };
        expect(serverArg.clientGeneratedId).toBe("custom-local-only");
        expect(serverArg.label).toBe("Renamed");
    });

    test("rename Cancel performs no mutation", async () => {
        signInAlice();
        getMyCardPacksMock.mockResolvedValue([
            {
                id: "pack-1",
                clientGeneratedId: "custom-1",
                label: "Office Edition",
                cardSetData: officeCardSetData,
            },
        ]);
        renderModal();
        await waitFor(() => {
            expect(screen.getByText("Office Edition")).toBeInTheDocument();
        });
        fireEvent.click(
            screen.getByLabelText(
                'renamePackAria:{"label":"Office Edition"}',
            ),
        );
        await screen.findByDisplayValue("Office Edition");
        fireEvent.click(screen.getByRole("button", { name: "cancel" }));
        expect(saveCardPackMock).not.toHaveBeenCalled();
    });

    test("delete fires both server and local mutations after confirm", async () => {
        signInAlice();
        window.localStorage.setItem(
            "effect-clue.custom-presets.v1",
            JSON.stringify({
                version: 1,
                presets: [
                    {
                        id: "custom-1",
                        label: "Office Edition",
                        categories: [
                            { id: "category-tv", name: "TV Shows", cards: [
                                { id: "card-office", name: "The Office" },
                            ] },
                        ],
                    },
                ],
            }),
        );
        getMyCardPacksMock.mockResolvedValue([
            {
                id: "pack-1",
                clientGeneratedId: "custom-1",
                label: "Office Edition",
                cardSetData: officeCardSetData,
            },
        ]);
        renderModal();
        await waitFor(() => {
            expect(screen.getByText("Office Edition")).toBeInTheDocument();
        });
        fireEvent.click(
            screen.getByLabelText(
                'deletePackAria:{"label":"Office Edition"}',
            ),
        );
        const confirmBtn = await screen.findByRole("button", { name: "confirm" });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(deleteCardPackMock).toHaveBeenCalledTimes(1);
        });
        // The orchestrator passes the server's canonical `id` to
        // `deleteCardPackOnServer`. Server action's `WHERE id = $1
        // OR client_generated_id = $1` would accept either, but the
        // server id is the more direct key.
        expect(deleteCardPackMock.mock.calls[0]?.[0]).toEqual({
            idOrClientGeneratedId: "pack-1",
        });
        // Local entry removed.
        const raw = window.localStorage.getItem(
            "effect-clue.custom-presets.v1",
        );
        expect(raw).not.toContain("Office Edition");
    });
});

describe("mergeCardPacks", () => {
    test("dedupes server packs that came from local clientGeneratedId", () => {
        const merged = mergeCardPacks(
            [
                {
                    id: "custom-1",
                    label: "Local name",
                    cardSet: { categories: [] } as never,
                },
            ],
            [
                {
                    id: "server-1",
                    clientGeneratedId: "custom-1",
                    label: "Server name",
                    cardSetData: EMPTY_CARD_SET_DATA,
                },
            ],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject({
            id: "server-1",
            clientGeneratedId: "custom-1",
            label: "Server name",
            source: "server",
        });
    });

    test("drops server packs with malformed cardSetData", () => {
        const merged = mergeCardPacks(
            [],
            [
                {
                    id: "broken",
                    clientGeneratedId: "broken",
                    label: "Broken",
                    cardSetData: "not-json",
                },
            ],
        );
        expect(merged).toHaveLength(0);
    });

    test("dedupes when local id has been swapped to server id by reconcile", () => {
        // Post-reconcile state: the local pack's `id` is the server's
        // `id` (the swap happens in `markPackSynced` after a
        // successful push or pull). The server pack's
        // `clientGeneratedId` is the original `custom-…` id. If
        // `mergeCardPacks` only checked against
        // `clientGeneratedId`, the same pack would render twice —
        // once from `decodedServer` and once from `localOnly`.
        const merged = mergeCardPacks(
            [
                {
                    id: "server-1",
                    label: "Mansion",
                    cardSet: { categories: [] } as never,
                },
            ],
            [
                {
                    id: "server-1",
                    clientGeneratedId: "custom-mansion",
                    label: "Mansion",
                    cardSetData: EMPTY_CARD_SET_DATA,
                },
            ],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject({
            id: "server-1",
            clientGeneratedId: "custom-mansion",
            source: "server",
        });
    });

    test("server-source pack picks up unsyncedSince from its local copy", () => {
        const stamp = DateTime.nowUnsafe();
        const merged = mergeCardPacks(
            [
                {
                    id: "server-1",
                    label: "Mansion",
                    cardSet: { categories: [] } as never,
                    unsyncedSince: stamp,
                },
            ],
            [
                {
                    id: "server-1",
                    clientGeneratedId: "custom-mansion",
                    label: "Mansion",
                    cardSetData: EMPTY_CARD_SET_DATA,
                },
            ],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0]?.unsyncedSince).toBe(stamp);
    });

    test("server-source pack matched by clientGeneratedId picks up unsyncedSince", () => {
        // Pre-reconcile state: local id is still the original
        // `custom-…` id, server pack has both `id` and
        // `clientGeneratedId`. The lookup should match by
        // `clientGeneratedId`.
        const stamp = DateTime.nowUnsafe();
        const merged = mergeCardPacks(
            [
                {
                    id: "custom-1",
                    label: "Local",
                    cardSet: { categories: [] } as never,
                    unsyncedSince: stamp,
                },
            ],
            [
                {
                    id: "server-1",
                    clientGeneratedId: "custom-1",
                    label: "Server",
                    cardSetData: EMPTY_CARD_SET_DATA,
                },
            ],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0]?.unsyncedSince).toBe(stamp);
    });

    test("server-source pack with no local copy has unsyncedSince undefined", () => {
        const merged = mergeCardPacks(
            [],
            [
                {
                    id: "server-1",
                    clientGeneratedId: "custom-1",
                    label: "Server-only",
                    cardSetData: EMPTY_CARD_SET_DATA,
                },
            ],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0]?.unsyncedSince).toBeUndefined();
    });

    test("local-only pack preserves its unsyncedSince", () => {
        const stamp = DateTime.nowUnsafe();
        const merged = mergeCardPacks(
            [
                {
                    id: "custom-local",
                    label: "Local-only",
                    cardSet: { categories: [] } as never,
                    unsyncedSince: stamp,
                },
            ],
            [],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject({
            source: "local",
            unsyncedSince: stamp,
        });
    });
});

describe("AccountModal — Sync now button", () => {
    const signInAlice = () => {
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
    };

    test("renders the Sync now button when signed in", async () => {
        signInAlice();
        renderModal();
        // The button starts in "syncing" state while the initial
        // React Query fetch is in flight, then settles to "syncNow".
        expect(
            await screen.findByRole("button", { name: "syncNow" }),
        ).toBeInTheDocument();
    });

    test("clicking Sync now refetches getMyCardPacks", async () => {
        signInAlice();
        getMyCardPacksMock.mockResolvedValue([]);
        renderModal();
        const button = await screen.findByRole("button", { name: "syncNow" });
        expect(getMyCardPacksMock).toHaveBeenCalledTimes(1);
        fireEvent.click(button);
        await waitFor(() => {
            expect(getMyCardPacksMock).toHaveBeenCalledTimes(2);
        });
    });

    test("synced pack rows show the synced aria-label", async () => {
        signInAlice();
        // Pack with `lastSyncedSnapshot` set and no `unsyncedSince` —
        // i.e. fully synced.
        window.localStorage.setItem(
            "effect-clue.custom-presets.v1",
            JSON.stringify({
                version: 1,
                presets: [
                    {
                        id: "pack-1",
                        label: "Office Edition",
                        categories: [],
                        lastSyncedSnapshot: {
                            id: "pack-1",
                            label: "Office Edition",
                            categories: [],
                        },
                    },
                ],
            }),
        );
        getMyCardPacksMock.mockResolvedValue([
            {
                id: "pack-1",
                clientGeneratedId: "pack-1",
                label: "Office Edition",
                cardSetData: officeCardSetData,
            },
        ]);
        renderModal();
        await waitFor(() => {
            expect(
                screen.getByLabelText(
                    'packSyncedAria:{"label":"Office Edition"}',
                ),
            ).toBeInTheDocument();
        });
    });

    test("pack with unsyncedSince shows the pending aria-label", async () => {
        signInAlice();
        window.localStorage.setItem(
            "effect-clue.custom-presets.v1",
            JSON.stringify({
                version: 1,
                presets: [
                    {
                        id: "custom-pending",
                        label: "Pending Pack",
                        categories: [],
                        unsyncedSince: 1735689600000,
                    },
                ],
            }),
        );
        getMyCardPacksMock.mockResolvedValue([]);
        renderModal();
        await waitFor(() => {
            expect(
                screen.getByLabelText(
                    'packPendingAria:{"label":"Pending Pack"}',
                ),
            ).toBeInTheDocument();
        });
    });
});
