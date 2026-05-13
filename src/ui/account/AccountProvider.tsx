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
    useEffect,
    useMemo,
    useRef,
    type ReactNode,
} from "react";
import { DateTime } from "effect";
import { useTranslations } from "next-intl";
import { signOut as signOutEvent } from "../../analytics/events";
import {
    CardPacksSync,
    commitSignOut,
    flushPendingChanges,
    type FlushReason,
    type UnsyncedSummary,
} from "../../data/cardPacksSync";
import { TelemetryRuntime } from "../../observability/runtime";
import { useModalStack } from "../components/ModalStack";
import { useSession } from "../hooks/useSession";
import { loadTourState } from "../tour/TourState";
import {
    computeShouldShowTour,
    TOUR_RE_ENGAGE_DURATION,
} from "../tour/useTourGate";
import {
    ACCOUNT_MODAL_ID,
    ACCOUNT_MODAL_MAX_WIDTH,
    AccountModal,
} from "./AccountModal";
import {
    LOGOUT_WARNING_MAX_WIDTH,
    LOGOUT_WARNING_MODAL_ID,
    LogoutWarningModalContent,
} from "./LogoutWarningModal";
import { consumePendingAccountModalIntent } from "./pendingAccountModal";

const ACCOUNT_TOUR_SCREEN_KEY = "account" as const;

interface AccountContextValue {
    /** Open the modal. Idempotent; calling while open re-pushes the
     *  same id, which the modal stack treats as a no-animation
     *  refresh of the entry. */
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
    readonly summary: UnsyncedSummary | null;
    readonly reason: FlushReason | null;
    readonly retrying: boolean;
}

