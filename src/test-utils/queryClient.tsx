/**
 * Test-only React Query wrapper.
 *
 * Production code mounts `QueryClientProvider` from `src/data/` at
 * the root layout, but unit tests render components directly. Use
 * this helper as a wrapper around `render()` so any RQ-using
 * component sees a working `QueryClient`.
 *
 * The test client disables retries, sets every staleTime / gcTime to
 * Infinity, and skips the persister entirely — tests should never
 * read or write `effect-clue.rq-cache.v1`. Each render gets a fresh
 * client so cache contents from one test never leak into another
 * (mirrors the `localStorage.clear()` discipline already in use).
 */
"use client";

import {
    QueryClient,
    QueryClientProvider,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

const makeTestQueryClient = (): QueryClient =>
    new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: Number.POSITIVE_INFINITY,
                staleTime: Number.POSITIVE_INFINITY,
                refetchOnWindowFocus: false,
            },
            mutations: {
                retry: false,
            },
        },
    });

export function TestQueryClientProvider({
    children,
}: {
    readonly children: ReactNode;
}): React.ReactElement {
    const [client] = useState(makeTestQueryClient);
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
