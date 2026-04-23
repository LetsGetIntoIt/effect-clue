"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { AnimatedFocusRing } from "./components/AnimatedFocusRing";
import { BottomNav } from "./components/BottomNav";
import { Checklist } from "./components/Checklist";
import { GlobalContradictionBanner } from "./components/GlobalContradictionBanner";
import { SuggestionLogPanel } from "./components/SuggestionLogPanel";
import { Toolbar } from "./components/Toolbar";
import { TooltipProvider } from "./components/Tooltip";
import { ConfirmProvider, useConfirm } from "./hooks/useConfirm";
import { SelectionProvider } from "./SelectionContext";
import { useGlobalShortcut } from "./keyMap";
import { T_STANDARD, useReducedTransition } from "./motion";

// Motion mode/group id literals — non user-facing.
const MOTION_APP_GROUP = "app";
const MOTION_WAIT: "wait" = "wait";
import { ClueProvider, useClue } from "./state";

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
            <AnimatedFocusRing groupId={MOTION_APP_GROUP}>
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
            </AnimatedFocusRing>
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
                if (ok) dispatch({ type: "newGame" });
            });
        }, [confirm, dispatch, t]),
    );
    return null;
}

/**
 * Tab-body router. Always fills the app-shell content slot (`h-full`)
 * so that only one scroll container exists — whichever child elects
 * to scroll (Checklist's table wrapper, SuggestionLogPanel's card).
 *
 * - `setup` → Checklist full width (setup affordances unlocked).
 * - `checklist` / `suggest` → on desktop both render the Play grid
 *   (Checklist + SuggestionLogPanel side by side); on mobile the grid
 *   collapses to a single visible pane chosen by `uiMode`, using
 *   `hidden` / `block` toggles rather than remounting. That keeps a
 *   single React tree across the breakpoint — the active tab never
 *   jumps when resizing.
 *
 * `min-w-0` lets long card names / suggestion lines shrink instead of
 * breaking the grid. Each panel owns its own internal scroll so the
 * Checklist's sticky header row anchors to its own scrollport; the
 * outer page never scrolls.
 */
function TabContent() {
    const { state } = useClue();
    const mode = state.uiMode;
    const transition = useReducedTransition(T_STANDARD);

    // Setup is its own full-width view; Play (checklist/suggest)
    // renders the two-pane grid. Crossfade between the two with
    // AnimatePresence mode="wait" so their layouts don't overlap.
    return (
        <AnimatePresence mode={MOTION_WAIT} initial={false}>
            {mode === "setup" ? (
                <motion.div
                    key="setup"
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={transition}
                    className="h-full min-h-0"
                >
                    <Checklist />
                </motion.div>
            ) : (
                <motion.div
                    key="play"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 16 }}
                    transition={transition}
                    className="grid h-full min-h-0 gap-5 [@media(min-width:800px)]:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]"
                >
                    <PlayPane
                        visible={mode === "checklist"}
                        className="min-h-0 min-w-0"
                    >
                        <Checklist />
                    </PlayPane>
                    <PlayPane
                        visible={mode === "suggest"}
                        className="min-h-0 min-w-0 overflow-y-auto"
                    >
                        <SuggestionLogPanel />
                    </PlayPane>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

/**
 * Checklist / Suggest pane. Both panes always stay mounted so the
 * URL `?view=` state stays coherent across the 800px breakpoint.
 *
 * Mobile (<800px): only the active pane is visible via the
 * `hidden [@media(min-width:800px)]:block` class on the inactive
 * pane. No fade animation — the `hidden` class removes it from the
 * layout entirely so the active pane fills the column.
 *
 * Desktop (≥800px): both panes are always visible (the `hidden`
 * class is overridden by the media-query `:block` at 800px+).
 *
 * This mirrors the pre-animation behavior exactly; the refactor is
 * only about routing Setup vs Play through `AnimatePresence` in the
 * parent. (A previous iteration attempted to animate opacity across
 * the breakpoint, which hid the suggest pane on desktop — avoid.)
 */
function PlayPane({
    visible,
    className,
    children,
}: {
    readonly visible: boolean;
    readonly className: string;
    readonly children: React.ReactNode;
}) {
    return (
        <div
            className={
                className +
                (visible ? "" : " hidden [@media(min-width:800px)]:block")
            }
        >
            {children}
        </div>
    );
}

