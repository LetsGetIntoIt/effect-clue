import { useState } from "preact/hooks";
import { Card, Player } from "../../logic/GameObjects";
import { recommendSuggestions } from "../../logic/Recommender";
import {
    addSuggestion,
    deductionResultSignal,
    DraftSuggestion,
    removeSuggestion,
    setupSignal,
    suggestionsSignal,
    updateSuggestion,
} from "../state";

/**
 * Consolidated card for everything the solver's primary loop touches:
 * adding a suggestion, getting recommendations for the next one, and
 * reviewing / editing the log of prior suggestions.
 */
export function SuggestionLogPanel() {
    return (
        <section class="panel suggestion-log">
            <h2>Suggestion log</h2>
            <div class="suggestion-log-grid">
                <AddSuggestion />
                <Recommendations />
            </div>
            <PriorSuggestions />
        </section>
    );
}

function AddSuggestion() {
    const setup = setupSignal.value;
    const [suspect, setSuspect] = useState<string>("");
    const [weapon, setWeapon] = useState<string>("");
    const [room, setRoom] = useState<string>("");
    const [suggester, setSuggester] = useState<string>(
        setup.players[0] ?? "");
    const [refuter, setRefuter] = useState<string>("");
    const [seenCard, setSeenCard] = useState<string>("");
    const [passedPlayers, setPassedPlayers] = useState<Set<string>>(new Set());

    // Keep the suggester dropdown's value valid when players come and go.
    if (suggester && !setup.players.some(p => String(p) === suggester)) {
        setSuggester(setup.players[0] ?? "");
    }

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
        <div class="suggestion-log-section">
            <h3>Add a suggestion</h3>
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
                            onChange={e => setSuspect(
                                (e.target as HTMLSelectElement).value)}
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
                            onChange={e => setWeapon(
                                (e.target as HTMLSelectElement).value)}
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
                            onChange={e => setRoom(
                                (e.target as HTMLSelectElement).value)}
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
        </div>
    );
}

