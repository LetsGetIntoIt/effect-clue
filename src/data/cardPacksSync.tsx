/**
 * Continuous reconcile between the server-side card-pack library and
 * the localStorage cache, plus the logout flush helper.
 *
 * The mental model is local-first with the server as source of truth
 * once signed in: every signed-in mount, focus, and reconnect is a
 * chance to converge. Three mechanisms drive convergence:
 *
 *   1. Mutations (`useSaveCardPack` / `useDeleteCardPack`) mirror to
 *      the server in parallel with the localStorage write.
 *   2. A React Query for `getMyCardPacks` (in this file's
 *      `<CardPacksSync />`) refetches on mount / focus / reconnect
 *      and triggers `applyServerSnapshot` on every settle —
 *      tombstone-flush, then reconcile, then write the merged list
 *      back to localStorage.
 *   3. The sign-in transition still calls `pushLocalPacksOnSignIn` to
 *      bulk-upload localStorage packs that pre-date the sign-in, then
 *      invalidates the React Query so the pull lands.
 *
 * Errors land in Honeycomb logs + Sentry breadcrumbs via
 * `Effect.logError`; sign-in / sync UX is never blocked by a sync
 * failure.
 *
 * The logout chokepoint `requestSignOut` runs `flushPendingChanges`
 * first. If everything's synced, it clears account-tied
 * localStorage and calls `authClient.signOut()`. If something is
 * unsynced (offline or server error), the
 * `LogoutWarningModal` opens with a per-pack diff and the user
 * decides whether to stay logged in, retry, or sign out anyway.
 */
"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Duration, Effect } from "effect";
import {
    localPacksPushedOnSignIn,
} from "../analytics/events";
import { cardSetEquals, type CardSet } from "../logic/CardSet";
import {
    clearAllTombstones,
    clearTombstones,
    loadTombstones,
    type CardPackTombstone,
} from "../logic/CardPackTombstones";
import {
    clearAccountTiedLocalState,
    loadCustomCardSets,
    markPackSynced,
    replaceCustomCardSets,
    type CardPackSnapshot,
    type CustomCardSet,
} from "../logic/CustomCardSets";
import { remapCardPackUsageIds } from "../logic/CardPackUsage";
import {
    deleteCardPack,
    getMyCardPacks,
    pushLocalPacksOnSignIn,
    saveCardPack,
    type PersistedCardPack,
    type PushResult,
} from "../server/actions/packs";
import { TelemetryRuntime } from "../observability/runtime";
import { authClient } from "../ui/account/authClient";
import { useSession } from "../ui/hooks/useSession";
import { cardPackUsageQueryKey } from "./cardPackUsage";
import { drainInFlight, trackInFlight } from "./cardPacksInFlight";
import {
    customCardPacksQueryKey,
    myCardPacksQueryKey,
} from "./customCardPacks";
import { decodeServerPack, encodeCardSet } from "./serverPackCodec";

// ── Reconcile ────────────────────────────────────────────────────────────────

interface ReconcileResult {
    readonly packs: ReadonlyArray<CustomCardSet>;
    readonly idMap: ReadonlyMap<string, string>;
    readonly countPulled: number;
}

const isExactDuplicateContent = (
    a: CustomCardSet,
    b: { label: string; cardSet: CardSet },
): boolean => a.label === b.label && cardSetEquals(a.cardSet, b.cardSet);

/**
 * Merge the localStorage library with the server's view, returning a
 * single canonical list. Discriminator rules:
 *
 *   1. **Tombstones win.** Any server pack whose `id` or
 *      `clientGeneratedId` is in `tombstoneIds` is dropped (the
 *      delete is still being retried). Any local pack in
 *      `tombstoneIds` is dropped too (defensive — should already be
 *      gone from localStorage).
 *   2. **Pair match (clientGeneratedId).** When a local pack's `id`
 *      equals a server pack's `clientGeneratedId`:
 *        - If content matches: merge with server's id; clear
 *          `unsyncedSince`; refresh `lastSyncedSnapshot` to server's
 *          view.
 *        - If content differs and the local pack has
 *          `unsyncedSince`: **local wins** — preserve local label /
 *          cardSet, retain `unsyncedSince`, baseline becomes the new
 *          server snapshot. (B.3 in plan.)
 *        - If content differs and there's no local
 *          `unsyncedSince`: **server wins** — that's a rename or a
 *          clean update from another device.
 *   3. **Exact-content duplicate.** Server pack with no
 *      clientGeneratedId pair-match BUT label + cardSet identical to
 *      a local pack: server wins (already canonical), idMap remaps
 *      the local id.
 *   4. **Server-only.** Pulled in. Increments `countPulled`.
 *   5. **Local-only.** Preserved with all metadata intact.
 */
