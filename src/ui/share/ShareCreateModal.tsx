/**
 * Sender-side share modal — three flows in one component (M22).
 *
 * Variants:
 *   - "pack"      — share a card pack only. Entries: card pack row in
 *                   setup, per-pack share in the picker.
 *   - "invite"    — invite a friend to play this game. Sends pack +
 *                   players + hand sizes. Optional checkbox includes
 *                   suggestions+accusations when the user has logged
 *                   any. Entries: setup pane, overflow menu.
 *   - "transfer"  — move this game to another device. Sends
 *                   everything (pack + players + hand sizes + known
 *                   cards + suggestions + accusations). Renders the
 *                   privacy warning. Entry: overflow menu only.
 *
 * Universal sign-in: the server requires every share to have an
 * authenticated, non-anonymous owner regardless of variant. The CTA
 * reads "Sign in or create account to share" for anonymous users and
 * "Copy link" otherwise. The inline sign-in slide + auto-retry-after-
 * sign-in (`pendingRetryRef`) is preserved across all three variants.
 *
 * Wire format: encodes each non-null sub-slice via Effect Schema
 * codecs (`src/logic/ShareCodec.ts`) so the receiver and the server
 * both validate identical shapes. The server is the discriminator —
 * it accepts a `kind`-tagged input and writes only the columns
 * appropriate for that kind, preventing a malicious client from
 * smuggling private fields under a benign-looking kind.
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Schema } from "effect";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
    shareCreateStarted,
    shareCreated,
    shareLinkCopied,
} from "../../analytics/events";
import {
    cardSetEquals,
    type CardSet,
} from "../../logic/CardSet";
import { CARD_SETS } from "../../logic/GameSetup";
import type { GameSession } from "../../logic/Persistence";
import {
    accusationCards,
} from "../../logic/Accusation";
import {
    suggestionCards,
    suggestionNonRefuters,
} from "../../logic/Suggestion";
import {
    accusationsCodec,
    cardPackCodec,
    handSizesCodec,
    knownCardsCodec,
    playersCodec,
    suggestionsCodec,
} from "../../logic/ShareCodec";
import {
    createShare,
    type CreateShareInput,
} from "../../server/actions/shares";
import { useClue } from "../state";
import { sessionQueryKey, useSession } from "../hooks/useSession";
import { DevSignInForm } from "../account/DevSignInForm";
import { T_STANDARD, useReducedTransition } from "../motion";
import { XIcon } from "../components/Icons";

const isDev = process.env.NODE_ENV === "development";

// Wire-format constants — exempt from i18next/no-literal-string.
const SOCIAL_SIGN_IN_PROVIDER = "google";
const SOCIAL_SIGN_IN_PATH = "/api/auth/sign-in/social";

// Module-scope step / variant discriminators (flow-control values, not
// user-facing copy — exempt from i18next literal lint).
const STEP_TOGGLES = "toggles" as const;
const STEP_SIGN_IN = "signIn" as const;
type Step = typeof STEP_TOGGLES | typeof STEP_SIGN_IN;
const PRESENCE_WAIT_MODE = "wait" as const;
const SHARE_BASE_PATH = "/share/";

const VARIANT_PACK = "pack" as const;
const VARIANT_INVITE = "invite" as const;
const VARIANT_TRANSFER = "transfer" as const;
export type ShareVariant =
    | typeof VARIANT_PACK
    | typeof VARIANT_INVITE
    | typeof VARIANT_TRANSFER;

// i18n keys per variant. Kept in module-scope const objects so the
// no-literal-string lint can ignore them (the rule treats top-of-
// module string constants as wire identifiers, not user copy).
const TITLE_KEY_FOR: Record<ShareVariant, string> = {
    [VARIANT_PACK]: "packTitle",
    [VARIANT_INVITE]: "inviteTitle",
    [VARIANT_TRANSFER]: "transferTitle",
};
const DESCRIPTION_KEY_FOR: Record<ShareVariant, string> = {
    [VARIANT_PACK]: "packDescription",
    [VARIANT_INVITE]: "inviteDescription",
    [VARIANT_TRANSFER]: "transferDescription",
};
const SIGN_IN_TITLE_KEY = "signInTitle";
const SIGN_IN_DESCRIPTION_KEY = "signInDescription";
const TRANSFER_WARNING_KEY = "transferWarning";
const INVITE_INCLUDE_PROGRESS_BOTH_KEY = "inviteIncludeProgressBoth";
const INVITE_INCLUDE_PROGRESS_SUGGESTIONS_ONLY_KEY =
    "inviteIncludeProgressSuggestionsOnly";
const INVITE_INCLUDE_PROGRESS_ACCUSATIONS_ONLY_KEY =
    "inviteIncludeProgressAccusationsOnly";

/**
 * Pick the right "include progress" checkbox label key for a given
 * (suggestionsCount, accusationsCount). Returns null when there's
 * nothing to include — the checkbox should be hidden in that case.
 *
 * The split into three keys (vs. ICU plural / multi-arg interpolation)
 * keeps each label short and readable in every condition. Pure
 * function for unit-testability — see ShareCreateModal.test.tsx.
 */
