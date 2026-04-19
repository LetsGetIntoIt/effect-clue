"use client";

import { ChecklistGrid } from "./components/ChecklistGrid";
import { GameSetupPanel } from "./components/GameSetupPanel";
import { GlobalContradictionBanner } from "./components/GlobalContradictionBanner";
import { SuggestionLogPanel } from "./components/SuggestionLogPanel";
import { Toolbar } from "./components/Toolbar";
import { TooltipProvider } from "./components/Tooltip";
import { ClueProvider } from "./state";

/**
 * Top-level Clue solver app. The suggestion log sits at the top because
 * it's where the user spends most of their time; the game-setup grid
 * and the deduction grid sit side-by-side below it on wide screens and
 * stack on mobile. A single global contradiction banner sits just below
 * the header so it's always visible regardless of which panel has focus.
 */
export function Clue() {
    return (
        <TooltipProvider delayDuration={150} skipDelayDuration={50}>
          <ClueProvider>
            <main className="mx-auto flex max-w-[1400px] flex-col gap-5 px-5 pb-15 pt-6">
                <header className="flex flex-wrap items-center justify-between gap-4">
                    <h1 className="m-0 text-[36px] uppercase tracking-[0.08em] text-accent drop-shadow-sm">
                        Clue solver
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
          </ClueProvider>
        </TooltipProvider>
    );
}
