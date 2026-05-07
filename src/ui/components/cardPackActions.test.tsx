import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    QueryClient,
    QueryClientProvider,
} from "@tanstack/react-query";
import { render } from "@testing-library/react";

vi.mock("next-intl", () => {
    const make = (ns: string) =>
        (key: string, values?: Record<string, unknown>): string => {
            const fq = ns.length > 0 ? `${ns}.${key}` : key;
            return values ? `${fq}:${JSON.stringify(values)}` : fq;
        };
    return {
        useTranslations: (ns?: string) => make(ns ?? ""),
    };
});

// Mocks for the four mutation hooks. Each returns an object with
// `mutate`, `mutateAsync` so the orchestrator can drive them. We
// set the function bodies per-test.
const saveLocalMutate = vi.fn();
const saveLocalMutateAsync = vi.fn();
const deleteLocalMutate = vi.fn();
const saveServerMutate = vi.fn();
const deleteServerMutate = vi.fn();
let signedInUserId: string | undefined = undefined;

vi.mock("../../data/customCardPacks", async () => {
    const actual = await vi.importActual<
        typeof import("../../data/customCardPacks")
    >("../../data/customCardPacks");
    return {
        ...actual,
        useSaveCardPack: () => ({
            mutate: saveLocalMutate,
            mutateAsync: saveLocalMutateAsync,
        }),
        useDeleteCardPack: () => ({
            mutate: deleteLocalMutate,
        }),
        useSaveCardPackOnServer: () => ({
            mutate: saveServerMutate,
        }),
        useDeleteCardPackOnServer: () => ({
            mutate: deleteServerMutate,
        }),
        useSignedInUserId: () => signedInUserId,
    };
});

let confirmAnswer: boolean | (() => boolean) = true;
vi.mock("../hooks/useConfirm", () => ({
    useConfirm: () => async () =>
        typeof confirmAnswer === "function" ? confirmAnswer() : confirmAnswer,
}));

let promptAnswer: string | null = "New Label";
vi.mock("../hooks/usePrompt", () => ({
    usePrompt: () => async () => promptAnswer,
}));

const openShareCardPackMock = vi.fn();
vi.mock("../share/ShareProvider", () => ({
    useShareContext: () => ({
        openShareCardPack: (opts: unknown) => openShareCardPackMock(opts),
        openInvitePlayer: vi.fn(),
        openContinueOnAnotherDevice: vi.fn(),
        open: false,
    }),
}));

const addTombstoneMock = vi.fn();
vi.mock("../../logic/CardPackTombstones", () => ({
    addTombstone: (entry: unknown) => addTombstoneMock(entry),
    loadTombstones: () => [],
    clearTombstones: vi.fn(),
    clearAllTombstones: vi.fn(),
}));

import {
    customCardPacksQueryKey,
    myCardPacksQueryKey,
} from "../../data/customCardPacks";
import { CardSet } from "../../logic/CardSet";
import { Card, CardCategory } from "../../logic/GameObjects";
import { CardEntry, Category } from "../../logic/GameSetup";
import type { CustomCardSet } from "../../logic/CustomCardSets";
import type { PersistedCardPack } from "../../server/actions/packs";
import { useCardPackActions } from "./cardPackActions";

const makeCardSet = (cardName: string): CardSet =>
    CardSet({
        categories: [
            Category({
                id: CardCategory(`cat-${cardName}`),
                name: "Stuff",
                cards: [
                    CardEntry({ id: Card(`card-${cardName}`), name: cardName }),
                ],
            }),
        ],
    });

const localPackOf = (
    id: string,
    label: string,
    overrides: Partial<CustomCardSet> = {},
): CustomCardSet => ({
    id,
    label,
    cardSet: makeCardSet(label),
    ...overrides,
});

const serverPackOf = (
    id: string,
    clientGeneratedId: string,
    label: string,
): PersistedCardPack => ({
    id,
    clientGeneratedId,
    label,
    cardSetData: JSON.stringify(makeCardSet(label)),
});

let actionsRef: ReturnType<typeof useCardPackActions> | undefined;

const Capture = () => {
    actionsRef = useCardPackActions();
    return null;
};

const renderWithSeed = (
    locals: ReadonlyArray<CustomCardSet>,
    serverPacks: ReadonlyArray<PersistedCardPack>,
) => {
    const client = new QueryClient({
        defaultOptions: {
            queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
            mutations: { retry: false },
        },
    });
    client.setQueryData(customCardPacksQueryKey, locals);
    client.setQueryData(myCardPacksQueryKey(signedInUserId), serverPacks);
    return render(
        <QueryClientProvider client={client}>
            <Capture />
        </QueryClientProvider>,
    );
};

