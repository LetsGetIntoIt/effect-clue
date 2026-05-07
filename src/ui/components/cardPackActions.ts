"use client";

import { useQueryClient } from "@tanstack/react-query";
import { DateTime } from "effect";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import {
    customCardPacksQueryKey,
    myCardPacksQueryKey,
    useDeleteCardPack,
    useDeleteCardPackOnServer,
    useSaveCardPack,
    useSaveCardPackOnServer,
    useSignedInUserId,
} from "../../data/customCardPacks";
import { addTombstone } from "../../logic/CardPackTombstones";
import type { CardSet } from "../../logic/CardSet";
import type { CustomCardSet } from "../../logic/CustomCardSets";
import type { PersistedCardPack } from "../../server/actions/packs";
import { useConfirm } from "../hooks/useConfirm";
import { usePrompt } from "../hooks/usePrompt";
import { useShareContext } from "../share/ShareProvider";

/**
 * Minimal addressable handle for a card pack. `clientGeneratedId` is
 * the cross-device-stable identity (the server's
 * `client_generated_id` column). The local pack's `id` may differ
 * post-reconcile (it gets swapped to the server's id), so the
 * orchestrator looks up the local entry by EITHER its `id` or
 * `clientGeneratedId` to find a match.
 */
interface CardPackActionTarget {
    readonly clientGeneratedId: string;
    readonly label: string;
    readonly cardSet: CardSet;
}

interface SavePackInput {
    readonly label: string;
    readonly cardSet: CardSet;
    /**
     * When provided and matches an existing pack's id, updates that
     * pack in place. When absent, creates a new pack.
     */
    readonly existingId?: string;
}

interface CardPackActions {
    /**
     * Single-call entry point for both "+ Save as card pack" (no
     * `existingId`) and "Update {label}" (with `existingId`). Writes
     * to localStorage first; when signed in, also fires the server
     * UPSERT. Returns the freshly-saved local pack.
     */
    readonly savePack: (input: SavePackInput) => Promise<CustomCardSet>;
    readonly sharePack: (pack: CardPackActionTarget) => void;
    readonly renamePack: (pack: CardPackActionTarget) => Promise<boolean>;
    readonly deletePack: (pack: CardPackActionTarget) => Promise<boolean>;
}

/**
 * Shared share / rename / delete / save handlers for a saved card
 * pack. The AccountModal, the Setup-pill row, and the All-card-packs
 * picker all route through this hook so the three surfaces stay in
 * lock-step — same prompt copy, same confirm flow, same local +
 * server mirroring.
 *
 * Local hooks (`useSaveCardPack` / `useDeleteCardPack`) handle
 * localStorage; server hooks (`useSaveCardPackOnServer` /
 * `useDeleteCardPackOnServer`) handle the server row, and on success
 * reach back to update the local pack's `lastSyncedSnapshot` /
 * tombstone state. This orchestrator wires them together based on
 * cache state — call local when there's a local match, call server
 * when the user is signed in. The server-write hook's `onSuccess`
 * carries all of the metadata bookkeeping (id swap, snapshot
 * refresh, tombstone clear) so callers don't have to think about it.
 */
