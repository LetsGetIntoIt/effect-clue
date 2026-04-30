/**
 * Sender-side share-creation modal. Lets the user pick which
 * sections of their current game to include, then calls the
 * `createShare` server action and copies the resulting
 * `https://winclue.vercel.app/share/{id}` URL to the clipboard.
 *
 * Toggle dependencies:
 *   - `players + hand sizes` is independent.
 *   - `known cards` and `suggestions + accusations` each
 *     independently can be on/off, BUT each is force-disabled
 *     when `players + hand sizes` is off (the references inside
 *     them would be orphaned without the player set).
 *   - `card pack` is fully independent.
 *
 * Custom-pack shares require sign-in: the server action throws
 * `Error("sign_in_required_for_custom_pack_share")` if a
 * non-built-in pack is included without a logged-in user; the
 * UI catches that and surfaces a "Sign in to share this pack"
 * affordance that opens the Account modal.
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
    shareCreateStarted,
    shareCreated,
    shareLinkCopied,
} from "../../analytics/events";
import type { CardSet } from "../../logic/CardSet";
import { CARD_SETS, GameSetup } from "../../logic/GameSetup";
import type { GameSession } from "../../logic/Persistence";
import { createShare } from "../../server/actions/shares";
import { useClue } from "../state";
import { sessionQueryKey, useSession } from "../hooks/useSession";
import { DevSignInForm } from "../account/DevSignInForm";
import { T_STANDARD, useReducedTransition } from "../motion";
import { XIcon } from "../components/Icons";

const isDev = process.env.NODE_ENV === "development";

// Wire-format constants — exempt from i18next/no-literal-string.
const SOCIAL_SIGN_IN_PROVIDER = "google";
const SOCIAL_SIGN_IN_PATH = "/api/auth/sign-in/social";

// Module-scope step discriminators — exempt from
// `i18next/no-literal-string` because they're flow-control values,
// not user-facing copy.
const STEP_TOGGLES = "toggles" as const;
const STEP_SIGN_IN = "signIn" as const;
type Step = typeof STEP_TOGGLES | typeof STEP_SIGN_IN;
// Framer presence-mode literal needed by the wizard's slide.
const PRESENCE_WAIT_MODE = "wait" as const;

const SHARE_BASE_PATH = "/share/";

export interface ShareToggleState {
    cardPack: boolean;
    players: boolean;
    knownCards: boolean;
    suggestions: boolean;
}

type ToggleState = ShareToggleState;

const DEFAULT_TOGGLES: ToggleState = {
    cardPack: true,
    players: true,
    knownCards: false,
    suggestions: false,
};

const sessionToShareInputs = (
    session: GameSession,
    toggles: ToggleState,
): {
    cardPackData: string | null;
    playersData: string | null;
    handSizesData: string | null;
    knownCardsData: string | null;
    suggestionsData: string | null;
    accusationsData: string | null;
    cardPackIsCustom: boolean;
} => {
    const builtInIds = new Set(CARD_SETS.map((s) => s.id));
    const cardPackIsCustom =
        toggles.cardPack &&
        !builtInIds.has((session.setup.cardSet as { id?: string }).id ?? "");

    return {
        cardPackData: toggles.cardPack
            ? JSON.stringify(session.setup.cardSet)
            : null,
        playersData: toggles.players
            ? JSON.stringify(session.setup.players)
            : null,
        handSizesData: toggles.players
            ? JSON.stringify(session.handSizes)
            : null,
        knownCardsData:
            toggles.players && toggles.knownCards
                ? JSON.stringify(session.hands)
                : null,
        suggestionsData:
            toggles.players && toggles.suggestions
                ? JSON.stringify(session.suggestions)
                : null,
        accusationsData:
            toggles.players && toggles.suggestions
                ? JSON.stringify(session.accusations)
                : null,
        cardPackIsCustom,
    };
};

export function ShareCreateModal({
    open,
    onClose,
    initialToggles,
    forcedCardPack,
}: {
    readonly open: boolean;
    readonly onClose: () => void;
    /**
     * Partial override of the default toggle state — useful when
     * the modal is opened from a context that wants to prefill
     * a subset (e.g. "Share this setup" prefills cardPack + players).
     */
    readonly initialToggles?: Partial<ShareToggleState>;
    /**
     * If provided, the share's `cardPackData` snapshot uses THIS
     * card set rather than the live `state.setup.cardSet`. Used by
     * per-pack share buttons so the share contains the picked pack
     * regardless of what's currently loaded in setup.
     */
    readonly forcedCardPack?: CardSet;
}) {
    const t = useTranslations("share");
    const tCommon = useTranslations("common");
    const tAccount = useTranslations("account");
    const { state, derived } = useClue();
    const queryClient = useQueryClient();
    const session = useSession();
    const transition = useReducedTransition(T_STANDARD);
    const [step, setStep] = useState<Step>(STEP_TOGGLES);
    // The wizard direction picks the slide axis: forward goes
    // right→left, back goes the other way. Tracked separately
    // from `step` so the same Framer variants work both ways.
    const [direction, setDirection] = useState<1 | -1>(1);
    // Captures whether the user's last attempt was blocked by
    // sign-in-required so we can auto-retry create after they sign
    // in, without forcing them to click "Create" again.
    const pendingRetryRef = useRef(false);
    // Re-seed toggles every time the modal opens so a per-pack
    // entry doesn't carry over its prefill into a later
    // generic "Share game" click. The parent updates
    // `initialToggles` synchronously with `setOpen(true)`, so the
    // first render where `open === true` already has the right
    // value to read.
    const [toggles, setToggles] = useState<ToggleState>(() => ({
        ...DEFAULT_TOGGLES,
        ...initialToggles,
    }));
    const prevOpenRef = useRef(open);
    useEffect(() => {
        if (open && !prevOpenRef.current) {
            setToggles({ ...DEFAULT_TOGGLES, ...initialToggles });
        }
        prevOpenRef.current = open;
    }, [open, initialToggles]);
    const [submitting, setSubmitting] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onCreate = async (): Promise<void> => {
        setSubmitting(true);
        setError(null);
        const session: GameSession = {
            // When `forcedCardPack` is provided, the share contains
            // that specific pack — used by per-pack share buttons.
            // The rest of the session (players, hands, suggestions)
            // still comes from the live state because pack-only
            // shares typically have `players: false` in their
            // toggles anyway. `GameSetup({...})` rebuilds the impl
            // (which derives `players` and `categories` from the
            // split inputs), so type-shape stays right.
            setup: forcedCardPack
                ? GameSetup({
                      cardSet: forcedCardPack,
                      playerSet: state.setup.playerSet,
                  })
                : state.setup,
            hands: state.knownCards.reduce<
                Array<{ player: string; cards: ReadonlyArray<string> }>
            >((acc, kc) => {
                const player = String(kc.player);
                const card = String(kc.card);
                const existing = acc.find((h) => h.player === player);
                if (existing) {
                    return acc.map((h) =>
                        h.player === player
                            ? { player: h.player, cards: [...h.cards, card] }
                            : h,
                    );
                }
                return [...acc, { player, cards: [card] }];
            }, []) as unknown as GameSession["hands"],
            handSizes: state.handSizes.map(([player, size]) => ({
                player,
                size,
            })),
            suggestions: derived.suggestionsAsData,
            accusations: derived.accusationsAsData,
        };
        const inputs = sessionToShareInputs(session, toggles);
        try {
            shareCreateStarted();
            const result = await createShare({
                cardPackData: inputs.cardPackData,
                playersData: inputs.playersData,
                handSizesData: inputs.handSizesData,
                knownCardsData: inputs.knownCardsData,
                suggestionsData: inputs.suggestionsData,
                accusationsData: inputs.accusationsData,
                cardPackIsCustom: inputs.cardPackIsCustom,
            });
            shareCreated({
                includedPack: toggles.cardPack,
                includedPlayers: toggles.players,
                includedKnownCards: toggles.knownCards,
                includedSuggestions: toggles.suggestions,
                packIsCustom: inputs.cardPackIsCustom,
                requiresAuth: inputs.cardPackIsCustom,
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
                // Clipboard write failed (e.g. permission denied) —
                // fall back to a prompt.
                if (typeof window !== "undefined") {
                    window.prompt(t("copyFallback"), url);
                }
            }
        } catch (e) {
            const msg = String(e);
            if (msg.includes("sign_in_required_for_custom_pack_share")) {
                // Slide to the inline sign-in step instead of stacking
                // an Account modal on top of this one. After the user
                // signs in, we auto-retry createShare from where they
                // left off — pendingRetryRef carries the intent across
                // the step transition.
                pendingRetryRef.current = true;
                setError(null);
                setDirection(1);
                setStep(STEP_SIGN_IN);
            } else {
                setError(t("errorGeneric"));
            }
        } finally {
            setSubmitting(false);
        }
    };

    /**
     * Called once the user has successfully completed the inline
     * sign-in step. Slides back to step 1 and, if a retry is pending
     * (i.e. they got bumped here by a sign-in-required error), re-runs
     * the create flow with the same toggles.
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

    /**
     * Whether the create button should advertise that sign-in is
     * required up front. Lazy heuristic: any non-built-in cardSet
     * counts as custom; if the user is anonymous, the create attempt
     * will need a sign-in first. We surface that in the CTA copy so
     * users aren't surprised by the slide.
     */
    const builtInIds = new Set(CARD_SETS.map(s => s.id));
    const activeCardSet =
        forcedCardPack ?? state.setup.cardSet;
    const cardSetIsCustom = !builtInIds.has(
        (activeCardSet as { id?: string }).id ?? "",
    );
    const needsSignIn =
        toggles.cardPack &&
        cardSetIsCustom &&
        (!session.data?.user || session.data.user.isAnonymous);

    const close = (): void => {
        setCopied(false);
        setError(null);
        setStep(STEP_TOGGLES);
        setDirection(1);
        pendingRetryRef.current = false;
        onClose();
    };

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
                                ? t("createTitle")
                                : t("signInTitle")}
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
                                        {t("createDescriptionLead")}
                                    </Dialog.Description>
                                    <ul className="m-0 list-disc px-5 pt-1 pl-9 text-[13px] text-muted">
                                        <li>{t("archetypePack")}</li>
                                        <li>{t("archetypeInProgress")}</li>
                                        <li>{t("archetypeSolved")}</li>
                                    </ul>
                                    <div className="flex flex-col gap-2 px-5 pt-3 text-[14px]">
                                        <Toggle
                                            label={t("toggleCardPack")}
                                            checked={toggles.cardPack}
                                            disabled={toggles.players}
                                            disabledHint={t("requiresCardPackForPlayers")}
                                            onChange={v =>
                                                setToggles(prev => ({ ...prev, cardPack: v }))
                                            }
                                        />
                                        <Toggle
                                            label={t("togglePlayers")}
                                            checked={toggles.players}
                                            onChange={v =>
                                                setToggles(prev => ({
                                                    ...prev,
                                                    players: v,
                                                    cardPack: v ? true : prev.cardPack,
                                                    knownCards: v ? prev.knownCards : false,
                                                    suggestions: v ? prev.suggestions : false,
                                                }))
                                            }
                                        />
                                        <Toggle
                                            label={t("toggleKnownCards")}
                                            checked={toggles.knownCards}
                                            disabled={!toggles.players}
                                            disabledHint={t("requiresPlayers")}
                                            onChange={v =>
                                                setToggles(prev => ({
                                                    ...prev,
                                                    knownCards: v,
                                                }))
                                            }
                                        />
                                        <Toggle
                                            label={t("toggleSuggestions")}
                                            checked={toggles.suggestions}
                                            disabled={!toggles.players}
                                            disabledHint={t("requiresPlayers")}
                                            onChange={v =>
                                                setToggles(prev => ({
                                                    ...prev,
                                                    suggestions: v,
                                                }))
                                            }
                                        />
                                    </div>
                                    {error !== null ? (
                                        <div className="px-5 pt-3 text-[13px] text-danger">
                                            {error}
                                        </div>
                                    ) : null}
                                    {copied ? (
                                        <div className="px-5 pt-3 text-[12px] text-muted">
                                            {t("linkExpiresIn", { duration: t("ttl") })}
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
                                        {t("signInDescription")}
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
                            >
                                {copied
                                    ? t("copied")
                                    : submitting
                                        ? t("creating")
                                        : needsSignIn
                                            ? t("signInToShare")
                                            : t("createAndCopy")}
                            </button>
                        ) : null}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function Toggle({
    label,
    checked,
    disabled,
    disabledHint,
    onChange,
}: {
    readonly label: string;
    readonly checked: boolean;
    readonly disabled?: boolean;
    readonly disabledHint?: string;
    readonly onChange: (next: boolean) => void;
}) {
    return (
        <label
            className={
                "flex cursor-pointer items-center gap-2 " +
                (disabled === true ? "cursor-not-allowed opacity-50" : "")
            }
            title={disabled === true ? disabledHint : undefined}
        >
            <input
                type="checkbox"
                // Show the actual `checked` value even when
                // disabled — a "required-on" toggle (cardPack when
                // players is on) needs to read as checked-and-locked,
                // not as a phantom unchecked box.
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                disabled={disabled === true}
                className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-not-allowed"
            />
            <span>{label}</span>
        </label>
    );
}
