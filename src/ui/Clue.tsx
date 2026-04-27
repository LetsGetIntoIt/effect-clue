"use client";

import { AnimatePresence, motion, type Variants } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { gameSetupStarted } from "../analytics/events";
import { startSetup } from "../analytics/gameSession";
import { BottomNav } from "./components/BottomNav";
import { Checklist } from "./components/Checklist";
import { GlobalContradictionBanner } from "./components/GlobalContradictionBanner";
import { SuggestionLogPanel } from "./components/SuggestionLogPanel";
import { Toolbar } from "./components/Toolbar";
import { TooltipProvider } from "./components/Tooltip";
import { ConfirmProvider, useConfirm } from "./hooks/useConfirm";
import { useIsDesktop } from "./hooks/useIsDesktop";
import { SelectionProvider } from "./SelectionContext";
import { useGlobalShortcut } from "./keyMap";
import { T_STANDARD, useReducedTransition } from "./motion";
import type { UiMode } from "../logic/ClueState";
import { ClueProvider, useClue } from "./state";

// Non user-facing literals.
const VARIANT_INITIAL = "initial";
const VARIANT_ANIMATE = "animate";
const VARIANT_EXIT = "exit";
const UI_SETUP: "setup" = "setup";
const UI_CHECKLIST: "checklist" = "checklist";
const UI_SUGGEST: "suggest" = "suggest";
const TOP_LEVEL_PLAY = "play";

/**
 * Horizontal mental-model of the three views. Setup sits to the
 * left of the play grid; within the play grid on mobile, the
 * checklist sits to the left of the suggest log. On desktop the
 * play grid collapses into one view (both panes visible), so the
 * top-level AnimatePresence treats "checklist" and "suggest" as a
 * single "play" key — switching between them doesn't animate.
 */
const POSITIONS: Record<UiMode, number> = {
    setup: 0,
    checklist: 1,
    suggest: 2,
};

type Direction = 1 | -1;

function getDirection(prev: UiMode, next: UiMode): Direction {
    return POSITIONS[next] >= POSITIONS[prev] ? 1 : -1;
}

const slideVariants: Variants = {
    initial: (dir: Direction) => ({ x: dir === 1 ? "100%" : "-100%" }),
    animate: { x: 0 },
    exit: (dir: Direction) => ({ x: dir === 1 ? "-100%" : "100%" }),
};

/**
 * Top-level Clue solver app.
 *
 * **Desktop (≥ 800px)** shows the `Checklist` and `SuggestionLogPanel`
 * side-by-side in a 2-column grid. A top-right `Toolbar` holds Undo
 * and Redo as top-level buttons plus a `⋯` overflow menu for Game
 * setup, Share link, and New game. Setup mode (entered via ⌘H or the
 * overflow menu) swaps the grid for a full-width Checklist that
 * unlocks inline-edit affordances.
 *
 * **Mobile (< 800px)** hides the desktop Toolbar entirely. A fixed
 * `BottomNav` takes its place, with Checklist / Suggest tabs that
 * split what desktop packs into a single Play grid, plus inline
 * Undo/Redo and a `⋯` overflow menu that mirrors the desktop one.
 * `<main>`'s bottom padding is bumped up to keep page content clear
 * of the fixed nav.
 *
 * A single global contradiction banner is pinned to the top of the
 * viewport (`position: fixed` inside `GlobalContradictionBanner`)
 * whenever the deducer is stuck; it measures its own height and
 * publishes `--contradiction-banner-offset`, which `<main>` adds to
 * its top padding so the header isn't hidden underneath.
 *
 * The unified Checklist is the single surface for both Setup and
 * Play modes — the overflow menu's Game setup item drives the
 * `uiMode` slice and the component gates its Setup-mode affordances
 * (inline renames, add/remove, hand-size row, "+ add card" / "+ add
 * category") on that flag. `uiMode` has three values: `setup`,
 * `checklist`, `suggest`. On desktop `checklist` and `suggest` both
 * render the Play grid; on mobile each routes to its own pane. This
 * means resizing across the breakpoint never jumps tabs — the URL
 * (`?view=…`) stays coherent on both sides.
 */
