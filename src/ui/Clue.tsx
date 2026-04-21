"use client";

import { useTranslations } from "next-intl";
import { CardPackRow } from "./components/CardPackRow";
import { Checklist } from "./components/Checklist";
import { ChecklistGrid } from "./components/ChecklistGrid";
import { GameSetupPanel } from "./components/GameSetupPanel";
import { GlobalContradictionBanner } from "./components/GlobalContradictionBanner";
import { MagnifyingGlass } from "./components/Icons";
import { SuggestionLogPanel } from "./components/SuggestionLogPanel";
import { Toolbar } from "./components/Toolbar";
import { TooltipProvider } from "./components/Tooltip";
import { HoverProvider } from "./HoverContext";
import { ClueProvider, useClue } from "./state";

/**
 * Top-level Clue solver app. The suggestion log sits at the top because
 * it's where the user spends most of their time; the game-setup grid
 * and the deduction grid sit side-by-side below it on wide screens and
 * stack on mobile. A single global contradiction banner is pinned to the
 * top of the viewport (`position: fixed` inside GlobalContradictionBanner)
 * whenever the deducer is stuck; it measures its own height and publishes
 * `--contradiction-banner-offset`, which `<main>` adds to its top padding
 * so the header isn't hidden underneath.
 *
 * The unified tabbed Checklist (below the suggestion log) is the
 * eventual single surface for both Setup and Play modes. Commit 17
 * introduces it as a copy of ChecklistGrid alongside the old
 * GameSetupPanel + ChecklistGrid pair (safety net); commit 18 folds
 * the Setup controls into the Checklist rows; commit 19 deletes the
 * old pair.
 */
export function Clue() {
    const t = useTranslations("app");
    return (
        <TooltipProvider delayDuration={150} skipDelayDuration={50}>
          <ClueProvider>
           <HoverProvider>
            <main className="mx-auto flex max-w-[1400px] flex-col gap-5 px-5 pb-15 [padding-top:calc(var(--contradiction-banner-offset,0px)+1.5rem)]">
                <header className="flex flex-wrap items-center justify-between gap-4">
                    <h1 className="m-0 flex items-center gap-3 text-[36px] uppercase tracking-[0.08em] text-accent drop-shadow-sm">
                        <MagnifyingGlass size={32} className="text-accent" />
                        {t("title")}
                    </h1>
                    <Toolbar />
                </header>

                <GlobalContradictionBanner />

                <SuggestionLogPanel />

                <TabBar />
                <CardPackRow />
                <Checklist />

                {/* Dormant safety net: GameSetupPanel returns null in
                    commit 18; ChecklistGrid still mounts the old
                    deduction view. Both files deleted in commit 19. */}
                <div className="grid grid-cols-1 items-start gap-5 [@media(min-width:1100px)]:grid-cols-[minmax(380px,1fr)_minmax(400px,1fr)]">
                    <GameSetupPanel />
                    <ChecklistGrid />
                </div>
            </main>
           </HoverProvider>
          </ClueProvider>
        </TooltipProvider>
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
