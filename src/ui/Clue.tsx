"use client";

import { useTranslations } from "next-intl";
import { Checklist } from "./components/Checklist";
import { GlobalContradictionBanner } from "./components/GlobalContradictionBanner";
import { SuggestionLogPanel } from "./components/SuggestionLogPanel";
import { Toolbar } from "./components/Toolbar";
import { TooltipProvider } from "./components/Tooltip";
import { HoverProvider } from "./HoverContext";
import { ClueProvider, useClue } from "./state";

/**
 * Top-level Clue solver app. The tab bar gates the whole page: the
 * Setup tab shows just the Checklist (deck / roster / hand sizes);
 * the Deduce tab shows the Checklist as a left column and the
 * SuggestionLogPanel as a right column on wide screens, stacking
 * below 800px. A single global contradiction banner is pinned to
 * the top of the viewport (`position: fixed` inside
 * GlobalContradictionBanner) whenever the deducer is stuck; it
 * measures its own height and publishes
 * `--contradiction-banner-offset`, which `<main>` adds to its top
 * padding so the header isn't hidden underneath.
 *
 * The unified Checklist is the single surface for both Setup and
 * Play modes — the tab bar drives the `uiMode` slice and the
 * component gates its Setup-mode affordances (inline renames, add/
 * remove, hand-size row, "+ add card" / "+ add category") on that
 * flag.
 */
export function Clue() {
    const t = useTranslations("app");
    return (
        <TooltipProvider delayDuration={150} skipDelayDuration={50}>
          <ClueProvider>
           <HoverProvider>
            <main className="mx-auto flex max-w-[1400px] flex-col gap-5 px-5 pb-15 [padding-top:calc(var(--contradiction-banner-offset,0px)+1.5rem)]">
                <header className="flex flex-wrap items-center justify-between gap-4">
                    <h1 className="m-0 text-[36px] uppercase tracking-[0.08em] text-accent drop-shadow-sm">
                        {t("title")}
                    </h1>
                    <Toolbar />
                </header>

                <GlobalContradictionBanner />

                <TabBar />
                <TabContent />
            </main>
           </HoverProvider>
          </ClueProvider>
        </TooltipProvider>
    );
}

/**
 * Tab-body router. Setup shows the Checklist at full width; Deduce
 * lays out Checklist + SuggestionLogPanel side by side on wide
 * screens and stacks them below the 800px breakpoint. `min-w-0` on
 * both children lets long card names / suggestion lines shrink
 * instead of breaking the grid.
 */
function TabContent() {
    const { state } = useClue();
    if (state.uiMode === "setup") {
        return <Checklist />;
    }
    return (
        <div className="grid gap-5 [@media(min-width:800px)]:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
            <div className="min-w-0">
                <Checklist />
            </div>
            <div className="min-w-0">
                <SuggestionLogPanel />
            </div>
        </div>
    );
}

/**
 * Setup / Deduce tab switcher. Drives the `uiMode` reducer slice;
 * consumers (currently just GameSetupPanel's inline-edit gate and
 * the new Checklist's future affordances) read `state.uiMode` and
 * render accordingly.
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
                aria-selected={state.uiMode === "play"}
                className={tabClass(state.uiMode === "play")}
                onClick={() => dispatch({ type: "setUiMode", mode: "play" })}
            >
                {tTabs("play")}
            </button>
        </div>
    );
}