export function AccountProvider({
    children,
}: {
    readonly children: ReactNode;
}) {
    const tAccount = useTranslations("account");
    const session = useSession();
    const queryClient = useQueryClient();
    const { push, popTo } = useModalStack();
    /**
     * Resolver registry for in-flight `requestSignOut` calls. The
     * promise resolves once the user has either committed sign-out
     * or chosen to stay. Multiple concurrent callers (unlikely) all
     * await the same outcome.
     */
    const pendingResolvesRef = useRef<Array<() => void>>([]);
    /**
     * Latest props for the logout-warning modal. The modal is pushed
     * onto the stack via re-push (idempotent on id), so the most
     * recent state from a retry is what's rendered. We hold the
     * `summary` here too because `onSignOutAnyway` reads it for
     * analytics.
     */
    const logoutStateRef = useRef<LogoutModalState | null>(null);

    const openModal = useCallback(() => {
        // Ghost-click guard for the My card packs walkthrough. When
        // the account tour will fire on this open (gate is fresh and
        // the user is signed in — `AccountModal`'s mount effect does
        // the actual fire), push the modal with backdrop close
        // disabled. iOS Safari can fire a synthetic "ghost click" up
        // to ~300 ms after a tap that ended on `touchend`, and that
        // click can land on the backdrop and dismiss the modal out
        // from under the walkthrough. Esc + the X button stay
        // enabled — those are deliberate exits.
        //
        // We don't need to also guard signed-out opens (no walk
        // there) or already-dismissed-gate opens (no walk either),
        // so cheap to check inline. The gate read here mirrors the
        // one inside AccountModal — both reads should agree.
        const willFireTour =
            session.data?.user
            && !session.data.user.isAnonymous
            && TelemetryRuntime.runSync(
                computeShouldShowTour(
                    loadTourState(ACCOUNT_TOUR_SCREEN_KEY),
                    DateTime.nowUnsafe(),
                    TOUR_RE_ENGAGE_DURATION,
                ),
            );
        push({
            id: ACCOUNT_MODAL_ID,
            title: tAccount("titleSignedIn"),
            maxWidth: ACCOUNT_MODAL_MAX_WIDTH,
            content: <AccountModal />,
            ...(willFireTour ? { dismissOnOutsideClick: false } : {}),
        });
    }, [push, tAccount, session]);
    const closeAccountModal = useCallback(() => {
        popTo(ACCOUNT_MODAL_ID);
    }, [popTo]);

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

    const dismissLogoutModal = useCallback(() => {
        logoutStateRef.current = null;
        popTo(LOGOUT_WARNING_MODAL_ID);
    }, [popTo]);

    const onStay = useCallback(() => {
        dismissLogoutModal();
        resolvePending();
        // Close the account modal too — staying logged in shouldn't
        // leave a stale warning hanging.
        closeAccountModal();
    }, [dismissLogoutModal, resolvePending, closeAccountModal]);

    const onSignOutAnyway = useCallback(async () => {
        const summary = logoutStateRef.current?.summary ?? null;
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
        dismissLogoutModal();
        resolvePending();
        closeAccountModal();
    }, [performCommitSignOut, dismissLogoutModal, resolvePending, closeAccountModal]);

    const showLogoutWarning = useCallback(
        (next: LogoutModalState) => {
            logoutStateRef.current = next;
            push({
                id: LOGOUT_WARNING_MODAL_ID,
                title: tAccount("logoutWarning.title"),
                dismissOnOutsideClick: false,
                dismissOnEscape: false,
                maxWidth: LOGOUT_WARNING_MAX_WIDTH,
                content: (
                    <LogoutWarningModalContent
                        summary={next.summary}
                        reason={next.reason}
                        retrying={next.retrying}
                        onStay={onStay}
                        onRetry={() => void onRetry()}
                        onSignOutAnyway={() => void onSignOutAnyway()}
                    />
                ),
            });
        },
        [push, tAccount, onStay, onSignOutAnyway],
    );

    const onRetry = useCallback(async () => {
        const current = logoutStateRef.current;
        if (current) {
            showLogoutWarning({ ...current, retrying: true });
        }
        const flush = await flushPendingChanges();
        if (flush.ok) {
            await performCommitSignOut();
            dismissLogoutModal();
            resolvePending();
            closeAccountModal();
            return;
        }
        showLogoutWarning({
            summary: flush.unsynced,
            reason: flush.reason,
            retrying: false,
        });
    }, [performCommitSignOut, dismissLogoutModal, resolvePending, closeAccountModal, showLogoutWarning]);

    const requestSignOut = useCallback(async (): Promise<void> => {
        const flush = await flushPendingChanges();
        if (flush.ok) {
            await performCommitSignOut();
            return;
        }
        return new Promise<void>((resolve) => {
            pendingResolvesRef.current.push(resolve);
            showLogoutWarning({
                summary: flush.unsynced,
                reason: flush.reason,
                retrying: false,
            });
        });
    }, [performCommitSignOut, showLogoutWarning]);

    // Re-open the Account modal after a Google OAuth round-trip.
    // `AccountModal.onGoogleSignIn` writes a sessionStorage marker
    // before kicking off the redirect; after Better Auth lands the
    // user back here, the SPA mounts fresh and this effect reads +
    // clears the marker. When it was present AND the user is now
    // signed in, we call `openModal()` so the user lands exactly
    // where they were before sign-in.
    //
    // Gating:
    //   - `session.isPending` — wait for Better Auth to finish
    //     fetching the session from the cookie set during the OAuth
    //     callback. Reading too early shows the anonymous state and
    //     the modal would open with the sign-in CTA, defeating the
    //     point.
    //   - `!isAnonymous` — if OAuth failed silently or the user
    //     was downgraded back to anonymous somehow, don't re-open
    //     a sign-in CTA on top of them.
    //   - `consumedRef` — fire at most once per mount, since the
    //     marker has already been cleared from storage by the
    //     consume call.
    //
    // The marker has a 10-minute freshness window (see
    // `pendingAccountModal.ts`), so an old marker from an
    // abandoned earlier flow can't surface days later.
    const consumedRef = useRef(false);
    const openModalRef = useRef(openModal);
    openModalRef.current = openModal;
    useEffect(() => {
        if (consumedRef.current) return;
        if (session.isPending) return;
        const user = session.data?.user;
        if (!user || user.isAnonymous) return;
        if (!consumePendingAccountModalIntent()) return;
        consumedRef.current = true;
        openModalRef.current();
    }, [session.isPending, session.data]);

    const value = useMemo<AccountContextValue>(
        () => ({ openModal, requestSignOut }),
        [openModal, requestSignOut],
    );
    return (
        <AccountContext.Provider value={value}>
            {children}
            {/*
              Sign-in side-effect + continuous reconcile (M8). The
              component renders nothing; it owns the
              `getMyCardPacks` React Query and the post-pull
              reconcile that keeps localStorage and the server in
              sync.
            */}
            <CardPacksSync />
        </AccountContext.Provider>
    );
}
