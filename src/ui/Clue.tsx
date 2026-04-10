import { useEffect } from "preact/hooks";
import { CaseFilePanel } from "./components/CaseFilePanel";
import { ChecklistGrid } from "./components/ChecklistGrid";
import { HandsPanel } from "./components/HandsPanel";
import { RecommenderPanel } from "./components/RecommenderPanel";
import { SetupPanel } from "./components/SetupPanel";
import { SuggestionForm } from "./components/SuggestionForm";
import { SuggestionList } from "./components/SuggestionList";
import { Toolbar } from "./components/Toolbar";
import { hydrateFromStorage } from "./state";

/**
 * Top-level Clue solver app. Panels are arranged in a two-column layout
 * on wide screens and collapse to a single column on mobile; signals
 * wire every panel to the same source of truth so editing anywhere
 * immediately re-runs the deducer and updates the grid.
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

            <div class="layout">
                <div class="column column-inputs">
                    <SetupPanel />
                    <HandsPanel />
                    <SuggestionForm />
                    <SuggestionList />
                </div>

                <div class="column column-outputs">
                    <CaseFilePanel />
                    <RecommenderPanel />
                    <ChecklistGrid />
                </div>
            </div>
        </main>
    );
}
