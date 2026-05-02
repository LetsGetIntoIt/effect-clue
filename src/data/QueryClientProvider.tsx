/**
 * Top-level React Query provider for the Clue solver app.
 *
 * This is the single QueryClient for the whole app — caches every
 * query and mutation through React Query, and persists the cache to
 * `localStorage` so a reloading user sees the same data without
 * waiting on a refetch.
 *
 * ─── Why one provider component (no SSR/CSR branch)? ────────────────
 * Earlier versions of this file branched on `typeof window`:
 * `QueryClientProvider` on the server, `PersistQueryClientProvider`
 * on the client. That was a hydration trap — the two components have
 * different React types and different child shapes (the client added
 * a sibling `<ReactQueryDevtools>`), so every `useId()` further down
 * the tree resolved differently between server and client. Radix
 * Dialog / Popover use `useId()` extensively, so the mismatch
 * cascaded into every modal in the app.
 *
 * The fix: always render the same tree. We compose a single
 * `<TanstackQueryClientProvider>` and register the persister and
 * devtools as side effects after mount, gated behind a `mounted`
 * state. The first server-rendered HTML and the first client-side
 * paint are byte-for-byte identical.
 *
 * ─── Defaults ───────────────────────────────────────────────────────
 * - `networkMode: "offlineFirst"` — queries return cached data while
 *   offline rather than throwing, and mutations queue for retry. We
 *   are an offline-first app: localStorage is the source of truth
 *   today; future server queries (M6+) layer on top.
 * - `staleTime: 1 minute` — cached data is considered fresh for a
 *   minute before background refetches; localStorage-backed queries
 *   don't actually refetch (they re-read sync), so the staleTime is
 *   mostly relevant once we add server queries.
 * - `gcTime: 24 hours` — match the persister's default `maxAge` so
 *   cache survives reload.
 * - `retry: 1` — one retry on network failures (M6+ relevant).
 *
 * ─── Persister cache version ────────────────────────────────────────
 * `PERSISTER_KEY` carries a `v1` suffix. Bump it whenever the
 * QueryClient cache shape changes in a way that would mis-decode old
 * entries — see [src/data/README.md](./README.md) for the procedure.
 */
"use client";

import {
    defaultShouldDehydrateQuery,
    QueryClient,
    QueryClientProvider as TanstackQueryClientProvider,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { Duration } from "effect";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Top-level localStorage key for the React Query persister. Bump the
 * suffix (`v1` → `v2`) on shape-breaking changes to any cached
 * `useQuery` payload. See `src/data/README.md`.
 */
const PERSISTER_KEY = "effect-clue.rq-cache.v1";

const DEFAULT_STALE_TIME = Duration.minutes(1);
const DEFAULT_GC_TIME = Duration.hours(24);

const buildClient = (): QueryClient =>
    new QueryClient({
        defaultOptions: {
            queries: {
                // eslint-disable-next-line i18next/no-literal-string -- RQ enum string
                networkMode: "offlineFirst",
                staleTime: Duration.toMillis(DEFAULT_STALE_TIME),
                gcTime: Duration.toMillis(DEFAULT_GC_TIME),
                retry: 1,
                refetchOnWindowFocus: false,
            },
            mutations: {
                // eslint-disable-next-line i18next/no-literal-string -- RQ enum string
                networkMode: "offlineFirst",
                retry: 0,
            },
        },
    });

/**
 * Wrap the app in a React Query provider.
 *
 * Always renders `<TanstackQueryClientProvider>` so the SSR tree and
 * the first client-render tree match exactly. The localStorage
 * persister and the devtools are post-mount side effects guarded by
 * `mounted`, so they can't perturb hydration.
 */
export function QueryClientProvider({
    children,
}: {
    readonly children: ReactNode;
}): React.ReactElement {
    // Stable QueryClient — re-created across renders would lose the
    // cache and re-hit every query. `useState` initializer pattern is
    // the canonical RQ + Next 13+ recipe.
    const [queryClient] = useState(buildClient);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        // SSR path: useEffect doesn't run, so `mounted` stays false
        // and the persister is never wired — exactly what we want
        // when there's no localStorage to talk to.
        const persister = createAsyncStoragePersister({
            storage: window.localStorage,
            key: PERSISTER_KEY,
        });
        const [unsubscribe] = persistQueryClient({
            queryClient,
            persister,
            // Match the QueryClient's gcTime so the persister doesn't
            // drop entries the in-memory cache still wants. Both
            // default to 24h; Duration keeps the unit visible at the
            // call site.
            maxAge: Duration.toMillis(DEFAULT_GC_TIME),
            // Honour `meta: { persist: false }` on individual queries
            // — useful for cached values whose shape doesn't survive
            // a JSON round-trip (e.g. `Map` instances, see
            // `cardPackUsage.ts`). Queries that don't set the flag
            // dehydrate by RQ's default rule (only successful
            // queries).
            dehydrateOptions: {
                shouldDehydrateQuery: (query) =>
                    query.meta?.["persist"] !== false &&
                    defaultShouldDehydrateQuery(query),
            },
        });
        setMounted(true);
        return unsubscribe;
    }, [queryClient]);

    return (
        <TanstackQueryClientProvider client={queryClient}>
            {children}
            {mounted && process.env.NODE_ENV === "development" ? (
                <ReactQueryDevtools initialIsOpen={false} />
            ) : null}
        </TanstackQueryClientProvider>
    );
}
