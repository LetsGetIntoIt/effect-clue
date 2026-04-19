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
 *
 * Uses Either.getLeft + Option unwrap rather than isLeft + .left so the
 * React Compiler / Turbopack don't hoist a `.left` read ahead of the
 * narrowing check in their IR.
 */
export function GlobalContradictionBanner() {
    const { derived } = useClue();
    const result = derived.deductionResult;
    const trace = Either.isLeft(result) ? result.left : undefined;
    if (!trace) return null;
    return (
        <div className="rounded-[var(--radius)] border border-border bg-panel p-4">
            <ContradictionBanner trace={trace} />
        </div>
    );
}
