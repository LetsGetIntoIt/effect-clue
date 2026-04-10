import { Card, Player } from "../../logic/GameObjects";
import { allCards, defaultHandSizes } from "../../logic/GameSetup";
import {
    addKnownCard,
    handSizesSignal,
    knownCardsSignal,
    removeKnownCard,
    setHandSizeFor,
    setupSignal,
} from "../state";

/**
 * Panel for telling the solver two things:
 *  1. What cards you (or anyone else) are known to hold
 *  2. How many cards each player was dealt
 *
 * The latter is critical: without hand sizes, the solver can't make
 * "row is full" or "row is empty" inferences from the consistency
 * rules. We pre-fill a reasonable default based on dealing the non-case
 * file cards evenly.
 */
export function HandsPanel() {
    const setup = setupSignal.value;
    const knownCards = knownCardsSignal.value;
    const handSizes = handSizesSignal.value;
    const handSizeMap = new Map(handSizes);

    const defaults = defaultHandSizes(setup);

    const onAddCard = (e: Event) => {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        const data = new FormData(form);
        const player = data.get("player");
        const card = data.get("card");
        if (typeof player !== "string" || typeof card !== "string") return;
        if (!player || !card) return;
        addKnownCard({ player: Player(player), card: Card(card) });
        form.reset();
    };

    const onHandSizeChange = (player: Player, raw: string) => {
        if (raw === "") {
            setHandSizeFor(player, undefined);
            return;
        }
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) setHandSizeFor(player, n);
    };

    return (
        <section class="panel">
            <h2>Known hands</h2>

            <h3>Hand sizes</h3>
            <table class="hand-sizes">
                <thead>
                    <tr><th>Player</th><th>Hand size</th><th>Default</th></tr>
                </thead>
                <tbody>
                    {setup.players.map(player => {
                        const current = handSizeMap.get(player);
                        const [, defaultSize] = defaults.find(
                            ([p]) => p === player) ?? [player, 0];
                        return (
                            <tr key={player}>
                                <td>{player}</td>
                                <td>
                                    <input
                                        type="number"
                                        min={0}
                                        max={allCards(setup).length}
                                        value={current === undefined ? "" : String(current)}
                                        placeholder={String(defaultSize)}
                                        onInput={e => onHandSizeChange(
                                            player,
                                            (e.target as HTMLInputElement).value,
                                        )}
                                    />
                                </td>
                                <td class="muted">{defaultSize}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            <h3>Known cards</h3>
            <form onSubmit={onAddCard} class="known-card-form">
                <select name="player" required>
                    <option value="">Player…</option>
                    {setup.players.map(p => (
                        <option key={p} value={p}>{p}</option>
                    ))}
                </select>
                <select name="card" required>
                    <option value="">Card…</option>
                    <optgroup label="Suspects">
                        {setup.suspects.map(c => <option key={c} value={c}>{c}</option>)}
                    </optgroup>
                    <optgroup label="Weapons">
                        {setup.weapons.map(c => <option key={c} value={c}>{c}</option>)}
                    </optgroup>
                    <optgroup label="Rooms">
                        {setup.rooms.map(c => <option key={c} value={c}>{c}</option>)}
                    </optgroup>
                </select>
                <button type="submit">Add</button>
            </form>

            {knownCards.length === 0 ? (
                <div class="muted">No known cards yet.</div>
            ) : (
                <ul class="known-card-list">
                    {knownCards.map((kc, i) => (
                        <li key={i}>
                            <span>{kc.player} holds {kc.card}</span>
                            <button
                                type="button"
                                class="link"
                                onClick={() => removeKnownCard(i)}
                            >
                                remove
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