export const reconcileCardPacks = (
    localPacks: ReadonlyArray<CustomCardSet>,
    serverPacks: ReadonlyArray<PersistedCardPack>,
    tombstoneIds: ReadonlySet<string> = new Set(),
): ReconcileResult => {
    const filteredServerRaw = serverPacks.filter(
        s =>
            !tombstoneIds.has(s.id) &&
            !tombstoneIds.has(s.clientGeneratedId),
    );
    const filteredLocal = localPacks.filter(p => !tombstoneIds.has(p.id));

    // Each `decoded` entry pairs the `CustomCardSet` shape with the
    // server's `clientGeneratedId` (which `decodeServerPack` drops).
    const decodedServer = filteredServerRaw.flatMap(p => {
        const decoded = decodeServerPack(p);
        return decoded === null
            ? []
            : [{ pack: decoded, clientGeneratedId: p.clientGeneratedId }];
    });

    const merged: Array<CustomCardSet> = [];
    const idMap = new Map<string, string>();
    const handledServerIds = new Set<string>();
    const handledLocalIds = new Set<string>();
    let countPulled = 0;

    // Phase 1: client-id pair matches.
    for (const localPack of filteredLocal) {
        const match = decodedServer.find(
            s => s.clientGeneratedId === localPack.id,
        );
        if (match === undefined) continue;
        const matchingServer = match.pack;
        const contentMatches =
            localPack.label === matchingServer.label &&
            cardSetEquals(localPack.cardSet, matchingServer.cardSet);
        const serverSnapshot: CardPackSnapshot = {
            label: matchingServer.label,
            cardSet: matchingServer.cardSet,
        };
        if (contentMatches) {
            merged.push({
                id: matchingServer.id,
                label: localPack.label,
                cardSet: localPack.cardSet,
                unsyncedSince: undefined,
                lastSyncedSnapshot: serverSnapshot,
            });
        } else if (localPack.unsyncedSince !== undefined) {
            // Local edit, conflict — local wins.
            merged.push({
                id: matchingServer.id,
                label: localPack.label,
                cardSet: localPack.cardSet,
                unsyncedSince: localPack.unsyncedSince,
                lastSyncedSnapshot: serverSnapshot,
            });
        } else {
            // No local edit — server wins (rename, other-device update).
            merged.push({
                id: matchingServer.id,
                label: matchingServer.label,
                cardSet: matchingServer.cardSet,
                unsyncedSince: undefined,
                lastSyncedSnapshot: serverSnapshot,
            });
        }
        if (localPack.id !== matchingServer.id) {
            idMap.set(localPack.id, matchingServer.id);
        }
        handledServerIds.add(matchingServer.id);
        handledLocalIds.add(localPack.id);
    }

    // Phase 2: remaining server packs — exact-content duplicate or fresh pull.
    for (const { pack: serverPack } of decodedServer) {
        if (handledServerIds.has(serverPack.id)) continue;
        const exactDup = filteredLocal.find(
            local =>
                !handledLocalIds.has(local.id) &&
                isExactDuplicateContent(local, serverPack),
        );
        const serverSnapshot: CardPackSnapshot = {
            label: serverPack.label,
            cardSet: serverPack.cardSet,
        };
        merged.push({
            id: serverPack.id,
            label: serverPack.label,
            cardSet: serverPack.cardSet,
            unsyncedSince: undefined,
            lastSyncedSnapshot: serverSnapshot,
        });
        if (exactDup !== undefined) {
            idMap.set(exactDup.id, serverPack.id);
            handledLocalIds.add(exactDup.id);
        } else {
            countPulled += 1;
        }
        handledServerIds.add(serverPack.id);
    }

    // Phase 3: remaining local-only packs.
    for (const localPack of filteredLocal) {
        if (handledLocalIds.has(localPack.id)) continue;
        merged.push(localPack);
    }

    return { packs: merged, idMap, countPulled };
};

