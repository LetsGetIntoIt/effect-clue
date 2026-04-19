import { N, Y, getCellByOwnerCard, Knowledge } from "./Knowledge";
import {
    CardCategory,
    Card,
    CaseFileOwner,
    Player,
    PlayerOwner,
} from "./GameObjects";
import {
    cardIdsInCategory,
    GameSetup,
} from "./GameSetup";

/**
 * How "known" the case file currently is, between 0 and 1.
 * 0 = we have no idea about any category.
 * 1 = we've fully solved the crime.
 */
export const caseFileProgress = (
    setup: GameSetup,
    knowledge: Knowledge,
): number => {
    if (setup.categories.length === 0) return 1;
    let solved = 0;
    for (const category of setup.categories) {
        if (caseFileAnswerFor(setup, knowledge, category.id) !== undefined) {
            solved += 1;
        }
    }
    return solved / setup.categories.length;
};

/**
 * Find the case file's card in a category, if we've deduced it. Returns
 * the card if a single Y is known, otherwise undefined.
 */
export const caseFileAnswerFor = (
    setup: GameSetup,
    knowledge: Knowledge,
    category: CardCategory,
): Card | undefined => {
    const caseFile = CaseFileOwner();
    const cards = cardIdsInCategory(setup, category);
    for (const card of cards) {
        if (getCellByOwnerCard(knowledge, caseFile, card) === Y) {
            return card;
        }
    }
    return undefined;
};

/**
 * The set of cards still possible for the case file in a given category
 * (i.e. not yet marked N for the case file).
 */
export const caseFileCandidatesFor = (
    setup: GameSetup,
    knowledge: Knowledge,
    category: CardCategory,
): ReadonlyArray<Card> => {
    const caseFile = CaseFileOwner();
    return cardIdsInCategory(setup, category).filter(
        card => getCellByOwnerCard(knowledge, caseFile, card) !== N,
    );
};

/**
 * A single ranked recommendation: one card per category (in the setup's
 * category order) that would, if asked, touch unknown cells and help
 * narrow the case file down.
 *
 * The three score factors are exposed separately so the UI can show
 * "why is this recommended" alongside the overall score.
 */
interface Recommendation {
    readonly suggester: Player;
    readonly cards: ReadonlyArray<Card>;
    readonly score: number;
    readonly cellInfoScore: number;
    readonly caseFileOpennessScore: number;
    readonly refuterUncertaintyScore: number;
}

/**
 * Output of the recommender. `topCount` is exposed for debug tooltips.
 * There's no "locked" gate — we always return the top-N; at the very
 * start of a game every triple ties, but tie-breaks (see below) pick
 * a stable subset so the user gets something to work with.
 */
interface RecommendationResult {
    readonly recommendations: ReadonlyArray<Recommendation>;
    readonly topCount: number;
}

/**
 * Enumerate every combination of one card per category, drawing only
 * from cards still possible for the case file. Short-circuits to an
 * empty generator if any category has zero remaining candidates.
 */
const cartesianCandidates = function* (
    setup: GameSetup,
    knowledge: Knowledge,
): Generator<ReadonlyArray<Card>, void, undefined> {
    const perCategory = setup.categories.map(c =>
        caseFileCandidatesFor(setup, knowledge, c.id));
    if (perCategory.some(list => list.length === 0)) return;

    const idx = new Array<number>(perCategory.length).fill(0);
    while (true) {
        // Each list[idx[i]] is valid because we checked all lists are
        // non-empty above, and idx[i] is bounded by list.length below.
        yield perCategory.map((list, i) => list[idx[i] ?? 0] as Card);
        // Increment least-significant digit, carrying upward.
        let i = perCategory.length - 1;
        while (i >= 0) {
            const current = idx[i] ?? 0;
            const listLen = perCategory[i]?.length ?? 0;
            if (current + 1 < listLen) {
                idx[i] = current + 1;
                break;
            }
            idx[i] = 0;
            i--;
        }
        if (i < 0) return;
    }
};

/**
 * Recommender scoring has three factors, multiplied together:
 *
 * 1. `cellInfoScore`: count of currently-unknown cells the question
 *    touches in other players' rows. "How many blanks does this
 *    suggestion probe?" — the original heuristic.
 *
 * 2. `caseFileOpennessScore`: product over the triple's categories of
 *    |caseFileCandidatesFor(category)|. Big when the case file still
 *    has many candidates per category, forcing this score to 0 when
 *    the case file is fully solved (we multiply, so 1×1×1 still gives
 *    a floor of 1). Captures "this triple actually probes cards that
 *    could still be in the case file".
 *
 * 3. `refuterUncertaintyScore`: number of other players who could
 *    still plausibly refute — players not known to lack *all* the
 *    suggested cards. 1 = refuter is predictable (we already know it
 *    has to be a specific player), ≥2 = we'll learn who. Penalises
 *    asking questions whose refuter we can already pin down.
 *
 * A triple with any factor = 0 contributes nothing useful (no cells
 * to probe, or no case-file possibility), and gets filtered out.
 *
 * Tie-breaking when two triples have identical scores: sort by the
 * joined card names alphabetically. Deterministic, reproducible, and
 * independent of category count.
 */
