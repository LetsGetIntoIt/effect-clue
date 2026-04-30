/**
 * Owns the open/closed state of the share-create modal and any
 * per-call entry-point options (initial toggle defaults, forced card
 * pack). The Toolbar / BottomNav overflow menu items call
 * `openModal()` with no args to use the modal's defaults; the
 * Setup-screen "Share this setup" button calls `openModalWith({...})`
 * to land on prefilled toggles, and per-pack share buttons call
 * `openModalWith({ forcedCardPack })` so the share contains that
 * specific pack rather than whatever's loaded in the live setup.
 *
 * Mirrors the `AccountProvider` / `InstallPromptProvider` pattern.
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
import type { CardSet } from "../../logic/CardSet";
import {
    ShareCreateModal,
    type ShareToggleState,
} from "./ShareCreateModal";

interface OpenModalOptions {
    readonly initialToggles?: Partial<ShareToggleState>;
    readonly forcedCardPack?: CardSet;
}

interface ShareContextValue {
    readonly open: boolean;
    readonly openModal: () => void;
    readonly openModalWith: (options: OpenModalOptions) => void;
}

/**
 * Default no-op context value. Returned by `useShareContext()` when
 * the consumer isn't wrapped in `<ShareProvider>` — this lets
 * isolated component tests (CardPackRow without the full provider
 * stack) still mount without crashing. The trade-off is that a
 * production miswire silently no-ops instead of throwing; we lean on
 * the test suite to ensure the providers stay composed in the real
 * tree.
 */
const SHARE_CONTEXT_DEFAULT: ShareContextValue = {
    open: false,
    openModal: () => {},
    openModalWith: () => {},
};

const ShareContext = createContext<ShareContextValue>(SHARE_CONTEXT_DEFAULT);

export const useShareContext = (): ShareContextValue =>
    useContext(ShareContext);

export function ShareProvider({
    children,
}: {
    readonly children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const [initialToggles, setInitialToggles] = useState<
        Partial<ShareToggleState> | undefined
    >(undefined);
    const [forcedCardPack, setForcedCardPack] = useState<
        CardSet | undefined
    >(undefined);
    const openModal = useCallback(() => {
        setInitialToggles(undefined);
        setForcedCardPack(undefined);
        setOpen(true);
    }, []);
    const openModalWith = useCallback(
        (options: OpenModalOptions) => {
            setInitialToggles(options.initialToggles);
            setForcedCardPack(options.forcedCardPack);
            setOpen(true);
        },
        [],
    );
    const closeModal = useCallback(() => {
        setOpen(false);
        // Don't reset prefill state here — the modal is unmounting,
        // and clearing now would re-render with default toggles for
        // a frame before it goes away.
    }, []);
    const value = useMemo<ShareContextValue>(
        () => ({ open, openModal, openModalWith }),
        [open, openModal, openModalWith],
    );
    return (
        <ShareContext.Provider value={value}>
            {children}
            <ShareCreateModal
                open={open}
                onClose={closeModal}
                {...(initialToggles !== undefined ? { initialToggles } : {})}
                {...(forcedCardPack !== undefined ? { forcedCardPack } : {})}
            />
        </ShareContext.Provider>
    );
}
