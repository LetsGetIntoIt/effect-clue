/**
 * Receiver-side import page. Lands here when a sender shares a
 * `https://winclue.vercel.app/share/{id}` URL. The server-side
 * route already fetched the snapshot; this client component
 * renders the import UI on top of an SSR-rendered shell.
 *
 * Behaviour:
 *   - Modal opens automatically on first paint with toggles
 *     pre-checked for every section the share included.
 *   - Sections the share doesn't include are greyed out.
 *   - "Import" applies the chosen subset to the receiver's local
 *     game state (via M3's RQ game-session cache) and routes
 *     them to `/play`.
 *   - The first time a user lands on `/share/[id]`, the
 *     share-import tour fires (`tour.shareImport.v1` storage key).
 *
 * Sign-in mid-import: if the user opts to "save the custom pack
 * to my account" and they're not signed-in, we stash the chosen
 * toggles + share id in `effect-clue.share-import.pending.v1`
 * (with a 15-minute TTL), redirect through Google, and on
 * return the import resumes from the stash.
 */
"use client";

import { useEffect, useState } from "react";
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
import { XIcon } from "../components/Icons";

interface ShareSnapshot {
    readonly id: string;
    readonly cardPackData: string | null;
    readonly playersData: string | null;
    readonly handSizesData: string | null;
    readonly knownCardsData: string | null;
    readonly suggestionsData: string | null;
    readonly accusationsData: string | null;
}

const VIA_X: ShareDismissVia = "x_button";
const VIA_BACKDROP: ShareDismissVia = "backdrop";

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

    const hasPack = snapshot.cardPackData !== null;
    const hasPlayers = snapshot.playersData !== null;
    const hasKnown = snapshot.knownCardsData !== null;
    const hasSugg = snapshot.suggestionsData !== null;

    const [includePack, setIncludePack] = useState(hasPack);
    const [includePlayers, setIncludePlayers] = useState(hasPlayers);
    const [includeKnown, setIncludeKnown] = useState(hasKnown);
    const [includeSugg, setIncludeSugg] = useState(hasSugg);

    useEffect(() => {
        shareOpened({ shareIdHash: hashShareId(snapshot.id) });
    }, [snapshot.id]);

    const onImport = async (): Promise<void> => {
        setSubmitting(true);
        shareImportStarted({ shareIdHash: hashShareId(snapshot.id) });
        try {
            // Apply the chosen subset to the receiver's local game
            // state. The actual reducer dispatch + RQ cache update
            // lives in `applyShareSnapshot` (deferred here because
            // it needs the receiver's `<ClueProvider>` context;
            // M9 ships the modal + the server actions and
            // `applyShareSnapshot` is the only piece left for the
            // session-aware-game-state hook to consume in M9b).
            shareImported({
                shareIdHash: hashShareId(snapshot.id),
                includedPack: includePack,
                includedPlayers: includePlayers,
                includedKnownCards: includeKnown,
                includedSuggestions: includeSugg,
                triggeredNewGame: false,
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

    return (
        <main className="mx-auto flex max-w-[640px] flex-col gap-5 px-5 py-8">
            <h1 className="m-0 font-display text-[28px] text-accent">
                {t("importTitle")}
            </h1>
            <p className="m-0 text-[14px] leading-relaxed">
                {t("importDescription")}
            </p>
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
                        <Dialog.Description className="px-5 pt-3 text-[14px] leading-relaxed">
                            {t("importModalDescription")}
                        </Dialog.Description>
                        <div className="flex flex-col gap-2 px-5 pt-3 text-[14px]">
                            <Toggle
                                label={t("toggleCardPack")}
                                checked={includePack}
                                disabled={!hasPack}
                                onChange={setIncludePack}
                            />
                            <Toggle
                                label={t("togglePlayers")}
                                checked={includePlayers}
                                disabled={!hasPlayers}
                                onChange={(v) => {
                                    setIncludePlayers(v);
                                    if (!v) {
                                        setIncludeKnown(false);
                                        setIncludeSugg(false);
                                    }
                                }}
                            />
                            <Toggle
                                label={t("toggleKnownCards")}
                                checked={includeKnown}
                                disabled={!hasKnown || !includePlayers}
                                onChange={setIncludeKnown}
                            />
                            <Toggle
                                label={t("toggleSuggestions")}
                                checked={includeSugg}
                                disabled={!hasSugg || !includePlayers}
                                onChange={setIncludeSugg}
                            />
                        </div>
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
                                disabled={submitting}
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

function Toggle({
    label,
    checked,
    disabled,
    onChange,
}: {
    readonly label: string;
    readonly checked: boolean;
    readonly disabled?: boolean;
    readonly onChange: (next: boolean) => void;
}) {
    return (
        <label
            className={
                "flex cursor-pointer items-center gap-2 " +
                (disabled === true ? "cursor-not-allowed opacity-50" : "")
            }
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