function Recommendations() {
    const setup = setupSignal.value;
    const result = deductionResultSignal.value;
    const [asPlayer, setAsPlayer] = useState<string>(setup.players[0] ?? "");

    // Keep player selection valid as players come and go.
    if (asPlayer && !setup.players.some(p => String(p) === asPlayer)) {
        setAsPlayer(setup.players[0] ?? "");
    }

    if (result._tag === "Contradiction" || !asPlayer) {
        return (
            <div class="suggestion-log-section">
                <h3>Next-suggestion recommendations</h3>
                <div class="muted">
                    {result._tag === "Contradiction"
                        ? "Resolve the contradiction to see recommendations."
                        : "Add players to see recommendations."}
                </div>
            </div>
        );
    }

    const rec = recommendSuggestions(setup, result.knowledge, Player(asPlayer), 5);

    return (
        <div class="suggestion-log-section">
            <h3>Next-suggestion recommendations</h3>
            <label>
                Suggesting as:&nbsp;
                <select
                    value={asPlayer}
                    onChange={e => setAsPlayer(
                        (e.target as HTMLSelectElement).value)}
                >
                    {setup.players.map(p => (
                        <option key={p} value={p}>{p}</option>
                    ))}
                </select>
            </label>
            {rec.locked ? (
                <div
                    class="recommender-locked"
                    title={`${rec.topCount} candidates tied for the top score`}
                >
                    Gather more leads to unlock recommendations.
                </div>
            ) : rec.recommendations.length === 0 ? (
                <div class="muted">
                    Nothing useful to ask — you've already narrowed everything
                    down.
                </div>
            ) : (
                <ol class="rec-list">
                    {rec.recommendations.map((r, i) => (
                        <li key={i}>
                            <strong>{r.suspect}</strong> with the&nbsp;
                            <strong>{r.weapon}</strong> in the&nbsp;
                            <strong>{r.room}</strong>
                            <span class="muted"> · score {r.score}</span>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}

function PriorSuggestions() {
    const suggestions = suggestionsSignal.value;
    const [editingId, setEditingId] = useState<string | null>(null);
    return (
        <div class="suggestion-log-section suggestions-prior">
            <h3>
                Prior suggestions
                {suggestions.length > 0 && ` (${suggestions.length})`}
            </h3>
            {suggestions.length === 0 ? (
                <div class="muted">No suggestions yet. Add one above.</div>
            ) : (
                <ol class="suggestion-list">
                    {suggestions.map(s =>
                        editingId === s.id ? (
                            <li key={s.id}>
                                <EditSuggestionRow
                                    suggestion={s}
                                    onSave={updated => {
                                        updateSuggestion(updated);
                                        setEditingId(null);
                                    }}
                                    onCancel={() => setEditingId(null)}
                                />
                            </li>
                        ) : (
                            <li key={s.id}>
                                <div>
                                    <strong>{s.suggester}</strong> suggested&nbsp;
                                    {s.cards.join(" + ")}
                                </div>
                                <div class="muted">
                                    {s.refuter
                                        ? <>
                                            refuted by <strong>{s.refuter}</strong>
                                            {s.seenCard && <> (showed {s.seenCard})</>}
                                        </>
                                        : "nobody could refute"}
                                    {s.nonRefuters.length > 0 && (
                                        <> · passed: {s.nonRefuters.join(", ")}</>
                                    )}
                                </div>
                                <div class="suggestion-actions">
                                    <button
                                        type="button"
                                        class="link"
                                        onClick={() => setEditingId(s.id)}
                                    >
                                        edit
                                    </button>
                                    <button
                                        type="button"
                                        class="link link-danger"
                                        onClick={() => removeSuggestion(s.id)}
                                    >
                                        remove
                                    </button>
                                </div>
                            </li>
                        ),
                    )}
                </ol>
            )}
        </div>
    );
}

function EditSuggestionRow({ suggestion, onSave, onCancel }: {
    suggestion: DraftSuggestion;
    onSave: (updated: DraftSuggestion) => void;
    onCancel: () => void;
}) {
    const setup = setupSignal.value;
    const [suggester, setSuggester] = useState(String(suggestion.suggester));
    const [suspect, setSuspect] = useState(String(suggestion.cards[0] ?? ""));
    const [weapon, setWeapon] = useState(String(suggestion.cards[1] ?? ""));
    const [room, setRoom] = useState(String(suggestion.cards[2] ?? ""));
    const [refuter, setRefuter] = useState(
        suggestion.refuter ? String(suggestion.refuter) : "");
    const [seenCard, setSeenCard] = useState(
        suggestion.seenCard ? String(suggestion.seenCard) : "");
    const [passedPlayers, setPassedPlayers] = useState<Set<string>>(
        new Set(suggestion.nonRefuters.map(p => String(p))));

    const canSave = suspect && weapon && room && suggester;

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

    const handleSave = () => {
        if (!canSave) return;
        const nonRefuters = setup.players.filter(p =>
            passedPlayers.has(String(p)));
        onSave({
            ...suggestion,
            suggester: Player(suggester),
            cards: [Card(suspect), Card(weapon), Card(room)],
            nonRefuters,
            refuter: refuter ? Player(refuter) : undefined,
            seenCard: seenCard ? Card(seenCard) : undefined,
        });
    };

    const eligibleForPassed = setup.players.filter(
        p => String(p) !== suggester && String(p) !== refuter);

    return (
        <div class="edit-suggestion">
            <div class="edit-suggestion-fields">
                <label>
                    Suggester:
                    <select value={suggester}
                        onChange={e => setSuggester(
                            (e.target as HTMLSelectElement).value)}>
                        {setup.players.map(p => (
                            <option key={p} value={p}>{p}</option>
                        ))}
                    </select>
                </label>
                <label>
                    Suspect:
                    <select value={suspect}
                        onChange={e => setSuspect(
                            (e.target as HTMLSelectElement).value)}>
                        <option value="">—</option>
                        {setup.suspects.map(c => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                </label>
                <label>
                    Weapon:
                    <select value={weapon}
                        onChange={e => setWeapon(
                            (e.target as HTMLSelectElement).value)}>
                        <option value="">—</option>
                        {setup.weapons.map(c => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                </label>
                <label>
                    Room:
                    <select value={room}
                        onChange={e => setRoom(
                            (e.target as HTMLSelectElement).value)}>
                        <option value="">—</option>
                        {setup.rooms.map(c => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                </label>
                <label>
                    Refuted by:
                    <select value={refuter}
                        onChange={e => onRefuterChange(
                            (e.target as HTMLSelectElement).value)}>
                        <option value="">— none —</option>
                        {setup.players
                            .filter(p => String(p) !== suggester)
                            .map(p => (
                                <option key={p} value={p}>{p}</option>
                            ))}
                    </select>
                </label>
                {refuter && (
                    <label>
                        Card shown:
                        <select value={seenCard}
                            onChange={e => setSeenCard(
                                (e.target as HTMLSelectElement).value)}>
                            <option value="">— unknown —</option>
                            {[suspect, weapon, room]
                                .filter(c => c !== "")
                                .map(c => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                        </select>
                    </label>
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
                                        (e.target as HTMLInputElement).checked)}
                                />
                                {p}
                            </label>
                        ))}
                    </fieldset>
                )}
            </div>
            <div class="edit-suggestion-actions">
                <button type="button" class="save-btn"
                    disabled={!canSave} onClick={handleSave}>
                    Save
                </button>
                <button type="button" class="cancel-btn"
                    onClick={onCancel}>
                    Cancel
                </button>
            </div>
        </div>
    );
}
