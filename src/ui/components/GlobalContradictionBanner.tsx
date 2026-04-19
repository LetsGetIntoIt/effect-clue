"use client";

import { Either } from "effect";
import { useClue } from "../state";
import { ContradictionBanner } from "./ContradictionBanner";

/**
 * Global contradiction banner rendered once at the top of the app (above
 * the setup/deduction panels) whenever the deducer detects an
 * inconsistency. Previously this was duplicated inside GameSetupPanel and
 * ChecklistGrid; lifting it here means users always see the same quick-fix
 * UI regardless of which panel they're focused on, and we no longer have
 * to render the same banner twice in parallel.
 */
export function GlobalContradictionBanner() {
    const { derived } = useClue();
    const result = derived.deductionResult;
    if (!Either.isLeft(result)) return null;
    return (
        <div className="rounded-[var(--radius)] border border-border bg-panel p-4">
            <ContradictionBanner trace={result.left} />
        </div>
    );
}
