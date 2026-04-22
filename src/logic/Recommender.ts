import { Data, Effect } from "effect";
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
import {
    CardSetService,
    KnowledgeService,
    PlayerSetService,
    getCardSet,
    getKnowledge,
    getPlayerSet,
} from "./services";

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
class RecommendationImpl extends Data.Class<{
    readonly suggester: Player;
    readonly cards: ReadonlyArray<Card>;
    readonly score: number;
    readonly cellInfoScore: number;
    readonly caseFileOpennessScore: number;
    readonly refuterUncertaintyScore: number;
}> {}
type Recommendation = RecommendationImpl;
const Recommendation = (params: {
    readonly suggester: Player;
    readonly cards: ReadonlyArray<Card>;
    readonly score: number;
    readonly cellInfoScore: number;
    readonly caseFileOpennessScore: number;
    readonly refuterUncertaintyScore: number;
}): Recommendation => new RecommendationImpl(params);

/**
 * Output of the recommender. `topCount` is exposed for debug tooltips.
 * There's no "locked" gate — we always return the top-N; at the very
 * start of a game every triple ties, but tie-breaks (see below) pick
 * a stable subset so the user gets something to work with.
 */
class RecommendationResultImpl extends Data.Class<{
    readonly recommendations: ReadonlyArray<Recommendation>;
    readonly topCount: number;
}> {}
type RecommendationResult = RecommendationResultImpl;
const RecommendationResult = (params: {
    readonly recommendations: ReadonlyArray<Recommendation>;
    readonly topCount: number;
}): RecommendationResult => new RecommendationResultImpl(params);

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
    suggester: Player,
    maxResults: number = 50,
): Effect.Effect<
    RecommendationResult,
    never,
    CardSetService | PlayerSetService | KnowledgeService
> =>
    Effect.gen(function* () {
        const cardSet = yield* getCardSet;
        const playerSet = yield* getPlayerSet;
        const knowledge = yield* getKnowledge;
        const setup = GameSetup({ cardSet, playerSet });
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

            results.push(Recommendation({
                suggester,
                cards,
                score,
                cellInfoScore,
                caseFileOpennessScore,
                refuterUncertaintyScore,
            }));
        }

        // Primary: descending score. Tiebreak: lexicographic by joined names.
        results.sort((a, b) => {
            if (a.score !== b.score) return b.score - a.score;
            return a.cards.join("|").localeCompare(b.cards.join("|"));
        });

        const first = results[0];
        if (first === undefined) {
            return RecommendationResult({ recommendations: [], topCount: 0 });
        }
        const topScore = first.score;
        const topCount = results.filter(r => r.score === topScore).length;

        return RecommendationResult({
            recommendations: results.slice(0, maxResults),
            topCount,
        });
    });

/**
 * Structured description of why a suggestion is recommended. The UI
 * layer resolves the tagged shape into localized copy via
 * `messages/en.json` under `recommendations.*`.
 *
 * Strategy: pick the dominant factor and emit the matching variant.
 *  - Case-file openness → `oneGuessFromCasefile` (we can pin down
 *    the answer).
 *  - Cell-info count → `probesManyCells` or `fillsCells` (fills
 *    blanks on other players' rows).
 *  - Refuter uncertainty → `refuterUncertainty` (reveals which
 *    player had to refute).
 *  - Fallback → `usefulCombination`.
 */
type RecommendationDescription =
    | {
          readonly kind: "oneGuessFromCasefile";
          readonly params: { readonly category: string };
      }
    | {
          readonly kind: "probesManyCells";
          readonly params: {
              readonly cellCount: number;
              readonly categories: string;
          };
      }
    | {
          readonly kind: "refuterUncertainty";
          readonly params: { readonly playerCount: number };
      }
    | {
          readonly kind: "fillsCells";
          readonly params: { readonly cellCount: number };
      }
    | {
          readonly kind: "usefulCombination";
          readonly params: Record<string, never>;
      };

export const describeRecommendation = (
    r: {
        readonly cards: ReadonlyArray<Card>;
        readonly cellInfoScore: number;
        readonly caseFileOpennessScore: number;
        readonly refuterUncertaintyScore: number;
    },
): Effect.Effect<
    RecommendationDescription,
    never,
    CardSetService | PlayerSetService | KnowledgeService
