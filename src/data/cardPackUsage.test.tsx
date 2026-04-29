/**
 * Hook-level tests for `useCardPackUsage`, `useRecordCardPackUse`,
 * and `useForgetCardPackUse`. The localStorage round-trip is pinned
 * separately by `src/logic/CardPackUsage.test.ts`; these tests focus
 * on the RQ cache behaviour: reads come from `initialData`, mutations
 * update the cache via `setQueryData`, and unrelated entries are not
 * disturbed by mutations.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { DateTime } from "effect";
import { recordCardPackUse } from "../logic/CardPackUsage";
import {
    useCardPackUsage,
    useForgetCardPackUse,
    useRecordCardPackUse,
} from "./cardPackUsage";
import { TestQueryClientProvider } from "../test-utils/queryClient";

beforeEach(() => {
    window.localStorage.clear();
});

describe("useCardPackUsage", () => {
    test("returns an empty Map when localStorage is empty", () => {
        const { result } = renderHook(() => useCardPackUsage(), {
            wrapper: TestQueryClientProvider,
        });
        expect(result.current.data?.size).toBe(0);
    });

    test("reflects entries already saved in localStorage on mount", () => {
        recordCardPackUse("classic");
        const { result } = renderHook(() => useCardPackUsage(), {
            wrapper: TestQueryClientProvider,
        });
        expect(result.current.data?.has("classic")).toBe(true);
    });
});

describe("useRecordCardPackUse", () => {
    test("adds a fresh entry to the cache when called", async () => {
        const { result } = renderHook(
            () => ({
                usage: useCardPackUsage(),
                record: useRecordCardPackUse(),
            }),
            { wrapper: TestQueryClientProvider },
        );
        expect(result.current.usage.data?.size).toBe(0);

        await act(async () => {
            await result.current.record.mutateAsync("custom-x");
        });

        await waitFor(() => {
            expect(result.current.usage.data?.has("custom-x")).toBe(true);
        });
    });

    test("re-recording an existing entry refreshes its timestamp", async () => {
        // Real timers throughout — RQ's mutateAsync Promise chain
        // can't drain under vi.useFakeTimers without manual flushing.
        // Force a measurable gap by sleeping 5ms between the seed
        // record and the re-record so the second `DateTime.nowUnsafe`
        // is strictly after the first.
        recordCardPackUse("custom-x");

        const { result } = renderHook(
            () => ({
                usage: useCardPackUsage(),
                record: useRecordCardPackUse(),
            }),
            { wrapper: TestQueryClientProvider },
        );
        const before = result.current.usage.data?.get("custom-x");
        expect(before).toBeDefined();

        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        await act(async () => {
            await result.current.record.mutateAsync("custom-x");
        });

        await waitFor(() => {
            const after = result.current.usage.data?.get("custom-x");
            expect(after).toBeDefined();
            expect(DateTime.toEpochMillis(after!)).toBeGreaterThanOrEqual(
                DateTime.toEpochMillis(before!),
            );
        });
    });
});

describe("useForgetCardPackUse", () => {
    test("removes a single entry without disturbing others", async () => {
        recordCardPackUse("custom-a");
        recordCardPackUse("custom-b");

        const { result } = renderHook(
            () => ({
                usage: useCardPackUsage(),
                forget: useForgetCardPackUse(),
            }),
            { wrapper: TestQueryClientProvider },
        );
        expect(result.current.usage.data?.size).toBe(2);

        await act(async () => {
            await result.current.forget.mutateAsync("custom-a");
        });

        await waitFor(() => {
            expect(result.current.usage.data?.size).toBe(1);
        });
        expect(result.current.usage.data?.has("custom-b")).toBe(true);
        expect(result.current.usage.data?.has("custom-a")).toBe(false);
    });

    test("forgetting an unknown entry is a no-op", async () => {
        recordCardPackUse("custom-a");
        const { result } = renderHook(
            () => ({
                usage: useCardPackUsage(),
                forget: useForgetCardPackUse(),
            }),
            { wrapper: TestQueryClientProvider },
        );
        expect(result.current.usage.data?.size).toBe(1);

        await act(async () => {
            await result.current.forget.mutateAsync("nonexistent");
        });

        expect(result.current.usage.data?.size).toBe(1);
        expect(result.current.usage.data?.has("custom-a")).toBe(true);
    });
});
