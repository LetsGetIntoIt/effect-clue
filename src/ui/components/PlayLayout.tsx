"use client";

import { AnimatePresence, motion, type Variants } from "motion/react";
import { useEffect, useRef } from "react";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { T_STANDARD, useReducedTransition } from "../motion";
import { Checklist } from "./Checklist";
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
 *   the `SuggestionLogPanel` side-by-side. The log pane is sticky on
 *   both axes (`top`+`right`) so it stays anchored to the viewport's
 *   top-right corner as the page scrolls — vertically through long
 *   tables and horizontally through wide ones.
 * - **Mobile (<800px)**: only the active pane is rendered. Switching
 *   between Checklist and Suggest cross-fades the two via
 *   `AnimatePresence` — slide variants combine an x-axis translate
 *   with opacity, so the entering and exiting panes overlap during
 *   the transition (no spatial gap) without leaking the off-screen
 *   pane visually. The two views are genuinely separate, not stacked,
 *   so horizontal page scroll on a wide setup table never reveals an
 *   inactive pane "to the side". The mobile container clips
 *   horizontal slide overflow as a safety net.
 */
export function PlayLayout({ mode }: { readonly mode: PlayMode }) {
    const isDesktop = useIsDesktop();
    return isDesktop ? <DesktopPlayLayout /> : <MobilePlayLayout mode={mode} />;
}

function DesktopPlayLayout() {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(320px,420px)] items-start gap-5">
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
                className="sticky right-5 top-[calc(var(--contradiction-banner-offset,0px)+var(--header-offset,0px)+1.5rem)] max-h-[calc(100dvh-var(--contradiction-banner-offset,0px)-var(--header-offset,0px)-3rem)] min-w-0 overflow-y-auto"
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
    useEffect(() => {
        prevModeRef.current = mode;
    }, [mode]);

    return (
        <div className="relative grid grid-cols-[minmax(0,1fr)] [grid-template-areas:'stack'] overflow-x-clip">
            <AnimatePresence custom={direction} initial={false}>
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