export function Clue() {
    const t = useTranslations("app");
    return (
        <TooltipProvider delayDuration={150} skipDelayDuration={50}>
          <ClueProvider>
           <ConfirmProvider>
           <SelectionProvider>
            <main className="mx-auto flex h-[100dvh] max-w-[1400px] flex-col gap-5 px-5 pb-24 [@media(min-width:800px)]:pb-5 [padding-top:calc(var(--contradiction-banner-offset,0px)+1.5rem)]">
                <header className="flex shrink-0 flex-wrap items-center justify-between gap-4">
                    <h1 className="m-0 text-[36px] uppercase tracking-[0.08em] text-accent drop-shadow-sm">
                        {t("title")}
                    </h1>
                    <div className="hidden [@media(min-width:800px)]:block">
                        <Toolbar />
                    </div>
                </header>

                <GlobalContradictionBanner />

                <div className="flex min-h-0 flex-1 flex-col">
                    <TabContent />
                </div>
                <NewGameShortcut />
            </main>
            <BottomNav />
           </SelectionProvider>
           </ConfirmProvider>
          </ClueProvider>
        </TooltipProvider>
    );
}

/**
 * Cmd/Ctrl+Shift+Backspace handler for starting a new game. Mounts
 * once inside `ClueProvider` so `useClue` + i18n are available.
 */
function NewGameShortcut() {
    const t = useTranslations("toolbar");
    const { dispatch } = useClue();
    const confirm = useConfirm();
    useGlobalShortcut(
        "global.newGame",
        useCallback(() => {
            void confirm({ message: t("newGameConfirm") }).then(ok => {
                if (ok) {
                    startSetup();
                    dispatch({ type: "newGame" });
                    gameSetupStarted();
                }
            });
        }, [confirm, dispatch, t]),
    );
    return null;
}

/**
 * Tab-body router driven by `uiMode`. Three logical views live in
 * a horizontal row: setup (pos 0), checklist (pos 1), suggest (pos
 * 2). Transitions slide whole pages in/out from the direction that
 * matches that position, so a move from setup to suggest slides the
 * new page in from the RIGHT (positions increasing), and the reverse
 * slides it in from the LEFT.
 *
 * On desktop, `checklist` and `suggest` collapse into a single play
 * grid (both panes visible side-by-side). The top-level
 * AnimatePresence keys on `"setup" | "play"` so switching between
 * checklist and suggest while on desktop does NOT trigger a slide —
 * both are already on screen. On mobile, within the play grid, each
 * pane is absolutely positioned and animates its `x` based on
 * `mode`, so the slide happens at the pane level there instead.
 */
