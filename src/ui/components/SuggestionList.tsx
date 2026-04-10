import { removeSuggestion, suggestionsSignal } from "../state";

/**
 * A scrollable list of every suggestion that's been entered so far, with
 * a delete button per row. Suggestions are displayed in insertion order —
 * it matches the order the game happens in and helps users spot
 * mistakes they want to fix.
 */
export function SuggestionList() {
    const suggestions = suggestionsSignal.value;

    if (suggestions.length === 0) {
        return (
            <section class="panel">
                <h2>Suggestions</h2>
                <div class="muted">No suggestions yet. Add one above.</div>
            </section>
        );
    }

    return (
        <section class="panel">
            <h2>Suggestions ({suggestions.length})</h2>
            <ol class="suggestion-list">
                {suggestions.map(s => (
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
                        <button
                            type="button"
                            class="link"
                            onClick={() => removeSuggestion(s.id)}
                        >
                            remove
                        </button>
                    </li>
                ))}
            </ol>
        </section>
    );
}
