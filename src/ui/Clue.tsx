"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { BottomNav } from "./components/BottomNav";
import { Checklist } from "./components/Checklist";
import { GlobalContradictionBanner } from "./components/GlobalContradictionBanner";
import { SuggestionLogPanel } from "./components/SuggestionLogPanel";
import { Toolbar } from "./components/Toolbar";
import { TooltipProvider } from "./components/Tooltip";
import { ConfirmProvider, useConfirm } from "./hooks/useConfirm";
import { SelectionProvider } from "./SelectionContext";
import { useGlobalShortcut } from "./keyMap";
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
 * (`?tab=…`) stays coherent on both sides.
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
    if (mode === "setup") {
        return <Checklist />;
    }
    // `hidden` / `block` classes keep both children mounted on desktop
    // and hide the off-tab one on mobile.
    const hideOnMobileIfSuggest =
        mode === "suggest" ? "hidden [@media(min-width:800px)]:block" : "";
    const hideOnMobileIfChecklist =
        mode === "checklist" ? "hidden [@media(min-width:800px)]:block" : "";
    return (
        <div className="grid h-full min-h-0 gap-5 [@media(min-width:800px)]:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
            <div className={`min-h-0 min-w-0 ${hideOnMobileIfSuggest}`}>
                <Checklist />
            </div>
            <div
                className={
                    `min-h-0 min-w-0 overflow-y-auto ${hideOnMobileIfChecklist}`
                }
            >
                <SuggestionLogPanel />
            </div>
        </div>
    );
}

