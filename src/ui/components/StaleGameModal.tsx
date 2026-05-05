/**
 * Modal that asks the user whether they want to start fresh when
 * they land on Checklist or Suggest with a game that's been sitting
 * idle (or never started in the first place).
 *
 * Two flavors:
 *   - "started" — the game has progress (known cards, suggestions,
 *     accusations) but the user hasn't touched it in a while.
 *   - "unstarted" — the game was created but never had progress
 *     logged on it.
 *
 * Three exit paths:
 *   - "Set up new game" → primary CTA, calls `onSetupNewGame()`.
 *     The caller is responsible for dispatching `newGame` and
 *     redirecting to the setup pane.
 *   - "Keep working" / X / Esc / overlay click → calls `onKeepWorking()`.
 *     The caller persists a snooze so we don't re-prompt every page
 *     load.
 *
 * Auto-focus lands on "Keep working" — wiping the game is the
 * destructive action, so an Enter on muscle memory should NOT be the
 * thing that wipes it. Mirrors the install-prompt focus bias.
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { DateTime, Duration } from "effect";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef } from "react";
import { ArrowRightIcon, XIcon } from "./Icons";

export type StaleGameVariant = "started" | "unstarted";

// Wire-format discriminators for the variant union — pulled out so
// the i18next/no-literal-string rule treats them as identifiers.
export const STALE_GAME_VARIANT_STARTED: StaleGameVariant = "started";
export const STALE_GAME_VARIANT_UNSTARTED: StaleGameVariant = "unstarted";

// next-intl key names for the per-variant body copy. Same rationale.
const STALE_GAME_DESCRIPTION_KEY_STARTED = "descriptionStarted" as const;
const STALE_GAME_DESCRIPTION_KEY_UNSTARTED = "descriptionUnstarted" as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type TranslateFn = (
    key: string,
    values?: Record<string, string | number>,
) => string;

/**
 * Render a coarse "N day(s)" / "N hour(s)" string for the modal body.
 * We deliberately keep it imprecise — the user only needs to know
 * whether this game is "the one I worked on yesterday" or "the one
 * from last month".
 */
const humanizeIdleDuration = (
    duration: Duration.Duration,
    t: TranslateFn,
): string => {
    const ms = Duration.toMillis(duration);
    if (ms >= DAY_MS) {
        const days = Math.max(1, Math.round(ms / DAY_MS));
        return t("durationDays", { count: days });
    }
    if (ms >= HOUR_MS) {
        const hours = Math.max(1, Math.round(ms / HOUR_MS));
        return t("durationHours", { count: hours });
    }
    return t("durationMinutes", {
        count: Math.max(1, Math.round(ms / 60000)),
    });
};

export function StaleGameModal({
    open,
    variant,
    referenceTimestamp,
    now,
    onSetupNewGame,
    onKeepWorking,
}: {
    readonly open: boolean;
    readonly variant: StaleGameVariant;
    /**
     * For "started": the most recent `lastModifiedAt`.
     * For "unstarted": the `createdAt`.
     * Used for the human-readable "you haven't touched this in
     * {duration}" copy. Caller is responsible for picking the right
     * one — the modal only stringifies it.
     */
    readonly referenceTimestamp: DateTime.Utc;
    /** Snapshot of "now" at modal open. Pure render function input. */
    readonly now: DateTime.Utc;
    readonly onSetupNewGame: () => void;
    readonly onKeepWorking: () => void;
}) {
    const t = useTranslations("staleGame");
    const tCommon = useTranslations("common");
    const keepWorkingRef = useRef<HTMLButtonElement | null>(null);

    const idleDuration = useMemo(
        () => DateTime.distance(referenceTimestamp, now),
        [referenceTimestamp, now],
    );
    const humanDuration = humanizeIdleDuration(idleDuration, t);

    // Fallback focus pull when the modal goes from closed to open.
    // `onOpenAutoFocus` covers the "mount with open=true" case; this
    // handles "mount with open=false → re-render with open=true",
    // which is the boot path coming out of the StartupCoordinator.
    // The setTimeout (vs rAF) is a deliberate choice — Radix Dialog's
    // FocusScope sets focus from a useEffect that runs after the
    // first paint, so an rAF-deferred focus can lose the race. A
    // small macrotask delay lets FocusScope settle before we
    // override with the cancel-biased target.
    useEffect(() => {
        if (!open) return;
        const id = window.setTimeout(() => {
            keepWorkingRef.current?.focus();
        }, 50);
        return () => window.clearTimeout(id);
    }, [open]);

    const descriptionKey =
        variant === STALE_GAME_VARIANT_STARTED
            ? STALE_GAME_DESCRIPTION_KEY_STARTED
            : STALE_GAME_DESCRIPTION_KEY_UNSTARTED;

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(next) => {
                if (!next) onKeepWorking();
            }}
        >
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-[var(--z-dialog-overlay)] bg-black/40" />
                <Dialog.Content
                    className={
                        "fixed left-1/2 top-1/2 z-[var(--z-dialog-content)] flex w-[min(92vw,480px)] flex-col "
                        + "-translate-x-1/2 -translate-y-1/2 rounded-[var(--radius)] border border-border "
                        + "bg-panel shadow-[0_10px_28px_rgba(0,0,0,0.28)] focus:outline-none"
                    }
                    onOpenAutoFocus={(e) => {
                        e.preventDefault();
                        // `setTimeout` rather than rAF so we settle
                        // after Radix's FocusScope, which can win
                        // races with a single rAF-deferred focus call.
                        window.setTimeout(() => {
                            keepWorkingRef.current?.focus();
                        }, 50);
                    }}
                >
                    <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
                        <Dialog.Title className="m-0 font-display text-[20px] text-accent">
                            {t("title")}
                        </Dialog.Title>
                        <Dialog.Close
                            aria-label={tCommon("close")}
                            className="-mt-1 -mr-1 cursor-pointer rounded-[var(--radius)] border-none bg-transparent p-1 text-[#2a1f12] hover:bg-hover"
                        >
                            <XIcon size={18} />
                        </Dialog.Close>
                    </div>
                    <Dialog.Description className="px-5 pt-3 pb-1 text-[14px] leading-relaxed">
                        {t(descriptionKey, { humanDuration })}
                    </Dialog.Description>
                    <div className="mt-4 flex items-center justify-end gap-2 border-t border-border bg-panel px-5 pt-4 pb-5">
                        <button
                            ref={keepWorkingRef}
                            type="button"
                            onClick={onKeepWorking}
                            className="cursor-pointer rounded-[var(--radius)] border border-border bg-white px-4 py-2 text-[14px] hover:bg-hover"
                        >
                            {t("keepWorking")}
                        </button>
                        <button
                            type="button"
                            onClick={onSetupNewGame}
                            className={
                                "inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius)] border-2 border-accent bg-accent "
                                + "px-4 py-2 text-[14px] font-semibold text-white hover:bg-accent-hover"
                            }
                        >
                            <span>{t("setupNew")}</span>
                            <ArrowRightIcon size={16} />
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
