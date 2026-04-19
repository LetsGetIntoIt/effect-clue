"use client";

import { useEffect, useState } from "react";
import { Player } from "../../logic/GameObjects";
import {
    allCardIds,
    caseFileSize,
    defaultHandSizes,
    GameSetup,
    PRESETS,
} from "../../logic/GameSetup";
import {
    CustomPreset,
    deleteCustomPreset,
    loadCustomPresets,
    saveCustomPreset,
} from "../../logic/CustomPresets";
import { useClue } from "../state";
import { CategoryEditor } from "./CategoryEditor";

const PRESET_CONFIRM =
    "Loading a preset will discard your current hand sizes, known " +
    "cards, and suggestions. Continue?";

/**
 * Editable text cell. Commits the new value on blur or Enter; resets to
 * the external value on Escape or if the input is cleared. The external
 * `value` prop wins whenever it changes, so upstream changes (e.g.
 * preset switch) propagate in cleanly.
 */
function InlineTextEdit({
    value,
    onCommit,
    className,
    title,
}: {
    value: string;
    onCommit: (next: string) => void;
    className?: string;
    title?: string;
}) {
    const [local, setLocal] = useState(value);
    useEffect(() => {
        setLocal(value);
    }, [value]);

    const commit = () => {
        const trimmed = local.trim();
        if (trimmed.length === 0) {
            setLocal(value);
            return;
        }
        if (trimmed !== value) onCommit(trimmed);
    };

    return (
        <input
            type="text"
            value={local}
            className={className}
            title={title}
            onChange={e => setLocal(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={e => {
                if (e.key === "Enter") {
                    (e.currentTarget as HTMLInputElement).blur();
                } else if (e.key === "Escape") {
                    setLocal(value);
                    (e.currentTarget as HTMLInputElement).blur();
                }
            }}
        />
    );
}

function PlayerNameInput({
    player,
    allPlayers,
}: {
    player: Player;
    allPlayers: ReadonlyArray<Player>;
}) {
    const { dispatch } = useClue();
    const [editing, setEditing] = useState(String(player));
    const [error, setError] = useState("");

    // Resync local state only when the player prop itself changes
    // (rename committed elsewhere, "New game" pressed, etc.). Doing this
    // unconditionally during render would clobber every keystroke.
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
            setError("Duplicate name");
            return;
        }
        dispatch({
            type: "renamePlayer",
            oldName: player,
            newName: Player(trimmed),
        });
        setError("");
    };

    return (
        <div className="flex flex-col items-stretch gap-0.5">
            <input
                type="text"
                className="box-border w-full rounded border border-border px-1.5 py-1 text-[12px]"
                value={editing}
                onChange={e => {
                    setEditing(e.currentTarget.value);
                    setError("");
                }}
                onBlur={commit}
                onKeyDown={e => {
                    if (e.key === "Enter") commit();
                }}
            />
            {error && (
                <span className="whitespace-nowrap text-[11px] text-danger">
                    {error}
                </span>
            )}
            <button
                type="button"
                className="self-center border-none bg-transparent px-1 text-[14px] leading-none text-muted hover:text-danger"
                title={`Remove ${player}`}
                onClick={() => dispatch({ type: "removePlayer", player })}
            >
                &times;
            </button>
        </div>
    );
}