const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
    saveLocalMutate.mockReset();
    saveLocalMutateAsync.mockReset();
    deleteLocalMutate.mockReset();
    saveServerMutate.mockReset();
    deleteServerMutate.mockReset();
    addTombstoneMock.mockReset();
    openShareCardPackMock.mockReset();
    confirmAnswer = true;
    promptAnswer = "New Label";
    signedInUserId = undefined;
    actionsRef = undefined;
});

afterEach(() => {
    actionsRef = undefined;
});

describe("useCardPackActions.savePack", () => {
    test("signed out → only saveLocal fires", async () => {
        signedInUserId = undefined;
        const localPack = localPackOf("custom-1", "Office");
        saveLocalMutateAsync.mockResolvedValue(localPack);
        renderWithSeed([], []);
        await actionsRef!.savePack({
            label: "Office",
            cardSet: makeCardSet("Office"),
        });
        expect(saveLocalMutateAsync).toHaveBeenCalledTimes(1);
        expect(saveServerMutate).not.toHaveBeenCalled();
    });

    test("signed in → saveLocal AND saveServer fire", async () => {
        signedInUserId = "alice";
        const localPack = localPackOf("custom-1", "Office");
        saveLocalMutateAsync.mockResolvedValue(localPack);
        renderWithSeed([], []);
        const result = await actionsRef!.savePack({
            label: "Office",
            cardSet: makeCardSet("Office"),
        });
        expect(saveLocalMutateAsync).toHaveBeenCalledTimes(1);
        expect(saveServerMutate).toHaveBeenCalledTimes(1);
        // saveServer receives the LOCAL pack's id as clientGeneratedId.
        expect(saveServerMutate.mock.calls[0]?.[0]).toMatchObject({
            clientGeneratedId: "custom-1",
            label: "Office",
        });
        expect(result.id).toBe("custom-1");
    });
});

describe("useCardPackActions.renamePack", () => {
    const target = {
        clientGeneratedId: "custom-1",
        label: "Office",
        cardSet: makeCardSet("Office"),
    };

    test("user cancels prompt → no mutations", async () => {
        promptAnswer = null;
        renderWithSeed(
            [localPackOf("custom-1", "Office")],
            [],
        );
        const result = await actionsRef!.renamePack(target);
        expect(result).toBe(false);
        expect(saveLocalMutate).not.toHaveBeenCalled();
        expect(saveServerMutate).not.toHaveBeenCalled();
    });

    test("user submits same label → no mutations", async () => {
        promptAnswer = "Office";
        renderWithSeed(
            [localPackOf("custom-1", "Office")],
            [],
        );
        const result = await actionsRef!.renamePack(target);
        expect(result).toBe(false);
        expect(saveLocalMutate).not.toHaveBeenCalled();
    });

    test("local match + signed out → only saveLocal fires", async () => {
        signedInUserId = undefined;
        promptAnswer = "Office Edition";
        renderWithSeed(
            [localPackOf("custom-1", "Office")],
            [],
        );
        await actionsRef!.renamePack(target);
        expect(saveLocalMutate).toHaveBeenCalledTimes(1);
        expect(saveLocalMutate.mock.calls[0]?.[0]).toMatchObject({
            label: "Office Edition",
            existingId: "custom-1",
        });
        expect(saveServerMutate).not.toHaveBeenCalled();
    });

    test("local match + signed in → saveLocal AND saveServer fire", async () => {
        signedInUserId = "alice";
        promptAnswer = "Office Edition";
        renderWithSeed(
            [localPackOf("custom-1", "Office")],
            [],
        );
        await actionsRef!.renamePack(target);
        expect(saveLocalMutate).toHaveBeenCalledTimes(1);
        expect(saveServerMutate).toHaveBeenCalledTimes(1);
        expect(saveServerMutate.mock.calls[0]?.[0]).toMatchObject({
            clientGeneratedId: "custom-1",
            label: "Office Edition",
        });
    });

    test("server-only (no local match) + signed in → only saveServer fires", async () => {
        signedInUserId = "alice";
        promptAnswer = "Office Edition";
        renderWithSeed(
            [],
            [serverPackOf("srv-1", "custom-1", "Office")],
        );
        await actionsRef!.renamePack(target);
        expect(saveLocalMutate).not.toHaveBeenCalled();
        expect(saveServerMutate).toHaveBeenCalledTimes(1);
    });

    test("post-reconcile findLocal walks via server cache to find local pack", async () => {
        // Local pack's `id` was swapped to the server's id by
        // `markPackSynced`, so direct cgid match against local fails.
        // The orchestrator should fall back to the server cache lookup
        // and use that to find the local entry by server id.
        signedInUserId = "alice";
        promptAnswer = "Office Edition";
        renderWithSeed(
            [localPackOf("srv-1", "Office")], // post-swap: local id = server id
            [serverPackOf("srv-1", "custom-1", "Office")],
        );
        await actionsRef!.renamePack(target);
        // saveLocal called with existingId = the local pack's id (post-swap).
        expect(saveLocalMutate).toHaveBeenCalledTimes(1);
        expect(saveLocalMutate.mock.calls[0]?.[0]).toMatchObject({
            existingId: "srv-1",
        });
        // saveServer called with the cgid (the wire-format-stable id).
        expect(saveServerMutate.mock.calls[0]?.[0]).toMatchObject({
            clientGeneratedId: "custom-1",
        });
    });
});

