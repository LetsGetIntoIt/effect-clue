"use client";

import { useTranslations } from "next-intl";
import { BottomNav } from "./components/BottomNav";
import { Checklist } from "./components/Checklist";
import { GlobalContradictionBanner } from "./components/GlobalContradictionBanner";
import { SuggestionLogPanel } from "./components/SuggestionLogPanel";
import { Toolbar } from "./components/Toolbar";
import { TooltipProvider } from "./components/Tooltip";
import { HoverProvider } from "./HoverContext";
import { ClueProvider, useClue } from "./state";

/**
 * Top-level Clue solver app.
 *
 * **Desktop (≥ 800px)** shows a top `TabBar` (Setup / Play) and a
 * top-right `Toolbar` (undo / redo / share / new game). The Play
 * tab lays the `Checklist` next to a sticky `SuggestionLogPanel`
 * in a 2-column grid.
 *
 * **Mobile (< 800px)** hides the top tab bar and toolbar entirely.
 * A fixed `BottomNav` takes their place, with Checklist / Suggest
 * tabs that split what desktop packs into a single Play grid, plus
 * inline Undo/Redo and an overflow menu for Game setup, Share link,
 * and New game. `<main>`'s bottom padding is bumped up to keep page
 * content clear of the fixed nav.
 *
 * A single global contradiction banner is pinned to the top of the
 * viewport (`position: fixed` inside `GlobalContradictionBanner`)
 * whenever the deducer is stuck; it measures its own height and
 * publishes `--contradiction-banner-offset`, which `<main>` adds to
 * its top padding so the header isn't hidden underneath.
 *
 * The unified Checklist is the single surface for both Setup and
 * Play modes — the tab bar drives the `uiMode` slice and the
 * component gates its Setup-mode affordances (inline renames, add/
 * remove, hand-size row, "+ add card" / "+ add category") on that
 * flag. `uiMode` has three values: `setup`, `checklist`, `suggest`.
 * On desktop `checklist` and `suggest` both render the Play grid
 * (the tab doesn't visually distinguish them); on mobile each routes
 * to its own pane. This means resizing across the breakpoint never
 * jumps tabs — the URL (`?tab=…`) stays coherent on both sides.
 */
export function Clue() {
    const t = useTranslations("app");
    return (
        <TooltipProvider delayDuration={150} skipDelayDuration={50}>
          <ClueProvider>
           <HoverProvider>
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

                <div className="hidden shrink-0 [@media(min-width:800px)]:block">
                    <TabBar />
                </div>
                <div className="flex min-h-0 flex-1 flex-col">
                    <TabContent />
                </div>
            </main>
            <BottomNav />
           </HoverProvider>
          </ClueProvider>
        </TooltipProvider>
    );
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

/**
 * Setup / Play tab switcher (desktop only). Drives the `uiMode`
 * reducer slice; consumers (Checklist's inline-edit gate and setup
 * affordances) read `state.uiMode === "setup"` to decide what to
 * render. The Play tab lights up for both `checklist` and `suggest`
 * since desktop doesn't distinguish them. Clicking Play resolves to
 * `checklist` — the more common landing.
 */
function TabBar() {
    const { state, dispatch } = useClue();
    const tTabs = useTranslations("tabs");
    const tabClass = (active: boolean) =>
        `cursor-pointer border-0 border-b-2 px-3 py-1.5 text-[13px] font-semibold ${
            active
                ? "border-accent bg-transparent text-accent"
                : "border-transparent bg-transparent text-muted hover:text-accent"
        }`;
    const playActive = state.uiMode !== "setup";
    return (
        <div role="tablist" className="-mb-3 flex gap-2 border-b border-border">
            <button
                type="button"
                role="tab"
                aria-selected={state.uiMode === "setup"}
                className={tabClass(state.uiMode === "setup")}
                onClick={() => dispatch({ type: "setUiMode", mode: "setup" })}
            >
                {tTabs("setup")}
            </button>
            <button
                type="button"
                role="tab"
                aria-selected={playActive}
                className={tabClass(playActive)}
                onClick={() => dispatch({ type: "setUiMode", mode: "checklist" })}
            >
                {tTabs("play")}
            </button>
        </div>
    );
}
