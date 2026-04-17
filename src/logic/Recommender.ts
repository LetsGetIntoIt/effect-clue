import { N, Y, getCellByOwnerCard, Knowledge } from "./Knowledge";
import {
    CardCategory,
    Card,
    CaseFileOwner,
    Player,
    PlayerOwner,
} from "./GameObjects";
import {
    allCards,
    cardsInCategory,
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
        if (caseFileAnswerFor(setup, knowledge, category.name) !== undefined) {
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
    const cards = cardsInCategory(setup, category);
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
    return cardsInCategory(setup, category).filter(
        card => getCellByOwnerCard(knowledge, caseFile, card) !== N,
    );
};

/**
 * A single ranked recommendation: one card per category (in the setup's
 * category order) that would, if asked, touch unknown cells and help
 * narrow the case file down.
 */
export interface Recommendation {
    readonly suggester: Player;
    readonly cards: ReadonlyArray<Card>;
    readonly score: number;
}

/**
 * Output of the recommender. When `locked` is true, the top score is
 * shared by too many candidate suggestions to give meaningful guidance
 * — the UI should show a "gather more leads" message instead. The
 * `topCount` field is exposed for tooltips/debug.
 */
export interface RecommendationResult {
    readonly recommendations: ReadonlyArray<Recommendation>;
    readonly locked: boolean;
    readonly topCount: number;
}

/**
 * Threshold for "too many candidates tied for the best score". Below
 * this many ties, recommendations are useful; above, the user should
 * make more suggestions to narrow things down first.
 */
const TOP_TIE_THRESHOLD = 5;

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
        caseFileCandidatesFor(setup, knowledge, c.name));
    if (perCategory.some(list => list.length === 0)) return;

    const idx = new Array<number>(perCategory.length).fill(0);
    while (true) {
        yield perCategory.map((list, i) => list[idx[i]]);
        // Increment least-significant digit, carrying upward.
        let i = perCategory.length - 1;
        while (i >= 0) {
            idx[i]++;
            if (idx[i] < perCategory[i].length) break;
            idx[i] = 0;
            i--;
        }
        if (i < 0) return;
    }
};

export const recommendSuggestions = (
    setup: GameSetup,
    knowledge: Knowledge,
    suggester: Player,
    maxResults: number = 5,
): RecommendationResult => {
    const otherPlayers = setup.players.filter(p => p !== suggester);

    const results: Recommendation[] = [];
    for (const cards of cartesianCandidates(setup, knowledge)) {
        let unknownCount = 0;
        for (const p of otherPlayers) {
            for (const card of cards) {
                const v = getCellByOwnerCard(knowledge, PlayerOwner(p), card);
                if (v === undefined) unknownCount += 1;
            }
        }
        if (unknownCount === 0) continue;
        results.push({
            suggester,
            cards,
            score: unknownCount,
        });
    }

    if (results.length === 0) {
        return { recommendations: [], locked: false, topCount: 0 };
    }

    results.sort((a, b) => b.score - a.score);
    const topScore = results[0].score;
    const topCount = results.filter(r => r.score === topScore).length;
    const locked = topCount > TOP_TIE_THRESHOLD;

    return {
        recommendations: locked ? [] : results.slice(0, maxResults),
        locked,
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
    allCards(setup).map(card => probabilitiesForCard(setup, knowledge, card));
