import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => {
    const make = (ns: string) =>
        (key: string, values?: Record<string, unknown>): string => {
            const fq = ns.length > 0 ? `${ns}.${key}` : key;
            return values ? `${fq}:${JSON.stringify(values)}` : fq;
        };
    return {
        useTranslations: (ns?: string) => make(ns ?? ""),
    };
});

vi.mock("next/navigation", () => ({
    usePathname: () => "/play",
    useSearchParams: () => new URLSearchParams(),
}));

const refetchMock = vi.fn();
let mockSessionData: {
    user: { id: string; isAnonymous?: boolean };
} | null = null;

vi.mock("../hooks/useSession", () => ({
    useSession: () => ({
        data: mockSessionData,
        isPending: false,
        isRefetching: false,
        error: null,
        refetch: refetchMock,
    }),
}));

vi.mock("./authClient", () => ({
    authClient: { useSession: () => ({ data: null }), signIn: { social: vi.fn() } },
}));

// Mock the AccountModal — we don't render it; we only care about the
// LogoutWarningModal that AccountProvider opens via `requestSignOut`.
vi.mock("./AccountModal", () => ({
    AccountModal: () => null,
    ACCOUNT_MODAL_ID: "account",
    ACCOUNT_MODAL_MAX_WIDTH: "min(92vw,440px)",
}));

const flushPendingChangesMock = vi.fn();
const commitSignOutMock = vi.fn();

// Mock the whole `cardPacksSync` module so AccountProvider's
// `<CardPacksSync />` mount doesn't try to spin up a React Query
// against `getMyCardPacks`. The orchestration we want to exercise
// is `requestSignOut` → `flushPendingChanges` → modal → user choice
// → `commitSignOut`.
vi.mock("../../data/cardPacksSync", () => ({
    CardPacksSync: () => null,
    commitSignOut: (...args: unknown[]) => commitSignOutMock(...args),
    flushPendingChanges: () => flushPendingChangesMock(),
}));

const signOutEventMock = vi.fn();
vi.mock("../../analytics/events", () => ({
    signOut: (...args: unknown[]) => signOutEventMock(...args),
    signInStarted: vi.fn(),
    signInFailed: vi.fn(),
    signInCompleted: vi.fn(),
}));

import {
    AccountProvider,
    useAccountContext,
} from "./AccountProvider";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { ModalStackProvider, ModalStackShell } from "../components/ModalStack";

const SignOutButton = () => {
    const { requestSignOut } = useAccountContext();
    return (
        <button
            type="button"
            data-testid="sign-out"
            onClick={() => void requestSignOut()}
        >
            sign out
        </button>
    );
};

const Wrappers = ({ children }: { readonly children: React.ReactNode }) => (
    <TestQueryClientProvider>
        <ModalStackProvider>
            {children}
            <ModalStackShell />
        </ModalStackProvider>
    </TestQueryClientProvider>
);

const renderProvider = () =>
    render(
        <AccountProvider>
            <SignOutButton />
        </AccountProvider>,
        { wrapper: Wrappers },
    );

beforeEach(() => {
    refetchMock.mockReset();
    refetchMock.mockResolvedValue(undefined);
    flushPendingChangesMock.mockReset();
    commitSignOutMock.mockReset();
    commitSignOutMock.mockResolvedValue(undefined);
    signOutEventMock.mockReset();
    mockSessionData = {
        user: { id: "alice-id", isAnonymous: false },
    };
});

afterEach(() => {
    mockSessionData = null;
});

