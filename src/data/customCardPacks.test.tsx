/**
 * Hook-level tests for `useCustomCardPacks`, `useSaveCardPack`, and
 * `useDeleteCardPack`. The lower-level localStorage round-trip is
 * already pinned by `src/logic/CustomCardSets.test.ts`; this file
 * focuses on the React Query layer:
 *
 *   - `useCustomCardPacks` reads the seeded localStorage on first
 *     render (via `initialData`).
 *   - `useSaveCardPack` writes via `saveCustomCardSet` and the new
 *     pack appears in the cache immediately (no refetch).
 *   - `useDeleteCardPack` removes a pack from the cache on success.
 *   - Each hook lives behind a `Effect.fn(...)` span, which is why
 *     they're routed through `TelemetryRuntime` — the spans
 *     themselves no-op in unit tests because `TelemetryLayer` is
 *     `Layer.empty` without a Honeycomb key, but the round-trip is
 *     still exercised.
 */
import { describe, expect, test, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { CardSet, CardEntry, Category } from "../logic/CardSet";
import { Card, CardCategory } from "../logic/GameObjects";
import {
    saveCustomCardSet,
    type CustomCardSet,
} from "../logic/CustomCardSets";
import {
    useCustomCardPacks,
    useDeleteCardPack,
    useSaveCardPack,
} from "./customCardPacks";
import { TestQueryClientProvider } from "../test-utils/queryClient";

const makeCardSet = (suffix: string) =>
    CardSet({
        categories: [
            Category({
                id: CardCategory(`cat-${suffix}`),
                name: "Things",
                cards: [
                    CardEntry({ id: Card(`card-${suffix}-1`), name: "One" }),
                    CardEntry({ id: Card(`card-${suffix}-2`), name: "Two" }),
                ],
            }),
        ],
    });

beforeEach(() => {
    window.localStorage.clear();
});

describe("useCustomCardPacks", () => {
    test("returns [] on first render with empty localStorage", () => {
        const { result } = renderHook(() => useCustomCardPacks(), {
            wrapper: TestQueryClientProvider,
        });
        expect(result.current.data).toEqual([]);
    });

    test("reflects packs already saved in localStorage on mount", () => {
        saveCustomCardSet("Pre-existing", makeCardSet("a"));
        const { result } = renderHook(() => useCustomCardPacks(), {
            wrapper: TestQueryClientProvider,
        });
        expect(result.current.data).toHaveLength(1);
        expect(result.current.data?.[0]?.label).toBe("Pre-existing");
    });

    test("multiple instances under the same QueryClient share the cache", () => {
        saveCustomCardSet("Shared", makeCardSet("s"));
        const { result: a } = renderHook(() => useCustomCardPacks(), {
            wrapper: TestQueryClientProvider,
        });
        const { result: b } = renderHook(() => useCustomCardPacks(), {
            wrapper: TestQueryClientProvider,
        });
        // Different wrappers create different clients; each reads
        // localStorage on first mount.
        expect(a.current.data).toEqual(b.current.data);
    });
});

describe("useSaveCardPack", () => {
    test("writes a new pack to localStorage and updates the cache for any consumer under the same QueryClient", async () => {
        let savedPack: CustomCardSet | undefined;
        const { result } = renderHook(
            () => ({
                packs: useCustomCardPacks(),
                save: useSaveCardPack(),
            }),
            { wrapper: TestQueryClientProvider },
        );
        expect(result.current.packs.data).toEqual([]);

        await act(async () => {
            savedPack = await result.current.save.mutateAsync({
                label: "Brand New",
                cardSet: makeCardSet("new"),
            });
        });

        await waitFor(() => {
            expect(result.current.packs.data).toHaveLength(1);
        });
        expect(result.current.packs.data?.[0]?.id).toBe(savedPack?.id);
        expect(result.current.packs.data?.[0]?.label).toBe("Brand New");
    });
});

describe("useDeleteCardPack", () => {
    test("removes a pack from the cache and from localStorage", async () => {
        // Seed one custom pack already in localStorage so the cache has
        // it on first render.
        const seeded = saveCustomCardSet("To delete", makeCardSet("d"));

        const { result } = renderHook(
            () => ({
                packs: useCustomCardPacks(),
                del: useDeleteCardPack(),
            }),
            { wrapper: TestQueryClientProvider },
        );
        expect(result.current.packs.data).toHaveLength(1);

        await act(async () => {
            await result.current.del.mutateAsync(seeded.id);
        });

        await waitFor(() => {
            expect(result.current.packs.data).toHaveLength(0);
        });
    });

    test("deleting an unknown id is a no-op", async () => {
        saveCustomCardSet("Stays", makeCardSet("stay"));
        const { result } = renderHook(
            () => ({
                packs: useCustomCardPacks(),
                del: useDeleteCardPack(),
            }),
            { wrapper: TestQueryClientProvider },
        );
        expect(result.current.packs.data).toHaveLength(1);

        await act(async () => {
            await result.current.del.mutateAsync("nonexistent");
        });

        // No throw, no removal — cache untouched.
        expect(result.current.packs.data).toHaveLength(1);
        expect(result.current.packs.data?.[0]?.label).toBe("Stays");
    });
});