// ── Server-snapshot application ─────────────────────────────────────────────

const applyServerSnapshotEffect = Effect.fn(
    "data.cardPacks.applyServerSnapshot",
)(function* (serverPacks: ReadonlyArray<PersistedCardPack>) {
    yield* Effect.promise(() => drainInFlight());

    // Tombstone flush — retry every pending delete; clear successes.
    const tombstones = loadTombstones();
    const survivors: Array<CardPackTombstone> = [];
    for (const tombstone of tombstones) {
        try {
            const promise = deleteCardPack({
                idOrClientGeneratedId: tombstone.id,
            });
            trackInFlight(promise);
            yield* Effect.promise(() => promise);
        } catch (cause) {
            yield* Effect.logError(
                "data.cardPacks.tombstoneFlush failed",
                { cause },
            );
            survivors.push(tombstone);
        }
    }
    if (survivors.length === 0) {
        clearAllTombstones();
    } else {
        clearTombstones(
            tombstones
                .filter(
                    t => !survivors.some(s => s.id === t.id),
                )
                .map(t => t.id),
        );
    }

    const tombstoneIds = new Set<string>(survivors.map(t => t.id));

    // Reconcile against latest localStorage state.
    const local = loadCustomCardSets();
    const reconciled = reconcileCardPacks(local, serverPacks, tombstoneIds);
    replaceCustomCardSets(reconciled.packs);
    if (reconciled.idMap.size > 0) {
        remapCardPackUsageIds(reconciled.idMap);
    }
    return reconciled;
});

// ── Sign-in transition: bulk push ───────────────────────────────────────────

const signInPushEffect = Effect.fn("data.cardPacks.signInPush")(function* (
    packs: ReadonlyArray<CustomCardSet>,
) {
    if (packs.length === 0) {
        return {
            countPushed: 0,
            countAlreadySynced: 0,
            countRenamed: 0,
            countDeduped: 0,
            countFailed: 0,
        } satisfies PushResult;
    }
    const promise = pushLocalPacksOnSignIn({
        packs: packs.map(p => ({
            clientGeneratedId: p.id,
            label: p.label,
            cardSetData: encodeCardSet(p.cardSet),
        })),
    });
    trackInFlight(promise);
    return yield* Effect.tryPromise({
        try: () => promise,
        catch: cause => new Error(String(cause)),
    });
});

// ── CardPacksSync component ─────────────────────────────────────────────────

/**
 * Mounted inside `AccountProvider`. Owns:
 *   - The per-user React Query for `getMyCardPacks` (refetch on
 *     mount / focus / reconnect).
 *   - The sign-in transition effect (bulk push on anon → real).
 *   - The `applyServerSnapshot` effect that runs every time the
 *     query produces fresh data.
 *
 * Renders nothing.
 */
