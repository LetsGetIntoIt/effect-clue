import { N, Y, getCellByOwnerCard, Knowledge } from "./Knowledge";
import {
    CardCategory,
    Card,
    CaseFileOwner,
    Player,
    PlayerOwner,
} from "./GameObjects";
import {
    allCardIds,
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
export interface Recommendation {
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
export interface RecommendationResult {
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
    maxResults: number = 5,
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

// ---- Probabilistic mode ------------------------------------------------

/**
 * For a given card, compute the fraction of currently-known cells that
 * definitely point to each possible owner. This is a crude approximation
 * of a true probability: we're not enumerating consistent worlds, just
 * reporting what the checklist already directly says. It's extremely
 * cheap (O(owners)) and useful as a UI signal: "70% confidence Bob has
 * the knife" really means "2 of the other 3 possible owners have been
 * ruled out".
 */
export interface CardProbabilities {
    readonly card: Card;
    // probability[ownerKey] where ownerKey is "caseFile" or player name.
    readonly probability: ReadonlyMap<string, number>;
}

export const probabilitiesForCard = (
    setup: GameSetup,
    knowledge: Knowledge,
    card: Card,
): CardProbabilities => {
    const result = new Map<string, number>();
    const caseFile = CaseFileOwner();

    // First: does anyone already have a Y for this card? Then they have
    // probability 1 and everyone else 0.
    let knownOwner: string | undefined = undefined;
    if (getCellByOwnerCard(knowledge, caseFile, card) === Y) {
        knownOwner = "caseFile";
    }
    for (const p of setup.players) {
        if (getCellByOwnerCard(knowledge, PlayerOwner(p), card) === Y) {
            knownOwner = p;
        }
    }

    if (knownOwner !== undefined) {
        result.set("caseFile", knownOwner === "caseFile" ? 1 : 0);
        for (const p of setup.players) {
            result.set(p, knownOwner === p ? 1 : 0);
        }
        return { card, probability: result };
    }

    // Otherwise: distribute 1.0 uniformly across un-ruled-out owners.
    const candidates: string[] = [];
    if (getCellByOwnerCard(knowledge, caseFile, card) !== N) {
        candidates.push("caseFile");
    }
    for (const p of setup.players) {
        if (getCellByOwnerCard(knowledge, PlayerOwner(p), card) !== N) {
            candidates.push(p);
        }
    }

    const prob = candidates.length === 0 ? 0 : 1 / candidates.length;
    result.set("caseFile", candidates.includes("caseFile") ? prob : 0);
    for (const p of setup.players) {
        result.set(p, candidates.includes(p) ? prob : 0);
    }
    return { card, probability: result };
};

export const probabilitiesForAllCards = (
    setup: GameSetup,
    knowledge: Knowledge,
): ReadonlyArray<CardProbabilities> =>
    allCardIds(setup).map(card => probabilitiesForCard(setup, knowledge, card));
