import { useState } from "preact/hooks";
import { Card, Player } from "../../logic/GameObjects";
import { addSuggestion, setupSignal } from "../state";

export function SuggestionForm() {
    const setup = setupSignal.value;
    const [suspect, setSuspect] = useState<string>("");
    const [weapon, setWeapon] = useState<string>("");
    const [room, setRoom] = useState<string>("");
    const [suggester, setSuggester] = useState<string>(
        setup.players[0] ?? "");
    const [refuter, setRefuter] = useState<string>("");
    const [seenCard, setSeenCard] = useState<string>("");
    const [passedPlayers, setPassedPlayers] = useState<Set<string>>(new Set());

    const canSubmit = suspect && weapon && room && suggester;

    const onSuggesterChange = (value: string) => {
        setSuggester(value);
        const next = new Set(passedPlayers);
        next.delete(value);
        setPassedPlayers(next);
    };

    const onRefuterChange = (value: string) => {
        setRefuter(value);
        setSeenCard("");
        const next = new Set(passedPlayers);
        next.delete(value);
        setPassedPlayers(next);
    };

    const togglePassed = (name: string, checked: boolean) => {
        const next = new Set(passedPlayers);
        if (checked) next.add(name);
        else next.delete(name);
        setPassedPlayers(next);
    };

    const onSubmit = (e: Event) => {
        e.preventDefault();
        if (!canSubmit) return;
        const cards = [Card(suspect), Card(weapon), Card(room)];
        const nonRefuters = setup.players.filter(p =>
            passedPlayers.has(String(p)),
        );
        addSuggestion({
            id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            suggester: Player(suggester),
            cards,
            nonRefuters,
            refuter: refuter ? Player(refuter) : undefined,
            seenCard: seenCard ? Card(seenCard) : undefined,
        });
        setSuspect(""); setWeapon(""); setRoom("");
        setRefuter(""); setSeenCard("");
        setPassedPlayers(new Set());
    };

    const eligibleForPassed = setup.players.filter(
        p => String(p) !== suggester && String(p) !== refuter,
    );

    return (
        <section class="panel">
            <h2>Add a suggestion</h2>
            <form onSubmit={onSubmit} class="suggestion-form">
                <div>
                    <label>
                        Suggester:
                        <select
                            value={suggester}
                            onChange={e => onSuggesterChange(
                                (e.target as HTMLSelectElement).value)}
                            required
                        >
                            {setup.players.map(p => (
                                <option key={p} value={p}>{p}</option>
                            ))}
                        </select>
                    </label>
                </div>
                <div>
                    <label>
                        Suspect:
                        <select
                            value={suspect}
                            onChange={e => setSuspect((e.target as HTMLSelectElement).value)}
                            required
                        >
                            <option value="">—</option>
                            {setup.suspects.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </label>
                </div>
                <div>
                    <label>
                        Weapon:
                        <select
                            value={weapon}
                            onChange={e => setWeapon((e.target as HTMLSelectElement).value)}
                            required
                        >
                            <option value="">—</option>
                            {setup.weapons.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </label>
                </div>
                <div>
                    <label>
                        Room:
                        <select
                            value={room}
                            onChange={e => setRoom((e.target as HTMLSelectElement).value)}
                            required
                        >
                            <option value="">—</option>
                            {setup.rooms.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </label>
                </div>
                <div>
                    <label>
                        Refuted by:
                        <select
                            value={refuter}
                            onChange={e => onRefuterChange(
                                (e.target as HTMLSelectElement).value)}
                        >
                            <option value="">— none —</option>
                            {setup.players
                                .filter(p => String(p) !== suggester)
                                .map(p => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                        </select>
                    </label>
                </div>
                {refuter && (
                    <div>
                        <label>
                            Card shown (optional):
                            <select
                                value={seenCard}
                                onChange={e => setSeenCard(
                                    (e.target as HTMLSelectElement).value)}
                            >
                                <option value="">— unknown —</option>
                                {[suspect, weapon, room]
                                    .filter(c => c !== "")
                                    .map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                            </select>
                        </label>
                    </div>
                )}
                {eligibleForPassed.length > 0 && (
                    <fieldset class="non-refuters">
                        <legend>Could not refute</legend>
                        {eligibleForPassed.map(p => (
                            <label key={p} class="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={passedPlayers.has(String(p))}
                                    onChange={e => togglePassed(
                                        String(p),
                                        (e.target as HTMLInputElement).checked,
                                    )}
                                />
                                {p}
                            </label>
                        ))}
                    </fieldset>
                )}
                <button type="submit" disabled={!canSubmit}>
                    Add suggestion
                </button>
            </form>
        </section>
    );
}
