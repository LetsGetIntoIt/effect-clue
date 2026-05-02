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

import { Result, Schema } from "effect";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import {
    shareImportDismissed,
    shareImported,
    shareOpened,
    shareImportStarted,
    type ShareDismissVia,
} from "../../analytics/events";
import { cardSetEquals } from "../../logic/CardSet";
import { CARD_SETS } from "../../logic/GameSetup";
import { cardPackCodec, playersCodec } from "../../logic/ShareCodec";
import { XIcon } from "../components/Icons";
import { useApplyShareSnapshot } from "./useApplyShareSnapshot";

interface ShareSnapshot {
    readonly id: string;
    readonly cardPackData: string | null;
    readonly playersData: string | null;
    readonly handSizesData: string | null;
    readonly knownCardsData: string | null;
    readonly suggestionsData: string | null;
    readonly accusationsData: string | null;
    readonly ownerName: string | null;
    readonly ownerIsAnonymous: boolean | null;
}

const VIA_X: ShareDismissVia = "x_button";
const VIA_BACKDROP: ShareDismissVia = "backdrop";

// How many player names to spell out in the "Players" bullet before
// collapsing the rest to "+N more". Mirrors the inline-name budget on
// the create side.
const PLAYER_NAMES_VISIBLE = 4;

interface PackSummary {
    readonly label: string;
    readonly isCustom: boolean;
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
        return { label: builtIn.label, isCustom: false, isUnnamedCustom: false };
    }
    const wireName = decoded.success.name;
    if (wireName !== undefined && wireName !== "") {
        return { label: wireName, isCustom: true, isUnnamedCustom: false };
    }
    return { label: "", isCustom: true, isUnnamedCustom: true };
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
    const tCommon = useTranslations("common");
    const router = useRouter();
    const [open, setOpen] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const applySnapshot = useApplyShareSnapshot();

    const hasPack = snapshot.cardPackData !== null;
    const hasPlayers = snapshot.playersData !== null;
    const hasHandSizes = snapshot.handSizesData !== null;
    const hasKnown = snapshot.knownCardsData !== null;
    const hasSugg = snapshot.suggestionsData !== null;
    const hasAccu = snapshot.accusationsData !== null;
    const isEmpty = !hasPack && !hasPlayers;

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

    const onImport = async (): Promise<void> => {
        setSubmitting(true);
        shareImportStarted({ shareIdHash: hashShareId(snapshot.id) });
        try {
            applySnapshot(snapshot);
            shareImported({
                shareIdHash: hashShareId(snapshot.id),
                hadPack: hasPack,
                hadPlayers: hasPlayers,
                hadKnownCards: hasKnown,
                hadSuggestions: hasSugg,
                triggeredNewGame: true,
                savedPackToAccount: false,
            });
            router.push("/play");
        } finally {
            setSubmitting(false);
        }
    };

    const close = (via: ShareDismissVia): void => {
        shareImportDismissed({
            shareIdHash: hashShareId(snapshot.id),
            via,
        });
        setOpen(false);
        router.push("/play");
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

    return (
        <main className="mx-auto flex max-w-[640px] flex-col gap-5 px-5 py-8">
            <h1 className="m-0 font-display text-[28px] text-accent">
                {t("importTitle")}
            </h1>
            <Dialog.Root
                open={open}
                onOpenChange={(next) => !next && close(VIA_BACKDROP)}
            >
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
                                {t("importModalTitle")}
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
                                className="px-5 pt-3 text-[14px] leading-relaxed"
                                data-share-import-sender
                            >
                                {t("importSharedBy", {
                                    name: snapshot.ownerName,
                                })}
                            </Dialog.Description>
                        ) : null}
                        {isEmpty ? (
                            <div className="px-5 pt-3 text-[14px] leading-relaxed text-muted">
                                {t("importEmpty")}
                            </div>
                        ) : (
                            <>
                                <div className="px-5 pt-4 text-[14px] font-semibold">
                                    {t("importIncludesHeader")}
                                </div>
                                <ul
                                    className="m-0 list-disc px-5 pl-9 pt-1 text-[14px]"
                                    data-share-import-bullets
                                >
                                    {packBullet !== null ? (
                                        <li data-share-import-bullet="pack">
                                            {packBullet}
                                        </li>
                                    ) : null}
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
                                className="cursor-pointer rounded-[var(--radius)] border border-border bg-white px-4 py-2 text-[14px] hover:bg-hover"
                            >
                                {tCommon("cancel")}
                            </button>
                            <button
                                type="button"
                                onClick={() => void onImport()}
                                disabled={submitting || isEmpty}
                                data-share-import-cta
                                className="cursor-pointer rounded-[var(--radius)] border-2 border-accent bg-accent px-4 py-2 text-[14px] font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {submitting ? t("importing") : t("importAction")}
                            </button>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </main>
    );
}

/**
 * Hash a share id for analytics so PostHog never sees the raw
 * cuid2. The hash function is intentionally simple (FNV-1a 32-bit
 * folded to 8 hex chars) — collisions are fine; we only need the
 * identifier to be stable across events for the same share so
 * funnels work.
 */
const hashShareId = (id: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i += 1) {
        h ^= id.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
};
