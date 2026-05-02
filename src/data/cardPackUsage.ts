/**
 * React Query hooks for per-pack last-used recency.
 *
 * Wraps the localStorage-backed `loadCardPackUsage` /
 * `recordCardPackUse` / `forgetCardPackUse` functions from
 * [`src/logic/CardPackUsage.ts`](../logic/CardPackUsage.ts) so the
 * picker UI gets cache-backed reads and automatic re-renders after
 * mutations. Mirrors the structure of `customCardPacks.ts`.
 *
 * SSR note: same gate as `useCustomCardPacks` — `loadCardPackUsage()`
 * reads `window.localStorage`, so the query is client-only. The
 * placeholder is the empty `Map`, matching the previous
 * useState-initialised-to-`new Map()` pattern.
 */
"use client";

import {
    useMutation,
    useQuery,
    useQueryClient,
    type UseMutationResult,
    type UseQueryResult,
} from "@tanstack/react-query";
import { DateTime, Effect } from "effect";
import {
    forgetCardPackUse,
    loadCardPackUsage,
    recordCardPackUse,
    type CardPackUsage,
} from "../logic/CardPackUsage";
import { TelemetryRuntime } from "../observability/runtime";

const cardPackUsageQueryKey = ["card-pack-usage"] as const;

const isClient = (): boolean => typeof window !== "undefined";
const emptyUsage: CardPackUsage = new Map();

const loadEffect = Effect.fn("rq.cardPackUsage.load")(function* () {
    return loadCardPackUsage();
});

const recordEffect = Effect.fn("rq.cardPackUsage.record")(function* (
    packId: string,
) {
    recordCardPackUse(packId);
});

const forgetEffect = Effect.fn("rq.cardPackUsage.forget")(function* (
    packId: string,
) {
    forgetCardPackUse(packId);
});

const readUsage = (): CardPackUsage =>
    isClient() ? TelemetryRuntime.runSync(loadEffect()) : emptyUsage;

/**
 * Read the recency map. Empty on the server; on the client this
 * reads localStorage synchronously on first render via `initialData`
 * so consumers don't see an empty placeholder before the queryFn
 * fires.
 *
 * `meta: { persist: false }` opts this query out of the React Query
 * persister: the cached `data` is a `ReadonlyMap`, which JSON-stringifies
 * to `{}` and can't be reconstructed without a custom hydrator. Since
 * `initialData` already reads from `loadCardPackUsage()` synchronously
 * on every client render, the persister entry is redundant anyway —
 * skipping it sidesteps the Map-as-empty-object hydration crash that
 * would otherwise blow up `usage.entries()` in `CardPackRow` after a
 * reload.
 */
export function useCardPackUsage(): UseQueryResult<CardPackUsage, Error> {
    return useQuery({
        queryKey: cardPackUsageQueryKey,
        queryFn: readUsage,
        initialData: readUsage,
        staleTime: Number.POSITIVE_INFINITY,
        meta: { persist: false },
    });
}

/**
 * Stamp `packId` as just-used. The cache is updated optimistically
 * (in-place: a fresh Map with the new entry) so the surface re-renders
 * immediately — no waiting on the localStorage write.
 */
export function useRecordCardPackUse(): UseMutationResult<
    void,
    Error,
    string
> {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (packId: string) =>
            TelemetryRuntime.runPromise(recordEffect(packId)),
        onSuccess: (_void, packId) => {
            queryClient.setQueryData<CardPackUsage>(
                cardPackUsageQueryKey,
                (old) => {
                    const next = new Map(old ?? emptyUsage);
                    next.set(packId, DateTime.nowUnsafe());
                    return next;
                },
            );
        },
    });
}

/**
 * Drop the recency entry for `packId` (e.g. when its custom pack is
 * deleted so the store doesn't accrete orphan ids).
 */
export function useForgetCardPackUse(): UseMutationResult<
    void,
    Error,
    string
> {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (packId: string) =>
            TelemetryRuntime.runPromise(forgetEffect(packId)),
        onSuccess: (_void, packId) => {
            queryClient.setQueryData<CardPackUsage>(
                cardPackUsageQueryKey,
                (old) => {
                    if (!old || !old.has(packId)) return old ?? emptyUsage;
                    const next = new Map(old);
                    next.delete(packId);
                    return next;
                },
            );
        },
    });
}
