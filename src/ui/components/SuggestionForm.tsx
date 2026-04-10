import { useState } from "preact/hooks";
import { Card, Player } from "../../logic/GameObjects";
import { addSuggestion, setupSignal } from "../state";

/**
 * Form for adding a new suggestion. Collects:
 *  - Who suggested (dropdown from setup.players)
 *  - One suspect, one weapon, one room (dropdowns)
 *  - Who refuted, if anyone (dropdown including "no one")
 *  - Which card was seen, if known (dropdown constrained to the three
 *    suggested cards)
 *
 * Non-refuters are derived automatically: any players between the
 * suggester and the refuter (following turn order) who weren't able to
 * refute. We approximate "turn order" as `setup.players` order — this is
 * the standard way the game is played.
 */
export function SuggestionForm() {
    const setup = setupSignal.value;
    const [suspect, setSuspect] = useState<string>("");
    const [weapon, setWeapon] = useState<string>("");
    const [room, setRoom] = useState<string>("");
    const [suggester, setSuggester] = useState<string>(
        setup.players[0] ?? "");
    const [refuter, setRefuter] = useState<string>("");
    const [seenCard, setSeenCard] = useState<string>("");

    const canSubmit = suspect && weapon && room && suggester;

    const onSubmit = (e: Event) => {
        e.preventDefault();
        if (!canSubmit) return;
        const cards = [Card(suspect), Card(weapon), Card(room)];
        const nonRefuters = computeNonRefuters(
            setup.players,
            Player(suggester),
            refuter ? Player(refuter) : undefined,
        );
        addSuggestion({
            id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            suggester: Player(suggester),
            cards,
            nonRefuters,
            refuter: refuter ? Player(refuter) : undefined,
            seenCard: seenCard ? Card(seenCard) : undefined,
        });
        // Reset narrow fields but keep the suggester chosen for fast entry.
        setSuspect(""); setWeapon(""); setRoom("");
        setRefuter(""); setSeenCard("");
    };

    return (
        <section class="panel">
            <h2>Add a suggestion</h2>
            <form onSubmit={onSubmit} class="suggestion-form">
                <div>
                    <label>
                        Suggester:
                        <select
                            value={suggester}
                            onChange={e => setSuggester((e.target as HTMLSelectElement).value)}
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
                            onChange={e => setRefuter((e.target as HTMLSelectElement).value)}
                        >
                            <option value="">— none —</option>
                            {setup.players
                                .filter(p => p !== suggester)
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
                                onChange={e => setSeenCard((e.target as HTMLSelectElement).value)}
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
                <button type="submit" disabled={!canSubmit}>
                    Add suggestion
                </button>
            </form>
        </section>
    );
}

/**
 * Given a turn order, the suggester, and (optionally) the refuter,
 * return the players who had a chance to refute but passed. These are
 * the players who sit between the suggester and the refuter in the
 * standard Clue turn order (or everyone else, if nobody refuted).
 */
const computeNonRefuters = (
    players: ReadonlyArray<Player>,
    suggester: Player,
    refuter: Player | undefined,
): ReadonlyArray<Player> => {
    const startIdx = players.indexOf(suggester);
    if (startIdx < 0) return [];
    const ordered: Player[] = [];
    for (let i = 1; i < players.length; i++) {
        const p = players[(startIdx + i) % players.length];
        if (p === refuter) break;
        ordered.push(p);
    }
    return ordered;
};
