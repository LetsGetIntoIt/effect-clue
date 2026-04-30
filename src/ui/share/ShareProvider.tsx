/**
 * Owns the open/closed state of the share-create modal so the
 * Toolbar / BottomNav overflow menu items can call
 * `openShareModal()` without threading state. Mirrors the
 * `AccountProvider` / `InstallPromptProvider` pattern.
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
import { ShareCreateModal } from "./ShareCreateModal";

interface ShareContextValue {
    readonly open: boolean;
    readonly openModal: () => void;
}

const ShareContext = createContext<ShareContextValue | undefined>(undefined);

export const useShareContext = (): ShareContextValue => {
    const ctx = useContext(ShareContext);
    if (!ctx) {
        // eslint-disable-next-line i18next/no-literal-string -- developer-facing assertion.
        throw new Error("useShareContext must be inside <ShareProvider>");
    }
    return ctx;
};

export function ShareProvider({
    children,
}: {
    readonly children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const openModal = useCallback(() => setOpen(true), []);
    const closeModal = useCallback(() => setOpen(false), []);
    const value = useMemo<ShareContextValue>(
        () => ({ open, openModal }),
        [open, openModal],
    );
    return (
        <ShareContext.Provider value={value}>
            {children}
            <ShareCreateModal open={open} onClose={closeModal} />
        </ShareContext.Provider>
    );
}
