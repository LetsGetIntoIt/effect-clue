/**
 * React Query hooks for the user's saved custom card packs.
 *
 * The hooks split along the local-vs-server axis:
 *
 *   - `useCustomCardPacks` reads from localStorage.
 *   - `useSaveCardPack` / `useDeleteCardPack` write to localStorage.
 *     `useSaveCardPack` additionally stamps `unsyncedSince` when the
 *     user is signed in so the logout flush / next reconcile knows to
 *     push.
 *   - `useSaveCardPackOnServer` / `useDeleteCardPackOnServer` operate
 *     on the server-stored library. On success they reach back into
 *     localStorage to call `markPackSynced` / clear tombstones, and
 *     they update the React Query caches so the modal refreshes.
 *
 * The `useCardPackActions` orchestrator in
 * [`src/ui/components/cardPackActions.ts`](../ui/components/cardPackActions.ts)
 * is the canonical entry point for share / rename / delete / save
 * flows — it decides which hooks to fire based on cache state.
 *
 * SSR note: `loadCustomCardSets()` reads `window.localStorage`, so
 * we gate it with `typeof window === "undefined"` and return `[]` on
 * the server. We use RQ's `initialData` to seed the cache
 * synchronously on first render with `staleTime: Infinity` to make
 * sure the queryFn never refetches over our cache. `setQueryData`
 * inside the mutations keeps the cache aligned with localStorage,
 * matching the previous useState + useEffect pattern from
 * `CardPackRow` (data available on first render; updates after every
 * mutation; no async refetch loop). Once the persister rehydrates,
 * its cached entry takes precedence over `initialData`.
 */
"use client";

import {
    useMutation,
    useQuery,
    useQueryClient,
    type UseMutationResult,
    type UseQueryResult,
} from "@tanstack/react-query";
import { Effect } from "effect";
import type { CardSet } from "../logic/CardSet";
import { clearTombstones } from "../logic/CardPackTombstones";
import { remapCardPackUsageIds } from "../logic/CardPackUsage";
import {
    deleteCustomCardSet,
    loadCustomCardSets,
    markPackSynced,
    markPackUnsynced,
    saveCustomCardSet,
    type CustomCardSet,
} from "../logic/CustomCardSets";
import { TelemetryRuntime } from "../observability/runtime";
import {
    deleteCardPack as deleteCardPackServer,
    saveCardPack as saveCardPackServer,
    type PersistedCardPack,
} from "../server/actions/packs";
import { useSession } from "../ui/hooks/useSession";
import { trackInFlight } from "./cardPacksInFlight";
import { decodeServerPack } from "./serverPackCodec";

export const customCardPacksQueryKey = ["custom-card-packs"] as const;
export const myCardPacksQueryKey = (userId: string | undefined) =>
    ["my-card-packs", userId] as const;

/** SSR-safe gate: localStorage queries only run on the client. */
const isClient = (): boolean => typeof window !== "undefined";

const loadEffect = Effect.fn("rq.customPacks.load")(function* () {
    return loadCustomCardSets();
});

const readPacks = (): ReadonlyArray<CustomCardSet> =>
    isClient() ? TelemetryRuntime.runSync(loadEffect()) : [];

/**
 * Returns the signed-in non-anonymous user id, or `undefined` for
 * anonymous / signed-out sessions. Anonymous sessions are real DB
 * rows but treated as "not yet attached to an account" — server
 * mirroring is gated on this returning a real id.
 */
export const useSignedInUserId = (): string | undefined => {
    const session = useSession();
    const user = session.data?.user;
    if (!user || user.isAnonymous) return undefined;
    return user.id;
};

/**
 * Read-side hook: returns every saved custom card pack as a stable,
 * cache-backed array. `data` is the localStorage snapshot from
 * mount time on the client, and `[]` on the server.
 */
export function useCustomCardPacks(): UseQueryResult<
    ReadonlyArray<CustomCardSet>,
    Error
