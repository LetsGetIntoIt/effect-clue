"use client";

import { useTranslations } from "next-intl";
import { playCtaClicked } from "../../analytics/events";
import { phaseAtLeast } from "../../logic/GamePhase";
import { useGamePhase } from "../hooks/useGamePhase";
import { useHasKeyboard } from "../hooks/useHasKeyboard";
import { shortcutSuffix } from "../keyMap";
import { useClue } from "../state";

const VARIANT_TOOLBAR = "toolbar" as const;
const VARIANT_BOTTOM_NAV = "bottomNav" as const;

export type PlayCTAButtonVariant = typeof VARIANT_TOOLBAR | typeof VARIANT_BOTTOM_NAV;

/**
 * Global "Start playing" / "Continue playing" affordance. Appears
 * next to the overflow menu — in the desktop Toolbar and in the
 * mobile BottomNav's setup-mode slot.
 *
 * - Hidden when phase < setupCompleted (the user can't usefully
 *   "start playing" until the minimum data is there).
 * - Label flips between "Start playing" (setupCompleted) and
 *   "Continue playing" (gameStarted).
 * - Shortcut suffix `(⌘J)` appears on devices that have a keyboard.
 * - Clicking dispatches `setUiMode("checklist")` — equivalent to
 *   pressing ⌘J.
 *
 * The `bottomNav` variant always renders an `<li className="flex-1">`
 * slot so the BottomNav's `[flex-1][⋯]` shape stays balanced even
 * when the button is hidden — the slot is just an empty spacer in
 * that case. The `toolbar` variant returns `null` when hidden; the
 * parent's `gap-3` flex collapses cleanly.
 */
export function PlayCTAButton({
    variant,
}: {
    readonly variant: PlayCTAButtonVariant;
}) {
    const phase = useGamePhase();
    const { dispatch } = useClue();
    const t = useTranslations("playCta");
    const hasKeyboard = useHasKeyboard();

    const visible = phaseAtLeast(phase, "setupCompleted");

    if (!visible) {
        return variant === VARIANT_BOTTOM_NAV
            ? (
                <li
                    className="flex-1"
                    aria-hidden
                    data-testid="play-cta-spacer"
                />
            )
            : null;
    }

    // `phase` is `setupCompleted | gameStarted` here (the visibility
    // gate filters out `new | dirty`). Narrowing in TS isn't worth
    // the runtime cast; spelling it as a literal union prop is
    // clearer.
    const labelPhase: "setupCompleted" | "gameStarted" =
        phase === "gameStarted" ? "gameStarted" : "setupCompleted";
    const labelKey =
        labelPhase === "gameStarted" ? "continuePlaying" : "startPlaying";
    const label = t(labelKey, {
        shortcut: shortcutSuffix("global.gotoChecklist", hasKeyboard),
    });
    const ariaLabel = t("ariaLabel");

    const onClick = () => {
        playCtaClicked({ phase: labelPhase, variant });
        dispatch({ type: "setUiMode", mode: "checklist" });
    };

    if (variant === VARIANT_TOOLBAR) {
        return (
            <button
                type="button"
                aria-label={ariaLabel}
                data-tour-anchor="play-cta"
                onClick={onClick}
                className={
                    "tap-target-compact text-tap-compact rounded-[var(--radius)] " +
                    "border-none bg-accent font-semibold text-white " +
                    "cursor-pointer hover:bg-accent-hover " +
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                    "focus-visible:ring-offset-1 focus-visible:ring-offset-bg " +
                    "inline-flex items-center justify-center"
                }
            >
                {label}
            </button>
        );
    }

    return (
        <li className="flex-1">
            <button
                type="button"
                aria-label={ariaLabel}
                data-tour-anchor="play-cta"
                onClick={onClick}
                className={
                    "flex h-12 w-full cursor-pointer items-center justify-center " +
                    "rounded-[var(--radius)] border-0 bg-accent px-3 " +
                    "text-[1rem] font-semibold text-white " +
                    "hover:bg-accent-hover " +
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                    "focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
                }
            >
                {label}
            </button>
        </li>
    );
}