export function CardPacksSync(): null {
    const session = useSession();
    const queryClient = useQueryClient();
    const user = session.data?.user;
    const userId =
        user && !user.isAnonymous ? user.id : undefined;
    const lastPushedUserIdRef = useRef<string | null>(null);
    const lastAppliedDataUpdatedAtRef = useRef<number | null>(null);

    const myCardPacks = useQuery({
        queryKey: myCardPacksQueryKey(userId),
        queryFn: getMyCardPacks,
        enabled: userId !== undefined,
        staleTime: Duration.toMillis(Duration.seconds(30)),
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchOnMount: true,
    });

    // Sign-in transition: push localStorage packs on the
    // anon → real transition. Idempotent on (owner_id,
    // client_generated_id) so accidental re-runs are no-ops.
    useEffect(() => {
        if (userId === undefined) return;
        if (lastPushedUserIdRef.current === userId) return;
        lastPushedUserIdRef.current = userId;
        const localBefore = loadCustomCardSets();
        void TelemetryRuntime.runPromise(
            signInPushEffect(localBefore).pipe(
                Effect.tap(result =>
                    Effect.sync(() => {
                        localPacksPushedOnSignIn({
                            countPushed: result.countPushed,
                            countAlreadySynced: result.countAlreadySynced,
                            countRenamed: result.countRenamed,
                            countDeduped: result.countDeduped,
                            countPulled: 0,
                            countFailed: result.countFailed,
                        });
                    }),
                ),
                Effect.tapError(cause =>
                    Effect.logError(
                        "data.cardPacks.signInPush failed",
                        { cause },
                    ),
                ),
                Effect.ignore,
                Effect.tap(() =>
                    Effect.sync(() => {
                        // Force the React Query to pull now that the
                        // push is settled, so reconcile picks up the
                        // freshly-stamped server rows.
                        void queryClient.invalidateQueries({
                            queryKey: myCardPacksQueryKey(userId),
                        });
                    }),
                ),
            ),
        );
    }, [queryClient, userId]);

    // Apply server snapshot whenever the React Query produces fresh
    // data. `dataUpdatedAt` increments on every successful fetch
    // (including refetches), so a once-per-update guard is enough.
    useEffect(() => {
        if (userId === undefined) return;
        const serverPacks = myCardPacks.data;
        if (serverPacks === undefined) return;
        if (
            lastAppliedDataUpdatedAtRef.current === myCardPacks.dataUpdatedAt
        ) {
            return;
        }
        lastAppliedDataUpdatedAtRef.current = myCardPacks.dataUpdatedAt;

        void TelemetryRuntime.runPromise(
            applyServerSnapshotEffect(serverPacks).pipe(
                Effect.tap(reconciled =>
                    Effect.sync(() => {
                        queryClient.setQueryData<ReadonlyArray<CustomCardSet>>(
                            customCardPacksQueryKey,
                            reconciled.packs,
                        );
                        if (reconciled.idMap.size > 0) {
                            void queryClient.invalidateQueries({
                                queryKey: cardPackUsageQueryKey,
                            });
                        }
                    }),
                ),
                Effect.tapError(cause =>
                    Effect.logError(
                        "data.cardPacks.applyServerSnapshot failed",
                        { cause },
                    ),
                ),
                Effect.ignore,
            ),
        );
    }, [
        userId,
        queryClient,
        myCardPacks.data,
        myCardPacks.dataUpdatedAt,
    ]);

    return null;
}

// ── Flush helper ────────────────────────────────────────────────────────────

export interface UnsyncedSummary {
    readonly created: ReadonlyArray<{
        readonly id: string;
        readonly label: string;
    }>;
    readonly modified: ReadonlyArray<{
        readonly id: string;
        readonly label: string;
        readonly labelChanged: boolean;
        readonly cardsChanged: boolean;
    }>;
    readonly deleted: ReadonlyArray<{
        readonly id: string;
        readonly label: string;
    }>;
}

export type FlushReason = "offline" | "serverError";

type FlushResult =
    | { readonly ok: true }
    | {
          readonly ok: false;
          readonly unsynced: UnsyncedSummary;
          readonly reason: FlushReason;
      };

const summarizeUnsynced = (
    packs: ReadonlyArray<CustomCardSet>,
    tombstones: ReadonlyArray<CardPackTombstone>,
): UnsyncedSummary => {
    const created: Array<{ id: string; label: string }> = [];
    const modified: Array<{
        id: string;
        label: string;
        labelChanged: boolean;
        cardsChanged: boolean;
    }> = [];
    for (const p of packs) {
        // A pack is in sync iff it has a server snapshot AND no
        // pending local edit. Anything else needs to flush.
        const isSynced =
            p.unsyncedSince === undefined &&
            p.lastSyncedSnapshot !== undefined;
        if (isSynced) continue;
        if (p.lastSyncedSnapshot === undefined) {
            // Never been on the server — covers a fresh local
            // creation AND an anonymous-era pack whose sign-in push
            // failed before `lastSyncedSnapshot` was populated.
            created.push({ id: p.id, label: p.label });
            continue;
        }
        const labelChanged = p.label !== p.lastSyncedSnapshot.label;
        const cardsChanged = !cardSetEquals(
            p.cardSet,
            p.lastSyncedSnapshot.cardSet,
        );
        if (!labelChanged && !cardsChanged) continue;
        modified.push({
            id: p.id,
            label: p.label,
            labelChanged,
            cardsChanged,
        });
    }
    return {
        created,
        modified,
        deleted: tombstones.map(t => ({ id: t.id, label: t.label })),
    };
};

