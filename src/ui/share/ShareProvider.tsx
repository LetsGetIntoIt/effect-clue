/**
 * Owns the three sender entry points for the share modal.
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
 * Each opener pushes a `ShareCreateModal` content entry onto the
 * global modal stack with the appropriate variant + per-call options.
 * No own `Dialog.Root` — the stack shell renders the modal and slides
 * it in over whatever else was already open (e.g. AccountModal during
 * the My Card Packs share path).
 */
"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import type { CardSet } from "../../logic/CardSet";
import { useModalStack } from "../components/ModalStack";
import { useSession } from "../hooks/useSession";
import {
    consumePendingShareIntent,
    type PendingShareIntent,
} from "./pendingShare";
import {
    SHARE_CREATE_MODAL_ID,
    SHARE_CREATE_MODAL_MAX_WIDTH,
    ShareCreateModal,
    type ShareVariant,
} from "./ShareCreateModal";

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

const TITLE_KEY_FOR: Record<ShareVariant, string> = {
    [VARIANT_PACK]: "packTitle",
    [VARIANT_INVITE]: "inviteTitle",
    [VARIANT_TRANSFER]: "transferTitle",
};

export function ShareProvider({
    children,
}: {
    readonly children: ReactNode;
}) {
    const t = useTranslations("share");
    const { push } = useModalStack();
    const session = useSession();
    /**
     * Set when an OAuth round-trip completes with a stashed share
     * intent — consumed by the resume effect below, which pushes the
     * share modal pre-loaded with the recovered payload. Cleared via
     * `onResumeConsumed` (passed into the modal) so a re-open of the
     * modal doesn't re-consume.
     */
    const resumeIntentRef = useRef<PendingShareIntent | null>(null);

    const pushShareModal = useCallback(
        (
            variant: ShareVariant,
            opts: {
                readonly forcedCardPack?: CardSet;
                readonly forcedCardPackLabel?: string;
                readonly resumeIntent?: PendingShareIntent;
            } = {},
        ) => {
            push({
                id: SHARE_CREATE_MODAL_ID,
                title: t(TITLE_KEY_FOR[variant]),
                maxWidth: SHARE_CREATE_MODAL_MAX_WIDTH,
                content: (
                    <ShareCreateModal
                        variant={variant}
                        {...(opts.forcedCardPack !== undefined
                            ? { forcedCardPack: opts.forcedCardPack }
                            : {})}
                        {...(opts.forcedCardPackLabel !== undefined
                            ? { forcedCardPackLabel: opts.forcedCardPackLabel }
                            : {})}
                        {...(opts.resumeIntent !== undefined
                            ? { resumeIntent: opts.resumeIntent }
                            : {})}
                        onResumeConsumed={() => {
                            resumeIntentRef.current = null;
                        }}
                    />
                ),
            });
        },
        [push, t],
    );

    const openShareCardPack = useCallback(
        (opts?: OpenSharePackOptions) => {
            pushShareModal(VARIANT_PACK, {
                ...(opts?.forcedCardPack !== undefined
                    ? { forcedCardPack: opts.forcedCardPack }
                    : {}),
                ...(opts?.packLabel !== undefined
                    ? { forcedCardPackLabel: opts.packLabel }
                    : {}),
            });
        },
        [pushShareModal],
    );
    const openInvitePlayer = useCallback(() => {
        pushShareModal(VARIANT_INVITE);
    }, [pushShareModal]);
    const openContinueOnAnotherDevice = useCallback(() => {
        pushShareModal(VARIANT_TRANSFER);
    }, [pushShareModal]);

    // Resume a stashed share intent once the user signs in. Drains
    // localStorage exactly once per signed-in mount; the
    // `resumeIntentRef` keeps a fresh re-fire from re-pushing the
    // same intent.
    useEffect(() => {
        const user = session.data?.user;
        if (!user || user.isAnonymous) return;
        if (resumeIntentRef.current !== null) return;
        const pending = consumePendingShareIntent();
        if (pending === null) return;
        resumeIntentRef.current = pending;
        pushShareModal(pending.variant, { resumeIntent: pending });
    }, [pushShareModal, session.data]);

    const value = useMemo<ShareContextValue>(
        () => ({
            openShareCardPack,
            openInvitePlayer,
            openContinueOnAnotherDevice,
        }),
        [
            openShareCardPack,
            openInvitePlayer,
            openContinueOnAnotherDevice,
        ],
    );

    return (
        <ShareContext.Provider value={value}>{children}</ShareContext.Provider>
    );
}
