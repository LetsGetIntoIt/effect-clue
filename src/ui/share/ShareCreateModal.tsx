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
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
    shareCreateStarted,
    shareCreated,
    shareLinkCopied,
} from "../../analytics/events";
import { CARD_SETS } from "../../logic/GameSetup";
import type { GameSession } from "../../logic/Persistence";
import { createShare } from "../../server/actions/shares";
import { useClue } from "../state";
import { useAccountContext } from "../account/AccountProvider";
import { XIcon } from "../components/Icons";

const SHARE_BASE_PATH = "/share/";

interface ToggleState {
    cardPack: boolean;
    players: boolean;
    knownCards: boolean;
    suggestions: boolean;
}

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
}: {
    readonly open: boolean;
    readonly onClose: () => void;
}) {
    const t = useTranslations("share");
    const tCommon = useTranslations("common");
    const { state, derived } = useClue();
    const { openModal: openAccountModal } = useAccountContext();
    const [toggles, setToggles] = useState<ToggleState>({
        cardPack: true,
        players: true,
        knownCards: false,
        suggestions: false,
    });
    const [submitting, setSubmitting] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onCreate = async (): Promise<void> => {
        setSubmitting(true);
        setError(null);
        const session: GameSession = {
            setup: state.setup,
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
                setError(t("errorSignInRequired"));
                openAccountModal();
            } else {
                setError(t("errorGeneric"));
            }
        } finally {
            setSubmitting(false);
        }
    };

    const close = (): void => {
        setCopied(false);
        setError(null);
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
                            {t("createTitle")}
                        </Dialog.Title>
                        <Dialog.Close
                            aria-label={tCommon("close")}
                            className="-mt-1 -mr-1 cursor-pointer rounded-[var(--radius)] border-none bg-transparent p-1 text-[#2a1f12] hover:bg-hover"
                        >
                            <XIcon size={18} />
                        </Dialog.Close>
                    </div>
                    <Dialog.Description className="px-5 pt-3 text-[14px] leading-relaxed">
                        {t("createDescription")}
                    </Dialog.Description>
                    <div className="flex flex-col gap-2 px-5 pt-3 text-[14px]">
                        <Toggle
                            label={t("toggleCardPack")}
                            checked={toggles.cardPack}
                            onChange={(v) =>
                                setToggles((t) => ({ ...t, cardPack: v }))
                            }
                        />
                        <Toggle
                            label={t("togglePlayers")}
                            checked={toggles.players}
                            onChange={(v) =>
                                setToggles((t) => ({
                                    ...t,
                                    players: v,
                                    knownCards: v ? t.knownCards : false,
                                    suggestions: v ? t.suggestions : false,
                                }))
                            }
                        />
                        <Toggle
                            label={t("toggleKnownCards")}
                            checked={toggles.knownCards}
                            disabled={!toggles.players}
                            disabledHint={t("requiresPlayers")}
                            onChange={(v) =>
                                setToggles((t) => ({ ...t, knownCards: v }))
                            }
                        />
                        <Toggle
                            label={t("toggleSuggestions")}
                            checked={toggles.suggestions}
                            disabled={!toggles.players}
                            disabledHint={t("requiresPlayers")}
                            onChange={(v) =>
                                setToggles((t) => ({ ...t, suggestions: v }))
                            }
                        />
                    </div>
                    {error !== null ? (
                        <div className="px-5 pt-3 text-[13px] text-danger">
                            {error}
                        </div>
                    ) : null}
                    <div className="mt-4 flex items-center justify-end gap-2 border-t border-border bg-panel px-5 pt-4 pb-5">
                        <button
                            type="button"
                            onClick={close}
                            className="cursor-pointer rounded-[var(--radius)] border border-border bg-white px-4 py-2 text-[14px] hover:bg-hover"
                        >
                            {tCommon("cancel")}
                        </button>
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
                                    : t("createAndCopy")}
                        </button>
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
                checked={disabled === true ? false : checked}
                onChange={(e) => onChange(e.target.checked)}
                disabled={disabled === true}
                className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-not-allowed"
            />
            <span>{label}</span>
        </label>
    );
}