export const pickProgressLabelKey = (
    suggestionsCount: number,
    accusationsCount: number,
): {
    key: string;
    values: Record<string, number>;
} | null => {
    if (suggestionsCount > 0 && accusationsCount > 0) {
        return {
            key: INVITE_INCLUDE_PROGRESS_BOTH_KEY,
            values: {
                suggestions: suggestionsCount,
                accusations: accusationsCount,
            },
        };
    }
    if (suggestionsCount > 0) {
        return {
            key: INVITE_INCLUDE_PROGRESS_SUGGESTIONS_ONLY_KEY,
            values: { count: suggestionsCount },
        };
    }
    if (accusationsCount > 0) {
        return {
            key: INVITE_INCLUDE_PROGRESS_ACCUSATIONS_ONLY_KEY,
            values: { count: accusationsCount },
        };
    }
    return null;
};
const PACK_INCLUDES_HEADER_KEY = "packIncludesHeader";
const PACK_CATEGORY_ITEM_KEY = "packCategoryItem";
const COPIED_KEY = "copied";
const CREATING_KEY = "creating";
const SIGN_IN_TO_SHARE_KEY = "signInToShare";
const COPY_LINK_KEY = "copyLink";
const COPY_FALLBACK_KEY = "copyFallback";
const ERROR_GENERIC_KEY = "errorGeneric";
const LINK_EXPIRES_IN_KEY = "linkExpiresIn";
const TTL_KEY = "ttl";

const ERR_SIGN_IN_REQUIRED_MSG = "sign_in_required_to_share";

/**
 * Resolve the user-facing label for a `CardSet`. Built-in packs match
 * by structural equality against `CARD_SETS` (the wire format doesn't
 * carry the built-in id, so we re-derive it). Custom packs fall back
 * to the supplied `customLabel` (the modal's caller knows it from
 * context — picker passes the picked pack's label, etc.).
 */
const resolvePackLabel = (
    cardSet: CardSet,
    customLabel: string | undefined,
): { label: string; isCustom: boolean } => {
    const builtIn = CARD_SETS.find((s) =>
        cardSetEquals(cardSet, s.cardSet),
    );
    if (builtIn) return { label: builtIn.label, isCustom: false };
    return { label: customLabel ?? "", isCustom: true };
};

/**
 * Project a domain `CardSet` to the wire shape (`CardSetSchema`),
 * preserving branded ids — the codec accepts the branded form on
 * encode, so we feed it values that already match `CardSetSchema`'s
 * `Type` field. The optional `name` rides along when the caller
 * knows the pack's user-facing label so the receive modal can render
 * it.
 */
const projectCardSet = (cardSet: CardSet, packName: string | undefined) => ({
    ...(packName !== undefined && packName !== ""
        ? { name: packName }
        : {}),
    categories: cardSet.categories.map((c) => ({
        id: c.id,
        name: c.name,
        cards: c.cards.map((card) => ({ id: card.id, name: card.name })),
    })),
});

