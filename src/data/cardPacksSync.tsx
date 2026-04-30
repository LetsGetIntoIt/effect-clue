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
import {
    localPacksPushedOnSignIn,
} from "../analytics/events";
import { loadCustomCardSets } from "../logic/CustomCardSets";
import { pushLocalPacksOnSignIn } from "../server/actions/packs";
import { useSession } from "../ui/hooks/useSession";

export function CardPacksSyncOnSignIn() {
    const session = useSession();
    const lastSyncedUserIdRef = useRef<string | null>(null);

    useEffect(() => {
        const user = session.data?.user;
        if (!user || user.isAnonymous) return;
        if (lastSyncedUserIdRef.current === user.id) return;
        lastSyncedUserIdRef.current = user.id;

        const packs = loadCustomCardSets();
        if (packs.length === 0) return;

        void (async () => {
            try {
                const result = await pushLocalPacksOnSignIn({
                    packs: packs.map((p) => ({
                        clientGeneratedId: p.id,
                        label: p.label,
                        cardSet: p.cardSet,
                    })),
                });
                localPacksPushedOnSignIn({
                    countPushed: result.countPushed,
                    countAlreadySynced: result.countAlreadySynced,
                    countRenamed: result.countRenamed,
                    countFailed: result.countFailed,
                });
            } catch {
                // Sign-in itself succeeded — the push is best-effort
                // and Sentry catches any thrown error from the
                // server-action wrapper. Don't block the UI on it.
            }
        })();
    }, [session.data]);

    return null;
}
