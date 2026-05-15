"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { CardSet } from "../../../logic/CardSet";
import { type Card, type Player, PlayerOwner } from "../../../logic/GameObjects";
import { KnownCard } from "../../../logic/InitialKnowledge";
import { getCellByOwnerCard, type Knowledge, N, Y } from "../../../logic/Knowledge";

/**
 * Checklist-style grid for "which player has which card."
 *
 * Rows are cards (grouped by category header rows that mirror the
 * play-mode Checklist's `bg-category-header` strip). Columns are the
 * players passed in `players`. Each cell is a checkbox: ticking
 * invokes `onAddKnownCard` / `onRemoveKnownCard`, which the parent
 * wires up against the right `knownCards` slice.
 *
 * Cell **backgrounds** are derived from `deductionKnowledge` — pass
 * the deduction-only slice of knowledge to paint green for a deduced
 * Y and red for a deduced N. As the user ticks cards into a player's
 * hand and the parent's deducer concludes "this column is now full",
 * the remaining cells visually fill red without any auto-fill logic
 * here. The deducer's failure mode (a manual tick that contradicts
 * deductions) is surfaced by the global `GlobalContradictionBanner`;
 * no inline error UI in the grid.
 *
 * Per-column counter shows "Identified X of Y in hand" using the
 * `handSizes` Map passed in by the caller. Empty entries (player
 * missing from the map) display "0 of 0".
 *
 * Single-column mode is just `players.length === 1` — no separate
 * layout branch. That's how Projects 2 (share import) and 3 (My Cards
 * null state) consume this component.
 *
 * The grid is intentionally stateless and unaware of `useClue()` —
 * wizard call sites compose the props via `useCardSelectionGridProps`,
 * while the share-import modal wires them from snapshot-derived
 * state. Project 3 (My Cards null state in play mode) will use the
 * hook the same way the wizard does.
 */
interface Props {
    readonly players: ReadonlyArray<Player>;
    readonly cardSet: CardSet;
    readonly knownCards: ReadonlyArray<KnownCard>;
    readonly handSizes: ReadonlyMap<Player, number>;
    readonly deductionKnowledge: Knowledge;
    readonly onAddKnownCard: (card: KnownCard) => void;
    readonly onRemoveKnownCard: (index: number) => void;
    readonly firstCellTourAnchor?: string;
    readonly readOnly?: boolean;
}

// Whole-cell click target. The label fills the td, so any tap inside
// the cell toggles the checkbox (the checkbox itself sits in the middle
// for visual focus, but the click region is the entire cell). Hover /
// focus-within ring matches the play-mode Checklist's cell ring.
const CELL_INTERACTIVE_RING =
    "cursor-pointer hover:not-focus-within:ring-2 hover:not-focus-within:ring-accent/30 focus-within:ring-[3px] focus-within:ring-accent focus-within:outline-none";

// Sticky positioning for the grid, mirroring `Checklist.tsx`'s token
// ladder so the visual language of "headers stay visible during scroll"
// reads the same in setup as in play. Z-index variables are defined in
// `app/globals.css`:
//   - --z-checklist-sticky-column (30): tbody first column (card
//     category-header + card name cells)
//   - --z-checklist-sticky-top-left (36): the top-left corner cell —
//     sticky in both axes, must cover the sticky-left column on
//     horizontal scroll
//   - --z-checklist-sticky-header (39): thead non-corner cells —
//     covers the body's sticky-left column on horizontal scroll
//
// `top` resolves to "below the fixed page header (and contradiction
// banner if it's visible)" via the same CSS variables Clue.tsx
// publishes for the play-mode Checklist. When the wizard is the only
// thing on screen, those variables fall back to 0 so the thead pins
// to viewport top. The `z-index` on the thead element itself is
// load-bearing — `position: sticky` alone doesn't elevate the thead
// above tbody in the table's stacking, so without the explicit
// z-index the body's `<td>` (later in document order) would paint
// over the thead during scroll. Matches `Checklist.tsx`'s thead.
const STICKY_THEAD_TOP =
    "sticky top-[calc(var(--contradiction-banner-offset,0px)+var(--header-offset,0px))] z-[var(--z-checklist-sticky-header)]";
