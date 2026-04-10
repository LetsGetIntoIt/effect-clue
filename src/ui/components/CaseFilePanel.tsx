import { CardCategory, ALL_CATEGORIES } from "../../logic/GameObjects";
import {
    caseFileAnswerFor,
    caseFileCandidatesFor,
    caseFileProgress,
} from "../../logic/Recommender";
import { deductionResultSignal, setupSignal } from "../state";

/**
 * The "current best guess" at the solution. For each category (suspect /
 * weapon / room) we show either the resolved answer or the current
 * candidate set.
 */
export function CaseFilePanel() {
    const setup = setupSignal.value;
    const result = deductionResultSignal.value;

    if (result._tag === "Contradiction") {
        return null; // ChecklistGrid will show the error
    }

    const knowledge = result.knowledge;
    const progress = caseFileProgress(setup, knowledge);

    return (
        <section class="panel case-file">
            <h2>Case file</h2>
            <div class="progress">
                <span>
                    {(progress * 100).toFixed(0)}% solved
                </span>
                <div class="progress-bar">
                    <div style={{ width: `${progress * 100}%` }} />
                </div>
            </div>
            <dl>
                {ALL_CATEGORIES.map(category => {
                    const solved = caseFileAnswerFor(setup, knowledge, category);
                    const candidates = caseFileCandidatesFor(
                        setup,
                        knowledge,
                        category,
                    );
                    return (
                        <div class="case-file-row" key={category}>
                            <dt>{label(category)}</dt>
                            <dd>
                                {solved ? (
                                    <strong>{solved}</strong>
                                ) : (
                                    <span class="muted">
                                        {candidates.length} candidates:&nbsp;
                                        {candidates.slice(0, 4).join(", ")}
                                        {candidates.length > 4 && "…"}
                                    </span>
                                )}
                            </dd>
                        </div>
                    );
                })}
            </dl>
        </section>
    );
}

const label = (category: CardCategory): string => {
    switch (category) {
        case "suspect": return "Suspect";
        case "weapon":  return "Weapon";
        case "room":    return "Room";
    }
};
