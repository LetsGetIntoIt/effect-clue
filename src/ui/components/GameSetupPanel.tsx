import { useState } from "preact/hooks";
import { Card, Player } from "../../logic/GameObjects";
import {
    allCards,
    caseFileSize,
    defaultHandSizes,
    GameSetup,
} from "../../logic/GameSetup";
import {
    addKnownCard,
    addPlayer,
    deductionResultSignal,
    handSizesSignal,
    hasGameData,
    knownCardsSignal,
    newGame,
    removeKnownCard,
    removePlayer,
    renamePlayer,
    setHandSizeFor,
    setupSignal,
} from "../state";

const NEW_GAME_CONFIRM =
    "You've already started logging this game. Selecting a new game " +
    "setup preset will lose all unsaved deductions. Would you like to " +
    "continue?";

function PlayerNameInput({ player, allPlayers }: {
    player: Player;
    allPlayers: ReadonlyArray<Player>;
}) {
    const [editing, setEditing] = useState(String(player));
    const [error, setError] = useState("");

    // Sync local state if the signal-level name changed (e.g. preset load).
    if (editing !== String(player) && !error) {
        setEditing(String(player));
    }

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
        renamePlayer(player, Player(trimmed));
        setError("");
    };

    return (
        <div class="player-header-cell">
            <input
                type="text"
                class="player-name-input"
                value={editing}
                onInput={e => {
                    setEditing((e.target as HTMLInputElement).value);
                    setError("");
                }}
                onBlur={commit}
                onKeyDown={e => { if (e.key === "Enter") commit(); }}
            />
            {error && <span class="error-text">{error}</span>}
            <button
                type="button"
                class="remove-player-btn"
                title={`Remove ${player}`}
                onClick={() => removePlayer(player)}
            >
                &times;
            </button>
        </div>
    );
}

export function GameSetupPanel() {
    const setup: GameSetup = setupSignal.value;
    const knownCards = knownCardsSignal.value;
    const handSizeMap = new Map(handSizesSignal.value);
    const result = deductionResultSignal.value;
    const defaults = new Map(defaultHandSizes(setup));

    const totalDealt = allCards(setup).length - caseFileSize();
    const setHandSizes = setup.players
        .map(p => handSizeMap.get(p))
        .filter((n): n is number => typeof n === "number");
    const allHandSizesSet =
        setHandSizes.length === setup.players.length && setup.players.length > 0;
    const handSizesTotal = setHandSizes.reduce((a, b) => a + b, 0);
    const handSizeMismatch =
        allHandSizesSet && handSizesTotal !== totalDealt;

    const onNewGame = () => {
        if (hasGameData() && !window.confirm(NEW_GAME_CONFIRM)) return;
        newGame();
    };

    const onHandSizeChange = (player: Player, raw: string) => {
        if (raw === "") {
            setHandSizeFor(player, undefined);
            return;
        }
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) setHandSizeFor(player, n);
    };

    const isKnown = (player: Player, card: Card): boolean =>
        knownCards.some(kc => kc.player === player && kc.card === card);

    const toggleKnownCard = (player: Player, card: Card) => {
        const index = knownCards.findIndex(
            kc => kc.player === player && kc.card === card,
        );
        if (index >= 0) {
            removeKnownCard(index);
        } else {
            addKnownCard({ player, card });
        }
    };

    const categories: ReadonlyArray<{ name: string; cards: ReadonlyArray<Card> }> = [
        { name: "Suspects", cards: setup.suspects },
        { name: "Weapons",  cards: setup.weapons },
        { name: "Rooms",    cards: setup.rooms },
    ];

    const cardSpan = setup.players.length + 2; // label + players + add column

    return (
        <section class="panel">
            <div class="panel-header">
                <h2>Game setup</h2>
                <button
                    type="button"
                    class="new-game-btn"
                    onClick={onNewGame}
                >
                    New game
                </button>
            </div>

            {handSizeMismatch && (
                <div class="validation-banner warning">
                    Hand sizes total {handSizesTotal} card
                    {handSizesTotal === 1 ? "" : "s"}; should total
                    &nbsp;{totalDealt} after the {caseFileSize()} case-file
                    cards.
                </div>
            )}

            {result._tag === "Contradiction" && (
                <div class="validation-banner error">
                    <strong>Contradiction:</strong> {result.error.reason}
                </div>
            )}

            <div class="game-setup-grid-wrap">
                <table class="game-setup-grid">
                    <thead>
                        <tr>
                            <th class="row-label-corner"></th>
                            {setup.players.map(p => (
                                <th key={p} class="player-header">
                                    <PlayerNameInput
                                        player={p}
                                        allPlayers={setup.players}
                                    />
                                </th>
                            ))}
                            <th class="add-player-cell">
                                <button
                                    type="button"
                                    class="add-player-btn"
                                    title="Add player"
                                    onClick={addPlayer}
                                >
                                    +
                                </button>
                            </th>
                        </tr>
                        <tr class="hand-size-row">
                            <th class="row-label">Hand size</th>
                            {setup.players.map(p => {
                                const current = handSizeMap.get(p);
                                const def = defaults.get(p);
                                return (
                                    <td key={p}>
                                        <input
                                            type="number"
                                            min={0}
                                            max={allCards(setup).length}
                                            value={current === undefined
                                                ? ""
                                                : String(current)}
                                            placeholder={def === undefined
                                                ? ""
                                                : String(def)}
                                            onInput={e => onHandSizeChange(
                                                p,
                                                (e.target as HTMLInputElement).value,
                                            )}
                                        />
                                    </td>
                                );
                            })}
                            <td></td>
                        </tr>
                    </thead>
                    <tbody>
                        {categories.flatMap(cat => [
                            <tr class="category-row" key={`h-${cat.name}`}>
                                <th colSpan={cardSpan}>{cat.name}</th>
                            </tr>,
                            ...cat.cards.map(card => (
                                <tr key={card}>
                                    <th class="card-name">{card}</th>
                                    {setup.players.map(p => (
                                        <td key={p} class="checklist-cell">
                                            <input
                                                type="checkbox"
                                                checked={isKnown(p, card)}
                                                onChange={() =>
                                                    toggleKnownCard(p, card)}
                                            />
                                        </td>
                                    ))}
                                    <td></td>
                                </tr>
                            )),
                        ])}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