const STICKY_FIRST_COL =
    "sticky left-0 z-[var(--z-checklist-sticky-column)]";
const STICKY_FIRST_COL_HEADER =
    "sticky left-0 z-[var(--z-checklist-sticky-top-left)]";
// `relative` so the non-corner thead cells form their own stacking
// context above the body's sticky-left column. Without this, the
// sticky-left tbody cells (z-[--z-checklist-sticky-column] = 30)
// would render OVER non-positioned thead cells during horizontal
// scroll — the player-name column headers would slide under the
// card-name column. Matches `COLUMN_HEADER_STACK` in `Checklist.tsx`.
const COLUMN_HEADER_STACK =
    "relative z-[var(--z-checklist-sticky-header)]";

export function CardSelectionGrid({
    players,
    cardSet,
    knownCards,
    handSizes,
    deductionKnowledge,
    onAddKnownCard,
    onRemoveKnownCard,
    firstCellTourAnchor,
    readOnly = false,
}: Props) {
    const t = useTranslations("setupWizard.cardSelection");

    // O(1) "does this player have this card" lookup for checkbox state.
    const ownedSet = useMemo(() => {
        const set = new Set<string>();
        for (const kc of knownCards) {
            set.add(`${String(kc.player)}::${String(kc.card)}`);
        }
        return set;
    }, [knownCards]);

    const isOwned = (player: Player, card: Card) =>
        ownedSet.has(`${String(player)}::${String(card)}`);

    const toggle = (player: Player, card: Card) => {
        if (readOnly) return;
        if (isOwned(player, card)) {
            const idx = knownCards.findIndex(
                kc => kc.player === player && kc.card === card,
            );
            if (idx >= 0) onRemoveKnownCard(idx);
        } else {
            onAddKnownCard(KnownCard({ player, card }));
        }
    };

    // Per-player Y count from user's knownCards (NOT from deduction —
    // the counter measures what the user has explicitly identified).
    const ownedCountByPlayer = useMemo(() => {
        const counts = new Map<Player, number>();
        for (const p of players) counts.set(p, 0);
        for (const kc of knownCards) {
            if (counts.has(kc.player)) {
                counts.set(kc.player, (counts.get(kc.player) ?? 0) + 1);
            }
        }
        return counts;
    }, [knownCards, players]);

    // First interactive cell — receives the optional tour anchor.
    const firstCardId = cardSet.categories[0]?.cards[0]?.id;
    const firstPlayerId = players[0];

    if (players.length === 0 || cardSet.categories.length === 0) {
        return null;
    }

    return (
        <div className="flex justify-center">
            <table className="border-collapse rounded border border-border/40 text-[1rem]">
                <thead className={STICKY_THEAD_TOP}>
                    <tr>
                        <th
                            // `border-b` is replaced with an inset
                            // box-shadow because `border-collapse:
                            // collapse` shares the bottom border with
                            // the next row's top border — the merged
                            // line sits at the seam between thead and
                            // tbody. As tbody rows scroll under the
                            // sticky thead, the seam can flash the
                            // body row's bg (especially the maroon
                            // `bg-category-header` strip) at sub-pixel
                            // boundaries. Painting the bottom edge as
                            // an inset shadow inside the cell's
                            // bg-panel layer keeps it pinned with the
                            // sticky cell instead of at the merge
                            // line, eliminating the bleed.
                            className={`bg-panel shadow-[inset_0_-1px_0_var(--color-border)] ${STICKY_FIRST_COL_HEADER}`}
                        />
                        {players.map(player => {
                            const owned =
                                ownedCountByPlayer.get(player) ?? 0;
                            const total =
                                handSizes.get(player) ?? 0;
                            return (
                                <th
                                    key={String(player)}
                                    // Both LEFT and BOTTOM borders are
                                    // painted as inset shadows inside
                                    // the cell's bg-panel layer. The
                                    // CSS `border-collapse: collapse`
                                    // merges adjacent borders at the
                                    // seam between the sticky thead
                                    // and the body's category-header
                                    // row beneath — at sub-pixel
                                    // boundaries the maroon
                                    // `bg-category-header` flashes
                                    // through both the bottom seam
                                    // AND the vertical column-divider
                                    // seams during scroll. Painting
                                    // the borders inside the cell's
                                    // own paint layer pins them with
                                    // the sticky cell.
                                    className={`bg-panel px-4 py-2 text-center align-bottom shadow-[inset_1px_0_0_var(--color-border),inset_0_-1px_0_var(--color-border)] ${COLUMN_HEADER_STACK}`}
                                >
                                    <div className="truncate font-semibold">
                                        {String(player)}
                                    </div>
                                    <div className="text-[0.875rem] font-normal text-muted">
                                        {t("counter", {
                                            count: owned,
                                            total,
                                        })}
                                    </div>
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {cardSet.categories.flatMap(category => {
                        const rows: React.ReactNode[] = [];
                        rows.push(
                            // Category-header row mirrors the play-mode
                            // Checklist: a sticky-left `<th>` carrying the
                            // label, plus a spanning `<td>` filler. Both
                            // cells paint the maroon `bg-category-header`
                            // tone so the strip reads as one continuous row
                            // even when the table scrolls horizontally and
                            // the sticky-left `<th>` floats above the
                            // filler.
                            <tr
                                key={`h-${String(category.id)}`}
                                className="bg-category-header"
                            >
                                <th
                                    className={`border-b border-border bg-category-header px-2 py-1 text-left text-[1rem] font-semibold uppercase tracking-[0.05em] text-white ${STICKY_FIRST_COL}`}
                                >
                                    {category.name}
                                </th>
                                <td
                                    colSpan={players.length}
                                    className="border-b border-border bg-category-header"
                                />
                            </tr>,
                        );
                        for (const entry of category.cards) {
                            rows.push(
                                <tr key={String(entry.id)}>
                                    <th
                                        scope="row"
                                        className={`truncate border-b border-border bg-panel px-3 py-1 text-left font-normal ${STICKY_FIRST_COL}`}
                                    >
                                        {entry.name}
                                    </th>
                                    {players.map(player => {
                                        const owned = isOwned(player, entry.id);
                                        const deduced = getCellByOwnerCard(
                                            deductionKnowledge,
                                            PlayerOwner(player),
                                            entry.id,
                                        );
                                        const isFirstCell =
                                            firstCellTourAnchor !==
                                                undefined &&
                                            entry.id === firstCardId &&
                                            player === firstPlayerId;
                                        const tone =
                                            deduced === Y
                                                ? "bg-yes-bg"
                                                : deduced === N
                                                  ? "bg-no-bg"
                                                  : "bg-white";
                                        return (
                                            <td
                                                key={`${String(player)}::${String(entry.id)}`}
                                                // Explicit `z-0` traps the
                                                // native `<input
                                                // type=checkbox>` inside
                                                // the cell's stacking
                                                // context. Without it,
                                                // Chrome / Safari can
                                                // promote the form
                                                // control to a higher
                                                // paint layer, so the
                                                // checkbox glyph leaks
                                                // through the sticky
                                                // thead (z-index 39) and
                                                // sticky-left column
                                                // (z-index 30) during
                                                // scroll. The cell is
                                                // already `position:
                                                // relative` from the
                                                // ring + label sizing.
                                                className={`relative z-0 border-b border-l border-border p-0 ${tone}`}
                                                {...(isFirstCell
                                                    ? {
                                                          "data-tour-anchor":
                                                              firstCellTourAnchor,
                                                      }
                                                    : {})}
                                            >
                                                <label
                                                    className={`flex h-full w-full items-center justify-center px-4 py-1.5 ${readOnly ? "cursor-default" : CELL_INTERACTIVE_RING}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="cursor-pointer"
                                                        checked={owned}
                                                        disabled={readOnly}
                                                        onChange={() =>
                                                            toggle(
                                                                player,
                                                                entry.id,
                                                            )
                                                        }
                                                        aria-label={t(
                                                            "cellAria",
                                                            {
                                                                player: String(
                                                                    player,
                                                                ),
                                                                card: entry.name,
                                                            },
                                                        )}
                                                    />
                                                </label>
                                            </td>
                                        );
                                    })}
                                </tr>,
                            );
                        }
                        return rows;
                    })}
                </tbody>
            </table>
        </div>
    );
}
