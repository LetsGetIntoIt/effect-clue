/**
 * Sign-in side-effect: when an anonymous user signs in (or
 * upgrades their anonymous account into a real one), push every
 * localStorage-resident custom card pack up to the server so the
 * library syncs across devices going forward.
 *
 * The push is idempotent — `pushLocalPacksOnSignIn` keys on
 * `(owner_id, client_generated_id)` so re-running with the same
 * payload after a re-sign-in is a no-op apart from refreshing the
 * `updated_at` timestamp.
 *
 * Mounts inside the same provider stack as `useSession`. The
 * effect fires exactly once per "anon→signedIn transition" per
 * session — we track the previous user id in a ref so re-renders
 * caused by other state changes don't spam the server.
 */
"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
    localPacksPushedOnSignIn,
} from "../analytics/events";
import { cardSetEquals, CardSet } from "../logic/CardSet";
import { CardEntry, Category } from "../logic/GameSetup";
import { Card, CardCategory } from "../logic/GameObjects";
import {
    loadCustomCardSets,
    replaceCustomCardSets,
    type CustomCardSet,
} from "../logic/CustomCardSets";
import {
    remapCardPackUsageIds,
} from "../logic/CardPackUsage";
import {
    cardPackUsageQueryKey,
} from "./cardPackUsage";
import {
    customCardPacksQueryKey,
} from "./customCardPacks";
import {
    getMyCardPacks,
    pushLocalPacksOnSignIn,
    type PersistedCardPack,
    type PushResult,
} from "../server/actions/packs";
import { useSession } from "../ui/hooks/useSession";
import { myCardPacksQueryKey } from "../ui/account/AccountModal";

interface ReconcileResult {
    readonly packs: ReadonlyArray<CustomCardSet>;
    readonly idMap: ReadonlyMap<string, string>;
    readonly countPulled: number;
}

const emptyPushResult: PushResult = {
    countPushed: 0,
    countAlreadySynced: 0,
    countRenamed: 0,
    countDeduped: 0,
    countFailed: 0,
};

const decodeServerPack = (
    pack: PersistedCardPack,
): CustomCardSet | null => {
    try {
        const parsed: unknown = JSON.parse(pack.cardSetData);
        if (
            typeof parsed !== "object" ||
            parsed === null ||
            !("categories" in parsed) ||
            !Array.isArray(parsed.categories)
        ) {
            return null;
        }
        const categories = [];
        for (const category of parsed.categories) {
            if (
                typeof category !== "object" ||
                category === null ||
                !("id" in category) ||
                typeof category.id !== "string" ||
                !("name" in category) ||
                typeof category.name !== "string" ||
                !("cards" in category) ||
                !Array.isArray(category.cards)
            ) {
                return null;
            }
            const cards = [];
            for (const card of category.cards) {
                if (
                    typeof card !== "object" ||
                    card === null ||
                    !("id" in card) ||
                    typeof card.id !== "string" ||
                    !("name" in card) ||
                    typeof card.name !== "string"
                ) {
                    return null;
                }
                cards.push(
                    CardEntry({
                        id: Card(card.id),
                        name: card.name,
                    }),
                );
            }
            categories.push(
                Category({
                    id: CardCategory(category.id),
                    name: category.name,
                    cards,
                }),
            );
        }
        return {
            id: pack.id,
            label: pack.label,
            cardSet: CardSet({ categories }),
        };
    } catch {
        return null;
    }
};

const isExactDuplicate = (
    a: CustomCardSet,
    b: CustomCardSet,
): boolean => a.label === b.label && cardSetEquals(a.cardSet, b.cardSet);

export const reconcileCardPacks = (
    localPacks: ReadonlyArray<CustomCardSet>,
    serverPacks: ReadonlyArray<PersistedCardPack>,
): ReconcileResult => {
    const decodedServer = serverPacks.flatMap((pack) => {
        const decoded = decodeServerPack(pack);
        return decoded === null ? [] : [decoded];
    });
    const merged: Array<CustomCardSet> = [];
    const idMap = new Map<string, string>();
    let countPulled = 0;

    for (const serverPack of decodedServer) {
        const existing = merged.find((pack) =>
            isExactDuplicate(pack, serverPack),
        );
        if (existing) {
            idMap.set(serverPack.id, existing.id);
            continue;
        }
        const hadLocalEquivalent = localPacks.some((pack) =>
            isExactDuplicate(pack, serverPack),
        );
        const hadLocalClientId = serverPacks.some(
            (pack) =>
                pack.id === serverPack.id &&
                localPacks.some((local) => local.id === pack.clientGeneratedId),
        );
        if (!hadLocalEquivalent && !hadLocalClientId) {
            countPulled += 1;
        }
        merged.push(serverPack);
    }

    for (const localPack of localPacks) {
        const sameClientServer = serverPacks.find(
            (pack) => pack.clientGeneratedId === localPack.id,
        );
        if (sameClientServer !== undefined) {
            idMap.set(localPack.id, sameClientServer.id);
            continue;
        }
        const exactDuplicate = merged.find((pack) =>
            isExactDuplicate(pack, localPack),
        );
        if (exactDuplicate) {
            idMap.set(localPack.id, exactDuplicate.id);
            continue;
        }
        merged.push(localPack);
    }

    return { packs: merged, idMap, countPulled };
};

export function CardPacksSyncOnSignIn() {
    const session = useSession();
    const queryClient = useQueryClient();
    const lastSyncedUserIdRef = useRef<string | null>(null);

    useEffect(() => {
        const user = session.data?.user;
        if (!user || user.isAnonymous) return;
        if (lastSyncedUserIdRef.current === user.id) return;
        lastSyncedUserIdRef.current = user.id;

        const packs = loadCustomCardSets();

        void (async () => {
            try {
                const result = packs.length > 0
                    ? await pushLocalPacksOnSignIn({
                          packs: packs.map((p) => ({
                              clientGeneratedId: p.id,
                              label: p.label,
                              cardSet: p.cardSet,
                          })),
                      })
                    : emptyPushResult;
                const serverPacks = await getMyCardPacks();
                const reconciled = reconcileCardPacks(packs, serverPacks);
                replaceCustomCardSets(reconciled.packs);
                const usage = remapCardPackUsageIds(reconciled.idMap);
                queryClient.setQueryData(
                    customCardPacksQueryKey,
                    reconciled.packs,
                );
                queryClient.setQueryData(cardPackUsageQueryKey, usage);
                queryClient.setQueryData(
                    myCardPacksQueryKey(user.id),
                    serverPacks,
                );
                localPacksPushedOnSignIn({
                    countPushed: result.countPushed,
                    countAlreadySynced: result.countAlreadySynced,
                    countRenamed: result.countRenamed,
                    countDeduped: result.countDeduped,
                    countPulled: reconciled.countPulled,
                    countFailed: result.countFailed,
                });
            } catch {
                // Sign-in itself succeeded — the push is best-effort
                // and Sentry catches any thrown error from the
                // server-action wrapper. Don't block the UI on it.
            }
        })();
    }, [queryClient, session.data]);

    return null;
}
