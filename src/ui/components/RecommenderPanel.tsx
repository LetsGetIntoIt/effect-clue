import { useState } from "preact/hooks";
import { Player } from "../../logic/GameObjects";
import { recommendSuggestions } from "../../logic/Recommender";
import { deductionResultSignal, setupSignal } from "../state";

/**
 * "What should I ask next?" panel. Given a chosen suggester, shows the
 * top-ranked suggestions by expected information gain (currently a
 * simple "number of unknown cells touched" heuristic — good enough for
 * the classic 3–6 player game without the overhead of true entropy
 * calculations).
 */
export function RecommenderPanel() {
    const setup = setupSignal.value;
    const result = deductionResultSignal.value;
    const [asPlayer, setAsPlayer] = useState<string>(setup.players[0] ?? "");

    if (result._tag === "Contradiction") return null;
    if (!asPlayer) return null;

    const recs = recommendSuggestions(
        setup,
        result.knowledge,
        Player(asPlayer),
        5,
    );

    return (
        <section class="panel">
            <h2>Next-suggestion recommendations</h2>
            <label>
                Suggesting as:&nbsp;
                <select
                    value={asPlayer}
                    onChange={e => setAsPlayer((e.target as HTMLSelectElement).value)}
                >
                    {setup.players.map(p => (
                        <option key={p} value={p}>{p}</option>
                    ))}
                </select>
            </label>
            {recs.length === 0 ? (
                <div class="muted">Nothing useful to ask — you've already
                    narrowed everything down.</div>
            ) : (
                <ol class="rec-list">
                    {recs.map((r, i) => (
                        <li key={i}>
                            <strong>{r.suspect}</strong> with the&nbsp;
                            <strong>{r.weapon}</strong> in the&nbsp;
                            <strong>{r.room}</strong>
                            <span class="muted"> · score {r.score}</span>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}
