"use client";

import { Result } from "effect";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { type Card, type Player, PlayerOwner } from "../../../logic/GameObjects";
import { KnownCard } from "../../../logic/InitialKnowledge";
import { getCellByOwnerCard, N, Y } from "../../../logic/Knowledge";
import { useClue } from "../../state";
import { firstDealtHandSizes } from "../firstDealt";

/**
 * Checklist-style grid for "which player has which card."
 *
 * Rows are cards (grouped by category header rows that mirror the
 * play-mode Checklist's `bg-category-header` strip). Columns are the
 * players passed in `players`. Each cell is a checkbox: ticking
 * dispatches `addKnownCard` / `removeKnownCard` against the same
 * `state.knownCards` slice that `PlayerColumnCardList` used to.
 *
 * Cell **backgrounds** are derived from the **deduction-only** slice
 * of knowledge (`state.derived.deductionResult`). They paint green for
 * a deduced Y and red for a deduced N — so as the user ticks cards
 * into a player's hand and the deducer concludes "this column is now
 * full", the remaining cells visually fill red without any auto-fill
 * logic here. The deducer's failure mode (a manual tick that
 * contradicts deductions) is surfaced by the global
 * `GlobalContradictionBanner`; no inline error UI in the grid.
 *
 * Per-column counter shows "Identified X of Y in hand" using the hand
 * size from (1) `handSizeOverrides`, (2) `setup.handSizes` user
 * override, or (3) `firstDealtHandSizes` default — first match wins.
 *
 * Single-column mode is just `players.length === 1` — no separate
 * layout branch. That's how Projects 2 (share import) and 3 (My Cards
 * null state) consume this component.
 */
interface Props {
    readonly players: ReadonlyArray<Player>;
    readonly firstCellTourAnchor?: string;
    readonly readOnly?: boolean;
    readonly handSizeOverrides?: ReadonlyMap<Player, number>;
}

// Whole-cell click target. The label fills the td, so any tap inside
// the cell toggles the checkbox (the checkbox itself sits in the middle
// for visual focus, but the click region is the entire cell). Hover /
// focus-within ring matches the play-mode Checklist's cell ring.
const CELL_INTERACTIVE_RING =
    "cursor-pointer hover:not-focus-within:ring-2 hover:not-focus-within:ring-accent/30 focus-within:ring-[3px] focus-within:ring-accent focus-within:outline-none";

export function CardSelectionGrid({
    players,
    firstCellTourAnchor,
    readOnly = false,
    handSizeOverrides,
}: Props) {
    const t = useTranslations("setupWizard.cardSelection");
    const { state, derived, dispatch } = useClue();
    const setup = state.setup;

    // The deduction-only knowledge slice. Used purely for cell
    // backgrounds. When the deducer fails (contradiction), fall back
    // to the initial knowledge — the user's manual ticks still paint
    // through (initial knowledge contains the user's known cards),
    // and `GlobalContradictionBanner` handles the failure messaging.
    const knowledge = useMemo(() => {
        const dr = derived.deductionResult;
        return Result.isSuccess(dr) ? dr.success : derived.initialKnowledge;
    }, [derived.deductionResult, derived.initialKnowledge]);

    // O(1) "does this player have this card" lookup for checkbox state.
    const ownedSet = useMemo(() => {
        const set = new Set<string>();
        for (const kc of state.knownCards) {
            set.add(`${String(kc.player)}::${String(kc.card)}`);
        }
        return set;
    }, [state.knownCards]);

    const isOwned = (player: Player, card: Card) =>
        ownedSet.has(`${String(player)}::${String(card)}`);

    const toggle = (player: Player, card: Card) => {
        if (readOnly) return;
        if (isOwned(player, card)) {
            const idx = state.knownCards.findIndex(
                kc => kc.player === player && kc.card === card,
            );
            if (idx >= 0) dispatch({ type: "removeKnownCard", index: idx });
        } else {
            dispatch({
                type: "addKnownCard",
                card: KnownCard({ player, card }),
            });
        }
    };

    // Per-player Y count from user's knownCards (NOT from deduction —
    // the counter measures what the user has explicitly identified).
    const ownedCountByPlayer = useMemo(() => {
        const counts = new Map<Player, number>();
        for (const p of players) counts.set(p, 0);
        for (const kc of state.knownCards) {
            if (counts.has(kc.player)) {
                counts.set(kc.player, (counts.get(kc.player) ?? 0) + 1);
            }
        }
        return counts;
    }, [state.knownCards, players]);

    // Hand size denominator. Override > setup.handSizes user pin >
    // firstDealtHandSizes default.
    const handSizeByPlayer = useMemo(() => {
        const result = new Map<Player, number>();
        const dealtDefaults = new Map(
            firstDealtHandSizes(setup, state.firstDealtPlayerId),
        );
        for (const p of players) {
            const override = handSizeOverrides?.get(p);
            if (override !== undefined) {
                result.set(p, override);
                continue;
            }
            const fromSetup = state.handSizes.find(
                ([h]: readonly [Player, number]) => h === p,
            )?.[1];
            if (fromSetup !== undefined) {
                result.set(p, fromSetup);
                continue;
            }
            result.set(p, dealtDefaults.get(p) ?? 0);
        }
        return result;
    }, [
        players,
        setup,
        state.handSizes,
        state.firstDealtPlayerId,
        handSizeOverrides,
    ]);

    // First interactive cell — receives the optional tour anchor.
    const firstCardId = setup.categories[0]?.cards[0]?.id;
    const firstPlayerId = players[0];

    if (players.length === 0 || setup.categories.length === 0) {
        return null;
    }

    return (
        <div className="flex justify-center overflow-x-auto">
            <table className="border-collapse rounded border border-border/40 text-[1rem]">
                <thead>
                    <tr>
                        <th className="border-b border-border bg-panel" />
                        {players.map(player => {
                            const owned =
                                ownedCountByPlayer.get(player) ?? 0;
                            const total =
                                handSizeByPlayer.get(player) ?? 0;
                            return (
                                <th
                                    key={String(player)}
                                    className="border-b border-l border-border px-4 py-2 text-center align-bottom"
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
                    {setup.categories.flatMap(category => {
                        const rows: React.ReactNode[] = [];
                        rows.push(
                            <tr
                                key={`h-${String(category.id)}`}
                                className="bg-category-header"
                            >
                                <th
                                    colSpan={players.length + 1}
                                    className="border-b border-border px-2 py-1 text-left text-[1rem] font-semibold uppercase tracking-[0.05em] text-white"
                                >
                                    {category.name}
                                </th>
                            </tr>,
                        );
                        for (const entry of category.cards) {
                            rows.push(
                                <tr key={String(entry.id)}>
                                    <th
                                        scope="row"
                                        className="truncate border-b border-border bg-panel px-3 py-1 text-left font-normal"
                                    >
                                        {entry.name}
                                    </th>
                                    {players.map(player => {
                                        const owned = isOwned(player, entry.id);
                                        const deduced = getCellByOwnerCard(
                                            knowledge,
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
                                                className={`relative border-b border-l border-border p-0 ${tone}`}
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
