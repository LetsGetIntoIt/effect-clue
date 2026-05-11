"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { KnownCard } from "../../../logic/InitialKnowledge";
import type { Card, Player } from "../../../logic/GameObjects";
import { useClue } from "../../state";

/**
 * One column of "does this player own this card?" toggles.
 *
 * Used by the M6 wizard's step 5 (My cards) and step 6 (Other
 * players' cards). The legacy `<Checklist inSetup>` cell-based grid
 * solves the same problem but carries deductions, popovers, leads,
 * and status glyphs that are overkill for "tick the cards you have."
 *
 * Toggle dispatches `addKnownCard` / `removeKnownCard` against the
 * existing `knownCards` slice. Layout:
 *
 * - One header row with the player name (or a custom heading from
 *   the parent for "My cards" — pass `heading` to override).
 * - One row per category, with the category name as a sub-heading
 *   followed by checkbox rows for each card in that category.
 *
 * The component doesn't paginate; the parent controls layout
 * (single column on mobile, grid on desktop) by stacking instances.
 */
interface Props {
    readonly player: Player;
    readonly heading?: string;
    /**
     * Optional `data-tour-anchor` for the very first checkbox row.
     * Used by the M6 setup tour's "Mark your cards" step to spotlight
     * the first row when the column lives in step 5 (My cards). Other
     * mounts (step 6, M8 my-hand panel) leave this undefined.
     */
    readonly firstRowTourAnchor?: string;
}

export function PlayerColumnCardList({
    player,
    heading,
    firstRowTourAnchor,
}: Props) {
    const tSetup = useTranslations("setup");
    const { state, dispatch } = useClue();
    const setup = state.setup;
    const knownCards = state.knownCards;

    // Cache "owns this card?" lookups per render so the per-row
    // toggle doesn't scan `knownCards` linearly.
    const ownedSet = useMemo(() => {
        const set = new Set<Card>();
        for (const kc of knownCards) {
            if (kc.player === player) set.add(kc.card);
        }
        return set;
    }, [knownCards, player]);

    const toggle = (card: Card) => {
        if (ownedSet.has(card)) {
            const idx = knownCards.findIndex(
                kc => kc.player === player && kc.card === card,
            );
            if (idx >= 0) {
                dispatch({ type: "removeKnownCard", index: idx });
            }
        } else {
            dispatch({
                type: "addKnownCard",
                card: KnownCard({ player, card }),
            });
        }
    };

    const heading_ = heading ?? String(player);

    // Stable identity of the very first card across all categories.
    // Tagged with `firstRowTourAnchor` (when provided) so the setup
    // tour's "Mark your cards" step can spotlight a single row rather
    // than the whole column.
    const firstCardId = setup.categories[0]?.cards[0]?.id;

    return (
        <div className="flex min-w-0 flex-col gap-2 rounded border border-border/40 p-3">
            <h3 className="m-0 truncate text-[1.125rem] font-semibold">
                {heading_}
            </h3>
            <div className="flex flex-col gap-3">
                {setup.categories.map(category => (
                    <div
                        key={String(category.id)}
                        className="flex flex-col gap-1"
                    >
                        <span className="text-[1rem] uppercase tracking-wide text-muted">
                            {category.name}
                        </span>
                        <ul className="m-0 flex list-none flex-col gap-1 p-0">
                            {category.cards.map(entry => {
                                const owned = ownedSet.has(entry.id);
                                const isFirst =
                                    firstRowTourAnchor !== undefined &&
                                    entry.id === firstCardId;
                                return (
                                    <li
                                        key={String(entry.id)}
                                        className="flex items-center gap-2"
                                        {...(isFirst
                                            ? {
                                                  "data-tour-anchor":
                                                      firstRowTourAnchor,
                                              }
                                            : {})}
                                    >
                                        <label className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-hover">
                                            <input
                                                type="checkbox"
                                                checked={owned}
                                                onChange={() =>
                                                    toggle(entry.id)
                                                }
                                                aria-label={tSetup(
                                                    "knownCardCheckboxAria",
                                                    {
                                                        player: String(player),
                                                        card: entry.name,
                                                    },
                                                )}
                                            />
                                            <span className="text-[1rem]">
                                                {entry.name}
                                            </span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </div>
        </div>
    );
}

