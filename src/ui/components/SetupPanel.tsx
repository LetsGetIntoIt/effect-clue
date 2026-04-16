import { useState } from "preact/hooks";
import { Player } from "../../logic/GameObjects";
import { PRESETS, GameSetup } from "../../logic/GameSetup";
import { loadPreset, renamePlayer, setupSignal } from "../state";

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
        <div class="player-name-row">
            <input
                type="text"
                value={editing}
                onInput={e => {
                    setEditing((e.target as HTMLInputElement).value);
                    setError("");
                }}
                onBlur={commit}
                onKeyDown={e => { if (e.key === "Enter") commit(); }}
            />
            {error && <span class="error-text">{error}</span>}
        </div>
    );
}

export function SetupPanel() {
    const setup: GameSetup = setupSignal.value;

    const onPresetChange = (e: Event) => {
        const index = Number((e.target as HTMLSelectElement).value);
        if (!Number.isFinite(index)) return;
        const preset = PRESETS[index];
        if (preset) loadPreset(preset.setup);
    };

    const activePresetIndex = PRESETS.findIndex(
        p => p.setup === setup,
    );

    return (
        <section class="panel">
            <h2>Game setup</h2>
            <label>
                Preset:&nbsp;
                <select
                    value={String(activePresetIndex >= 0 ? activePresetIndex : 0)}
                    onChange={onPresetChange}
                >
                    {PRESETS.map((p, i) => (
                        <option key={i} value={String(i)}>{p.name}</option>
                    ))}
                </select>
            </label>
            <div class="muted">
                {setup.players.length} players,&nbsp;
                {setup.suspects.length} suspects,&nbsp;
                {setup.weapons.length} weapons,&nbsp;
                {setup.rooms.length} rooms
            </div>
            <div class="player-names">
                <h3>Players</h3>
                {setup.players.map((player, i) => (
                    <PlayerNameInput
                        key={i}
                        player={player}
                        allPlayers={setup.players}
                    />
                ))}
            </div>
        </section>
    );
}
