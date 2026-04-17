import { useEffect } from "preact/hooks";
import { ChecklistGrid } from "./components/ChecklistGrid";
import { GameSetupPanel } from "./components/GameSetupPanel";
import { SuggestionLogPanel } from "./components/SuggestionLogPanel";
import { Toolbar } from "./components/Toolbar";
import { hydrateFromStorage } from "./state";

/**
 * Top-level Clue solver app. The suggestion log sits at the top because
 * it's where the user spends most of their time; the game-setup grid
 * and the deduction grid sit side-by-side below it on wide screens and
 * stack on mobile.
 */
export function Clue() {
    useEffect(() => {
        hydrateFromStorage();
    }, []);

    return (
        <main class="clue-app">
            <header>
                <h1>Clue solver</h1>
                <Toolbar />
            </header>

            <SuggestionLogPanel />

            <div class="bottom-row">
                <GameSetupPanel />
                <ChecklistGrid />
            </div>
        </main>
    );
}
