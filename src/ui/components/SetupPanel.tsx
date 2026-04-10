import { PRESETS, GameSetup } from "../../logic/GameSetup";
import { loadPreset, setupSignal } from "../state";

/**
 * Preset picker + summary of the current game setup.
 *
 * We intentionally keep this minimal: picking a preset resets all other
 * state because a different deck composition invalidates any existing
 * suggestions or known hands. Users who want custom setups can still
 * edit the JSON in localStorage directly — a full custom setup editor
 * is out of scope for the initial build-out.
 */
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
            <div class="muted">
                Players: {setup.players.join(", ")}
            </div>
        </section>
    );
}