describe("useCardPackActions.deletePack", () => {
    const target = {
        clientGeneratedId: "custom-1",
        label: "Office",
        cardSet: makeCardSet("Office"),
    };

    test("user cancels confirm → no mutations", async () => {
        confirmAnswer = false;
        renderWithSeed(
            [localPackOf("custom-1", "Office")],
            [],
        );
        const result = await actionsRef!.deletePack(target);
        expect(result).toBe(false);
        expect(deleteLocalMutate).not.toHaveBeenCalled();
        expect(deleteServerMutate).not.toHaveBeenCalled();
        expect(addTombstoneMock).not.toHaveBeenCalled();
    });

    test("local match + signed out → only deleteLocal fires; no tombstone", async () => {
        signedInUserId = undefined;
        renderWithSeed(
            [localPackOf("custom-1", "Office")],
            [],
        );
        await actionsRef!.deletePack(target);
        expect(deleteLocalMutate).toHaveBeenCalledWith("custom-1");
        expect(deleteServerMutate).not.toHaveBeenCalled();
        expect(addTombstoneMock).not.toHaveBeenCalled();
    });

    test("synced pack + signed in → tombstone + deleteLocal + deleteServer (with server id)", async () => {
        signedInUserId = "alice";
        renderWithSeed(
            [
                localPackOf("srv-1", "Office", {
                    lastSyncedSnapshot: {
                        label: "Office",
                        cardSet: makeCardSet("Office"),
                    },
                }),
            ],
            [serverPackOf("srv-1", "custom-1", "Office")],
        );
        await actionsRef!.deletePack(target);
        expect(addTombstoneMock).toHaveBeenCalledTimes(1);
        expect(addTombstoneMock.mock.calls[0]?.[0]).toMatchObject({
            id: "srv-1",
            label: "Office",
        });
        expect(deleteLocalMutate).toHaveBeenCalledWith("srv-1");
        // Server delete keys by the server's id (not the cgid).
        expect(deleteServerMutate).toHaveBeenCalledWith("srv-1");
    });

    test("local-only-no-server-presence + signed in + no serverMatch → no tombstone, no server call", async () => {
        signedInUserId = "alice";
        renderWithSeed(
            [localPackOf("custom-1", "Office")], // no lastSyncedSnapshot
            [], // server doesn't have it
        );
        await actionsRef!.deletePack(target);
        expect(addTombstoneMock).not.toHaveBeenCalled();
        expect(deleteLocalMutate).toHaveBeenCalledWith("custom-1");
        expect(deleteServerMutate).not.toHaveBeenCalled();
    });

    test("server-only + signed in → no local delete; deleteServer fires with serverMatch.id", async () => {
        signedInUserId = "alice";
        renderWithSeed(
            [],
            [serverPackOf("srv-1", "custom-1", "Office")],
        );
        await actionsRef!.deletePack(target);
        // No local entry to remove, so no localDelete.
        expect(deleteLocalMutate).not.toHaveBeenCalled();
        expect(deleteServerMutate).toHaveBeenCalledWith("srv-1");
        // Tombstone fires (signed in + server presence) — covers
        // the race where a refetch could resurrect the deleted pack.
        expect(addTombstoneMock).toHaveBeenCalledTimes(1);
    });
});

describe("useCardPackActions.sharePack", () => {
    test("calls openShareCardPack with the pack's cardSet and label", async () => {
        renderWithSeed([], []);
        actionsRef!.sharePack({
            clientGeneratedId: "custom-1",
            label: "Office",
            cardSet: makeCardSet("Office"),
        });
        await flush();
        expect(openShareCardPackMock).toHaveBeenCalledTimes(1);
        const opts = openShareCardPackMock.mock.calls[0]?.[0] as {
            packLabel: string;
            forcedCardPack: { categories: ReadonlyArray<unknown> };
        };
        expect(opts.packLabel).toBe("Office");
        expect(opts.forcedCardPack.categories).toHaveLength(1);
    });
});
