import { useState } from "preact/hooks";
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

export function HandsPanel() {
    const setup = setupSignal.value;
    const knownCards = knownCardsSignal.value;
    const handSizes = handSizesSignal.value;
    const handSizeMap = new Map(handSizes);
    const [showChecklist, setShowChecklist] = useState(false);

    const defaults = defaultHandSizes(setup);

    const onHandSizeChange = (player: Player, raw: string) => {
        if (raw === "") {
            setHandSizeFor(player, undefined);
            return;
        }
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) setHandSizeFor(player, n);
    };

    const categories = [
        { name: "Suspects", cards: setup.suspects },
        { name: "Weapons",  cards: setup.weapons },
        { name: "Rooms",    cards: setup.rooms },
    ];

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

    const isKnown = (player: Player, card: Card): boolean =>
        knownCards.some(kc => kc.player === player && kc.card === card);

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
            <button
                type="button"
                class="checklist-toggle"
                onClick={() => setShowChecklist(!showChecklist)}
            >
                {showChecklist ? "Close checklist" : "Edit known cards\u2026"}
            </button>

            {showChecklist && (
                <div class="known-cards-checklist">
                    <table>
                        <thead>
                            <tr>
                                <th></th>
                                {setup.players.map(p => (
                                    <th key={p}>{p}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {categories.flatMap(cat => [
                                <tr class="category-row" key={`h-${cat.name}`}>
                                    <th colSpan={1 + setup.players.length}>
                                        {cat.name}
                                    </th>
                                </tr>,
                                ...cat.cards.map(card => (
                                    <tr key={card}>
                                        <th class="card-name">{card}</th>
                                        {setup.players.map(player => (
                                            <td key={player} class="checklist-cell">
                                                <input
                                                    type="checkbox"
                                                    checked={isKnown(player, card)}
                                                    onChange={() =>
                                                        toggleKnownCard(player, card)}
                                                />
                                            </td>
                                        ))}
                                    </tr>
                                )),
                            ])}
                        </tbody>
                    </table>
                </div>
            )}

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
