/**
 * Top-level React Query provider for the Clue solver app.
 *
 * This is the single QueryClient for the whole app — caches every
 * query and mutation through React Query, and persists the cache to
 * `localStorage` so a reloading user sees the same data without
 * waiting on a refetch.
 *
 * ─── Why split SSR vs CSR? ──────────────────────────────────────────
 * On the server (Next.js SSR / RSC pre-render) `window` is undefined,
 * so we can't construct an `AsyncStoragePersister` over
 * `window.localStorage`. We render a vanilla `QueryClientProvider`
 * during SSR so context is available; the client re-mounts under
 * `PersistQueryClientProvider`, which restores the cached state from
 * localStorage. Both providers expose the same context, so consumers
 * (`useQuery` / `useMutation`) work uniformly across the boundary.
 *
 * Hydration is safe: neither provider component renders DOM of its
 * own, so the server and client trees match. The persister rehydrates
 * cache entries asynchronously after mount, before any consumer runs
 * a network query against the same key.
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
    QueryClient,
    QueryClientProvider as TanstackQueryClientProvider,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Duration } from "effect";
import { useState, type ReactNode } from "react";

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
 * On SSR / pre-render: a vanilla `QueryClientProvider` so context is
 * available but no localStorage hydration is attempted.
 *
 * On the client: `PersistQueryClientProvider` rehydrates from
 * localStorage and persists changes back. Devtools mount only in
 * development.
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

    if (typeof window === "undefined") {
        return (
            <TanstackQueryClientProvider client={queryClient}>
                {children}
            </TanstackQueryClientProvider>
        );
    }

    const persister = createAsyncStoragePersister({
        storage: window.localStorage,
        key: PERSISTER_KEY,
    });

    return (
        <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{
                persister,
                // Match the QueryClient's gcTime so the persister
                // doesn't drop entries the in-memory cache still
                // wants. Both default to 24h; Duration keeps the unit
                // visible at the call site.
                maxAge: Duration.toMillis(DEFAULT_GC_TIME),
            }}
        >
            {children}
            {process.env.NODE_ENV === "development" ? (
                <ReactQueryDevtools initialIsOpen={false} />
            ) : null}
        </PersistQueryClientProvider>
    );
}