describe("AccountProvider — requestSignOut orchestration", () => {
    test("flush ok → no modal, commitSignOut + signOut event fire immediately", async () => {
        flushPendingChangesMock.mockResolvedValue({ ok: true });
        renderProvider();
        fireEvent.click(screen.getByTestId("sign-out"));

        await waitFor(() => {
            expect(commitSignOutMock).toHaveBeenCalledTimes(1);
        });
        // Provider passes (queryClient, userId) to commitSignOut.
        const args = commitSignOutMock.mock.calls[0];
        expect(args?.[1]).toBe("alice-id");
        expect(signOutEventMock).toHaveBeenCalledTimes(1);
        // No `discardedUnsyncedChanges` flag on the clean path.
        expect(signOutEventMock.mock.calls[0]?.[0]).toBeUndefined();
        expect(refetchMock).toHaveBeenCalledTimes(1);
        // No warning modal.
        expect(
            screen.queryByText(/logoutWarning\.title/),
        ).not.toBeInTheDocument();
    });

    test("flush !ok → warning modal opens with summary; commitSignOut NOT called", async () => {
        flushPendingChangesMock.mockResolvedValue({
            ok: false,
            reason: "offline",
            unsynced: {
                created: [{ id: "a", label: "Office" }],
                modified: [],
                deleted: [],
            },
        });
        renderProvider();
        fireEvent.click(screen.getByTestId("sign-out"));

        await waitFor(() => {
            expect(
                screen.getByText("account.logoutWarning.title"),
            ).toBeInTheDocument();
        });
        expect(commitSignOutMock).not.toHaveBeenCalled();
        // Per-pack item renders inside the created section.
        expect(screen.getByText("Office")).toBeInTheDocument();
    });

    test("Stay logged in → modal closes, commitSignOut NOT called", async () => {
        flushPendingChangesMock.mockResolvedValue({
            ok: false,
            reason: "offline",
            unsynced: {
                created: [{ id: "a", label: "Office" }],
                modified: [],
                deleted: [],
            },
        });
        renderProvider();
        fireEvent.click(screen.getByTestId("sign-out"));
        await screen.findByText("account.logoutWarning.title");

        fireEvent.click(
            screen.getByRole("button", { name: "account.logoutWarning.stayLoggedIn" }),
        );
        await waitFor(() => {
            expect(
                screen.queryByText("account.logoutWarning.title"),
            ).not.toBeInTheDocument();
        });
        expect(commitSignOutMock).not.toHaveBeenCalled();
        expect(signOutEventMock).not.toHaveBeenCalled();
    });

    test("Try again succeeds on retry → modal closes, commitSignOut fires", async () => {
        flushPendingChangesMock
            .mockResolvedValueOnce({
                ok: false,
                reason: "serverError",
                unsynced: {
                    created: [{ id: "a", label: "Office" }],
                    modified: [],
                    deleted: [],
                },
            })
            .mockResolvedValueOnce({ ok: true });
        renderProvider();
        fireEvent.click(screen.getByTestId("sign-out"));
        await screen.findByText("account.logoutWarning.title");
        // Try again button only renders for `serverError` reason.
        fireEvent.click(
            screen.getByRole("button", { name: "account.logoutWarning.tryAgain" }),
        );
        await waitFor(() => {
            expect(commitSignOutMock).toHaveBeenCalledTimes(1);
        });
        await waitFor(() => {
            expect(
                screen.queryByText("account.logoutWarning.title"),
            ).not.toBeInTheDocument();
        });
        expect(signOutEventMock).toHaveBeenCalledTimes(1);
    });

    test("Try again still fails → modal stays open with refreshed summary", async () => {
        flushPendingChangesMock
            .mockResolvedValueOnce({
                ok: false,
                reason: "serverError",
                unsynced: {
                    created: [{ id: "a", label: "First" }],
                    modified: [],
                    deleted: [],
                },
            })
            .mockResolvedValueOnce({
                ok: false,
                reason: "offline",
                unsynced: {
                    created: [],
                    modified: [{ id: "b", label: "Second", labelChanged: true, cardsChanged: false }],
                    deleted: [],
                },
            });
        renderProvider();
        fireEvent.click(screen.getByTestId("sign-out"));
        await screen.findByText("First");

        fireEvent.click(
            screen.getByRole("button", { name: "account.logoutWarning.tryAgain" }),
        );
        // After retry the modal still open, but reflects the new
        // summary + new reason.
        await screen.findByText("Second");
        // Lede swapped from serverError to offline.
        expect(
            screen.getByText("account.logoutWarning.ledeOffline"),
        ).toBeInTheDocument();
        // No `Try again` button this time — reason is now offline.
        expect(
            screen.queryByRole("button", { name: "account.logoutWarning.tryAgain" }),
        ).not.toBeInTheDocument();
        expect(commitSignOutMock).not.toHaveBeenCalled();
    });

    test("Sign out anyway → commitSignOut with discardedUnsyncedChanges + counts", async () => {
        flushPendingChangesMock.mockResolvedValue({
            ok: false,
            reason: "offline",
            unsynced: {
                created: [
                    { id: "a", label: "Office" },
                    { id: "b", label: "Library" },
                ],
                modified: [
                    { id: "c", label: "Mansion", labelChanged: true, cardsChanged: false },
                ],
                deleted: [{ id: "d", label: "Cellar" }],
            },
        });
        renderProvider();
        fireEvent.click(screen.getByTestId("sign-out"));
        await screen.findByText("account.logoutWarning.title");

        fireEvent.click(
            screen.getByRole("button", { name: "account.logoutWarning.signOutAnyway" }),
        );
        await waitFor(() => {
            expect(commitSignOutMock).toHaveBeenCalledTimes(1);
        });
        await waitFor(() => {
            expect(signOutEventMock).toHaveBeenCalledTimes(1);
        });
        const props = signOutEventMock.mock.calls[0]?.[0] as {
            discardedUnsyncedChanges: boolean;
            unsyncedCounts: { created: number; modified: number; deleted: number };
        };
        expect(props.discardedUnsyncedChanges).toBe(true);
        expect(props.unsyncedCounts).toEqual({
            created: 2,
            modified: 1,
            deleted: 1,
        });
    });

    test("requestSignOut Promise resolves only after the user makes a choice", async () => {
        flushPendingChangesMock.mockResolvedValue({
            ok: false,
            reason: "offline",
            unsynced: {
                created: [{ id: "a", label: "Office" }],
                modified: [],
                deleted: [],
            },
        });

        let resolved = false;
        const Caller = () => {
            const { requestSignOut } = useAccountContext();
            return (
                <button
                    type="button"
                    data-testid="sign-out"
                    onClick={() => {
                        void requestSignOut().then(() => {
                            resolved = true;
                        });
                    }}
                >
                    sign out
                </button>
            );
        };
        render(
            <AccountProvider>
                <Caller />
            </AccountProvider>,
            { wrapper: Wrappers },
        );
        fireEvent.click(screen.getByTestId("sign-out"));
        await screen.findByText("account.logoutWarning.title");

        // Modal is open; the Promise has NOT resolved.
        await new Promise(r => setTimeout(r, 0));
        expect(resolved).toBe(false);

        fireEvent.click(
            screen.getByRole("button", { name: "account.logoutWarning.stayLoggedIn" }),
        );
        await waitFor(() => {
            expect(resolved).toBe(true);
        });
    });
});