export function GameSetupPanel() {
    const { state, dispatch, hasGameData } = useClue();
    const setup: GameSetup = state.setup;
    const handSizeMap = new Map(state.handSizes);
    const defaults = new Map(defaultHandSizes(setup));

    // User-saved card packs, kept in React state so save/delete
    // re-renders the preset row without a page reload.
    const [customPresets, setCustomPresets] =
        useState<ReadonlyArray<CustomPreset>>(() => loadCustomPresets());

    const totalDealt = allCardIds(setup).length - caseFileSize(setup);
    const setHandSizesArr = setup.players
        .map(p => handSizeMap.get(p))
        .filter((n): n is number => typeof n === "number");
    const allHandSizesSet =
        setHandSizesArr.length === setup.players.length &&
        setup.players.length > 0;
    const handSizesTotal = setHandSizesArr.reduce((a, b) => a + b, 0);
    const handSizeMismatch =
        allHandSizesSet && handSizesTotal !== totalDealt;

    const onPreset = (preset: (typeof PRESETS)[number]) => {
        if (hasGameData() && !window.confirm(PRESET_CONFIRM)) return;
        dispatch({ type: "loadPreset", setup: preset.build() });
    };

    const onCustomPreset = (preset: CustomPreset) => {
        if (hasGameData() && !window.confirm(PRESET_CONFIRM)) return;
        // Load the preset's categories on top of the current player list.
        dispatch({
            type: "loadPreset",
            setup: GameSetup({
                players: setup.players,
                categories: preset.categories,
            }),
        });
    };

    const onSaveAsPreset = () => {
        const label = window.prompt(
            "Save this card pack as a preset. Name it:",
        );
        if (!label || !label.trim()) return;
        saveCustomPreset(label.trim(), setup);
        setCustomPresets(loadCustomPresets());
    };

    const onDeleteCustomPreset = (preset: CustomPreset) => {
        if (!window.confirm(`Delete preset "${preset.label}"?`)) return;
        deleteCustomPreset(preset.id);
        setCustomPresets(loadCustomPresets());
    };

    const onHandSizeChange = (player: Player, raw: string) => {
        if (raw === "") {
            dispatch({ type: "setHandSize", player, size: undefined });
            return;
        }
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) {
            dispatch({ type: "setHandSize", player, size: n });
        }
    };

    // Card rows span the full table width (label + player columns + the
    // add-player column) because known-card entry now happens by clicking
    // cells in the ChecklistGrid — this table is purely about editing
    // the deck and player roster.
    const cardSpan = setup.players.length + 2;

    return (
        <section className="min-w-0 rounded-[var(--radius)] border border-border bg-panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="m-0 text-[16px] uppercase tracking-[0.05em] text-accent">
                    Game setup
                </h2>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-muted">
                    Preset:
                </span>
                {PRESETS.map(preset => (
                    <button
                        key={preset.id}
                        type="button"
                        className="cursor-pointer rounded border border-border bg-white px-3 py-1 text-[13px] hover:bg-hover"
                        onClick={() => onPreset(preset)}
                    >
                        {preset.label}
                    </button>
                ))}
                {customPresets.map(preset => (
                    <span
                        key={preset.id}
                        className="inline-flex items-center overflow-hidden rounded border border-border bg-white text-[13px]"
                    >
                        <button
                            type="button"
                            className="cursor-pointer px-3 py-1 hover:bg-hover"
                            onClick={() => onCustomPreset(preset)}
                            title={`Load custom preset "${preset.label}"`}
                        >
                            {preset.label}
                        </button>
                        <button
                            type="button"
                            className="cursor-pointer border-l border-border px-2 py-1 text-muted hover:bg-hover hover:text-danger"
                            onClick={() => onDeleteCustomPreset(preset)}
                            title={`Delete preset "${preset.label}"`}
                            aria-label={`Delete preset ${preset.label}`}
                        >
                            ×
                        </button>
                    </span>
                ))}
                <button
                    type="button"
                    className="cursor-pointer rounded border border-dashed border-border bg-white px-3 py-1 text-[13px] text-muted hover:bg-hover hover:text-accent"
                    onClick={onSaveAsPreset}
                    title="Save the current category and card set as a reusable preset"
                >
                    + Save as preset
                </button>
            </div>

            <div className="mb-3">
                <CategoryEditor />
            </div>

            {handSizeMismatch && (
                <div className="mb-3 rounded-[var(--radius)] border border-warning-border bg-warning-bg px-3 py-2 text-[13px] text-warning">
                    Hand sizes total {handSizesTotal} card
                    {handSizesTotal === 1 ? "" : "s"}; should total&nbsp;
                    {totalDealt} after the {caseFileSize(setup)} case-file
                    cards.
                </div>
            )}

            <div className="overflow-x-auto rounded-[var(--radius)] border border-border">
                <table className="w-full border-collapse text-[12px]">
                    <thead>
                        <tr>
                            <th className="border border-border bg-row-header px-1.5 py-1 text-left"></th>
                            {setup.players.map(p => (
                                <th
                                    key={p}
                                    className="min-w-[110px] border border-border bg-row-header px-1 py-1 align-top"
                                >
                                    <PlayerNameInput
                                        player={p}
                                        allPlayers={setup.players}
                                    />
                                </th>
                            ))}
                            <th className="w-8 border border-border bg-row-header px-1.5 py-1 text-center">
                                <button
                                    type="button"
                                    className="h-6 w-6 cursor-pointer rounded border-none bg-accent text-[16px] leading-none text-white hover:bg-accent-hover"
                                    title="Add player"
                                    onClick={() =>
                                        dispatch({ type: "addPlayer" })
                                    }
                                >
                                    +
                                </button>
                            </th>
                        </tr>
                        <tr>
                            <th className="whitespace-nowrap border border-border bg-row-header px-1.5 py-1 text-left font-semibold">
                                Hand size
                            </th>
                            {setup.players.map(p => {
                                const current = handSizeMap.get(p);
                                const def = defaults.get(p);
                                return (
                                    <td
                                        key={p}
                                        className="border border-border px-1.5 py-1 text-center"
                                    >
                                        <input
                                            type="number"
                                            min={0}
                                            max={allCardIds(setup).length}
                                            className="w-14 rounded border border-border p-0.5 text-center text-[12px]"
                                            value={
                                                current === undefined
                                                    ? ""
                                                    : String(current)
                                            }
                                            placeholder={
                                                def === undefined
                                                    ? ""
                                                    : String(def)
                                            }
                                            onChange={e =>
                                                onHandSizeChange(
                                                    p,
                                                    e.currentTarget.value,
                                                )
                                            }
                                        />
                                    </td>
                                );
                            })}
                            <td className="border border-border"></td>
                        </tr>
                    </thead>
                    <tbody>
                        {setup.categories.flatMap((cat) => {
                            const canRemoveCategory =
                                setup.categories.length > 1;
                            const canRemoveCard = cat.cards.length > 1;
                            return [
                                <tr key={`h-${String(cat.id)}`}>
                                    <th
                                        colSpan={cardSpan}
                                        className="border border-border bg-accent px-1.5 py-1 text-left text-[10px] uppercase tracking-[0.05em] text-white"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <InlineTextEdit
                                                value={cat.name}
                                                className="min-w-0 flex-1 rounded border border-white/30 bg-transparent px-1 py-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-white focus:bg-white/10 focus:outline-none"
                                                title="Rename category"
                                                onCommit={next =>
                                                    dispatch({
                                                        type: "renameCategory",
                                                        categoryId: cat.id,
                                                        name: next,
                                                    })
                                                }
                                            />
                                            <button
                                                type="button"
                                                title={
                                                    canRemoveCategory
                                                        ? `Remove ${cat.name}`
                                                        : "At least one category is required"
                                                }
                                                disabled={!canRemoveCategory}
                                                className="cursor-pointer border-none bg-transparent p-0 text-[14px] leading-none text-white/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                                onClick={() =>
                                                    dispatch({
                                                        type: "removeCategoryById",
                                                        categoryId: cat.id,
                                                    })
                                                }
                                            >
                                                &times;
                                            </button>
                                        </div>
                                    </th>
                                </tr>,
                                ...cat.cards.map(entry => (
                                    <tr key={String(entry.id)}>
                                        <th
                                            colSpan={cardSpan}
                                            className="whitespace-nowrap border border-border bg-white px-1.5 py-1 text-left font-normal"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <InlineTextEdit
                                                    value={entry.name}
                                                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] hover:border-border focus:border-accent focus:outline-none"
                                                    title="Rename card"
                                                    onCommit={next =>
                                                        dispatch({
                                                            type: "renameCard",
                                                            cardId: entry.id,
                                                            name: next,
                                                        })
                                                    }
                                                />
                                                <button
                                                    type="button"
                                                    title={
                                                        canRemoveCard
                                                            ? `Remove ${entry.name}`
                                                            : "At least one card per category is required"
                                                    }
                                                    disabled={!canRemoveCard}
                                                    className="cursor-pointer border-none bg-transparent p-0 text-[14px] leading-none text-muted hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                                                    onClick={() =>
                                                        dispatch({
                                                            type: "removeCardById",
                                                            cardId: entry.id,
                                                        })
                                                    }
                                                >
                                                    &times;
                                                </button>
                                            </div>
                                        </th>
                                    </tr>
                                )),
                                <tr key={`add-card-${String(cat.id)}`}>
                                    <th
                                        colSpan={cardSpan}
                                        className="border border-border bg-row-alt px-1.5 py-1 text-left"
                                    >
                                        <button
                                            type="button"
                                            className="cursor-pointer border-none bg-transparent p-0 text-[12px] text-accent underline"
                                            onClick={() =>
                                                dispatch({
                                                    type: "addCardToCategoryById",
                                                    categoryId: cat.id,
                                                })
                                            }
                                        >
                                            + add card
                                        </button>
                                    </th>
                                </tr>,
                            ];
                        })}
                        <tr>
                            <th
                                colSpan={cardSpan}
                                className="border border-border bg-row-alt px-1.5 py-2 text-center"
                            >
                                <button
                                    type="button"
                                    className="cursor-pointer rounded border border-border bg-white px-3 py-1 text-[13px] hover:bg-hover"
                                    onClick={() =>
                                        dispatch({ type: "addCategory" })
                                    }
                                >
                                    + add category
                                </button>
                            </th>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>
    );
}