> =>
    Effect.gen(function* () {
        const cardSet = yield* getCardSet;
        const playerSet = yield* getPlayerSet;
        const knowledge = yield* getKnowledge;
        const setup = GameSetup({ cardSet, playerSet });

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
            return {
                kind: "oneGuessFromCasefile",
                params: { category: openCategoryNames[0] ?? "category" },
            };
        }

        if (r.cellInfoScore >= 4 && openCategoryNames.length >= 1) {
            return {
                kind: "probesManyCells",
                params: {
                    cellCount: r.cellInfoScore,
                    categories: openCategoryNames.join(" / "),
                },
            };
        }

        if (r.refuterUncertaintyScore >= 3) {
            return {
                kind: "refuterUncertainty",
                params: { playerCount: r.refuterUncertaintyScore },
            };
        }

        if (r.cellInfoScore >= 1) {
            return {
                kind: "fillsCells",
                params: { cellCount: r.cellInfoScore },
            };
        }

        return { kind: "usefulCombination", params: {} };
    });

/**
 * Tagged descriptor that replaces the old bare `"any"` sentinel in a
 * collapsed slot. Each kind corresponds to a subset of case-file
 * candidates; a collapsed slot records *which* subset the tie-group
 * actually covered, so the UI can render a more descriptive phrase
 * ("any weapon Green doesn't own" rather than just "any weapon").
 *
 * `anyYouOwn` / `anyOwnedBy` refer to cards where we have a definitive
 * Y for the suggester / named player. `anyYouDontOwn` / `anyNotOwnedBy`
 * require a definitive N. `anyYouDontKnow` requires the case-file cell
 * to still be undefined (i.e. nobody has a Y recorded anywhere yet).
 * `anyNotInCaseFile` requires the case-file cell to be N.
 */
export type AnySlot =
    | { readonly kind: "any" }
    | { readonly kind: "anyYouOwn" }
    | { readonly kind: "anyYouDontOwn" }
    | { readonly kind: "anyYouDontKnow" }
    | { readonly kind: "anyNotInCaseFile" }
    | { readonly kind: "anyOwnedBy"; readonly player: Player }
    | { readonly kind: "anyNotOwnedBy"; readonly player: Player };

export const isAnySlot = (v: Card | AnySlot): v is AnySlot =>
    typeof v === "object" && v !== null && "kind" in v;

/**
 * A consolidated recommendation row. Each category slot is either a
 * specific `Card` or an `AnySlot` describing the subset of case-file
 * candidates this slot consolidates over.
 */
export interface ConsolidatedRecommendation {
    readonly suggester: Player;
    readonly cards: ReadonlyArray<Card | AnySlot>;
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
    recs: ReadonlyArray<Recommendation>,
): Effect.Effect<
    ReadonlyArray<ConsolidatedRecommendation>,
    never,
    CardSetService | PlayerSetService | KnowledgeService