const isOfflineHeuristic = (): boolean =>
    typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * Drain in-flight, retry tombstones, push every pack with
 * `unsyncedSince`, then synthesize a summary if anything's still
 * pending. Treats `navigator.onLine === false` as a fast skip
 * (returns `reason: "offline"` without touching the network); any
 * post-precheck network failure is reported as `reason:
 * "serverError"`.
 */
export const flushPendingChanges = async (): Promise<FlushResult> => {
    await drainInFlight();

    if (isOfflineHeuristic()) {
        const summary = summarizeUnsynced(
            loadCustomCardSets(),
            loadTombstones(),
        );
        if (
            summary.created.length === 0 &&
            summary.modified.length === 0 &&
            summary.deleted.length === 0
        ) {
            return { ok: true };
        }
        // eslint-disable-next-line i18next/no-literal-string -- FlushReason discriminator.
        return { ok: false, unsynced: summary, reason: "offline" };
    }

    // Tombstone flush.
    const tombstones = loadTombstones();
    for (const tombstone of tombstones) {
        try {
            const promise = deleteCardPack({
                idOrClientGeneratedId: tombstone.id,
            });
            trackInFlight(promise);
            await promise;
            clearTombstones([tombstone.id]);
        } catch (cause) {
            await TelemetryRuntime.runPromise(
                Effect.logError(
                    "data.cardPacks.flush.deleteFailed",
                    { cause },
                ),
            );
        }
    }

    // Pack-save flush. Push anything we don't know is in sync —
    // that includes packs with `unsyncedSince` (a local edit) AND
    // packs with no `lastSyncedSnapshot` (anonymous-era packs whose
    // sign-in push failed before the snapshot was populated).
    const packs = loadCustomCardSets();
    for (const pack of packs) {
        const needsPush =
            pack.unsyncedSince !== undefined ||
            pack.lastSyncedSnapshot === undefined;
        if (!needsPush) continue;
        try {
            const promise = saveCardPack({
                clientGeneratedId: pack.id,
                label: pack.label,
                cardSetData: encodeCardSet(pack.cardSet),
            });
            trackInFlight(promise);
            const serverRow = await promise;
            const decoded = decodeServerPack(serverRow);
            if (decoded !== null) {
                const synced = markPackSynced(pack.id, {
                    id: serverRow.id,
                    label: serverRow.label,
                    cardSet: decoded.cardSet,
                });
                if (synced && synced.id !== pack.id) {
                    remapCardPackUsageIds(new Map([[pack.id, synced.id]]));
                }
            }
        } catch (cause) {
            await TelemetryRuntime.runPromise(
                Effect.logError(
                    "data.cardPacks.flush.saveFailed",
                    { cause },
                ),
            );
        }
    }

    const summary = summarizeUnsynced(
        loadCustomCardSets(),
        loadTombstones(),
    );
    const stillUnsynced =
        summary.created.length > 0 ||
        summary.modified.length > 0 ||
        summary.deleted.length > 0;
    if (!stillUnsynced) {
        return { ok: true };
    }
    return {
        ok: false,
        unsynced: summary,
        // We got past the `navigator.onLine` precheck but still have
        // pending changes — either an explicit network failure
        // (sawNetworkError) or an unprocessable server response
        // (decode failure, etc.). Either way the user-facing
        // "couldn't reach the server" framing fits.
        // eslint-disable-next-line i18next/no-literal-string -- FlushReason discriminator.
        reason: "serverError",
    };
};

// ── Sign-out chokepoint ─────────────────────────────────────────────────────

/**
 * Commit a sign-out: clear account-tied localStorage, drop affected
 * React Query caches, then call `authClient.signOut()`. Caller emits
 * the `signOut` analytics event with whatever metadata is
 * appropriate for the path that got us here.
 */
export const commitSignOut = async (
    queryClientArg: import("@tanstack/react-query").QueryClient,
    userId: string | undefined,
): Promise<void> => {
    clearAccountTiedLocalState();
    queryClientArg.removeQueries({
        queryKey: customCardPacksQueryKey,
    });
    queryClientArg.removeQueries({
        queryKey: cardPackUsageQueryKey,
    });
    if (userId !== undefined) {
        queryClientArg.removeQueries({
            queryKey: myCardPacksQueryKey(userId),
        });
    }
    await authClient.signOut();
};
