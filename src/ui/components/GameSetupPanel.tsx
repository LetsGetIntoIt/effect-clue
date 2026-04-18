"use client";

import { useEffect, useState } from "react";
import { Card, Player } from "../../logic/GameObjects";
import {
    allCards,
    caseFileSize,
    defaultHandSizes,
    GameSetup,
    PRESETS,
} from "../../logic/GameSetup";
import { useClue } from "../state";
import { CategoryEditor } from "./CategoryEditor";

const NEW_GAME_CONFIRM =
    "You've already started logging this game. Selecting a new game " +
    "setup preset will lose all unsaved deductions. Would you like to " +
    "continue?";

const PRESET_CONFIRM =
    "Loading a preset will discard your current hand sizes, known " +
    "cards, and suggestions. Continue?";

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
    const { state, dispatch, derived, hasGameData } = useClue();
    const setup: GameSetup = state.setup;
    const knownCards = state.knownCards;
    const handSizeMap = new Map(state.handSizes);
    const result = derived.deductionResult;
    const defaults = new Map(defaultHandSizes(setup));

    const totalDealt = allCards(setup).length - caseFileSize(setup);
    const setHandSizesArr = setup.players
        .map(p => handSizeMap.get(p))
        .filter((n): n is number => typeof n === "number");
    const allHandSizesSet =
        setHandSizesArr.length === setup.players.length &&
        setup.players.length > 0;
    const handSizesTotal = setHandSizesArr.reduce((a, b) => a + b, 0);
    const handSizeMismatch =
        allHandSizesSet && handSizesTotal !== totalDealt;

    const onNewGame = () => {
        if (hasGameData() && !window.confirm(NEW_GAME_CONFIRM)) return;
        dispatch({ type: "newGame" });
    };

    const onPreset = (preset: (typeof PRESETS)[number]) => {
        if (hasGameData() && !window.confirm(PRESET_CONFIRM)) return;
        dispatch({ type: "loadPreset", setup: preset.build() });
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

    const isKnown = (player: Player, card: Card): boolean =>
        knownCards.some(kc => kc.player === player && kc.card === card);

    const toggleKnownCard = (player: Player, card: Card) => {
        const index = knownCards.findIndex(
            kc => kc.player === player && kc.card === card,
        );
        if (index >= 0) {
            dispatch({ type: "removeKnownCard", index });
        } else {
            dispatch({ type: "addKnownCard", card: { player, card } });
        }
    };

    const categories: ReadonlyArray<{
        name: string;
        cards: ReadonlyArray<Card>;
    }> = setup.categories.map(c => ({
        name: String(c.name),
        cards: c.cards,
    }));

    const cardSpan = setup.players.length + 2; // label + players + add column

    return (
        <section className="min-w-0 rounded-[var(--radius)] border border-border bg-panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="m-0 text-[16px] uppercase tracking-[0.05em] text-accent">
                    Game setup
                </h2>
                <button
                    type="button"
                    className="cursor-pointer rounded border-none bg-accent px-3.5 py-1.5 text-[13px] text-white hover:bg-accent-hover"
                    onClick={onNewGame}
                >
                    New game
                </button>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-muted">
                    Preset:
                </span>
                {PRESETS.map(preset => (
                    <button
                        key={preset.id}
                        type="button"
                        className="cursor-pointer rounded border border-border bg-white px-3 py-1 text-[13px] hover:bg-[#f0f0f5]"
                        onClick={() => onPreset(preset)}
                    >
                        {preset.label}
                    </button>
                ))}
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

            {result._tag === "Contradiction" && (
                <div className="mb-3 rounded-[var(--radius)] border border-danger-border bg-danger-bg px-3 py-2 text-[13px] text-danger">
                    <strong>Contradiction:</strong> {result.error.reason}
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
                                            max={allCards(setup).length}
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
                        {setup.categories.flatMap((cat, catIdx) => {
                            const canRemoveCategory =
                                setup.categories.length > 1;
                            const canRemoveCard = cat.cards.length > 1;
                            return [
                                <tr key={`h-${catIdx}`}>
                                    <th
                                        colSpan={cardSpan}
                                        className="border border-border bg-accent px-1.5 py-1 text-left text-[10px] uppercase tracking-[0.05em] text-white"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span>{String(cat.name)}</span>
                                            <button
                                                type="button"
                                                title={
                                                    canRemoveCategory
                                                        ? `Remove ${String(cat.name)}`
                                                        : "At least one category is required"
                                                }
                                                disabled={!canRemoveCategory}
                                                className="cursor-pointer border-none bg-transparent p-0 text-[14px] leading-none text-white/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                                onClick={() =>
                                                    dispatch({
                                                        type: "removeCategory",
                                                        categoryIndex: catIdx,
                                                    })
                                                }
                                            >
                                                &times;
                                            </button>
                                        </div>
                                    </th>
                                </tr>,
                                ...cat.cards.map((card, cardIdx) => (
                                    <tr key={`${catIdx}-${String(card)}-${cardIdx}`}>
                                        <th className="whitespace-nowrap border border-border bg-white px-1.5 py-1 text-left font-normal">
                                            <div className="flex items-center justify-between gap-2">
                                                <span>{card}</span>
                                                <button
                                                    type="button"
                                                    title={
                                                        canRemoveCard
                                                            ? `Remove ${card}`
                                                            : "At least one card per category is required"
                                                    }
                                                    disabled={!canRemoveCard}
                                                    className="cursor-pointer border-none bg-transparent p-0 text-[14px] leading-none text-muted hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                                                    onClick={() =>
                                                        dispatch({
                                                            type: "removeCard",
                                                            categoryIndex: catIdx,
                                                            cardIndex: cardIdx,
                                                        })
                                                    }
                                                >
                                                    &times;
                                                </button>
                                            </div>
                                        </th>
                                        {setup.players.map(p => (
                                            <td
                                                key={p}
                                                className="w-8 min-w-8 border border-border px-1.5 py-1 text-center"
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="m-0 cursor-pointer"
                                                    checked={isKnown(p, card)}
                                                    onChange={() =>
                                                        toggleKnownCard(p, card)
                                                    }
                                                />
                                            </td>
                                        ))}
                                        <td className="border border-border"></td>
                                    </tr>
                                )),
                                <tr key={`add-card-${catIdx}`}>
                                    <th
                                        colSpan={cardSpan}
                                        className="border border-border bg-[#fafafc] px-1.5 py-1 text-left"
                                    >
                                        <button
                                            type="button"
                                            className="cursor-pointer border-none bg-transparent p-0 text-[12px] text-accent underline"
                                            onClick={() =>
                                                dispatch({
                                                    type: "addCardToCategory",
                                                    categoryIndex: catIdx,
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
                                className="border border-border bg-[#fafafc] px-1.5 py-2 text-center"
                            >
                                <button
                                    type="button"
                                    className="cursor-pointer rounded border border-border bg-white px-3 py-1 text-[13px] hover:bg-[#f0f0f5]"
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