export const recommendSuggestions = (
    setup: GameSetup,
    knowledge: Knowledge,
    suggester: Player,
    maxResults: number = 50,
): RecommendationResult => {
    const otherPlayers = setup.players.filter(p => p !== suggester);

    const results: Recommendation[] = [];
    for (const cards of cartesianCandidates(setup, knowledge)) {
        // Factor 1: unknown cells touched in others' rows.
        let cellInfoScore = 0;
        for (const p of otherPlayers) {
            for (const card of cards) {
                const v = getCellByOwnerCard(knowledge, PlayerOwner(p), card);
                if (v === undefined) cellInfoScore += 1;
            }
        }
        if (cellInfoScore === 0) continue;

        // Factor 2: case-file openness. Product over categories of
        // candidate counts; at least 1 per category (we're iterating
        // only live candidates), so this is always ≥1.
        let caseFileOpennessScore = 1;
        for (const category of setup.categories) {
            const candidates = caseFileCandidatesFor(
                setup, knowledge, category.id);
            caseFileOpennessScore *= candidates.length;
        }

        // Factor 3: how many distinct other players could refute this
        // suggestion? A player who's known to lack all three suggested
        // cards cannot refute. If we're down to just one possible
        // refuter, the answer is predictable — we learn less.
        let refuterUncertaintyScore = 0;
        for (const p of otherPlayers) {
            const allN = cards.every(card =>
                getCellByOwnerCard(knowledge, PlayerOwner(p), card) === N);
            if (!allN) refuterUncertaintyScore += 1;
        }
        if (refuterUncertaintyScore === 0) continue;

        const score =
            cellInfoScore * caseFileOpennessScore * refuterUncertaintyScore;

        results.push({
            suggester,
            cards,
            score,
            cellInfoScore,
            caseFileOpennessScore,
            refuterUncertaintyScore,
        });
    }

    // Primary: descending score. Tiebreak: lexicographic by joined names.
    results.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return a.cards.join("|").localeCompare(b.cards.join("|"));
    });

    const first = results[0];
    if (first === undefined) {
        return { recommendations: [], topCount: 0 };
    }
    const topScore = first.score;
    const topCount = results.filter(r => r.score === topScore).length;

    return {
        recommendations: results.slice(0, maxResults),
        topCount,
    };
};

/**
 * Plain-English explanation of why a suggestion is recommended. Feeds the
 * UI directly — no need to know the raw scoring formula to understand
 * what the solver is suggesting.
 *
 * Strategy: pick the dominant factor and phrase it as the headline.
 *  - Case-file openness tells you the suggestion probes unresolved
 *    casefile categories.
 *  - Cell-info count tells you it'll fill in blanks on other players'
 *    rows.
 *  - Refuter uncertainty tells you you'll learn which player had to
 *    refute.
 *
 * Returns a short single-sentence phrase intended for a list item
 * (fits on one line).
 */
export const describeRecommendation = (
    setup: GameSetup,
    knowledge: Knowledge,
    r: {
        readonly cards: ReadonlyArray<Card>;
        readonly cellInfoScore: number;
        readonly caseFileOpennessScore: number;
        readonly refuterUncertaintyScore: number;
    },
): string => {
    // Identify categories whose casefile answer is still open, and
    // which of this triple's cards sit in those categories.
    const openCategories = setup.categories.filter(
        c => caseFileAnswerFor(setup, knowledge, c.id) === undefined,
    );
    const openCategoryNames = openCategories
        .map(c => c.name)
        .map(n => n.toLowerCase());

    // Could a single category become fully pinned by the refuter? That
    // happens when there are exactly two casefile candidates in a
    // category and this suggestion probes the non-casefile one.
    const oneGuessFromCasefile = openCategories.some(c => {
        const candidates = caseFileCandidatesFor(setup, knowledge, c.id);
        return (
            candidates.length === 2 &&
            r.cards.some(card => candidates.includes(card))
        );
    });

    if (oneGuessFromCasefile && openCategoryNames.length === 1) {
        return `Could pin down the casefile ${openCategoryNames[0] ?? "category"} in one guess.`;
    }

    if (r.cellInfoScore >= 4 && openCategoryNames.length >= 1) {
        return (
            `Probes ${r.cellInfoScore} unknown cells across other ` +
            `players' ${openCategoryNames.join(" / ")} rows.`
        );
    }

    if (r.refuterUncertaintyScore >= 3) {
        return (
            `Any of ${r.refuterUncertaintyScore} players could refute — ` +
            `will reveal which one has a card.`
        );
    }

    if (r.cellInfoScore >= 1) {
        const cellWord = r.cellInfoScore === 1 ? "cell" : "cells";
        return `Fills in ${r.cellInfoScore} unknown ${cellWord} on other players' rows.`;
    }

    return "Probes a useful combination.";
};