> {
    return useQuery({
        queryKey: customCardPacksQueryKey,
        queryFn: readPacks,
        // `initialData` makes the value synchronously available on
        // first render — no `data === undefined` flicker before the
        // queryFn fires. localStorage is the source of truth; with
        // `staleTime: Infinity` the queryFn never re-runs, and
        // mutations propagate via `setQueryData`.
        initialData: readPacks,
        staleTime: Number.POSITIVE_INFINITY,
    });
}

interface SaveCardPackInput {
    readonly label: string;
    readonly cardSet: CardSet;
    /**
     * When provided and the id matches an existing pack, the
     * mutation updates that pack in place (id preserved). When
     * absent, a new pack is created.
     */
    readonly existingId?: string;
}

const saveLocalEffect = Effect.fn("rq.customPacks.save")(function* (
    label: string,
    cardSet: CardSet,
    existingId: string | undefined,
    stampUnsynced: boolean,
) {
    const saved = saveCustomCardSet(label, cardSet, existingId);
    if (stampUnsynced) {
        markPackUnsynced(saved.id);
        // Re-read so the returned value carries the freshly-stamped
        // metadata (caller may pass it through to the React Query
        // cache or the orchestrator).
        const refreshed = loadCustomCardSets().find(
            p => p.id === saved.id,
        );
        return refreshed ?? saved;
    }
    return saved;
});

const deleteLocalEffect = Effect.fn("rq.customPacks.delete")(function* (
    id: string,
) {
    deleteCustomCardSet(id);
});

/**
 * Local-side write hook: snapshot the current `CardSet` as a custom
 * card pack in localStorage. Defaults to inserting a new pack;
 * pass `existingId` to update an existing pack in place. When the
 * user is signed in, also stamps `unsyncedSince` so the next
 * reconcile / logout flush knows to push.
 *
 * Server-side mirroring is the orchestrator's job — see
 * `useCardPackActions.savePack` / `renamePack` for the call sites
 * that fire `useSaveCardPackOnServer` after this resolves.
 */
export function useSaveCardPack(): UseMutationResult<
    CustomCardSet,
    Error,
    SaveCardPackInput
> {
    const queryClient = useQueryClient();
    const userId = useSignedInUserId();
    return useMutation({
        mutationFn: ({ label, cardSet, existingId }: SaveCardPackInput) =>
            TelemetryRuntime.runPromise(
                saveLocalEffect(
                    label,
                    cardSet,
                    existingId,
                    userId !== undefined,
                ),
            ),
        onSuccess: (savedPack) => {
            queryClient.setQueryData<ReadonlyArray<CustomCardSet>>(
                customCardPacksQueryKey,
                (old) => {
                    if (!old) return [savedPack];
                    const idx = old.findIndex(p => p.id === savedPack.id);
                    if (idx === -1) return [...old, savedPack];
                    const next = [...old];
                    next[idx] = savedPack;
                    return next;
                },
            );
        },
    });
}

/**
 * Local-side delete hook: removes a saved custom card pack by id.
 * Built-in pack ids that don't match any saved pack are silently
 * ignored — `deleteCustomCardSet` itself is a no-op on misses.
 *
 * Tombstone bookkeeping + server-side mirror live in
 * `useCardPackActions.deletePack`.
 */
export function useDeleteCardPack(): UseMutationResult<void, Error, string> {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) =>
            TelemetryRuntime.runPromise(deleteLocalEffect(id)),
        onSuccess: (_void, id) => {
            queryClient.setQueryData<ReadonlyArray<CustomCardSet>>(
                customCardPacksQueryKey,
                (old) => old?.filter((p) => p.id !== id) ?? [],
            );
        },
    });
}

interface SaveCardPackOnServerInput {
    readonly clientGeneratedId: string;
    readonly label: string;
    readonly cardSet: CardSet;
}

const saveOnServerEffect = Effect.fn("rq.customPacks.saveOnServer")(function* (
    input: SaveCardPackOnServerInput,
) {
    const promise = saveCardPackServer(input);
    trackInFlight(promise);
    return yield* Effect.promise(() => promise);
});