> =>
    Effect.gen(function* () {
        const cardSet = yield* getCardSet;
        const playerSet = yield* getPlayerSet;
        const knowledge = yield* getKnowledge;
        const setup = GameSetup({ cardSet, playerSet });

        // Per-category case-file candidate set. The seed for every
        // descriptor's target set — all descriptors intersect with this.
        const candidatesByCat: ReadonlyArray<ReadonlyArray<Card>> =
            setup.categories.map(c =>
                caseFileCandidatesFor(setup, knowledge, c.id),
            );

        // For each tier, the suggester is constant (all tied triples in
        // a tier come from the same recommendSuggestions call). We still
        // look it up per tier so the descriptor target sets carry the
        // right `suggester` reference.
        const setEq = (a: ReadonlySet<Card>, b: ReadonlySet<Card>): boolean => {
            if (a.size !== b.size) return false;
            for (const v of a) if (!b.has(v)) return false;
            return true;
        };

        // Build the ordered list of candidate descriptors for category
        // `i` and a given `suggester`. Each entry pairs an AnySlot with
        // the exact set of cards (within case-file candidates) that the
        // slot describes. Ordering here IS the tie-break priority used
        // by pickDescriptor — broadest/simplest label first.
        const descriptorsFor = (
            i: number,
            suggester: Player,
        ): ReadonlyArray<{
            readonly slot: AnySlot;
            readonly target: ReadonlySet<Card>;
        }> => {
            const cands = candidatesByCat[i] ?? [];
            const all = new Set(cands);
            const youOwn = new Set<Card>();
            const youDontOwn = new Set<Card>();
            const youDontKnow = new Set<Card>();
            const notInCaseFile = new Set<Card>();
            for (const c of cands) {
                const selfCell = getCellByOwnerCard(
                    knowledge,
                    PlayerOwner(suggester),
                    c,
                );
                if (selfCell === Y) youOwn.add(c);
                if (selfCell === N) youDontOwn.add(c);
                const cfCell = getCellByOwnerCard(
                    knowledge,
                    CaseFileOwner(),
                    c,
                );
                if (cfCell === undefined) youDontKnow.add(c);
                if (cfCell === N) notInCaseFile.add(c);
            }

            const perPlayer: Array<{
                readonly slot: AnySlot;
                readonly target: ReadonlySet<Card>;
            }> = [];
            for (const p of setup.players) {
                if (p === suggester) continue;
                const ownedBy = new Set<Card>();
                const notOwnedBy = new Set<Card>();
                for (const c of cands) {
                    const v = getCellByOwnerCard(
                        knowledge,
                        PlayerOwner(p),
                        c,
                    );
                    if (v === Y) ownedBy.add(c);
                    if (v === N) notOwnedBy.add(c);
                }
                perPlayer.push({
                    slot: { kind: "anyOwnedBy", player: p },
                    target: ownedBy,
                });
                perPlayer.push({
                    slot: { kind: "anyNotOwnedBy", player: p },
                    target: notOwnedBy,
                });
            }

            // Broadest first: plain "any" wins whenever it matches, and
            // "you don't know about" is the most commonly-useful refine-
            // ment for a pool that's still case-file-candidate-only.
            // Suggester-ownership labels come last because within the
            // current recommender pool their targets are empty (you own)
            // or equal to `all` (you don't own) — so they'd never be
            // picked over `any` even if tried earlier, and in the future
            // (expanded pool) they're less specific than a player-
            // named label.
            return [
                { slot: { kind: "any" }, target: all },
                { slot: { kind: "anyYouDontKnow" }, target: youDontKnow },
                { slot: { kind: "anyNotInCaseFile" }, target: notInCaseFile },
                ...perPlayer,
                { slot: { kind: "anyYouOwn" }, target: youOwn },
                { slot: { kind: "anyYouDontOwn" }, target: youDontOwn },
            ];
        };

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
            const suggester = tier[0]?.suggester;
            if (suggester === undefined) continue;

            // Precompute descriptor lists per category for this tier's
            // suggester. Reused across iterative passes.
            const descsByCat = setup.categories.map((_, i) =>
                descriptorsFor(i, suggester),
            );

            // Iterate: at each pass, look for a position that can be
            // collapsed. Stop when a pass produces no further collapse.
            let changed = true;
            while (changed) {
                changed = false;
                for (let i = 0; i < setup.categories.length; i++) {
                    const descs = descsByCat[i] ?? [];
                    if (descs.length === 0) continue;

                    // Group by the tuple of other-position values
                    // (serialized as a string key). Any `AnySlot` at
                    // another position is already collapsed and has a
                    // stable JSON shape, so JSON.stringify is fine as a
                    // key.
                    const groups = new Map<
                        string,
                        ConsolidatedRecommendation[]
                    >();
                    for (const row of rows) {
                        const key = row.cards
                            .map((c, j) =>
                                j === i ? "*" : JSON.stringify(c),
                            )
                            .join("|");
                        let list = groups.get(key);
                        if (!list) {
                            list = [];
                            groups.set(key, list);
                        }
                        list.push(row);
                    }

                    // For each group, look for a descriptor whose target
                    // set matches the distinct card values at position
                    // i. Skip groups that already have an AnySlot at i
                    // (already collapsed there).
                    const nextRows: ConsolidatedRecommendation[] = [];
                    let didCollapse = false;
                    for (const group of groups.values()) {
                        const atI = group.map(g => g.cards[i]);
                        const alreadyAny = atI.some(v =>
                            v !== undefined && isAnySlot(v),
                        );
                        if (alreadyAny) {
                            nextRows.push(...group);
                            continue;
                        }
                        const specific = new Set<Card>();
                        for (const v of atI) {
                            if (v !== undefined && !isAnySlot(v)) {
                                specific.add(v);
                            }
                        }
                        let chosen: AnySlot | undefined;
                        // Require at least 2 distinct card values; a
                        // singleton group doesn't need a collapse label.
                        if (specific.size >= 2) {
                            for (const d of descs) {
                                if (setEq(specific, d.target)) {
                                    chosen = d.slot;
                                    break;
                                }
                            }
                        }
                        if (chosen !== undefined && group.length > 1) {
                            const first = group[0]!;
                            const slot = chosen;
                            const mergedCards = first.cards.map((c, j) =>
                                j === i ? slot : c,
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
    });
