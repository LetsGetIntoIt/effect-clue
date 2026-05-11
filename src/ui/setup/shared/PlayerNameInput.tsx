"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Player } from "../../../logic/GameObjects";
import { useClue } from "../../state";
import { useConfirm } from "../../hooks/useConfirm";
import { TrashIcon } from "../../components/Icons";

/**
 * Editable player-name input for the setup wizard's player list.
 *
 * Differs from the legacy `<PlayerNameInput>` inside `Checklist.tsx` in
 * that it doesn't participate in the Checklist grid keyboard nav
 * (no `data-cell-row` / `data-cell-col`) — the wizard's accordion is
 * a vertical list, not a 2D grid, so arrow-key navigation between
 * rows is delegated to the up/down buttons in `PlayerListReorder`.
 *
 * Duplicate-name guard runs locally (the reducer doesn't validate);
 * shows an inline error and reverts to the previous value if the
 * user blurs without resolving.
 */
export function PlayerNameInput({
    player,
    allPlayers,
    onCommit,
}: {
    readonly player: Player;
    readonly allPlayers: ReadonlyArray<Player>;
    readonly onCommit?: (newName: Player) => void;
}) {
    const t = useTranslations("setup");
    const { state, dispatch } = useClue();
    const confirm = useConfirm();
    const [editing, setEditing] = useState(String(player));
    const [error, setError] = useState("");

    useEffect(() => {
        setEditing(String(player));
        setError("");
    }, [player]);

    const commit = () => {
        const trimmed = editing.trim();
        if (!trimmed) {
            setEditing(String(player));
            setError("");
            return;
        }
        if (trimmed === String(player)) {
            setError("");
            return;
        }
        if (allPlayers.some(p => String(p) === trimmed)) {
            setError(t("duplicateName"));
            return;
        }
        const next = Player(trimmed);
        dispatch({
            type: "renamePlayer",
            oldName: player,
            newName: next,
        });
        setError("");
        onCommit?.(next);
    };

    // Removing a player can drop their known cards and any
    // suggestions referencing them — confirm in that case.
    const onRemove = async () => {
        const hasKnownCards = state.knownCards.some(
            kc => kc.player === player,
        );
        const hasSuggestions = state.suggestions.some(
            s =>
                s.suggester === player ||
                s.refuter === player ||
                s.nonRefuters.some(p => p === player),
        );
        if (hasKnownCards || hasSuggestions) {
            const ok = await confirm({
                message: t("removePlayerConfirm", {
                    player: String(player),
                }),
            });
            if (!ok) return;
        }
        dispatch({ type: "removePlayer", player });
    };

    return (
        <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
                <input
                    type="text"
                    className="box-border min-w-0 flex-1 rounded border border-border px-2 py-1.5 text-[1rem]"
                    value={editing}
                    onChange={e => {
                        setEditing(e.currentTarget.value);
                        setError("");
                    }}
                    onBlur={commit}
                    onKeyDown={e => {
                        if (e.key === "Enter") {
                            commit();
                            (e.currentTarget as HTMLInputElement).blur();
                        } else if (e.key === "Escape") {
                            setEditing(String(player));
                            setError("");
                            (e.currentTarget as HTMLInputElement).blur();
                        }
                    }}
                />
                <button
                    type="button"
                    className="shrink-0 cursor-pointer rounded border border-border bg-bg p-1.5 text-fg hover:bg-hover"
                    aria-label={t("removePlayerTitle", {
                        player: String(player),
                    })}
                    onClick={onRemove}
                >
                    <TrashIcon size={16} />
                </button>
            </div>
            {error && (
                <span className="text-[1rem] text-danger">
                    {error}
                </span>
            )}
        </div>
    );
}
