/**
 * Receiver-side import page (M22).
 *
 * Lands here when the sender shares a `https://winclue.vercel.app/share/{id}`
 * URL. The server route already fetched the snapshot; this client
 * component renders a summary on top of an SSR-rendered shell.
 *
 * UX (M22 redesign — was previously a 4-toggle pick-what-to-import
 * modal; users couldn't predict what each toggle would do, and the
 * actual hydration was a `// TODO` comment):
 *
 *   - Modal opens automatically. Header reads "A friend shared a
 *     Clue Solver game".
 *   - "Shared by {name}" appears for non-anonymous senders. Anonymous
 *     senders surface as no-attribution.
 *   - "This share includes:" + a bulleted list of what's in the link
 *     — pack name (with `(custom)` suffix when the pack isn't a
 *     built-in), player names + count, hand-size flag, and counts
 *     for known cards / suggestions / accusations.
 *   - One CTA — "Add to my game". Click → snapshot replaces the
 *     receiver's local game state and routes to `/play`.
 *   - Defensive empty-share branch (no card pack — unreachable from
 *     the new sender flows but possible for legacy / direct API
 *     calls): render an empty-state message + disable Import.
 */
"use client";

import { DateTime, Result, Schema } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
    shareImportDismissed,
    shareImported,
    shareOpened,
    shareImportStarted,
    signInFailed,
    signInStarted,
    type ShareDismissVia,
    type SignInFromContext,
} from "../../analytics/events";
import { cardSetEquals } from "../../logic/CardSet";
import { CARD_SETS } from "../../logic/GameSetup";
import { cardPackCodec, playersCodec } from "../../logic/ShareCodec";
import { customCardPacksQueryKey } from "../../data/customCardPacks";
import { cardPackUsageQueryKey } from "../../data/cardPackUsage";
import { authClient } from "../account/authClient";
import { useSession } from "../hooks/useSession";
import { XIcon } from "../components/Icons";
import { useConfirm } from "../hooks/useConfirm";
import { saveTourDismissed } from "../tour/TourState";
import {
    hasPersistedGameData,
    saveCardPackFromSnapshot,
    useApplyShareSnapshot,
    type RecognisedPackResult,
} from "./useApplyShareSnapshot";
import { hashShareId } from "./shareAnalytics";
import {
    consumePendingImportIntent,
    savePendingImportIntent,
} from "./pendingImport";

interface ShareSnapshot {
    readonly id: string;
    readonly cardPackData: string | null;
    readonly playersData: string | null;
    readonly handSizesData: string | null;
    readonly knownCardsData: string | null;
    readonly suggestionsData: string | null;
    readonly accusationsData: string | null;
    readonly hypothesesData: string | null;
    readonly selfPlayerIdData: string | null;
    readonly firstDealtPlayerIdData: string | null;
    readonly dismissedInsightsData: string | null;
    readonly hypothesisOrderData: string | null;
    readonly ownerName: string | null;
    readonly ownerIsAnonymous: boolean | null;
}

const VIA_X: ShareDismissVia = "x_button";
const VIA_BACKDROP: ShareDismissVia = "backdrop";

// Sign-in is now required to receive any share. The CTA on the
// receive modal kicks off Better Auth's social sign-in directly —
// there's no AccountProvider mounted on this route, so we don't
// reuse the AccountModal sign-in flow. After OAuth lands the user
// back here, an effect consumes a sessionStorage intent and auto-
// fires the import.
const SOCIAL_SIGN_IN_PROVIDER = "google" as const;
const SIGN_IN_FROM_RECEIVE: SignInFromContext = "share_import";

// How many player names to spell out in the "Players" bullet before
// collapsing the rest to "+N more". Mirrors the inline-name budget on
// the create side.
const PLAYER_NAMES_VISIBLE = 4;
const RECEIVE_FLOW_PACK = "pack";
const RECEIVE_FLOW_INVITE = "invite";
const RECEIVE_FLOW_TRANSFER = "transfer";

