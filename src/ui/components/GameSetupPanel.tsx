"use client";

import { useTranslations } from "next-intl";
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
    editable,
}: {
    player: Player;
    allPlayers: ReadonlyArray<Player>;
    editable: boolean;
}) {
    const t = useTranslations("setup");
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
            setError(t("duplicateName"));
            return;
        }
        dispatch({
            type: "renamePlayer",
            oldName: player,
            newName: Player(trimmed),
        });
        setError("");
    };

    if (!editable) {
        return (
            <div className="px-1 py-1 text-center text-[12px] font-semibold">
                {String(player)}
            </div>
        );
    }

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
                title={t("removePlayerTitle", { player: String(player) })}
                onClick={() => dispatch({ type: "removePlayer", player })}
            >
                &times;
            </button>
        </div>
    );
}

export function GameSetupPanel() {
    const t = useTranslations("setup");
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
        if (hasGameData() && !window.confirm(t("loadPresetConfirm"))) return;
        dispatch({ type: "loadPreset", setup: preset.build() });
    };

    const onCustomPreset = (preset: CustomPreset) => {
        if (hasGameData() && !window.confirm(t("loadPresetConfirm"))) return;
        // Load the preset's cardSet on top of the current player roster —
        // presets deliberately don't remember players.
        dispatch({
            type: "loadPreset",
            setup: GameSetup({
                cardSet: preset.cardSet,
                playerSet: setup.playerSet,
            }),
        });
    };

    const onSaveAsPreset = () => {
        const label = window.prompt(t("saveAsPresetPrompt"));
        if (!label || !label.trim()) return;
        saveCustomPreset(label.trim(), setup);
        setCustomPresets(loadCustomPresets());
    };

    const onDeleteCustomPreset = (preset: CustomPreset) => {
        if (
            !window.confirm(
                t("deleteCustomPresetConfirm", { label: preset.label }),
            )
        )
            return;
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

    const inSetup = state.uiMode === "setup";

    return (
        <section className="min-w-0 rounded-[var(--radius)] border border-border bg-panel p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="m-0 text-[16px] uppercase tracking-[0.05em] text-accent">
                    {t("title")}
                </h2>
                {inSetup ? (
                    <button
                        type="button"
                        className="cursor-pointer rounded border-none bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover"
                        onClick={() =>
                            dispatch({ type: "setUiMode", mode: "play" })
                        }
                        title={t("startPlayingTitle")}
                    >
                        {t("startPlaying")}
                    </button>
                ) : (
                    <button
                        type="button"
                        className="cursor-pointer rounded border border-border bg-white px-3.5 py-1.5 text-[13px] hover:bg-hover"
                        onClick={() =>
                            dispatch({ type: "setUiMode", mode: "setup" })
                        }
                        title={t("editSetupTitle")}
                    >
                        {t("editSetup")}
                    </button>
                )}
            </div>

            {inSetup && (
                <>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-muted">
                            {t("preset")}
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
                                    title={t("loadCustomPresetTitle", {
                                        label: preset.label,
                                    })}
                                >
                                    {preset.label}
                                </button>
                                <button
                                    type="button"
                                    className="cursor-pointer border-l border-border px-2 py-1 text-muted hover:bg-hover hover:text-danger"
                                    onClick={() => onDeleteCustomPreset(preset)}
                                    title={t("deleteCustomPresetTitle", {
                                        label: preset.label,
                                    })}
                                    aria-label={t("deleteCustomPresetAria", {
                                        label: preset.label,
                                    })}
                                >
                                    ×
                                </button>
                            </span>
                        ))}
                        <button
                            type="button"
                            className="cursor-pointer rounded border border-dashed border-border bg-white px-3 py-1 text-[13px] text-muted hover:bg-hover hover:text-accent"
                            onClick={onSaveAsPreset}
                            title={t("saveAsPresetTitle")}
                        >
                            {t("saveAsPreset")}
                        </button>
                    </div>
                </>
            )}

            {handSizeMismatch && (
                <div className="mb-3 rounded-[var(--radius)] border border-warning-border bg-warning-bg px-3 py-2 text-[13px] text-warning">
                    {t("handSizeMismatch", {
                        total: handSizesTotal,
                        expected: totalDealt,
                        caseFileCount: caseFileSize(setup),
                    })}
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
                                        editable={inSetup}
                                    />
                                </th>
                            ))}
                            <th className="w-8 border border-border bg-row-header px-1.5 py-1 text-center">
                                {inSetup && (
                                    <button
                                        type="button"
                                        className="h-6 w-6 cursor-pointer rounded border-none bg-accent text-[16px] leading-none text-white hover:bg-accent-hover"
                                        title={t("addPlayerTitle")}
                                        onClick={() =>
                                            dispatch({ type: "addPlayer" })
                                        }
                                    >
                                        +
                                    </button>
                                )}
                            </th>
                        </tr>
                        <tr>
                            <th className="whitespace-nowrap border border-border bg-row-header px-1.5 py-1 text-left font-semibold">
                                {t("handSize")}
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
                    {inSetup && (
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
                                                title={t("renameCategoryTitle")}
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
                                                        ? t("removeCategoryTitle", {
                                                              name: cat.name,
                                                          })
                                                        : t("removeCategoryMin")
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
                                                    title={t("renameCardTitle")}
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
                                                            ? t("removeCardTitle", {
                                                                  name: entry.name,
                                                              })
                                                            : t("removeCardMin")
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
                                            {t("addCard")}
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
                                    {t("addCategory")}
                                </button>
                            </th>
                        </tr>
                    </tbody>
                    )}
                </table>
            </div>
        </section>
    );
}