export function useCardPackActions(): CardPackActions {
    const tCommon = useTranslations("common");
    const tAccount = useTranslations("account");
    const queryClient = useQueryClient();
    const userId = useSignedInUserId();
    const confirm = useConfirm();
    const prompt = usePrompt();
    const { openShareCardPack } = useShareContext();
    const saveLocal = useSaveCardPack();
    const deleteLocal = useDeleteCardPack();
    const saveServer = useSaveCardPackOnServer();
    const deleteServer = useDeleteCardPackOnServer();

    const findServer = useCallback(
        (target: CardPackActionTarget): PersistedCardPack | undefined => {
            const server =
                queryClient.getQueryData<ReadonlyArray<PersistedCardPack>>(
                    myCardPacksQueryKey(userId),
                );
            return server?.find(
                (p) =>
                    p.clientGeneratedId === target.clientGeneratedId ||
                    p.id === target.clientGeneratedId,
            );
        },
        [queryClient, userId],
    );

    /**
     * Find a local pack by its `clientGeneratedId`. Two cases to
     * cover:
     *
     *   1. Pre-reconcile: the local pack's `id` equals its cgid
     *      (that's how `saveCustomCardSet` mints them). Direct match.
     *   2. Post-reconcile: `markPackSynced` swapped the local `id`
     *      to the server's cuid2. The cgid lives on the server row;
     *      we look it up via the `myCardPacksQueryKey` cache and
     *      then find the local pack by the corresponding server id.
     */
    const findLocal = useCallback(
        (target: CardPackActionTarget): CustomCardSet | undefined => {
            const local =
                queryClient.getQueryData<ReadonlyArray<CustomCardSet>>(
                    customCardPacksQueryKey,
                );
            if (local === undefined) return undefined;
            const directMatch = local.find(
                (p) => p.id === target.clientGeneratedId,
            );
            if (directMatch !== undefined) return directMatch;
            const serverMatch = findServer(target);
            if (serverMatch !== undefined) {
                return local.find((p) => p.id === serverMatch.id);
            }
            return undefined;
        },
        [queryClient, findServer],
    );

    const sharePack = useCallback<CardPackActions["sharePack"]>(
        (pack) => {
            openShareCardPack({
                forcedCardPack: pack.cardSet,
                packLabel: pack.label,
            });
        },
        [openShareCardPack],
    );

    const savePack = useCallback<CardPackActions["savePack"]>(
        async (input) => {
            const localPack = await saveLocal.mutateAsync(input);
            if (userId !== undefined) {
                saveServer.mutate({
                    clientGeneratedId: localPack.id,
                    label: localPack.label,
                    cardSet: localPack.cardSet,
                });
            }
            return localPack;
        },
        [saveLocal, saveServer, userId],
    );

    const renamePack = useCallback<CardPackActions["renamePack"]>(
        async (pack) => {
            const next = await prompt({
                title: tAccount("renamePackDialogTitle"),
                label: tAccount("renamePackInputLabel"),
                initialValue: pack.label,
                confirmLabel: tCommon("save"),
            });
            if (next === null) return false;
            const trimmed = next.trim();
            if (trimmed.length === 0 || trimmed === pack.label) return false;

            const localMatch = findLocal(pack);
            if (localMatch !== undefined) {
                saveLocal.mutate({
                    label: trimmed,
                    cardSet: pack.cardSet,
                    existingId: localMatch.id,
                });
            }
            // Always push to the server when signed in. The server
            // action is idempotent on `(owner_id,
            // client_generated_id)` — if the row already exists,
            // it's an UPDATE; if not, an INSERT. Covers both the
            // "synced pack rename" and "server-only pack rename"
            // cases without a separate fallback branch.
            if (userId !== undefined) {
                saveServer.mutate({
                    clientGeneratedId: pack.clientGeneratedId,
                    label: trimmed,
                    cardSet: pack.cardSet,
                });
            }
            return true;
        },
        [
            prompt,
            tAccount,
            tCommon,
            findLocal,
            saveLocal,
            saveServer,
            userId,
        ],
    );

    const deletePack = useCallback<CardPackActions["deletePack"]>(
        async (pack) => {
            const ok = await confirm({
                message: tAccount("deletePackConfirm", { label: pack.label }),
            });
            if (!ok) return false;

            const localMatch = findLocal(pack);
            const serverMatch = findServer(pack);

            // Tombstone first (when there's any chance the server
            // has the pack) so a refetch racing the delete doesn't
            // resurrect it. The server-side delete's `onSuccess`
            // clears the tombstone.
            if (
                userId !== undefined &&
                (serverMatch !== undefined || localMatch?.lastSyncedSnapshot !== undefined)
            ) {
                addTombstone({
                    id: localMatch?.id ?? pack.clientGeneratedId,
                    label: pack.label,
                    deletedAt: DateTime.nowUnsafe(),
                });
            }

            if (localMatch !== undefined) {
                deleteLocal.mutate(localMatch.id);
            }
            if (userId !== undefined && serverMatch !== undefined) {
                // Use the server's `id` so the delete keys cleanly
                // even when the local pack's id has been swapped.
                deleteServer.mutate(serverMatch.id);
            }
            return true;
        },
        [
            confirm,
            tAccount,
            findLocal,
            findServer,
            deleteLocal,
            deleteServer,
            userId,
        ],
    );

    return { savePack, sharePack, renamePack, deletePack };
}
