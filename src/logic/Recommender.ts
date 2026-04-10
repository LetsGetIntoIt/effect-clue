import { N, Y, getCellByOwnerCard, Knowledge } from "./Knowledge";
import {
    ALL_CATEGORIES,
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
    let solved = 0;
    for (const category of ALL_CATEGORIES) {
        if (caseFileAnswerFor(setup, knowledge, category) !== undefined) {
            solved += 1;
        }
    }
    return solved / ALL_CATEGORIES.length;
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
 * A simple suggestion recommender: enumerate all possible (suspect,
 * weapon, room) triples whose components are still open (not ruled out
 * for the case file), and rank them by how many "unknown" cells they
 * would touch in the suggester's non-refuter neighbours. The goal is to
 * maximise information gain in the next turn.
 */
export interface Recommendation {
    readonly suggester: Player;
    readonly suspect: Card;
    readonly weapon: Card;
    readonly room: Card;
    readonly score: number;
}

export const recommendSuggestions = (
    setup: GameSetup,
    knowledge: Knowledge,
    suggester: Player,
    maxResults: number = 5,
): ReadonlyArray<Recommendation> => {
    const suspects = caseFileCandidatesFor(setup, knowledge, "suspect");
    const weapons  = caseFileCandidatesFor(setup, knowledge, "weapon");
    const rooms    = caseFileCandidatesFor(setup, knowledge, "room");

    const otherPlayers = setup.players.filter(p => p !== suggester);

    const results: Recommendation[] = [];
    for (const suspect of suspects) {
        for (const weapon of weapons) {
            for (const room of rooms) {
                // Count unknown (suggester-doesn't-know) cells among the
                // three cards × other players. Higher = more potential
                // information from asking.
                let unknownCount = 0;
                for (const p of otherPlayers) {
                    for (const card of [suspect, weapon, room]) {
                        const v = getCellByOwnerCard(knowledge, PlayerOwner(p), card);
                        if (v === undefined) unknownCount += 1;
                    }
                }
                if (unknownCount === 0) continue;
                results.push({
                    suggester,
                    suspect,
                    weapon,
                    room,
                    score: unknownCount,
                });
            }
        }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
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
