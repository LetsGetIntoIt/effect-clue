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
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
    CardSet,
    CardEntry,
    Category,
    cardSetEquals,
} from "../../logic/CardSet";
import { deduceSync } from "../../logic/Deducer";
import {
    CARD_SETS,
    GameSetup,
} from "../../logic/GameSetup";
import type { Card, Player } from "../../logic/GameObjects";
import {
    buildInitialKnowledge,
    KnownCard,
} from "../../logic/InitialKnowledge";
import { emptyKnowledge, type Knowledge } from "../../logic/Knowledge";
import { PlayerSet } from "../../logic/PlayerSet";
import {
    cardPackCodec,
    firstDealtPlayerIdCodec,
    handSizesCodec,
    knownCardsCodec,
    playersCodec,
    selfPlayerIdCodec,
} from "../../logic/ShareCodec";
import { customCardPacksQueryKey } from "../../data/customCardPacks";
import { cardPackUsageQueryKey } from "../../data/cardPackUsage";
import { authClient } from "../account/authClient";
import { useSession } from "../hooks/useSession";
import { XIcon } from "../components/Icons";
import { useConfirm } from "../hooks/useConfirm";
import { CardSelectionGrid } from "../setup/shared/CardSelectionGrid";
import { firstDealtHandSizes } from "../setup/firstDealt";
import { saveTourDismissed } from "../tour/TourState";
import {
    type ApplyOverrides,
    hasPersistedGameData,
    saveCardPackFromSnapshot,
    useApplyShareSnapshot,
    type RecognisedPackResult,
} from "./useApplyShareSnapshot";
import { hashShareId } from "./shareAnalytics";
import {
    consumePendingImportIntent,
    peekPendingImportIntent,
    type PendingImportIntent,
    type PendingImportOverrides,
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

/**
 * Decode the wire-format pick strings carried in a pending-import
 * intent back into `ApplyOverrides`. Used by the auto-import effect
 * after `consumePendingImportIntent` returns the matched intent's
 * override strings. Decode failures are silently dropped — a malformed
 * or stale entry imports without overrides, same as a pre-picker
 * intent would.
 *
 * Returns `undefined` when there are no decodable overrides so the
 * caller's `applySnapshot(snapshot, overrides)` call falls through to
 * the no-override path.
 */
const decodeOverridesFromPendingImport = (
    overrides: PendingImportOverrides,
): ApplyOverrides | undefined => {
    const out: { selfPlayerId?: Player | null; knownCards?: ReadonlyArray<KnownCard> } = {};
    if (overrides.selfPlayerIdData !== undefined) {
        const decoded = Schema.decodeUnknownResult(selfPlayerIdCodec)(
            overrides.selfPlayerIdData,
        );
        if (Result.isSuccess(decoded)) out.selfPlayerId = decoded.success;
    }
    if (overrides.knownCardsData !== undefined) {
        const decoded = Schema.decodeUnknownResult(knownCardsCodec)(
            overrides.knownCardsData,
        );
        if (Result.isSuccess(decoded)) {
            const flat: KnownCard[] = [];
            for (const hand of decoded.success) {
                for (const card of hand.cards) {
                    flat.push(KnownCard({ player: hand.player, card }));
                }
            }
            out.knownCards = flat;
        }
    }
    if (out.selfPlayerId === undefined && out.knownCards === undefined) {
        return undefined;
    }
    return out;
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

    // --- Invite-share "optional identity + cards" picker ---
    //
    // Modal-local state for the receiver's picks. Both fields are
    // optional from the user's perspective (the existing summary +
    // CTA continues to work when neither is filled). The fields are
    // surfaced ONLY when `receiveFlow === RECEIVE_FLOW_INVITE` — pack
    // and transfer flows don't render the picker.
    //
    // The picks are encoded into `pendingImport` sessionStorage at
    // sign-in time so they survive the OAuth round-trip; auto-import
    // applies them as `ApplyOverrides`. If the user navigates back
    // from OAuth while still anonymous, the anonymous-mount restore
    // effect (below) peeks the entry and seeds local state, so the
    // picks don't disappear.
    const [importIdentity, setImportIdentity] = useState<Player | null>(null);
    const [importKnownCards, setImportKnownCards] = useState<
        ReadonlyArray<KnownCard>
    >([]);

    // Tracks the last identity that was committed to local state.
    // Used by the clear-cards-on-identity-change effect below; the
    // anonymous-mount restore effect updates this synchronously when
    // it seeds state from sessionStorage so the clear effect (which
    // runs in the next tick) sees no mismatch and doesn't blow the
    // freshly-restored cards away.
    const lastIdentityRef = useRef<Player | null>(null);

    // Snapshot-derived bits the picker needs. Pre-decoded once per
    // snapshot. Each memo returns `null` on decode failure so the
    // render can gracefully omit the picker rather than crash on a
    // malformed invite share.
    const modalCardSet = useMemo<CardSet | null>(() => {
        if (snapshot.cardPackData === null) return null;
        const decoded = Schema.decodeUnknownResult(cardPackCodec)(
            snapshot.cardPackData,
        );
        if (Result.isFailure(decoded)) return null;
        return CardSet({
            categories: decoded.success.categories.map((c) =>
                Category({
                    id: c.id,
                    name: c.name,
                    cards: c.cards.map((card) =>
                        CardEntry({ id: card.id, name: card.name }),
                    ),
                }),
            ),
        });
    }, [snapshot.cardPackData]);

    const modalPlayers = useMemo<ReadonlyArray<Player>>(() => {
        if (snapshot.playersData === null) return [];
        const decoded = Schema.decodeUnknownResult(playersCodec)(
            snapshot.playersData,
        );
        return Result.isSuccess(decoded) ? decoded.success : [];
    }, [snapshot.playersData]);

    const modalFirstDealtPlayerId = useMemo<Player | null>(() => {
        if (snapshot.firstDealtPlayerIdData === null) return null;
        const decoded = Schema.decodeUnknownResult(firstDealtPlayerIdCodec)(
            snapshot.firstDealtPlayerIdData,
        );
        return Result.isSuccess(decoded) ? decoded.success : null;
    }, [snapshot.firstDealtPlayerIdData]);

    const modalHandSizesArr = useMemo<
        ReadonlyArray<readonly [Player, number]>
    >(() => {
        if (snapshot.handSizesData === null) return [];
        const decoded = Schema.decodeUnknownResult(handSizesCodec)(
            snapshot.handSizesData,
        );
        if (Result.isFailure(decoded)) return [];
        return decoded.success.map(
            (h) => [h.player, h.size] as readonly [Player, number],
        );
    }, [snapshot.handSizesData]);

    const modalSetup = useMemo<GameSetup | null>(() => {
        if (modalCardSet === null) return null;
        if (modalPlayers.length === 0) return null;
        return GameSetup({
            cardSet: modalCardSet,
            playerSet: PlayerSet({ players: modalPlayers }),
        });
    }, [modalCardSet, modalPlayers]);

    // Hand-size denominator map for the picker grid. Combines the
    // share's `handSizes` entries with `firstDealtHandSizes` as
    // fallback so a malformed-or-missing entry for any one player
    // still produces a sensible "X of Y" denominator. Empty when the
    // share is missing the bits we need (caller falls through to
    // not rendering the picker).
    const modalHandSizesMap = useMemo<ReadonlyMap<Player, number>>(() => {
        if (modalSetup === null) return new Map();
        const map = new Map<Player, number>();
        for (const [player, size] of modalHandSizesArr) {
            map.set(player, size);
        }
        const dealt = new Map(
            firstDealtHandSizes(modalSetup, modalFirstDealtPlayerId),
        );
        for (const p of modalPlayers) {
            if (!map.has(p)) map.set(p, dealt.get(p) ?? 0);
        }
        return map;
    }, [
        modalSetup,
        modalPlayers,
        modalHandSizesArr,
        modalFirstDealtPlayerId,
    ]);

    // Mini-deducer for cell backgrounds — gives the grid the same
    // "X === Y → fill remaining red" visual the wizard provides via
    // global state. Invite shares have no suggestions / accusations,
    // so the deducer sees ONLY the share's setup + the user's picks.
    // Failure (theoretically unreachable for invite, defensive) falls
    // back to `initialKnowledge`, same pattern the wizard uses.
    const modalInitialKnowledge = useMemo<Knowledge>(() => {
        if (modalSetup === null) return emptyKnowledge;
        return buildInitialKnowledge(
            modalSetup,
            importKnownCards,
            Array.from(modalHandSizesMap.entries()),
        );
    }, [modalSetup, importKnownCards, modalHandSizesMap]);

    const modalDeductionKnowledge = useMemo<Knowledge>(() => {
        if (modalSetup === null) return emptyKnowledge;
        const result = deduceSync(modalSetup, [], [], modalInitialKnowledge);
        return Result.isSuccess(result) ? result.success : modalInitialKnowledge;
    }, [modalSetup, modalInitialKnowledge]);

    // Anonymous-mount restore: when the user navigates back from the
    // OAuth provider before completing sign-in (e.g. hit back, closed
    // the auth tab, etc.), the modal remounts with the same shareId.
    // Peek (don't consume) the pending intent and re-seed local state
    // from any encoded picks so they don't disappear on the round-trip.
    // A subsequent successful OAuth completes the consume + auto-import.
    const anonymousRestoreRanRef = useRef(false);
    useEffect(() => {
        if (anonymousRestoreRanRef.current) return;
        if (!isAnonymous) return;
        if (receiveFlow !== RECEIVE_FLOW_INVITE) return;
        const peeked = peekPendingImportIntent(snapshot.id);
        if (peeked === null) return;
        anonymousRestoreRanRef.current = true;
        if (peeked.selfPlayerIdData !== undefined) {
            const decoded = Schema.decodeUnknownResult(selfPlayerIdCodec)(
                peeked.selfPlayerIdData,
            );
            if (Result.isSuccess(decoded)) {
                setImportIdentity(decoded.success);
                lastIdentityRef.current = decoded.success;
            }
        }
        if (peeked.knownCardsData !== undefined) {
            const decoded = Schema.decodeUnknownResult(knownCardsCodec)(
                peeked.knownCardsData,
            );
            if (Result.isSuccess(decoded)) {
                const flat: KnownCard[] = [];
                for (const hand of decoded.success) {
                    for (const card of hand.cards) {
                        flat.push(KnownCard({ player: hand.player, card }));
                    }
                }
                setImportKnownCards(flat);
            }
        }
    }, [isAnonymous, receiveFlow, snapshot.id]);

    // Identity-change clears cards (runs after the restore above has
    // settled because the restore sets `lastIdentityRef` in the same
    // tick it sets identity). On any subsequent real change of
    // `importIdentity`, drop the previously-picked cards — they
    // belong to a different player's hand.
    useEffect(() => {
        if (lastIdentityRef.current === importIdentity) return;
        lastIdentityRef.current = importIdentity;
        setImportKnownCards([]);
    }, [importIdentity]);

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

    /**
     * Build `ApplyOverrides` from the modal-local picker state. Used
     * by the manual Join path on invite shares. Returns `undefined`
     * when nothing was picked, so the snapshot path runs unmodified.
     */
    const buildOverridesFromLocalState = (): ApplyOverrides | undefined => {
        if (importIdentity === null && importKnownCards.length === 0) {
            return undefined;
        }
        const overrides: { selfPlayerId?: Player | null; knownCards?: ReadonlyArray<KnownCard> } = {};
        if (importIdentity !== null) overrides.selfPlayerId = importIdentity;
        if (importKnownCards.length > 0) overrides.knownCards = importKnownCards;
        return overrides;
    };

    const performImport = async (
        overrides?: ApplyOverrides,
    ): Promise<void> => {
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
            // Pick overrides: explicit param (auto-import path, from
            // decoded pendingImport entry) wins; otherwise build from
            // local picker state (manual Join on invite); transfer
            // shares ignore the picker entirely. Only pass the second
            // arg when we actually have overrides to apply — keeps
            // the call shape symmetric with the pack-only branch and
            // the historical no-override path.
            const effectiveOverrides =
                overrides ??
                (receiveFlow === RECEIVE_FLOW_INVITE
                    ? buildOverridesFromLocalState()
                    : undefined);
            if (effectiveOverrides !== undefined) {
                applySnapshot(snapshot, effectiveOverrides);
            } else {
                applySnapshot(snapshot);
            }
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
        //
        // Encode the user's optional invite-share picks (identity +
        // cards in hand) into the same intent so they survive the
        // OAuth round-trip. Auto-import on return applies them as
        // ApplyOverrides; the user doesn't have to re-pick.
        const intent: PendingImportIntent = {
            shareId: snapshot.id,
            t: Date.now(),
        };
        if (receiveFlow === RECEIVE_FLOW_INVITE && importIdentity !== null) {
            (intent as { selfPlayerIdData?: string }).selfPlayerIdData =
                Schema.encodeSync(selfPlayerIdCodec)(importIdentity);
        }
        if (
            receiveFlow === RECEIVE_FLOW_INVITE &&
            importIdentity !== null &&
            importKnownCards.length > 0
        ) {
            // Group flat KnownCard[] into the wire's hands-per-player
            // shape before encoding.
            const cards: Card[] = importKnownCards.map((kc) => kc.card);
            (intent as { knownCardsData?: string }).knownCardsData =
                Schema.encodeSync(knownCardsCodec)([
                    { player: importIdentity, cards },
                ]);
        }
        savePendingImportIntent(intent);
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

    // `performImport` and `onSignInToImport` close over picker state
    // (`importIdentity`, `importKnownCards`), so memoizing this with a
    // stale dep list would lock them to the first render's empty
    // picks. Define fresh per render — the CTA button doesn't need
    // referential stability here.
    const onImport = async (): Promise<void> => {
        if (isAnonymous) {
            await onSignInToImport();
            return;
        }
        await performImport();
    };

    /**
     * Auto-import after OAuth lands the user back here. Guarded by a
     * single sessionStorage entry that the user themselves wrote when
     * clicking "Sign in to import". Runs at most once per mount —
     * `autoImportRanRef` rejects re-entry under React StrictMode (or
     * any future re-mount). A drive-by malicious URL doesn't trigger
     * this branch because no intent was ever written.
     *
     * The intent may carry encoded `selfPlayerIdData` + `knownCardsData`
     * picks from the modal (invite shares only) — we decode them here
     * and forward as `ApplyOverrides` to `performImport`. Decode
     * failures fall back to no overrides (same as a pre-picker intent).
     */
    const autoImportRanRef = useRef(false);
    useEffect(() => {
        if (autoImportRanRef.current) return;
        if (isAnonymous) return;
        const consumed = consumePendingImportIntent(snapshot.id);
        if (consumed === null) return;
        autoImportRanRef.current = true;
        const overrides = decodeOverridesFromPendingImport(consumed);
        void performImport(overrides);
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
                            "max-h-[calc(100dvh-2rem)] overflow-hidden " +
                            "-translate-x-1/2 -translate-y-1/2 rounded-[var(--radius)] border border-border " +
                            "bg-panel shadow-[0_10px_28px_rgba(0,0,0,0.28)] focus:outline-none"
                        }
                    >
                        {/* Header band — pinned, doesn't scroll. The modal's
                            structural ladder mirrors `ModalStack`'s shell:
                            header is `shrink-0`, the body in between is the
                            `flex-1 min-h-0 overflow-y-auto` scroll
                            container, and the footer below is `shrink-0
                            z-[40]` so any sticky-thead inside the body
                            (e.g. `CardSelectionGrid`'s player-name row)
                            pins to the top of THIS scroll context and the
                            grid never scrolls past the action buttons. */}
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
                        {/* Scrollable body. `relative z-0` traps inner
                            stacking contexts (high-z grid cells, sticky
                            thead at z-39) below the footer band (z-40) so
                            the picker grid can't paint over the action
                            buttons. `min-h-0` is the load-bearing piece —
                            without it, `flex-1` can't shrink below the
                            children's intrinsic height and the modal grows
                            past the viewport regardless of `max-h`. */}
                        <div className="relative z-0 flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
                        {snapshot.ownerName !== null ? (
                            <Dialog.Description
                                className="px-5 pt-3 text-[1rem] leading-normal"
                                data-share-import-sender
                            >
                                {t("importSharedBy", {
                                    name: snapshot.ownerName,
                                })}
                            </Dialog.Description>
                        ) : null}
                        {isEmpty ? (
                            <div className="px-5 pt-3 text-[1rem] leading-normal text-muted">
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
                        {receiveFlow === RECEIVE_FLOW_INVITE &&
                        modalSetup !== null &&
                        modalCardSet !== null ? (
                            <div
                                className="flex flex-col gap-2 px-5 pt-4"
                                data-share-import-picker
                            >
                                <h3
                                    className="m-0 font-sans! text-[1.125rem] font-bold uppercase tracking-wide text-accent"
                                    data-share-import-identity-heading
                                >
                                    {t("importIdentityHeading")}
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {modalPlayers.map((player) => {
                                        const active =
                                            importIdentity === player;
                                        return (
                                            <button
                                                key={String(player)}
                                                type="button"
                                                aria-pressed={active}
                                                data-share-import-identity-pill
                                                onClick={() =>
                                                    setImportIdentity(
                                                        active ? null : player,
                                                    )
                                                }
                                                className={`tap-target-compact text-tap-compact cursor-pointer rounded-full border transition-colors ${
                                                    active
                                                        ? "border-accent bg-accent text-white hover:bg-accent-hover"
                                                        : "border-border bg-control text-fg hover:bg-control-hover"
                                                }`}
                                            >
                                                {String(player)}
                                            </button>
                                        );
                                    })}
                                </div>
                                {importIdentity !== null ? (
                                    <div
                                        className="flex flex-col gap-2 pt-2"
                                        data-share-import-cards-section
                                    >
                                        <h3 className="m-0 font-sans! text-[1.125rem] font-bold uppercase tracking-wide text-accent">
                                            {t("importCardsHeading")}
                                        </h3>
                                        <CardSelectionGrid
                                            players={[importIdentity]}
                                            cardSet={modalCardSet}
                                            knownCards={importKnownCards}
                                            handSizes={modalHandSizesMap}
                                            deductionKnowledge={
                                                modalDeductionKnowledge
                                            }
                                            onAddKnownCard={(card) =>
                                                setImportKnownCards((prev) => [
                                                    ...prev,
                                                    card,
                                                ])
                                            }
                                            onRemoveKnownCard={(index) =>
                                                setImportKnownCards((prev) =>
                                                    prev.filter(
                                                        (_, i) => i !== index,
                                                    ),
                                                )
                                            }
                                        />
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                        </div>
                        {/* Sticky footer band. `relative z-[40]` wins
                            against any z-index inside the body up
                            through 39 (the checklist-style grid's
                            sticky-header layer tops out at 39). The
                            scroll boundary above ends here, so the
                            grid's body scrolls UNDER this row instead
                            of pushing it off-screen. */}
                        <div className="relative z-[40] flex shrink-0 items-center justify-end gap-2 border-t border-border bg-panel px-5 pt-4 pb-5">
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