/**
 * Project a `Suggestion` (Data.Class with HashSet fields) to the
 * persisted suggestion schema shape. Brands stay intact so the codec
 * round-trips cleanly into `Player` / `Card`.
 */
const projectSuggestion = (s: GameSession["suggestions"][number]) => ({
    ...(s.id !== undefined ? { id: s.id } : {}),
    suggester: s.suggester,
    cards: suggestionCards(s),
    nonRefuters: suggestionNonRefuters(s),
    refuter: s.refuter ?? null,
    seenCard: s.seenCard ?? null,
    loggedAt: s.loggedAt,
});

const projectAccusation = (a: GameSession["accusations"][number]) => ({
    ...(a.id !== undefined ? { id: a.id } : {}),
    accuser: a.accuser,
    cards: accusationCards(a),
    loggedAt: a.loggedAt,
});

/**
 * Build the wire payload for a `pack` share — pack only, no game
 * state. Used by the card-pack-row and per-pack-picker entries.
 */
const buildPackInput = (
    cardSet: CardSet,
    packName: string | undefined,
): CreateShareInput => ({
    kind: VARIANT_PACK,
    cardPackData: Schema.encodeSync(cardPackCodec)(
        projectCardSet(cardSet, packName),
    ),
});

/**
 * Build the wire payload for an `invite` share — pack + players +
 * hand sizes, with optional suggestions/accusations when the user
 * checked the "include progress" box (and there's progress to ship).
 */
const buildInviteInput = (
    session: GameSession,
    packName: string | undefined,
    includeProgress: boolean,
): CreateShareInput => {
    const playerSlice = session.setup.players;
    return {
        kind: VARIANT_INVITE,
        cardPackData: Schema.encodeSync(cardPackCodec)(
            projectCardSet(session.setup.cardSet, packName),
        ),
        playersData: Schema.encodeSync(playersCodec)(playerSlice),
        handSizesData: Schema.encodeSync(handSizesCodec)(session.handSizes),
        ...(includeProgress
            ? {
                  suggestionsData: Schema.encodeSync(suggestionsCodec)(
                      session.suggestions.map(projectSuggestion),
                  ),
                  accusationsData: Schema.encodeSync(accusationsCodec)(
                      session.accusations.map(projectAccusation),
                  ),
              }
            : {}),
    };
};

/**
 * Build the wire payload for a `transfer` share — everything,
 * including known cards. Same projection as invite plus knownCards.
 */
const buildTransferInput = (
    session: GameSession,
    packName: string | undefined,
): CreateShareInput => ({
    kind: VARIANT_TRANSFER,
    cardPackData: Schema.encodeSync(cardPackCodec)(
        projectCardSet(session.setup.cardSet, packName),
    ),
    playersData: Schema.encodeSync(playersCodec)(session.setup.players),
    handSizesData: Schema.encodeSync(handSizesCodec)(session.handSizes),
    knownCardsData: Schema.encodeSync(knownCardsCodec)(session.hands),
    suggestionsData: Schema.encodeSync(suggestionsCodec)(
        session.suggestions.map(projectSuggestion),
    ),
    accusationsData: Schema.encodeSync(accusationsCodec)(
        session.accusations.map(projectAccusation),
    ),
});

interface ShareCreateModalProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly variant: ShareVariant;
    /**
     * Override pack used by `pack` variant when opened from the picker
     * (so the share contains that specific pack, not whatever's in the
     * live setup). Has no effect for invite / transfer variants —
     * those always reflect the live game.
     */
    readonly forcedCardPack?: CardSet;
    /**
     * Display label for the forced pack (or the active live pack when
     * known by the caller). Embedded in the wire payload so the
     * receiver can render the pack's name.
     */
    readonly forcedCardPackLabel?: string;
}