// Module-scope constants for the post-import navigation paths. Pack
// imports land the user on `/play` (default uiMode resolves to the
// setup wizard so they can build a fresh game with the new deck);
// invite / transfer imports skip setup — the share already configured
// the game — and land on `/play?view=checklist` directly. Hoisted so
// the `no-literal-string` lint rule treats them as wire identifiers.
const PLAY_PATH = "/play" as const;
const PLAY_CHECKLIST_PATH = "/play?view=checklist" as const;
const TOUR_SCREEN_SETUP = "setup" as const;
type ReceiveFlow =
    | typeof RECEIVE_FLOW_PACK
    | typeof RECEIVE_FLOW_INVITE
    | typeof RECEIVE_FLOW_TRANSFER;

const TITLE_KEY_FOR: Record<ReceiveFlow, string> = {
    [RECEIVE_FLOW_PACK]: "importModalTitlePack",
    [RECEIVE_FLOW_INVITE]: "importModalTitleInvite",
    [RECEIVE_FLOW_TRANSFER]: "importModalTitleTransfer",
};
const INCLUDES_HEADER_KEY_FOR: Record<ReceiveFlow, string> = {
    [RECEIVE_FLOW_PACK]: "importIncludesHeaderPack",
    [RECEIVE_FLOW_INVITE]: "importIncludesHeaderInvite",
    [RECEIVE_FLOW_TRANSFER]: "importIncludesHeaderTransfer",
};
const ACTION_KEY_FOR: Record<ReceiveFlow, string> = {
    [RECEIVE_FLOW_PACK]: "importActionPack",
    [RECEIVE_FLOW_INVITE]: "importActionInvite",
    [RECEIVE_FLOW_TRANSFER]: "importActionTransfer",
};
const PACK_NAMED_HEADER_KEY = "importIncludesHeaderPackNamed";

interface PackSummary {
    readonly label: string;
    readonly isCustom: boolean;
    readonly categories: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly count: number;
    }>;
    /** True when the snapshot has a card pack but we couldn't pull
     * a label out of it (the sender was on a really old version, or
     * the pack has a structural shape we don't recognise). The bullet
     * collapses to "Card pack (custom)" in that case. */
    readonly isUnnamedCustom: boolean;
}

const summarisePack = (cardPackData: string): PackSummary | null => {
    const decoded = Schema.decodeUnknownResult(cardPackCodec)(cardPackData);
    if (Result.isFailure(decoded)) return null;
    // Cross-reference structural equality against built-ins — the
    // wire format doesn't carry a built-in id, so we re-derive
    // membership here.
    const reconstructedCardSet = {
        categories: decoded.success.categories.map((c) => ({
            id: c.id,
            name: c.name,
            cards: c.cards.map((card) => ({ id: card.id, name: card.name })),
        })),
    };
    const builtIn = CARD_SETS.find((s) =>
        cardSetEquals(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            reconstructedCardSet as any,
            s.cardSet,
        ),
    );
    if (builtIn) {
        return {
            label: builtIn.label,
            isCustom: false,
            isUnnamedCustom: false,
            categories: decoded.success.categories.map((c) => ({
                id: c.id,
                name: c.name,
                count: c.cards.length,
            })),
        };
    }
    const wireName = decoded.success.name;
    if (wireName !== undefined && wireName !== "") {
        return {
            label: wireName,
            isCustom: true,
            isUnnamedCustom: false,
            categories: decoded.success.categories.map((c) => ({
                id: c.id,
                name: c.name,
                count: c.cards.length,
            })),
        };
    }
    return {
        label: "",
        isCustom: true,
        isUnnamedCustom: true,
        categories: decoded.success.categories.map((c) => ({
            id: c.id,
            name: c.name,
            count: c.cards.length,
        })),
    };
};

interface PlayersSummary {
    readonly count: number;
    readonly visibleNames: string;
    readonly extra: number;
}

