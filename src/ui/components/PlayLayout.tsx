"use client";

import { AnimatePresence, motion, type Variants } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { T_STANDARD, useReducedTransition } from "../motion";
import { Checklist } from "./Checklist";
import { MyHandPanel } from "./MyHandPanel";
import { SuggestionLogPanel } from "./SuggestionLogPanel";

// Non user-facing literals.
const VARIANT_INITIAL = "initial";
const VARIANT_ANIMATE = "animate";
const VARIANT_EXIT = "exit";
const UI_CHECKLIST: "checklist" = "checklist";
const UI_SUGGEST: "suggest" = "suggest";

type PlayMode = "checklist" | "suggest";
type Direction = 1 | -1;

const PLAY_POSITIONS: Record<PlayMode, number> = {
    checklist: 0,
    suggest: 1,
};

function getDirection(prev: PlayMode, next: PlayMode): Direction {
    return PLAY_POSITIONS[next] >= PLAY_POSITIONS[prev] ? 1 : -1;
}

const slideVariants: Variants = {
    initial: (dir: Direction) => ({ x: dir === 1 ? "100%" : "-100%", opacity: 0 }),
    animate: { x: 0, opacity: 1 },
    exit: (dir: Direction) => ({ x: dir === 1 ? "-100%" : "100%", opacity: 0 }),
};

/**
 * Layout for the Play view. Renders different React trees by
 * breakpoint instead of one tree with CSS hiding:
 *
 * - **Desktop (≥800px)**: a two-column grid with the `Checklist` and
 *   the `SuggestionLogPanel` side-by-side. Track 1 is sized
 *   `minmax(min-content, 1fr)` so it grows to honor `Checklist`'s
 *   `min-w-max` — when the player count makes the table wider than
 *   the viewport can fit alongside the log column, the grid expands
 *   past the viewport and `body`'s `overflow-x: auto` lets the user
 *   horizontally scroll to reach both. (If track 1 were
 *   `minmax(0, 1fr)` the table would overflow its track to the right
 *   and visually cover the SuggestionLogPanel sitting in track 2.)
 *   The log pane is sticky-top only — no sticky-right pin — so on
 *   horizontal page scroll it slides out of view to the right with
 *   the rest of the grid instead of overlapping the table.
 * - **Mobile (<800px)**: only the active pane is rendered. Switching
 *   between Checklist and Suggest cross-fades the two via
 *   `AnimatePresence` — slide variants combine an x-axis translate
 *   with opacity, so the entering and exiting panes overlap during
 *   the transition (no spatial gap) without leaking the off-screen
 *   pane visually. The two views are genuinely separate, not stacked,
 *   so horizontal page scroll on a wide setup table never reveals an
 *   inactive pane "to the side". `overflow-x: clip` is applied to the
 *   mobile container ONLY during the slide animation — at rest the
 *   container is `overflow-x: visible` so the inner Checklist's
 *   `min-w-max` table can extend body's `scrollWidth` and be reached
 *   via horizontal page scroll. Always-clipping the container would
 *   own horizontal scroll inside the slide stack, which breaks the
 *   "page owns horizontal scroll, not internal viewports" invariant.
 */
export function PlayLayout({ mode }: { readonly mode: PlayMode }) {
    const isDesktop = useIsDesktop();
    return (
        <div className="flex min-w-0 flex-col gap-3">
            <MyHandPanel />
            {isDesktop ? (
                <DesktopPlayLayout />
            ) : (
                <MobilePlayLayout mode={mode} />
            )}
        </div>
    );
}

function DesktopPlayLayout() {
    return (
        <div className="grid grid-cols-[minmax(min-content,1fr)_minmax(0,420px)] items-start gap-5">
            <Checklist />
            {/* The M10 swap-discoverability tour anchors here to
                spotlight the entire suggest column on desktop, mirror
                of `desktop-checklist-area` on the Checklist side. The
                anchor is intentionally on the sticky outer wrapper
                (not on `<SuggestionLogPanel>` itself) so the
                spotlight covers the visible viewport-pinned region
                even after vertical scroll. */}
            <div
                data-tour-anchor="desktop-suggest-area"
                className="sticky top-[calc(var(--contradiction-banner-offset,0px)+var(--header-offset,0px))] max-h-[calc(100dvh-var(--contradiction-banner-offset,0px)-var(--header-offset,0px)-1rem)] min-w-0 overflow-y-auto"
            >
                <SuggestionLogPanel />
            </div>
        </div>
    );
}

function MobilePlayLayout({ mode }: { readonly mode: PlayMode }) {
    const transition = useReducedTransition(T_STANDARD, { fadeMs: 120 });

    // Track the previous mode to compute slide direction. Updates via
    // useEffect so render sees the PREVIOUS value alongside the new
    // mode — which is what lets us choose the correct enter/exit side.
    const prevModeRef = useRef<PlayMode>(mode);
    const direction = getDirection(prevModeRef.current, mode);
    // Clip horizontal overflow ONLY during the slide animation. At
    // rest the container is `overflow-x: visible` so the inner
    // Checklist's `min-w-max` table can extend body's `scrollWidth`
    // and be reached via horizontal page scroll (the load-bearing
    // "page owns horizontal scroll" invariant). During the transition
    // the off-screen pane's `translateX(±100%)` would otherwise
    // extend `body.scrollWidth` and flash a horizontal scrollbar; the
    // clip masks it out for those ~200ms.
    const [isAnimating, setIsAnimating] = useState(false);
    useEffect(() => {
        if (prevModeRef.current === mode) return;
        prevModeRef.current = mode;
        setIsAnimating(true);
    }, [mode]);

    const animationClipClass = isAnimating ? " overflow-x-clip" : "";

    return (
        <div
            className={`relative grid grid-cols-[minmax(0,1fr)] [grid-template-areas:'stack']${animationClipClass}`}
        >
            <AnimatePresence
                custom={direction}
                initial={false}
                onExitComplete={() => setIsAnimating(false)}
            >
                {mode === UI_CHECKLIST ? (
                    <motion.div
                        key={UI_CHECKLIST}
                        custom={direction}
                        variants={slideVariants}
                        initial={VARIANT_INITIAL}
                        animate={VARIANT_ANIMATE}
                        exit={VARIANT_EXIT}
                        transition={transition}
                        className="[grid-area:stack] min-w-0"
                    >
                        <Checklist />
                    </motion.div>
                ) : (
                    <motion.div
                        key={UI_SUGGEST}
                        custom={direction}
                        variants={slideVariants}
                        initial={VARIANT_INITIAL}
                        animate={VARIANT_ANIMATE}
                        exit={VARIANT_EXIT}
                        transition={transition}
                        className="[grid-area:stack] min-w-0"
                    >
                        <SuggestionLogPanel />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
