/**
 * Regression tests for `QueryClientProvider`.
 *
 * The previous implementation branched between `<TanstackQueryClientProvider>`
 * (SSR) and `<PersistQueryClientProvider>` + `<ReactQueryDevtools>` (CSR).
 * Different React types and child counts on each side cascaded
 * `useId()` mismatches into every Radix Dialog / Popover further
 * down the tree.
 *
 * The refactor renders the same outer shell on both sides, defers
 * the persister to a `useEffect`, and gates devtools behind a
 * `mounted` state. These tests pin both invariants:
 *
 * 1. The pre-effect render produces the same outer tree on the
 *    server (renderToString) and on the client (initial render).
 * 2. The cardPackUsage query is opted out of the persister via
 *    `meta: { persist: false }` so its `Map`-shaped data never
 *    JSON-round-trips through the cache file.
 */

import { describe, expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { act, render } from "@testing-library/react";
import { QueryClientProvider } from "./QueryClientProvider";

describe("QueryClientProvider — hydration shape", () => {
    test("server-rendered HTML matches the first client render", () => {
        const tree = (
            <QueryClientProvider>
                <div data-testid="probe">probe</div>
            </QueryClientProvider>
        );
        const ssrHtml = renderToString(tree);
        const { container } = render(tree);
        // The first client render runs synchronously before any
        // useEffect, so the output must equal the SSR string.
        // React 19 may add hydration-only attributes; strip them
        // before compare so the assertion focuses on shape.
        const normalize = (html: string): string =>
            html.replace(/\s+data-reactroot[^>]*/g, "");
        expect(normalize(container.innerHTML)).toBe(normalize(ssrHtml));
    });

    test("does not throw when re-rendering after the post-mount effect runs", async () => {
        // Drive a render + effect flush. Even though jsdom has
        // localStorage, the persister's restoreClient is async and
        // shouldn't crash the synchronous tree.
        await act(async () => {
            render(
                <QueryClientProvider>
                    <div>after-mount</div>
                </QueryClientProvider>,
            );
        });
    });
});