const deleteOnServerEffect = Effect.fn("rq.customPacks.deleteOnServer")(
    function* (idOrClientGeneratedId: string) {
        const promise = deleteCardPackServer({ idOrClientGeneratedId });
        trackInFlight(promise);
        yield* Effect.promise(() => promise);
    },
);

/**
 * Apply a successful server save back into local state. Finds the
 * local pack by either its current `id` (post-reconcile, equals
 * server id) or its original `clientGeneratedId` (pre-swap), calls
 * `markPackSynced` to swap the id (when needed), refreshes
 * `lastSyncedSnapshot`, and clears `unsyncedSince`. Remaps any
 * usage entries from the old id to the new one. Clears any
 * tombstones that match either id (covers the rare fast
 * delete-then-save resurrection).
 */
const applyServerSave = (serverRow: PersistedCardPack): void => {
    const decoded = decodeServerPack(serverRow);
    if (decoded === null) return;
    const local = loadCustomCardSets().find(
        p =>
            p.id === serverRow.id ||
            p.id === serverRow.clientGeneratedId,
    );
    if (local === undefined) return;
    const synced = markPackSynced(local.id, {
        id: serverRow.id,
        label: serverRow.label,
        cardSet: decoded.cardSet,
    });
    if (synced !== undefined && synced.id !== local.id) {
        remapCardPackUsageIds(new Map([[local.id, synced.id]]));
    }
    clearTombstones([local.id, serverRow.id, serverRow.clientGeneratedId]);
};

/**
 * Server-side write hook for the user's card-pack library. UPSERTs
 * the row keyed by `(owner_id, client_generated_id)` and updates
 * the `myCardPacksQueryKey` cache so the AccountModal's pack list
 * refreshes immediately.
 *
 * On success it also reaches back into localStorage to apply
 * `markPackSynced` (which swaps the local id for the server's
 * canonical id when they differ) and updates
 * `customCardPacksQueryKey` so the rest of the UI sees the new id.
 * That coupling lives here so every server-write call site —
 * orchestrator-driven or not — gets the same id-swap + snapshot
 * bookkeeping.
 */
export function useSaveCardPackOnServer(): UseMutationResult<
    PersistedCardPack,
    Error,
    SaveCardPackOnServerInput
> {
    const queryClient = useQueryClient();
    const userId = useSignedInUserId();
    return useMutation({
        mutationFn: (input: SaveCardPackOnServerInput) =>
            TelemetryRuntime.runPromise(saveOnServerEffect(input)),
        onSuccess: (savedPack) => {
            queryClient.setQueryData<ReadonlyArray<PersistedCardPack>>(
                myCardPacksQueryKey(userId),
                (old) => {
                    if (!old) return [savedPack];
                    const idx = old.findIndex(
                        (p) =>
                            p.id === savedPack.id ||
                            p.clientGeneratedId === savedPack.clientGeneratedId,
                    );
                    if (idx === -1) return [savedPack, ...old];
                    const next = [...old];
                    next[idx] = savedPack;
                    return next;
                },
            );
            applyServerSave(savedPack);
            queryClient.setQueryData<ReadonlyArray<CustomCardSet>>(
                customCardPacksQueryKey,
                loadCustomCardSets(),
            );
        },
    });
}

/**
 * Server-side delete hook, owner-scoped, keyed by either the server-
 * minted `id` or the `client_generated_id`. On success clears the
 * matching tombstone (so the next pull doesn't filter the pack
 * back out by mistake).
 */
export function useDeleteCardPackOnServer(): UseMutationResult<
    void,
    Error,
    string
> {
    const queryClient = useQueryClient();
    const userId = useSignedInUserId();
    return useMutation({
        mutationFn: (idOrClientGeneratedId: string) =>
            TelemetryRuntime.runPromise(
                deleteOnServerEffect(idOrClientGeneratedId),
            ),
        onSuccess: (_void, arg) => {
            queryClient.setQueryData<ReadonlyArray<PersistedCardPack>>(
                myCardPacksQueryKey(userId),
                (old) =>
                    old?.filter(
                        (p) => p.id !== arg && p.clientGeneratedId !== arg,
                    ) ?? [],
            );
            clearTombstones([arg]);
        },
    });
}
