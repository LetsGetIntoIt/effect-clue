"use client";

import { Reorder } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { Player } from "../../../logic/GameObjects";
import { useClue } from "../../state";
import { ChevronLeftIcon, ChevronRightIcon } from "../../components/Icons";
import { PlayerNameInput } from "./PlayerNameInput";

// Reorder.Group axis prop value — module-scope constant so the
// i18next/no-literal-string lint treats it as a wire identifier.
const REORDER_AXIS_Y = "y" as const;

// Decorative drag-handle glyph (two vertical ellipses). Hoisted to
// module scope so the i18next lint rule reads it as a font glyph,
// not a translatable string.
const DRAG_HANDLE_GLYPH = "⋮⋮";

// Tour anchor shared with the M6 setup tour's "Players in turn order"
// step.
const PLAYERS_LIST_TOUR_ANCHOR = "setup-step-players-list" as const;

/**
 * Drag-to-reorder list of players, plus inline name + remove
 * controls per row and explicit up/down arrow buttons for keyboard
 * a11y.
 *
 * Drag drops dispatch a single `reorderPlayers` action with the new
 * full ordering — one undo step per user-perceived reorder, not one
 * per index swap.
 *
 * The arrow buttons drive the existing `movePlayer` action (left/
 * right semantics) for keyboard a11y. Visually they're stacked
 * vertically; "left" maps to "up" / "right" maps to "down" so a
 * vertical list reads correctly.
 *
 * Local state mirrors `state.setup.players` so the dragging hand
 * stays smooth; we only dispatch on drag end. A `useEffect` resets
 * the local list whenever the canonical order changes (via arrow
 * buttons, undo, or another tab's localStorage sync).
 */
export function PlayerListReorder() {
    const tSetup = useTranslations("setup");
    const { state, dispatch } = useClue();
    const players = state.setup.players;

    const [draft, setDraft] = useState<ReadonlyArray<Player>>(players);
    useEffect(() => {
        setDraft(players);
    }, [players]);

    const commitReorder = (next: ReadonlyArray<Player>) => {
        const sameOrder =
            next.length === players.length &&
            next.every((p, i) => p === players[i]);
        if (sameOrder) return;
        dispatch({ type: "reorderPlayers", players: next });
    };

    return (
        <div className="flex flex-col gap-2">
            <Reorder.Group
                axis={REORDER_AXIS_Y}
                values={[...draft]}
                onReorder={(next: ReadonlyArray<Player>) => {
                    setDraft(next);
                }}
                className="m-0 flex list-none flex-col gap-2 p-0"
                data-tour-anchor={PLAYERS_LIST_TOUR_ANCHOR}
            >
                {draft.map((player, i) => (
                    <Reorder.Item
                        key={player}
                        value={player}
                        onDragEnd={() => commitReorder(draft)}
                        className="flex touch-none items-center gap-2 rounded border border-border/50 bg-control px-2 py-1.5"
                    >
                        <PlayerNameInput
                            player={player}
                            allPlayers={players}
                        />
                        <div className="flex shrink-0 flex-col">
                            <button
                                type="button"
                                className="flex h-6 w-7 cursor-pointer items-center justify-center rounded border-none bg-transparent text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                                disabled={i === 0}
                                aria-label={tSetup("movePlayerLeftTitle", {
                                    player: String(player),
                                })}
                                onClick={() =>
                                    dispatch({
                                        type: "movePlayer",
                                        player,
                                        direction: "left",
                                    })
                                }
                            >
                                <ChevronLeftIcon
                                    size={14}
                                    className="-rotate-90"
                                />
                            </button>
                            <button
                                type="button"
                                className="flex h-6 w-7 cursor-pointer items-center justify-center rounded border-none bg-transparent text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                                disabled={i === players.length - 1}
                                aria-label={tSetup("movePlayerRightTitle", {
                                    player: String(player),
                                })}
                                onClick={() =>
                                    dispatch({
                                        type: "movePlayer",
                                        player,
                                        direction: "right",
                                    })
                                }
                            >
                                <ChevronRightIcon
                                    size={14}
                                    className="-rotate-90"
                                />
                            </button>
                        </div>
                        {/* Drag handle on the right, separated from the
                            trash (inside PlayerNameInput) by the arrow
                            buttons + an extra ml-3 so a thumb reaching
                            for the handle can't accidentally hit the
                            trash. */}
                        <span
                            aria-hidden
                            className="ml-3 shrink-0 cursor-grab select-none text-[1.125rem] leading-none text-muted"
                        >
                            {DRAG_HANDLE_GLYPH}
                        </span>
                    </Reorder.Item>
                ))}
            </Reorder.Group>

            <button
                type="button"
                className="tap-target-compact text-tap-compact self-start cursor-pointer rounded border border-border bg-control hover:bg-hover"
                onClick={() => dispatch({ type: "addPlayer" })}
            >
                {tSetup("addPlayerLabel")}
            </button>
        </div>
    );
}
