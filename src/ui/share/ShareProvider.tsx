/**
 * Owns the open/closed state of the share-create modal and the
 * variant + per-call options the entry point selects.
 *
 * Three named openers, one per flow:
 *   - `openShareCardPack({ forcedCardPack?, packLabel? })` —
 *     pack-only share. Card pack row in setup + per-pack share in
 *     the picker call this; the picker passes its own pack via
 *     `forcedCardPack`.
 *   - `openInvitePlayer()` — invite-a-player share. Setup pane
 *     near the Start playing CTA + overflow menu call this.
 *   - `openContinueOnAnotherDevice()` — full transfer share with
 *     all private game state. Overflow menu only.
 *
 * The previous `openModal` / `openModalWith({ initialToggles, ... })`
 * API was removed in M22 — the toggle-based contract leaked the
 * server's column structure into the UI. The variant API is the
 * stable surface; new sender entry points should reuse one of the
 * three openers rather than passing toggles directly.
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
import { ShareCreateModal, type ShareVariant } from "./ShareCreateModal";

interface OpenSharePackOptions {
    /** When opened from the picker, ships the picked pack instead of
     * whatever's currently loaded in setup. */
    readonly forcedCardPack?: CardSet;
    /** User-facing label for the picked / active pack. Embedded in
     * the wire payload so the receive modal renders the pack's name
     * instead of "(untitled)". */
    readonly packLabel?: string;
}

interface ShareContextValue {
    readonly open: boolean;
    readonly openShareCardPack: (opts?: OpenSharePackOptions) => void;
    readonly openInvitePlayer: () => void;
    readonly openContinueOnAnotherDevice: () => void;
}

/**
 * Default no-op context value, returned when a component is mounted
 * without `<ShareProvider>` above it. Lets isolated component tests
 * (CardPackRow alone, etc.) render without crashing.
 */
const SHARE_CONTEXT_DEFAULT: ShareContextValue = {
    open: false,
    openShareCardPack: () => {},
    openInvitePlayer: () => {},
    openContinueOnAnotherDevice: () => {},
};

const ShareContext = createContext<ShareContextValue>(SHARE_CONTEXT_DEFAULT);

export const useShareContext = (): ShareContextValue =>
    useContext(ShareContext);

const VARIANT_PACK: ShareVariant = "pack";
const VARIANT_INVITE: ShareVariant = "invite";
const VARIANT_TRANSFER: ShareVariant = "transfer";

export function ShareProvider({
    children,
}: {
    readonly children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const [variant, setVariant] = useState<ShareVariant>(VARIANT_PACK);
    const [forcedCardPack, setForcedCardPack] = useState<
        CardSet | undefined
    >(undefined);
    const [forcedCardPackLabel, setForcedCardPackLabel] = useState<
        string | undefined
    >(undefined);

    const openShareCardPack = useCallback(
        (opts?: OpenSharePackOptions) => {
            setVariant(VARIANT_PACK);
            setForcedCardPack(opts?.forcedCardPack);
            setForcedCardPackLabel(opts?.packLabel);
            setOpen(true);
        },
        [],
    );
    const openInvitePlayer = useCallback(() => {
        setVariant(VARIANT_INVITE);
        setForcedCardPack(undefined);
        setForcedCardPackLabel(undefined);
        setOpen(true);
    }, []);
    const openContinueOnAnotherDevice = useCallback(() => {
        setVariant(VARIANT_TRANSFER);
        setForcedCardPack(undefined);
        setForcedCardPackLabel(undefined);
        setOpen(true);
    }, []);
    const closeModal = useCallback(() => {
        setOpen(false);
        // Keep variant + forced state in place — the modal is unmounting,
        // and clearing now would re-render with default state for a
        // frame before it goes away.
    }, []);

    const value = useMemo<ShareContextValue>(
        () => ({
            open,
            openShareCardPack,
            openInvitePlayer,
            openContinueOnAnotherDevice,
        }),
        [
            open,
            openShareCardPack,
            openInvitePlayer,
            openContinueOnAnotherDevice,
        ],
    );

    return (
        <ShareContext.Provider value={value}>
            {children}
            <ShareCreateModal
                open={open}
                onClose={closeModal}
                variant={variant}
                {...(forcedCardPack !== undefined ? { forcedCardPack } : {})}
                {...(forcedCardPackLabel !== undefined
                    ? { forcedCardPackLabel }
                    : {})}
            />
        </ShareContext.Provider>
    );
}
