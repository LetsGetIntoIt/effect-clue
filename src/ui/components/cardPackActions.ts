"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import {
    customCardPacksQueryKey,
    useDeleteCardPack,
    useDeleteCardPackOnServer,
    useSaveCardPack,
    useSaveCardPackOnServer,
} from "../../data/customCardPacks";
import type { CardSet } from "../../logic/CardSet";
import type { CustomCardSet } from "../../logic/CustomCardSets";
import type { PersistedCardPack } from "../../server/actions/packs";
import { myCardPacksQueryKey } from "../account/AccountModal";
import { useConfirm } from "../hooks/useConfirm";
import { usePrompt } from "../hooks/usePrompt";
import { useSession } from "../hooks/useSession";
import { useShareContext } from "../share/ShareProvider";

/**
 * Minimal addressable handle for a card pack. `clientGeneratedId` is
 * the localStorage id (and the cross-device-stable identity used to
 * key against the server's `client_generated_id` column). Callers
 * pass this from whichever shape they have on hand — `CustomCardSet`,
 * the `DisplayPack` from the AccountModal, or a Setup-pill `DisplayPack`.
 */
interface CardPackActionTarget {
    readonly clientGeneratedId: string;
    readonly label: string;
    readonly cardSet: CardSet;
}

interface CardPackActions {
    readonly sharePack: (pack: CardPackActionTarget) => void;
    readonly renamePack: (pack: CardPackActionTarget) => Promise<boolean>;
    readonly deletePack: (pack: CardPackActionTarget) => Promise<boolean>;
}

/**
 * Shared share/rename/delete handlers for a saved card pack. The
 * AccountModal, the Setup-pill row, and the All-card-packs picker all
 * route through this hook so the three surfaces stay in lock-step
 * — same prompt copy, same confirm flow, same local + server mirroring.
 *
 * Server-side mirroring is opportunistic: when a matching entry
 * exists in the `myCardPacksQueryKey` cache (i.e. the user is signed
 * in and the pack has been synced), the rename / delete also writes
 * to the server. For local-only packs, only the local mutation runs.
 * Local-side mirroring is similarly conditional — when the `clientGeneratedId`
 * isn't in the localStorage cache (server-only pack viewed in the
 * modal before sign-in reconciliation), the local mutation is
 * skipped to avoid creating a duplicate row with a fresh local id.
 */
export function useCardPackActions(): CardPackActions {
    const tCommon = useTranslations("common");
    const tAccount = useTranslations("account");
    const queryClient = useQueryClient();
    const session = useSession();
    const userId = session.data?.user.id;
    const confirm = useConfirm();
    const prompt = usePrompt();
    const { openShareCardPack } = useShareContext();
    const saveLocal = useSaveCardPack();
    const deleteLocal = useDeleteCardPack();
    const saveServer = useSaveCardPackOnServer();
    const deleteServer = useDeleteCardPackOnServer();

    const findLocal = useCallback(
        (clientGeneratedId: string): CustomCardSet | undefined => {
            const local =
                queryClient.getQueryData<ReadonlyArray<CustomCardSet>>(
                    customCardPacksQueryKey,
                );
            return local?.find((p) => p.id === clientGeneratedId);
        },
        [queryClient],
    );

    const findServer = useCallback(
        (clientGeneratedId: string): PersistedCardPack | undefined => {
            const server =
                queryClient.getQueryData<ReadonlyArray<PersistedCardPack>>(
                    myCardPacksQueryKey(userId),
                );
            return server?.find(
                (p) => p.clientGeneratedId === clientGeneratedId,
            );
        },
        [queryClient, userId],
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

            const localMatch = findLocal(pack.clientGeneratedId);
            if (localMatch !== undefined) {
                saveLocal.mutate({
                    label: trimmed,
                    cardSet: pack.cardSet,
                    existingId: pack.clientGeneratedId,
                });
            }

            const serverMatch = findServer(pack.clientGeneratedId);
            if (serverMatch !== undefined) {
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
            findServer,
            saveLocal,
            saveServer,
        ],
    );

    const deletePack = useCallback<CardPackActions["deletePack"]>(
        async (pack) => {
            const ok = await confirm({
                message: tAccount("deletePackConfirm", { label: pack.label }),
            });
            if (!ok) return false;

            const localMatch = findLocal(pack.clientGeneratedId);
            if (localMatch !== undefined) {
                deleteLocal.mutate(pack.clientGeneratedId);
            }
            const serverMatch = findServer(pack.clientGeneratedId);
            if (serverMatch !== undefined) {
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
        ],
    );

    return { sharePack, renamePack, deletePack };
}
