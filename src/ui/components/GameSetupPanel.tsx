"use client";

/**
 * Dormant in commit 18. Checklist.tsx now owns the Setup-mode
 * affordances (inline-editable player / category / card names,
 * add / remove buttons, hand-size row, "+ add card" and "+ add
 * category" rows). CardPackRow.tsx owns the deck-swap row.
 *
 * The file stays on disk as a safety net — commit 19 deletes it
 * once the unified Checklist is confirmed at feature parity.
 */
export function GameSetupPanel() {
    return null;
}
