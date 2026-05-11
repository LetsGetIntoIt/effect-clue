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
 *   - "Keep working" / X / Esc / outside-click → calls `onKeepWorking()`.
 *     The caller persists a snooze so we don't re-prompt every page
 *     load.
 *
 * Auto-focus lands on "Keep working" — wiping the game is the
 * destructive action, so an Enter on muscle memory should NOT be the
 * thing that wipes it. Mirrors the install-prompt focus bias.
 *
 * Rendered via the global modal stack — the content component itself
 * has no `Dialog.Root`. `useStaleGameModalGate` watches the consumer
 * gate and pushes / pops the entry as the gate flips.
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { DateTime, Duration } from "effect";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef } from "react";
import { ArrowRightIcon, XIcon } from "./Icons";
import { useModalStack } from "./ModalStack";

export type StaleGameVariant = "started" | "unstarted";

// Wire-format discriminators for the variant union — pulled out so
// the i18next/no-literal-string rule treats them as identifiers.
export const STALE_GAME_VARIANT_STARTED: StaleGameVariant = "started";
export const STALE_GAME_VARIANT_UNSTARTED: StaleGameVariant = "unstarted";

const STALE_GAME_MODAL_ID = "stale-game" as const;
const STALE_GAME_MAX_WIDTH = "min(92vw,480px)" as const;

// next-intl key names for the per-variant body copy. Same rationale.
const STALE_GAME_DESCRIPTION_KEY_STARTED = "descriptionStarted" as const;
const STALE_GAME_DESCRIPTION_KEY_UNSTARTED = "descriptionUnstarted" as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type TranslateFn = (
    key: string,
    values?: Record<string, string | number>,
) => string;

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

interface StaleGameModalContentProps {
    readonly variant: StaleGameVariant;
    readonly referenceTimestamp: DateTime.Utc;
    readonly now: DateTime.Utc;
    readonly onSetupNewGame: () => void;
    readonly onKeepWorking: () => void;
}

function StaleGameModalContent({
    variant,
    referenceTimestamp,
    now,
    onSetupNewGame,
    onKeepWorking,
}: StaleGameModalContentProps) {
    const t = useTranslations("staleGame");
    const tCommon = useTranslations("common");
    const keepWorkingRef = useRef<HTMLButtonElement | null>(null);

    const idleDuration = useMemo(
        () => DateTime.distance(referenceTimestamp, now),
        [referenceTimestamp, now],
    );
    const humanDuration = humanizeIdleDuration(idleDuration, t);

    // Focus the safe option on mount (single rAF — see SplashModal for
    // the same pattern). Wiping the game is the destructive action;
    // muscle-memory Enter should NOT be what triggers it.
    useEffect(() => {
        const id = window.requestAnimationFrame(() => {
            keepWorkingRef.current?.focus();
        });
        return () => window.cancelAnimationFrame(id);
    }, []);

    const descriptionKey =
        variant === STALE_GAME_VARIANT_STARTED
            ? STALE_GAME_DESCRIPTION_KEY_STARTED
            : STALE_GAME_DESCRIPTION_KEY_UNSTARTED;

    return (
        <div className="flex flex-col">
            <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
                <Dialog.Title className="m-0 font-display text-[1.25rem] text-accent">
                    {t("title")}
                </Dialog.Title>
                <button
                    type="button"
                    aria-label={tCommon("close")}
                    onClick={onKeepWorking}
                    className="-mt-1 -mr-1 cursor-pointer rounded-[var(--radius)] border-none bg-transparent p-1 text-[#2a1f12] hover:bg-hover"
                >
                    <XIcon size={18} />
                </button>
            </div>
            <p className="px-5 pt-3 pb-1 text-[1rem] leading-relaxed">
                {t(descriptionKey, { humanDuration })}
            </p>
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-border bg-panel px-5 pt-4 pb-5">
                <button
                    ref={keepWorkingRef}
                    type="button"
                    onClick={onKeepWorking}
                    className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border border-border bg-white hover:bg-hover"
                >
                    {t("keepWorking")}
                </button>
                <button
                    type="button"
                    onClick={onSetupNewGame}
                    className={
                        "tap-target text-tap inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius)] border-2 border-accent bg-accent "
                        + "font-semibold text-white hover:bg-accent-hover"
                    }
                >
                    <span>{t("setupNew")}</span>
                    <ArrowRightIcon size={16} />
                </button>
            </div>
        </div>
    );
}

interface StaleGameModalGateProps {
    readonly open: boolean;
    readonly variant: StaleGameVariant;
    /**
     * For "started": the most recent `lastModifiedAt`.
     * For "unstarted": the `createdAt`.
     */
    readonly referenceTimestamp: DateTime.Utc;
    /** Snapshot of "now" at modal open. Pure render function input. */
    readonly now: DateTime.Utc;
    readonly onSetupNewGame: () => void;
    readonly onKeepWorking: () => void;
}

/** Push / pop the stale-game modal as the consumer's gate flips. */
function useStaleGameModalGate({
    open,
    variant,
    referenceTimestamp,
    now,
    onSetupNewGame,
    onKeepWorking,
}: StaleGameModalGateProps): void {
    const t = useTranslations("staleGame");
    const { push, popTo } = useModalStack();
    // Hold callbacks + translated title in refs (see SplashModal for
    // why — `useTranslations` returns an unstable reference under some
    // test mocks, and the consumer recreates handlers every render).
    const handlersRef = useRef({ onSetupNewGame, onKeepWorking });
    handlersRef.current = { onSetupNewGame, onKeepWorking };
    const titleRef = useRef("");
    titleRef.current = t("title");
    useEffect(() => {
        if (!open) return;
        push({
            id: STALE_GAME_MODAL_ID,
            title: titleRef.current,
            maxWidth: STALE_GAME_MAX_WIDTH,
            content: (
                <StaleGameModalContent
                    variant={variant}
                    referenceTimestamp={referenceTimestamp}
                    now={now}
                    onSetupNewGame={() => {
                        popTo(STALE_GAME_MODAL_ID);
                        handlersRef.current.onSetupNewGame();
                    }}
                    onKeepWorking={() => {
                        popTo(STALE_GAME_MODAL_ID);
                        handlersRef.current.onKeepWorking();
                    }}
                />
            ),
        });
        return () => {
            popTo(STALE_GAME_MODAL_ID);
        };
    }, [open, variant, referenceTimestamp, now, push, popTo]);
}

/**
 * Backwards-compatible component wrapper around `useStaleGameModalGate`.
 * Tests can keep mounting `<StaleGameModal open ... />` directly without
 * hand-pushing onto the stack.
 */
export function StaleGameModal(props: StaleGameModalGateProps) {
    useStaleGameModalGate(props);
    return null;
}
