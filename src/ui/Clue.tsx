"use client";

import { useTranslations } from "next-intl";
import { ChecklistGrid } from "./components/ChecklistGrid";
import { GameSetupPanel } from "./components/GameSetupPanel";
import { GlobalContradictionBanner } from "./components/GlobalContradictionBanner";
import { MagnifyingGlass } from "./components/Icons";
import { SuggestionLogPanel } from "./components/SuggestionLogPanel";
import { Toolbar } from "./components/Toolbar";
import { TooltipProvider } from "./components/Tooltip";
import { HoverProvider } from "./HoverContext";
import { ClueProvider } from "./state";

/**
 * Top-level Clue solver app. The suggestion log sits at the top because
 * it's where the user spends most of their time; the game-setup grid
 * and the deduction grid sit side-by-side below it on wide screens and
 * stack on mobile. A single global contradiction banner is pinned to the
 * top of the viewport (`position: fixed` inside GlobalContradictionBanner)
 * whenever the deducer is stuck; it measures its own height and publishes
 * `--contradiction-banner-offset`, which `<main>` adds to its top padding
 * so the header isn't hidden underneath.
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
