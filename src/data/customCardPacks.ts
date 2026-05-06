/**
 * React Query hooks for the user's saved custom card packs.
 *
 * Wraps the localStorage-backed `loadCustomCardSets` /
 * `saveCustomCardSet` / `deleteCustomCardSet` functions so callers
 * use the same imperative API as React Query elsewhere in the app
 * (`useQuery`, `useMutation`). The actual encoding / decoding logic
 * stays in [`src/logic/CustomCardSets.ts`](../logic/CustomCardSets.ts);
 * these hooks add caching, automatic UI updates after mutations, and
 * the Honeycomb spans defined in the plan's analytics inventory
 * (`rq.customPacks.load`, `rq.customPacks.save`, `rq.customPacks.delete`).
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
import {
    deleteCustomCardSet,
    loadCustomCardSets,
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
import { myCardPacksQueryKey } from "../ui/account/AccountModal";

export const customCardPacksQueryKey = ["custom-card-packs"] as const;

/** SSR-safe gate: localStorage queries only run on the client. */
const isClient = (): boolean => typeof window !== "undefined";

const loadEffect = Effect.fn("rq.customPacks.load")(function* () {
    return loadCustomCardSets();
});

const saveEffect = Effect.fn("rq.customPacks.save")(function* (
    label: string,
    cardSet: CardSet,
    existingId: string | undefined,
) {
    return saveCustomCardSet(label, cardSet, existingId);
});

const deleteEffect = Effect.fn("rq.customPacks.delete")(function* (id: string) {
    deleteCustomCardSet(id);
});

const readPacks = (): ReadonlyArray<CustomCardSet> =>
    isClient() ? TelemetryRuntime.runSync(loadEffect()) : [];

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

/**
 * Write-side hook: snapshot the current `CardSet` as a custom card
 * pack. Defaults to inserting a new pack; pass `existingId` to update
 * an existing pack in place. Returns the persisted pack so callers
 * can immediately reference it (e.g. record-as-recently-used).
 *
 * On success the query cache is updated optimistically — no refetch.
 */
export function useSaveCardPack(): UseMutationResult<
    CustomCardSet,
    Error,
    SaveCardPackInput
> {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ label, cardSet, existingId }: SaveCardPackInput) =>
            TelemetryRuntime.runPromise(saveEffect(label, cardSet, existingId)),
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
 * Delete a saved custom card pack by id. Built-in pack ids that
 * don't match any saved pack are silently ignored — `deleteCustomCardSet`
 * itself is a no-op on misses.
 */
export function useDeleteCardPack(): UseMutationResult<void, Error, string> {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) =>
            TelemetryRuntime.runPromise(deleteEffect(id)),
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
    return yield* Effect.promise(() => saveCardPackServer(input));
});

const deleteOnServerEffect = Effect.fn("rq.customPacks.deleteOnServer")(
    function* (idOrClientGeneratedId: string) {
        yield* Effect.promise(() =>
            deleteCardPackServer({ idOrClientGeneratedId }),
        );
    },
);

/**
 * Write-side hook for the user's *server-stored* card-pack library.
 * UPSERTs the pack on the server (keyed by `(owner_id, client_generated_id)`)
 * and refreshes the `myCardPacksQueryKey` cache so the AccountModal's
 * pack list updates immediately. Pairs with `useSaveCardPack` (local
 * storage) — call both when a synced pack is being mutated.
 */
export function useSaveCardPackOnServer(): UseMutationResult<
    PersistedCardPack,
    Error,
    SaveCardPackOnServerInput
> {
    const queryClient = useQueryClient();
    const session = useSession();
    const userId = session.data?.user.id;
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
        },
    });
}

/**
 * Owner-scoped delete on the server, keyed by either the server-minted
 * `id` or the `client_generated_id`. Pairs with `useDeleteCardPack`
 * (local storage).
 */
export function useDeleteCardPackOnServer(): UseMutationResult<
    void,
    Error,
    string
> {
    const queryClient = useQueryClient();
    const session = useSession();
    const userId = session.data?.user.id;
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
        },
    });
}