export function ShareCreateModal({
    open,
    onClose,
    variant,
    forcedCardPack,
    forcedCardPackLabel,
}: ShareCreateModalProps) {
    const t = useTranslations("share");
    const tCommon = useTranslations("common");
    const tAccount = useTranslations("account");
    const { state, derived } = useClue();
    const queryClient = useQueryClient();
    const session = useSession();
    const transition = useReducedTransition(T_STANDARD);
    const [step, setStep] = useState<Step>(STEP_TOGGLES);
    const [direction, setDirection] = useState<1 | -1>(1);
    const pendingRetryRef = useRef(false);
    // Optional "include progress" checkbox in the invite variant.
    // Re-seeded on each open so the prior session's choice doesn't
    // bleed into a fresh modal mount.
    const [includeProgress, setIncludeProgress] = useState(false);
    const prevOpenRef = useRef(open);
    useEffect(() => {
        if (open && !prevOpenRef.current) {
            setIncludeProgress(false);
        }
        prevOpenRef.current = open;
    }, [open]);
    const [submitting, setSubmitting] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // The pack the share will contain. Picker entry overrides; setup
    // and overflow-menu entries use the live setup's pack.
    const activeCardSet = forcedCardPack ?? state.setup.cardSet;
    const { label: activeCardSetLabel, isCustom: cardSetIsCustom } =
        resolvePackLabel(activeCardSet, forcedCardPackLabel);

    const suggestionsCount = derived.suggestionsAsData.length;
    const accusationsCount = derived.accusationsAsData.length;
    const progressLabel = pickProgressLabelKey(
        suggestionsCount,
        accusationsCount,
    );
    const showProgressToggle =
        variant === VARIANT_INVITE && progressLabel !== null;

    const needsSignIn =
        !session.data?.user || session.data.user.isAnonymous;

    const onCreate = async (): Promise<void> => {
        setSubmitting(true);
        setError(null);

        let payload: CreateShareInput;
        try {
            if (variant === VARIANT_PACK) {
                // Pack variant: only the pack ships. The forcedCardPack
                // path (per-pack share from picker) overrides the live
                // setup pack — the share contains the picked pack, not
                // whatever's currently loaded.
                payload = buildPackInput(activeCardSet, forcedCardPackLabel);
            } else {
                // Invite + transfer variants ship the live game's data.
                // forcedCardPack doesn't apply here — these flows only
                // open from setup-pane / overflow entries that work
                // against the live state. Branded ids stay branded
                // through to the codec so round-tripping `Player` /
                // `Card` doesn't require any type-level laundering.
                const hands = state.knownCards.reduce<
                    Array<{
                        player: GameSession["hands"][number]["player"];
                        cards: Array<
                            GameSession["hands"][number]["cards"][number]
                        >;
                    }>
                >((acc, kc) => {
                    const existing = acc.find((h) => h.player === kc.player);
                    if (existing) {
                        existing.cards.push(kc.card);
                        return acc;
                    }
                    return [...acc, { player: kc.player, cards: [kc.card] }];
                }, []);
                const gameSession: GameSession = {
                    setup: state.setup,
                    hands,
                    handSizes: state.handSizes.map(([player, size]) => ({
                        player,
                        size,
                    })),
                    suggestions: derived.suggestionsAsData,
                    accusations: derived.accusationsAsData,
                };
                if (variant === VARIANT_INVITE) {
                    payload = buildInviteInput(
                        gameSession,
                        forcedCardPackLabel,
                        includeProgress,
                    );
                } else {
                    payload = buildTransferInput(
                        gameSession,
                        forcedCardPackLabel,
                    );
                }
            }
        } catch {
            setSubmitting(false);
            setError(t(ERROR_GENERIC_KEY));
            return;
        }

        try {
            shareCreateStarted();
            const result = await createShare(payload);
            shareCreated({
                kind: variant,
                packIsCustom: cardSetIsCustom,
                includesProgress:
                    variant === VARIANT_INVITE
                        ? includeProgress
                        : variant === VARIANT_TRANSFER,
            });
            const url =
                typeof window !== "undefined"
                    ? `${window.location.origin}${SHARE_BASE_PATH}${result.id}`
                    : `${SHARE_BASE_PATH}${result.id}`;
            try {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                    await navigator.clipboard.writeText(url);
                    shareLinkCopied();
                    setCopied(true);
                }
            } catch {
                if (typeof window !== "undefined") {
                    window.prompt(t(COPY_FALLBACK_KEY), url);
                }
            }
        } catch (e) {
            const msg = String(e);
            if (msg.includes(ERR_SIGN_IN_REQUIRED_MSG)) {
                pendingRetryRef.current = true;
                setError(null);
                setDirection(1);
                setStep(STEP_SIGN_IN);
            } else {
                setError(t(ERROR_GENERIC_KEY));
            }
        } finally {
            setSubmitting(false);
        }
    };

    /**
     * Slides back to the toggles step after a successful sign-in. If a
     * retry was pending (i.e. the user hit "Copy link" while anon and
     * got bumped here), re-fires the create flow without making the
     * user click again.
     */
    const onSignedIn = async (): Promise<void> => {
        await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
        setDirection(-1);
        setStep(STEP_TOGGLES);
        if (pendingRetryRef.current) {
            pendingRetryRef.current = false;
            await onCreate();
        }
    };

    const onGoogleSignIn = (): void => {
        if (typeof window !== "undefined") {
            const url =
                `${SOCIAL_SIGN_IN_PATH}?provider=${SOCIAL_SIGN_IN_PROVIDER}` +
                `&callbackURL=${encodeURIComponent(
                    window.location.pathname + window.location.search,
                )}`;
            window.location.href = url;
        }
    };

    const goBackToToggles = (): void => {
        pendingRetryRef.current = false;
        setDirection(-1);
        setStep(STEP_TOGGLES);
    };

    const close = (): void => {
        setCopied(false);
        setError(null);
        setStep(STEP_TOGGLES);
        setDirection(1);
        pendingRetryRef.current = false;
        onClose();
    };

    const titleKey = TITLE_KEY_FOR[variant];
    const descriptionKey = DESCRIPTION_KEY_FOR[variant];

    const ctaLabel = copied
        ? t(COPIED_KEY)
        : submitting
            ? t(CREATING_KEY)
            : needsSignIn
                ? t(SIGN_IN_TO_SHARE_KEY)
                : t(COPY_LINK_KEY);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
                <Dialog.Content
                    className={
                        "fixed left-1/2 top-1/2 z-50 flex w-[min(92vw,480px)] flex-col " +
                        "-translate-x-1/2 -translate-y-1/2 rounded-[var(--radius)] border border-border " +
                        "bg-panel shadow-[0_10px_28px_rgba(0,0,0,0.28)] focus:outline-none"
                    }
                >
                    <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
                        <Dialog.Title className="m-0 font-display text-[20px] text-accent">
                            {step === STEP_TOGGLES
                                ? t(titleKey)
                                : t(SIGN_IN_TITLE_KEY)}
                        </Dialog.Title>
                        <Dialog.Close
                            aria-label={tCommon("close")}
                            className="-mt-1 -mr-1 cursor-pointer rounded-[var(--radius)] border-none bg-transparent p-1 text-[#2a1f12] hover:bg-hover"
                        >
                            <XIcon size={18} />
                        </Dialog.Close>
                    </div>
                    <div className="relative grid grid-cols-[minmax(0,1fr)] [grid-template-areas:'stack'] overflow-hidden">
                        <AnimatePresence custom={direction} initial={false} mode={PRESENCE_WAIT_MODE}>
                            {step === STEP_TOGGLES ? (
                                <motion.div
                                    key="toggles"
                                    custom={direction}
                                    initial={{ x: direction * 40, opacity: 0 }}
                                    animate={{ x: 0, opacity: 1 }}
                                    exit={{ x: -direction * 40, opacity: 0 }}
                                    transition={transition}
                                    className="[grid-area:stack] min-w-0"
                                >
                                    <Dialog.Description className="px-5 pt-3 text-[14px] leading-relaxed">
                                        {t(descriptionKey)}
                                    </Dialog.Description>
                                    {variant === VARIANT_PACK ? (
                                        <div
                                            className="mx-5 mt-3 rounded-[var(--radius)] border border-border bg-white px-3 py-2 text-[13px] leading-snug"
                                            data-share-pack-details
                                        >
                                            <div className="font-semibold text-accent">
                                                {activeCardSetLabel}
                                            </div>
                                            <div className="mt-1 text-[12px] text-muted">
                                                {t(PACK_INCLUDES_HEADER_KEY)}
                                            </div>
                                            <ul className="m-0 mt-1 list-disc pl-5">
                                                {activeCardSet.categories.map(
                                                    (cat) => (
                                                        <li key={cat.id}>
                                                            {t(
                                                                PACK_CATEGORY_ITEM_KEY,
                                                                {
                                                                    category:
                                                                        cat.name,
                                                                    count:
                                                                        cat.cards
                                                                            .length,
                                                                },
                                                            )}
                                                        </li>
                                                    ),
                                                )}
                                            </ul>
                                        </div>
                                    ) : null}
                                    {variant === VARIANT_TRANSFER ? (
                                        <div
                                            className="mx-5 mt-3 rounded-[var(--radius)] border border-danger bg-danger/10 px-3 py-2 text-[13px] leading-snug text-danger"
                                            data-share-transfer-warning
                                        >
                                            {t(TRANSFER_WARNING_KEY)}
                                        </div>
                                    ) : null}
                                    {showProgressToggle && progressLabel ? (
                                        <div className="px-5 pt-4 text-[14px]">
                                            <label className="flex cursor-pointer items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={includeProgress}
                                                    onChange={(e) =>
                                                        setIncludeProgress(
                                                            e.target.checked,
                                                        )
                                                    }
                                                    className="h-4 w-4 cursor-pointer accent-accent"
                                                />
                                                <span>
                                                    {t(
                                                        progressLabel.key,
                                                        progressLabel.values,
                                                    )}
                                                </span>
                                            </label>
                                        </div>
                                    ) : null}
                                    {error !== null ? (
                                        <div className="px-5 pt-3 text-[13px] text-danger">
                                            {error}
                                        </div>
                                    ) : null}
                                    {copied ? (
                                        <div className="px-5 pt-3 text-[12px] text-muted">
                                            {t(LINK_EXPIRES_IN_KEY, { duration: t(TTL_KEY) })}
                                        </div>
                                    ) : null}
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="signIn"
                                    custom={direction}
                                    initial={{ x: direction * 40, opacity: 0 }}
                                    animate={{ x: 0, opacity: 1 }}
                                    exit={{ x: -direction * 40, opacity: 0 }}
                                    transition={transition}
                                    className="[grid-area:stack] min-w-0"
                                >
                                    <Dialog.Description className="px-5 pt-3 text-[14px] leading-relaxed">
                                        {t(SIGN_IN_DESCRIPTION_KEY)}
                                    </Dialog.Description>
                                    <div className="flex flex-col gap-2 px-5 pt-4 pb-2">
                                        <button
                                            type="button"
                                            onClick={onGoogleSignIn}
                                            className="cursor-pointer rounded-[var(--radius)] border-2 border-accent bg-accent px-4 py-2 text-[14px] font-semibold text-white hover:bg-accent-hover"
                                        >
                                            {tAccount("signInWithGoogle")}
                                        </button>
                                        {isDev ? (
                                            <DevSignInForm onSignedIn={() => void onSignedIn()} />
                                        ) : null}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    <div className="mt-4 flex items-center justify-end gap-2 border-t border-border bg-panel px-5 pt-4 pb-5">
                        {step === STEP_SIGN_IN ? (
                            <button
                                type="button"
                                onClick={goBackToToggles}
                                className="mr-auto cursor-pointer rounded-[var(--radius)] border border-border bg-white px-4 py-2 text-[14px] hover:bg-hover"
                            >
                                {tCommon("back")}
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={close}
                            className="cursor-pointer rounded-[var(--radius)] border border-border bg-white px-4 py-2 text-[14px] hover:bg-hover"
                        >
                            {tCommon("cancel")}
                        </button>
                        {step === STEP_TOGGLES ? (
                            <button
                                type="button"
                                onClick={() => void onCreate()}
                                disabled={submitting}
                                className="cursor-pointer rounded-[var(--radius)] border-2 border-accent bg-accent px-4 py-2 text-[14px] font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                                data-share-cta
                            >
                                {ctaLabel}
                            </button>
                        ) : null}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