const summarisePlayers = (
    playersData: string,
): PlayersSummary | null => {
    const decoded = Schema.decodeUnknownResult(playersCodec)(playersData);
    if (Result.isFailure(decoded)) return null;
    const players = decoded.success;
    const count = players.length;
    const visible = players
        .slice(0, PLAYER_NAMES_VISIBLE)
        .map((p) => String(p))
        .join(", ");
    return {
        count,
        visibleNames: visible,
        extra: Math.max(0, count - PLAYER_NAMES_VISIBLE),
    };
};

const countJsonArrayItems = (raw: string): number | null => {
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        return parsed.length;
    } catch {
        return null;
    }
};

const countKnownCards = (raw: string): number | null => {
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        let total = 0;
        for (const entry of parsed) {
            if (Array.isArray(entry?.cards)) total += entry.cards.length;
        }
        return total;
    } catch {
        return null;
    }
};

export function ShareImportPage({
    snapshot,
}: {
    readonly snapshot: ShareSnapshot;
}) {
    const t = useTranslations("share");
    const tToolbar = useTranslations("toolbar");
    const tCommon = useTranslations("common");
    const router = useRouter();
    const queryClient = useQueryClient();
    const session = useSession();
    const [open, setOpen] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const applySnapshot = useApplyShareSnapshot();
    const confirm = useConfirm();
    const isAnonymous =
        !session.data?.user || session.data.user.isAnonymous;

    const hasPack = snapshot.cardPackData !== null;
    const hasPlayers = snapshot.playersData !== null;
    const hasHandSizes = snapshot.handSizesData !== null;
    const hasKnown = snapshot.knownCardsData !== null;
    const hasSugg = snapshot.suggestionsData !== null;
    const hasAccu = snapshot.accusationsData !== null;
    const isEmpty = !hasPack && !hasPlayers;
    const receiveFlow: ReceiveFlow =
        !hasPlayers
            ? RECEIVE_FLOW_PACK
            : hasKnown || hasSugg || hasAccu
                ? RECEIVE_FLOW_TRANSFER
                : RECEIVE_FLOW_INVITE;

    const packSummary = useMemo(
        () => (hasPack ? summarisePack(snapshot.cardPackData!) : null),
        [hasPack, snapshot.cardPackData],
    );
    const playersSummary = useMemo(
        () => (hasPlayers ? summarisePlayers(snapshot.playersData!) : null),
        [hasPlayers, snapshot.playersData],
    );
    const knownCount = useMemo(
        () => (hasKnown ? countKnownCards(snapshot.knownCardsData!) : null),
        [hasKnown, snapshot.knownCardsData],
    );
    const suggCount = useMemo(
        () =>
            hasSugg ? countJsonArrayItems(snapshot.suggestionsData!) : null,
        [hasSugg, snapshot.suggestionsData],
    );
    const accuCount = useMemo(
        () =>
            hasAccu ? countJsonArrayItems(snapshot.accusationsData!) : null,
        [hasAccu, snapshot.accusationsData],
    );

    useEffect(() => {
        shareOpened({ shareIdHash: hashShareId(snapshot.id) });
    }, [snapshot.id]);

    /**
     * User-facing label of the just-saved-or-recognised pack. Used in
     * the "Card pack X saved" confirm dialog. Empty string when the
     * sender shipped an unnamed custom pack — the dialog falls back
     * to a label-free copy variant in that case.
     */
    const pickPackResultLabel = (result: RecognisedPackResult): string => {
        if (result.kind === "saved") return result.pack.label;
        if (result.kind === "recognised") return result.label;
        return "";
    };

    const performImport = async (): Promise<void> => {
        setSubmitting(true);
        shareImportStarted({ shareIdHash: hashShareId(snapshot.id) });
        try {
            if (receiveFlow === RECEIVE_FLOW_PACK) {
                const result = saveCardPackFromSnapshot(snapshot);
                await queryClient.invalidateQueries({
                    queryKey: customCardPacksQueryKey,
                });
                await queryClient.invalidateQueries({
                    queryKey: cardPackUsageQueryKey,
                });
                shareImported({
                    shareIdHash: hashShareId(snapshot.id),
                    hadPack: hasPack,
                    hadPlayers: hasPlayers,
                    hadKnownCards: hasKnown,
                    hadSuggestions: hasSugg,
                    triggeredNewGame: false,
                    savedPackToAccount: false,
                });
                // Pack-only flow: ask whether to start a new game with
                // the just-saved pack. Default focus on "Not now" (the
                // Radix AlertDialog auto-focuses Cancel) so a user
                // who just wanted to file the pack away doesn't
                // accidentally clear their in-progress game.
                const inProgress = hasPersistedGameData();
                const label = pickPackResultLabel(result);
                const baseMsg =
                    label !== ""
                        ? t("packSavedPrompt", { label })
                        : t("packSavedPromptUnnamed");
                const message = inProgress
                    ? `${baseMsg} ${tToolbar("newGameConfirm")}`
                    : baseMsg;
                const startNew = await confirm({
                    title:
                        label !== ""
                            ? t("packSavedTitle", { label })
                            : t("packSavedTitleUnnamed"),
                    message,
                    cancelLabel: tCommon("notNow"),
                    confirmLabel: t("startNewGameWithPack"),
                    destructive: inProgress,
                });
                if (startNew) {
                    // Reuse `applyShareSnapshotToLocalStorage` with the
                    // pack-only snapshot — null fields hydrate as
                    // empty/cleared, preserving the existing player
                    // set. This is also where the ongoing-game
                    // "warning" really takes effect (we already showed
                    // it as part of the message above).
                    applySnapshot(snapshot);
                }
                router.push(PLAY_PATH);
                return;
            }

            // Invite / transfer: prompt for overwrite-game confirmation
            // first; if accepted, hydrate everything and go.
            if (hasPersistedGameData()) {
                const ok = await confirm({
                    message: tToolbar("newGameConfirm"),
                });
                if (!ok) return;
            }
            applySnapshot(snapshot);
            await queryClient.invalidateQueries({
                queryKey: customCardPacksQueryKey,
            });
            await queryClient.invalidateQueries({
                queryKey: cardPackUsageQueryKey,
            });
            shareImported({
                shareIdHash: hashShareId(snapshot.id),
                hadPack: hasPack,
                hadPlayers: hasPlayers,
                hadKnownCards: hasKnown,
                hadSuggestions: hasSugg,
                triggeredNewGame: true,
                savedPackToAccount: false,
            });
            // The share already contains a fully-configured game —
            // the receiver doesn't need the setup wizard or its
            // welcome tour. Mark the setup tour as dismissed so
            // `StartupCoordinator` doesn't redirect them back to
            // setup, and route them directly to the checklist so
            // the `checklistSuggest` tour can fire in place.
            saveTourDismissed(TOUR_SCREEN_SETUP, DateTime.nowUnsafe());
            router.push(PLAY_CHECKLIST_PATH);
        } finally {
            setSubmitting(false);
        }
    };

    const onSignInToImport = async (): Promise<void> => {
        // Stamp the intent BEFORE redirect so the post-OAuth mount can
        // recognise this exact share and auto-fire the import. Saved
        // even on failure — better-auth's redirect is opaque, so we
        // can't reliably clean up here, and a stale entry is rejected
        // by `consumePendingImportIntent`'s shareId + age check.
        savePendingImportIntent({ shareId: snapshot.id, t: Date.now() });
        signInStarted({
            provider: SOCIAL_SIGN_IN_PROVIDER,
            from: SIGN_IN_FROM_RECEIVE,
        });
        const result = await authClient.signIn.social({
            provider: SOCIAL_SIGN_IN_PROVIDER,
            callbackURL: window.location.pathname,
        });
        if (result.error !== null) {
            signInFailed({
                provider: SOCIAL_SIGN_IN_PROVIDER,
                reason: result.error.code ?? String(result.error.status),
            });
        }
    };

    const onImport = useCallback(async (): Promise<void> => {
        if (isAnonymous) {
            await onSignInToImport();
            return;
        }
        await performImport();
    }, [isAnonymous]);

    /**
     * Auto-import after OAuth lands the user back here. Guarded by a
     * single sessionStorage entry that the user themselves wrote when
     * clicking "Sign in to import". Runs at most once per mount —
     * `autoImportRanRef` rejects re-entry under React StrictMode (or
     * any future re-mount). A drive-by malicious URL doesn't trigger
     * this branch because no intent was ever written.
     */
    const autoImportRanRef = useRef(false);
    useEffect(() => {
        if (autoImportRanRef.current) return;
        if (isAnonymous) return;
        if (!consumePendingImportIntent(snapshot.id)) return;
        autoImportRanRef.current = true;
        void performImport();
    }, [isAnonymous, snapshot.id]);

    const close = (via: ShareDismissVia): void => {
        shareImportDismissed({
            shareIdHash: hashShareId(snapshot.id),
            via,
        });
        setOpen(false);
        router.push(PLAY_PATH);
    };

    const packBullet = (() => {
        if (packSummary === null) return null;
        if (packSummary.isUnnamedCustom) {
            return t("importIncludesPackUnnamedCustom");
        }
        if (packSummary.isCustom) {
            return t("importIncludesPackCustom", {
                label: packSummary.label,
            });
        }
        return t("importIncludesPackBuiltIn", {
            label: packSummary.label,
        });
    })();

    const playersBullet = (() => {
        if (playersSummary === null) return null;
        if (playersSummary.extra > 0) {
            return t("importIncludesPlayersOverflow", {
                count: playersSummary.count,
                names: playersSummary.visibleNames,
                extra: playersSummary.extra,
            });
        }
        return t("importIncludesPlayers", {
            count: playersSummary.count,
            names: playersSummary.visibleNames,
        });
    })();

    const includesHeader =
        receiveFlow === RECEIVE_FLOW_PACK &&
        packSummary !== null &&
        !packSummary.isUnnamedCustom
            ? t(PACK_NAMED_HEADER_KEY, { label: packSummary.label })
            : t(INCLUDES_HEADER_KEY_FOR[receiveFlow]);
    const showPackBullet = receiveFlow !== RECEIVE_FLOW_PACK;

    return (
        <main className="mx-auto flex max-w-[640px] flex-col gap-5 px-5 py-8">
            {/* Page heading uses the same hierarchy as SetupWizard +
                SuggestionLogPanel: slab/display family (inherited
                via the global h1 rule), uppercase + accent for the
                "you are here" cue. */}
            <h1 className="m-0 text-[1.5rem] uppercase tracking-[0.05em] text-accent">
                {t("importTitle")}
            </h1>
            <Dialog.Root
                open={open}
                onOpenChange={(next) => !next && close(VIA_BACKDROP)}
            >
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-[var(--z-dialog-overlay)] bg-black/40" />
                    <Dialog.Content
                        className={
                            "fixed left-1/2 top-1/2 z-[var(--z-dialog-content)] flex w-[min(92vw,480px)] flex-col " +
                            "-translate-x-1/2 -translate-y-1/2 rounded-[var(--radius)] border border-border " +
                            "bg-panel shadow-[0_10px_28px_rgba(0,0,0,0.28)] focus:outline-none"
                        }
                    >
                        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
                            {/* Modal title matches SuggestionLogPanel
                                's `h2`: uppercase + accent + slab,
                                one notch smaller than the page H1. */}
                            <Dialog.Title className="m-0 text-[1.25rem] uppercase tracking-[0.05em] text-accent">
                                {t(TITLE_KEY_FOR[receiveFlow])}
                            </Dialog.Title>
                            <button
                                type="button"
                                onClick={() => close(VIA_X)}
                                aria-label={tCommon("close")}
                                className="-mt-1 -mr-1 cursor-pointer rounded-[var(--radius)] border-none bg-transparent p-1 text-[#2a1f12] hover:bg-hover"
                            >
                                <XIcon size={18} />
                            </button>
                        </div>
                        {snapshot.ownerName !== null ? (
                            <Dialog.Description
                                className="px-5 pt-3 text-[1rem] leading-relaxed"
                                data-share-import-sender
                            >
                                {t("importSharedBy", {
                                    name: snapshot.ownerName,
                                })}
                            </Dialog.Description>
                        ) : null}
                        {isEmpty ? (
                            <div className="px-5 pt-3 text-[1rem] leading-relaxed text-muted">
                                {t("importEmpty")}
                            </div>
                        ) : (
                            <>
                                {/* "This share includes:" — sub-section
                                    heading inside the modal. Matches
                                    the DEDUCTIONS / LEADS / HYPOTHESIS
                                    + "PRIOR SUGGESTIONS" treatment:
                                    sans-bold-uppercase-accent. */}
                                <h3 className="m-0 mt-4 font-sans! px-5 text-[1.125rem] font-bold uppercase tracking-wide text-accent">
                                    {includesHeader}
                                </h3>
                                <ul
                                    className="m-0 list-disc px-5 pl-9 pt-1 text-[1rem]"
                                    data-share-import-bullets
                                >
                                    {showPackBullet && packBullet !== null ? (
                                        <li data-share-import-bullet="pack">
                                            {packBullet}
                                        </li>
                                    ) : null}
                                    {receiveFlow === RECEIVE_FLOW_PACK &&
                                    packSummary !== null
                                        ? packSummary.categories.map(
                                            (category) => (
                                                <li
                                                    key={category.id}
                                                    data-share-import-bullet="pack-category"
                                                >
                                                    {t(
                                                        "packCategoryItem",
                                                        {
                                                            category:
                                                                category.name,
                                                            count:
                                                                category.count,
                                                        },
                                                    )}
                                                </li>
                                            ),
                                        )
                                        : null}
                                    {playersBullet !== null ? (
                                        <li data-share-import-bullet="players">
                                            {playersBullet}
                                        </li>
                                    ) : null}
                                    {hasHandSizes ? (
                                        <li data-share-import-bullet="hand-sizes">
                                            {t("importIncludesHandSizes")}
                                        </li>
                                    ) : null}
                                    {hasKnown && knownCount !== null ? (
                                        <li data-share-import-bullet="known-cards">
                                            {t("importIncludesKnownCards", {
                                                count: knownCount,
                                            })}
                                        </li>
                                    ) : null}
                                    {hasSugg && suggCount !== null ? (
                                        <li data-share-import-bullet="suggestions">
                                            {t("importIncludesSuggestions", {
                                                count: suggCount,
                                            })}
                                        </li>
                                    ) : null}
                                    {hasAccu && accuCount !== null ? (
                                        <li data-share-import-bullet="accusations">
                                            {t("importIncludesAccusations", {
                                                count: accuCount,
                                            })}
                                        </li>
                                    ) : null}
                                </ul>
                            </>
                        )}
                        <div className="mt-4 flex items-center justify-end gap-2 border-t border-border bg-panel px-5 pt-4 pb-5">
                            <button
                                type="button"
                                onClick={() => close(VIA_X)}
                                className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border border-border bg-white hover:bg-hover"
                            >
                                {tCommon("cancel")}
                            </button>
                            <button
                                type="button"
                                onClick={() => void onImport()}
                                disabled={submitting || isEmpty}
                                data-share-import-cta
                                className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border-2 border-accent bg-accent font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {submitting
                                    ? t("importing")
                                    : isAnonymous
                                        ? t("signInToImport")
                                        : t(ACTION_KEY_FOR[receiveFlow])}
                            </button>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </main>
    );
}