/**
 * A consolidated recommendation row. Each category slot is either a
 * specific `Card` or the sentinel `"any"`, meaning "any casefile-
 * candidate card in this category produces the same score as part of
 * this family of tied recommendations."
 */
interface ConsolidatedRecommendation {
    readonly suggester: Player;
    readonly cards: ReadonlyArray<Card | "any">;
    readonly score: number;
    readonly cellInfoScore: number;
    readonly caseFileOpennessScore: number;
    readonly refuterUncertaintyScore: number;
    /** How many specific recommendations this consolidated row covers. */
    readonly groupSize: number;
}

/**
 * Collapse tied recommendations that differ only by which card was chosen
 * in one or more categories into a single "any X" row.
 *
 * Algorithm:
 *   1. Group by score.
 *   2. Within each tier, iteratively look for a category position where
 *      the distinct values across a fixed-non-position key equal the
 *      full set of casefile candidates for that category — replace those
 *      rows with one row whose position = "any". Repeat until stable
 *      (so "Mustard + any weapon + any room" emerges via two passes).
 *   3. Concatenate consolidated tiers in the original sorted order.
 */
export const consolidateRecommendations = (
    setup: GameSetup,
    knowledge: Knowledge,
    recs: ReadonlyArray<Recommendation>,
): ReadonlyArray<ConsolidatedRecommendation> => {
    // Casefile candidate set per category (for equivalence checks).
    const candidatesByCat: ReadonlyArray<ReadonlySet<Card>> =
        setup.categories.map(
            c => new Set(caseFileCandidatesFor(setup, knowledge, c.id)),
        );

    // Group by score, preserve input order between groups.
    const scoreOrder: number[] = [];
    const byScore = new Map<number, Recommendation[]>();
    for (const r of recs) {
        let list = byScore.get(r.score);
        if (!list) {
            list = [];
            byScore.set(r.score, list);
            scoreOrder.push(r.score);
        }
        list.push(r);
    }

    const out: ConsolidatedRecommendation[] = [];
    for (const score of scoreOrder) {
        const tier = byScore.get(score)!;
        // Seed with fully-specific cards.
        let rows: ConsolidatedRecommendation[] = tier.map(r => ({
            suggester: r.suggester,
            cards: r.cards,
            score: r.score,
            cellInfoScore: r.cellInfoScore,
            caseFileOpennessScore: r.caseFileOpennessScore,
            refuterUncertaintyScore: r.refuterUncertaintyScore,
            groupSize: 1,
        }));

        // Iterate: at each pass, look for a position that can be
        // collapsed. Stop when a pass produces no further collapse.
        let changed = true;
        while (changed) {
            changed = false;
            for (let i = 0; i < setup.categories.length; i++) {
                const targetCandidates = candidatesByCat[i];
                if (!targetCandidates || targetCandidates.size < 2) continue;

                // Group by the tuple of other-position values
                // (serialized as a string key).
                const groups = new Map<string, ConsolidatedRecommendation[]>();
                for (const row of rows) {
                    const key = row.cards
                        .map((c, j) => (j === i ? "*" : String(c)))
                        .join("|");
                    let list = groups.get(key);
                    if (!list) {
                        list = [];
                        groups.set(key, list);
                    }
                    list.push(row);
                }

                // For each group, if the distinct values at position i
                // cover every candidate and nothing is already "any" at
                // position i, collapse.
                const nextRows: ConsolidatedRecommendation[] = [];
                let didCollapse = false;
                for (const group of groups.values()) {
                    const atI = group.map(g => g.cards[i]);
                    const alreadyAny = atI.some(v => v === "any");
                    if (alreadyAny) {
                        nextRows.push(...group);
                        continue;
                    }
                    const specific = new Set<Card>();
                    for (const v of atI) {
                        if (v !== "any") specific.add(v as Card);
                    }
                    const covers =
                        specific.size === targetCandidates.size &&
                        Array.from(targetCandidates).every(c =>
                            specific.has(c),
                        );
                    if (covers && group.length > 1) {
                        const first = group[0]!;
                        const mergedCards = first.cards.map((c, j) =>
                            j === i ? ("any" as const) : c,
                        );
                        const groupSize = group.reduce(
                            (sum, g) => sum + g.groupSize,
                            0,
                        );
                        nextRows.push({
                            ...first,
                            cards: mergedCards,
                            groupSize,
                        });
                        didCollapse = true;
                    } else {
                        nextRows.push(...group);
                    }
                }

                if (didCollapse) {
                    rows = nextRows;
                    changed = true;
                    break; // restart the pass from category 0
                }
            }
        }

        out.push(...rows);
    }
    return out;
};
