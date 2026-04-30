/**
 * Owns the open/closed state of the account modal so any UI
 * surface (the Toolbar / BottomNav overflow item, future tour
 * step, future M8 card-pack management) can call
 * `openAccountModal()` without threading state through props.
 *
 * Mirrors the `InstallPromptProvider` pattern — single state,
 * exposed via context, modal rendered at the provider root.
 */
"use client";

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { AccountModal } from "./AccountModal";

interface AccountContextValue {
    /** True when the account modal is currently open. */
    readonly open: boolean;
    /** Open the modal. Idempotent; calling while open is a no-op. */
    readonly openModal: () => void;
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

export function AccountProvider({
    children,
}: {
    readonly children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const openModal = useCallback(() => setOpen(true), []);
    const closeModal = useCallback(() => setOpen(false), []);
    const value = useMemo<AccountContextValue>(
        () => ({ open, openModal }),
        [open, openModal],
    );
    return (
        <AccountContext.Provider value={value}>
            {children}
            <AccountModal open={open} onClose={closeModal} />
        </AccountContext.Provider>
    );
}