function TabContent() {
    const { state, hydrated } = useClue();
    const mode = state.uiMode;
    const transition = useReducedTransition(T_STANDARD, { fadeMs: 120 });

    // Track the previous mode to compute slide direction. Updates
    // via useEffect so render sees the PREVIOUS value alongside the
    // new mode — exactly what's needed to choose enter/exit sides.
    const prevModeRef = useRef<UiMode>(mode);
    const direction = getDirection(prevModeRef.current, mode);
    useEffect(() => {
        prevModeRef.current = mode;
    }, [mode]);

    const topLevelKey: "setup" | "play" =
        mode === UI_SETUP ? UI_SETUP : TOP_LEVEL_PLAY;

    // Until URL/localStorage hydration resolves the real view, render
    // a view-agnostic skeleton so the default `"setup"` pane doesn't
    // flash between initial mount and the hydrated dispatch. Gating
    // the AnimatePresence (not an early return) keeps hook order
    // stable across the transition. AnimatePresence only mounts once
    // `hydrated` is true, so `initial={false}` correctly skips the
    // entry animation on whichever hydrated view wins.
    return (
        <div className="relative h-full min-h-0 overflow-hidden">
            {!hydrated ? (
                <ViewSkeleton />
            ) : (
            <AnimatePresence custom={direction} initial={false}>
                {topLevelKey === UI_SETUP ? (
                    <motion.div
                        key={UI_SETUP}
                        custom={direction}
                        variants={slideVariants}
                        initial={VARIANT_INITIAL}
                        animate={VARIANT_ANIMATE}
                        exit={VARIANT_EXIT}
                        transition={transition}
                        className="absolute inset-0 min-h-0"
                    >
                        <Checklist />
                    </motion.div>
                ) : (
                    <motion.div
                        key={TOP_LEVEL_PLAY}
                        custom={direction}
                        variants={slideVariants}
                        initial={VARIANT_INITIAL}
                        animate={VARIANT_ANIMATE}
                        exit={VARIANT_EXIT}
                        transition={transition}
                        className="absolute inset-0 min-h-0"
                    >
                        <PlayGrid
                            mode={mode === UI_SUGGEST ? UI_SUGGEST : UI_CHECKLIST}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
            )}
        </div>
    );
}

/**
 * View-agnostic loading skeleton. On mobile it renders a single pane
 * (matching the one visible pane in Setup, Checklist, and Suggest
 * modes). On desktop (≥800px) it mirrors the Play grid's two-column
 * layout so the skeleton shape is close to whichever view lands —
 * the left column wins for Setup (where the right panel disappears
 * in one frame), and both columns match the Play grid. Rectangles
 * stand in for a heading bar, a subtitle / progress row, and the
 * main content area. `motion-safe:animate-pulse` lets reduced-motion
 * users see a static skeleton.
 */
function ViewSkeleton() {
    const pane = (
        <div className="flex h-full min-h-0 flex-col gap-3 rounded-[var(--radius)] border border-border/40 bg-panel/40 p-4">
            <div className="h-5 w-1/3 rounded bg-border/40" />
            <div className="h-3 w-2/3 rounded bg-border/30" />
            <div className="mt-1 min-h-20 flex-1 rounded bg-border/20" />
        </div>
    );
    return (
        <div
            aria-hidden
            className="relative h-full min-h-0 motion-safe:animate-pulse [@media(min-width:800px)]:grid [@media(min-width:800px)]:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] [@media(min-width:800px)]:gap-5"
        >
            {pane}
            <div className="hidden h-full min-h-0 [@media(min-width:800px)]:block">
                {pane}
            </div>
        </div>
    );
}

/**
 * Inside the play view. On desktop, a two-column grid with both
 * panes statically visible. On mobile, a relative container with
 * both panes absolutely positioned; each pane's `x` is driven by
 * its distance from the active mode, so switching checklist↔suggest
 * animates both panes sliding in sync.
 */
function PlayGrid({ mode }: { readonly mode: "checklist" | "suggest" }) {
    return (
        <div className="relative h-full min-h-0 overflow-hidden [@media(min-width:800px)]:overflow-visible [@media(min-width:800px)]:grid [@media(min-width:800px)]:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] [@media(min-width:800px)]:gap-5">
            <PlayPane paneMode={UI_CHECKLIST} currentMode={mode}>
                <Checklist />
            </PlayPane>
            <PlayPane
                paneMode={UI_SUGGEST}
                currentMode={mode}
                className="overflow-y-auto"
            >
                <SuggestionLogPanel />
            </PlayPane>
        </div>
    );
}

/**
 * A single Play pane that adapts to the breakpoint:
 *
 * - Desktop (≥800px): static grid member, no transform. Both panes
 *   always visible.
 * - Mobile (<800px): absolutely positioned inside `PlayGrid`. Its
 *   `x` animates based on `POSITIONS[paneMode] - POSITIONS[currentMode]`
 *   — so when the active pane is the Checklist, the Suggest pane
 *   sits at `x: 100%` (off to the right); when active flips to
 *   Suggest, both panes animate their x simultaneously.
 *
 * Inactive mobile panes are marked `aria-hidden` and `inert` so
 * keyboard focus doesn't land inside an off-screen pane.
 */
function PlayPane({
    paneMode,
    currentMode,
    className = "",
    children,
}: {
    readonly paneMode: "checklist" | "suggest";
    readonly currentMode: "checklist" | "suggest";
    readonly className?: string;
    readonly children: React.ReactNode;
}) {
    const isDesktop = useIsDesktop();
    const transition = useReducedTransition(T_STANDARD, { fadeMs: 120 });
    const offset = POSITIONS[paneMode] - POSITIONS[currentMode];
    const isActive = offset === 0;
    const mobileInactive = !isDesktop && !isActive;

    return (
        <motion.div
            className={
                "min-h-0 min-w-0 " +
                className +
                (isDesktop ? "" : " absolute inset-0")
            }
            animate={{ x: isDesktop ? 0 : `${offset * 100}%` }}
            transition={transition}
            aria-hidden={mobileInactive || undefined}
            inert={mobileInactive}
        >
            {children}
        </motion.div>
    );
}
