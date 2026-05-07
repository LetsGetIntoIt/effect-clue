/**
 * Owns the open/closed state of the account modal so any UI
 * surface (the Toolbar / BottomNav overflow item, future tour
 * step, future M8 card-pack management) can call
 * `openAccountModal()` without threading state through props.
 *
 * Also owns the sign-out chokepoint `requestSignOut`. Both Toolbar
 * and BottomNav call it instead of `authClient.signOut()` directly,
 * so the unsynced-changes flush + warning modal sits in one place.
 *
 * Mirrors the `InstallPromptProvider` pattern — single state,
 * exposed via context, modal rendered at the provider root.
 */
"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { signOut as signOutEvent } from "../../analytics/events";
import {
    CardPacksSync,
    commitSignOut,
    flushPendingChanges,
    type FlushReason,
    type UnsyncedSummary,
} from "../../data/cardPacksSync";
import { useSession } from "../hooks/useSession";
import { AccountModal } from "./AccountModal";
import { LogoutWarningModal } from "./LogoutWarningModal";

interface AccountContextValue {
    /** True when the account modal is currently open. */
    readonly open: boolean;
    /** Open the modal. Idempotent; calling while open is a no-op. */
    readonly openModal: () => void;
    /**
     * Single chokepoint for signing the user out. Flushes any pending
     * card-pack changes first. If everything's synced, clears
     * account-tied localStorage and calls `authClient.signOut()`. If
     * something is unsynced, opens `LogoutWarningModal` and lets the
     * user decide. Returns when sign-out is committed OR the user
     * elected to stay (or after retries).
     */
    readonly requestSignOut: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | undefined>(
    undefined,
);

export const useAccountContext = (): AccountContextValue => {
    const ctx = useContext(AccountContext);
    if (!ctx) {
        // eslint-disable-next-line i18next/no-literal-string -- developer-facing assertion.
        throw new Error("useAccountContext must be inside <AccountProvider>");
    }
    return ctx;
};

interface LogoutModalState {
    readonly open: boolean;
    readonly summary: UnsyncedSummary | null;
    readonly reason: FlushReason | null;
    readonly retrying: boolean;
}

const initialLogoutModalState: LogoutModalState = {
    open: false,
    summary: null,
    reason: null,
    retrying: false,
};

export function AccountProvider({
    children,
}: {
    readonly children: ReactNode;
}) {
    const session = useSession();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [logoutModal, setLogoutModal] = useState<LogoutModalState>(
        initialLogoutModalState,
    );
    /**
     * Resolver registry for in-flight `requestSignOut` calls. The
     * promise resolves once the user has either committed sign-out
     * or chosen to stay. Multiple concurrent callers (unlikely) all
     * await the same outcome.
     */
    const pendingResolvesRef = useRef<Array<() => void>>([]);

    const openModal = useCallback(() => setOpen(true), []);
    const closeModal = useCallback(() => setOpen(false), []);

    const resolvePending = useCallback(() => {
        const resolvers = pendingResolvesRef.current;
        pendingResolvesRef.current = [];
        for (const resolve of resolvers) {
            resolve();
        }
    }, []);

    const userId =
        session.data?.user && !session.data.user.isAnonymous
            ? session.data.user.id
            : undefined;

    const performCommitSignOut = useCallback(
        async (props?: {
            discardedUnsyncedChanges?: boolean;
            unsyncedCounts?: {
                created: number;
                modified: number;
                deleted: number;
            };
        }) => {
            await commitSignOut(queryClient, userId);
            signOutEvent(props);
            await session.refetch();
        },
        [queryClient, session, userId],
    );

    const requestSignOut = useCallback(async (): Promise<void> => {
        const flush = await flushPendingChanges();
        if (flush.ok) {
            await performCommitSignOut();
            return;
        }
        return new Promise<void>((resolve) => {
            pendingResolvesRef.current.push(resolve);
            setLogoutModal({
                open: true,
                summary: flush.unsynced,
                reason: flush.reason,
                retrying: false,
            });
        });
    }, [performCommitSignOut]);

    const onStay = useCallback(() => {
        setLogoutModal(initialLogoutModalState);
        resolvePending();
        // Close the account modal too — staying logged in shouldn't
        // leave a stale warning hanging.
        setOpen(false);
    }, [resolvePending]);

    const onRetry = useCallback(async () => {
        setLogoutModal((prev) => ({ ...prev, retrying: true }));
        const flush = await flushPendingChanges();
        if (flush.ok) {
            await performCommitSignOut();
            setLogoutModal(initialLogoutModalState);
            resolvePending();
            setOpen(false);
            return;
        }
        setLogoutModal({
            open: true,
            summary: flush.unsynced,
            reason: flush.reason,
            retrying: false,
        });
    }, [performCommitSignOut, resolvePending]);

    const onSignOutAnyway = useCallback(async () => {
        const summary = logoutModal.summary;
        await performCommitSignOut({
            discardedUnsyncedChanges: true,
            unsyncedCounts: summary
                ? {
                      created: summary.created.length,
                      modified: summary.modified.length,
                      deleted: summary.deleted.length,
                  }
                : { created: 0, modified: 0, deleted: 0 },
        });
        setLogoutModal(initialLogoutModalState);
        resolvePending();
        setOpen(false);
    }, [logoutModal.summary, performCommitSignOut, resolvePending]);

    const value = useMemo<AccountContextValue>(
        () => ({ open, openModal, requestSignOut }),
        [open, openModal, requestSignOut],
    );
    return (
        <AccountContext.Provider value={value}>
            {children}
            <AccountModal open={open} onClose={closeModal} />
            {/*
              Sign-in side-effect + continuous reconcile (M8). The
              component renders nothing; it owns the
              `getMyCardPacks` React Query and the post-pull
              reconcile that keeps localStorage and the server in
              sync.
            */}
            <CardPacksSync />
            <LogoutWarningModal
                open={logoutModal.open}
                summary={logoutModal.summary}
                reason={logoutModal.reason}
                retrying={logoutModal.retrying}
                onStay={onStay}
                onRetry={() => void onRetry()}
                onSignOutAnyway={() => void onSignOutAnyway()}
            />
        </AccountContext.Provider>
    );
}
