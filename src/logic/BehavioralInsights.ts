import { Data, HashMap, HashSet } from "effect";
import {
    Card,
    CardCategory,
    CaseFileOwner,
    Player,
    PlayerOwner,
} from "./GameObjects";
import { cardIdsInCategory, type GameSetup } from "./GameSetup";
import {
    type HypothesisMap,
    type HypothesisValue,
} from "./Hypothesis";
import {
    Cell,
    getCellByOwnerCard,
    type Knowledge,
} from "./Knowledge";
import type { Suggestion } from "./Suggestion";

/**
 * "Soft" / behavioral hypotheses surfaced from suggestion-log patterns.
 * Each Insight maps to a per-cell (Y or N) hypothesis the user can
 * accept with one click; once accepted, the existing `setHypothesis`
 * action takes over and the joint-deduction machinery tracks
 * plausibility / contradictions.
 *
 * Three pure-pattern detectors that don't need a per-player
 * perspective engine:
 *
 *   - `FrequentSuggester`: a player has named the same card 3+ times
 *     across all suggestions. Likely they own it (own-cards tactic).
 *     Maps to `(player, card) = Y`.
 *   - `CategoricalHole`: a player has named every card in a category
 *     except one. Likely they own the missing one. Maps to
 *     `(player, missing card) = Y`.
 *   - `SharedSuggestionFocus`: 3+ distinct players have each named
 *     the same card. Only one of them can own it — the common
 *     curiosity is more naturally explained by "it's in the case
 *     file." Maps to `(case file, card) = Y`.
 *
 * Theory-of-mind detectors (e.g. "could a specific player have
 * deduced X?") need a perspective engine and are deferred to a later
 * milestone — see the M3 sketch in
 * `/Users/kapil/.claude/plans/it-would-be-great-structured-kay.md`.
 *
 * When both detectors target the same cell, a final dedup pass merges
 * them into a `DualSignal` insight whose confidence is the higher of
 * the two — the user sees one row that combines the rationale.
 */

export type InsightConfidence = "low" | "med" | "high";

const CONFIDENCE_RANK: Readonly<Record<InsightConfidence, number>> = {
    low: 0,
    med: 1,
    high: 2,
};

/**
 * Compare two confidences. Returns the higher one (or `a` on tie).
 */
export const maxConfidence = (
    a: InsightConfidence,
    b: InsightConfidence,
): InsightConfidence => (CONFIDENCE_RANK[b] > CONFIDENCE_RANK[a] ? b : a);

/**
 * Strict-greater comparison on the ordinal rank. Used by the
 * dismissal filter: a dismissed insight only re-surfaces when its
 * current confidence has grown strictly past the dismissed level.
 */
export const isConfidenceGreater = (
    current: InsightConfidence,
    threshold: InsightConfidence,
): boolean => CONFIDENCE_RANK[current] > CONFIDENCE_RANK[threshold];

class FrequentSuggesterImpl extends Data.TaggedClass("FrequentSuggester")<{
    readonly suggester: Player;
    readonly card: Card;
    readonly count: number;
}> {}
type FrequentSuggester = FrequentSuggesterImpl;

class CategoricalHoleImpl extends Data.TaggedClass("CategoricalHole")<{
    readonly suggester: Player;
    readonly category: CardCategory;
    readonly missingCard: Card;
    readonly categorySize: number;
}> {}
type CategoricalHole = CategoricalHoleImpl;

/**
 * Both signals fired on the same (player, card) — surface as one row
 * with combined rationale and the higher confidence of the two.
 */
class DualSignalImpl extends Data.TaggedClass("DualSignal")<{
    readonly suggester: Player;
    readonly card: Card;
    readonly count: number;
    readonly category: CardCategory;
    readonly categorySize: number;
}> {}
type DualSignal = DualSignalImpl;

/**
 * Many distinct players have each named the same card across the
 * suggestion log. Each of them might be probing — but the joint
 * behavior is more naturally explained by "this card is in the case
 * file" than by "all of these players think they own it" (only one
 * can own it). Maps to a `(case file, card) = Y` hypothesis.
 */
class SharedSuggestionFocusImpl extends Data.TaggedClass("SharedSuggestionFocus")<{
    readonly card: Card;
    readonly distinctSuggesters: number;
    readonly totalCount: number;
}> {}
type SharedSuggestionFocus = SharedSuggestionFocusImpl;

export type InsightKind =
    | FrequentSuggester
    | CategoricalHole
    | DualSignal
    | SharedSuggestionFocus;

export interface Insight {
    /**
     * Stable id used for dismissal persistence. Shape is
     * `${kind._tag}:${player}:${card}` — survives suggestion-array
     * additions and follows player renames naturally (the brand
     * string mutates in place when `renamePlayer` fires).
     */
    readonly dismissedKey: string;
    readonly kind: InsightKind;
    readonly targetCell: Cell;
    readonly proposedValue: HypothesisValue;
    readonly confidence: InsightConfidence;
}

const dismissedKeyFor = (
    tag: InsightKind["_tag"],
    player: Player,
    card: Card,
): string => `${tag}:${String(player)}:${String(card)}`;

const dismissedKeyForCaseFile = (
    tag: InsightKind["_tag"],
    card: Card,
): string => `${tag}:case-file:${String(card)}`;

const frequentSuggesterConfidence = (count: number): InsightConfidence => {
    if (count >= 6) return "high";
    if (count >= 4) return "med";
    return "low";
};

const categoricalHoleConfidence = (
    categorySize: number,
): InsightConfidence => {
    if (categorySize >= 7) return "high";
    if (categorySize >= 5) return "med";
    return "low";
};

const sharedSuggestionConfidence = (
    distinctSuggesters: number,
): InsightConfidence => {
    if (distinctSuggesters >= 5) return "high";
    if (distinctSuggesters >= 4) return "med";
    return "low";
};

/**
 * Number of times each (suggester, card) pair has appeared across all
 * suggestions. Each suggestion contributes once per card it names
 * (typically one per category).
 */
const buildSuggestCounts = (
    suggestions: ReadonlyArray<Suggestion>,
): HashMap.HashMap<string, { player: Player; card: Card; count: number }> => {
    let m = HashMap.empty<
        string,
        { player: Player; card: Card; count: number }
    >();
    for (const s of suggestions) {
        for (const card of s.cards) {
            const key = `${String(s.suggester)}|${String(card)}`;
            const existing = HashMap.get(m, key);
            if (existing._tag === "Some") {
                m = HashMap.set(m, key, {
                    ...existing.value,
                    count: existing.value.count + 1,
                });
            } else {
                m = HashMap.set(m, key, {
                    player: s.suggester,
                    card,
                    count: 1,
                });
            }
        }
    }
    return m;
};

/**
 * Per-player set of distinct cards they've ever named. Used by the
 * categorical-hole detector. Returned as a Map keyed by player brand
 * string for deterministic iteration.
 */
const buildNamedCardsByPlayer = (
    suggestions: ReadonlyArray<Suggestion>,
): Map<Player, HashSet.HashSet<Card>> => {
    const m = new Map<Player, HashSet.HashSet<Card>>();
    for (const s of suggestions) {
        const existing = m.get(s.suggester) ?? HashSet.empty<Card>();
        let next = existing;
        for (const card of s.cards) {
            next = HashSet.add(next, card);
        }
        m.set(s.suggester, next);
    }
    return m;
};

const isCellKnown = (knowledge: Knowledge, cell: Cell): boolean =>
    getCellByOwnerCard(knowledge, cell.owner, cell.card) !== undefined;

const isCellHypothesized = (
    hypotheses: HypothesisMap,
    cell: Cell,
): boolean => HashMap.has(hypotheses, cell);

const detectFrequentSuggester = (
    suggestions: ReadonlyArray<Suggestion>,
    knowledge: Knowledge,
    hypotheses: HypothesisMap,
    selfPlayer: Player | null,
): ReadonlyArray<Insight> => {
    const counts = buildSuggestCounts(suggestions);
    const out: Insight[] = [];
    for (const [, { player, card, count }] of counts) {
        if (count < 3) continue;
        if (selfPlayer !== null && player === selfPlayer) continue;
        const targetCell = Cell(PlayerOwner(player), card);
        if (isCellKnown(knowledge, targetCell)) continue;
        if (isCellHypothesized(hypotheses, targetCell)) continue;
        out.push({
            dismissedKey: dismissedKeyFor(
                "FrequentSuggester",
                player,
                card,
            ),
            kind: new FrequentSuggesterImpl({
                suggester: player,
                card,
                count,
            }),
            targetCell,
            proposedValue: "Y",
            confidence: frequentSuggesterConfidence(count),
        });
    }
    return out;
};

const detectCategoricalHole = (
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
    knowledge: Knowledge,
    hypotheses: HypothesisMap,
    selfPlayer: Player | null,
): ReadonlyArray<Insight> => {
    const namedByPlayer = buildNamedCardsByPlayer(suggestions);
    const out: Insight[] = [];
    for (const player of setup.players) {
        if (selfPlayer !== null && player === selfPlayer) continue;
        const named = namedByPlayer.get(player) ?? HashSet.empty<Card>();
        for (const category of setup.categories) {
            const cardsInCat = cardIdsInCategory(setup, category.id);
            if (cardsInCat.length < 4) continue;
            const namedInCat = cardsInCat.filter(c => HashSet.has(named, c));
            if (namedInCat.length !== cardsInCat.length - 1) continue;
            const missingList = cardsInCat.filter(
                c => !HashSet.has(named, c),
            );
            const missingCard = missingList[0];
            if (missingCard === undefined) continue;
            const targetCell = Cell(PlayerOwner(player), missingCard);
            if (isCellKnown(knowledge, targetCell)) continue;
            if (isCellHypothesized(hypotheses, targetCell)) continue;
            out.push({
                dismissedKey: dismissedKeyFor(
                    "CategoricalHole",
                    player,
                    missingCard,
                ),
                kind: new CategoricalHoleImpl({
                    suggester: player,
                    category: category.id,
                    missingCard,
                    categorySize: cardsInCat.length,
                }),
                targetCell,
                proposedValue: "Y",
                confidence: categoricalHoleConfidence(cardsInCat.length),
            });
        }
    }
    return out;
};

/**
 * Many-distinct-suggesters → case-file detector.
 *
 * Counts unique suggesters per card (and the total times that card has
 * appeared across the log). When 3+ distinct players have each named
 * the same card, it's unlikely they all own it — only one can — so
 * the joint behavior is better explained by "the card is in the case
 * file." Maps to a `(case file, card) = Y` hypothesis.
 *
 * The self-player counts toward `distinctSuggesters` if they've
 * suggested the card; their inclusion isn't disqualifying because
 * the case-file interpretation is consistent with anyone (including
 * the user) probing for it. The detector skips emitting if the user
 * is already known to own the card — at that point the case-file
 * proposal is contradicted by real facts and the call-site filter
 * would drop it anyway, but we short-circuit here for clarity.
 */
const detectSharedSuggestionFocus = (
    suggestions: ReadonlyArray<Suggestion>,
    knowledge: Knowledge,
    hypotheses: HypothesisMap,
    selfPlayer: Player | null,
): ReadonlyArray<Insight> => {
    // card → { suggesters: HashSet<Player>, totalCount }
    let perCard = HashMap.empty<
        Card,
        {
            readonly suggesters: HashSet.HashSet<Player>;
            readonly totalCount: number;
        }
    >();
    for (const s of suggestions) {
        for (const card of s.cards) {
            const existing = HashMap.get(perCard, card);
            if (existing._tag === "Some") {
                perCard = HashMap.set(perCard, card, {
                    suggesters: HashSet.add(
                        existing.value.suggesters,
                        s.suggester,
                    ),
                    totalCount: existing.value.totalCount + 1,
                });
            } else {
                perCard = HashMap.set(perCard, card, {
                    suggesters: HashSet.fromIterable([s.suggester]),
                    totalCount: 1,
                });
            }
        }
    }
    const out: Insight[] = [];
    for (const [card, { suggesters, totalCount }] of perCard) {
        const distinctSuggesters = HashSet.size(suggesters);
        if (distinctSuggesters < 3) continue;
        const targetCell = Cell(CaseFileOwner(), card);
        if (isCellKnown(knowledge, targetCell)) continue;
        if (isCellHypothesized(hypotheses, targetCell)) continue;
        // If the user definitely owns this card, the case-file
        // interpretation is impossible regardless of how many people
        // suggested it.
        if (
            selfPlayer !== null
            && getCellByOwnerCard(
                knowledge,
                PlayerOwner(selfPlayer),
                card,
            ) === "Y"
        ) {
            continue;
        }
        out.push({
            dismissedKey: dismissedKeyForCaseFile(
                "SharedSuggestionFocus",
                card,
            ),
            kind: new SharedSuggestionFocusImpl({
                card,
                distinctSuggesters,
                totalCount,
            }),
            targetCell,
            proposedValue: "Y",
            confidence: sharedSuggestionConfidence(distinctSuggesters),
        });
    }
    return out;
};

/**
 * Final pass: when both detectors produced an insight on the same
 * (player, card) pair, replace them with a single `DualSignal`
 * insight that carries data from both halves.
 *
 * The combined dismissedKey is a fresh `DualSignal:player:card` so
 * dismissing the merged row stays distinct from dismissing either
 * underlying row — same evidence pattern, but the user is reacting
 * to the joint signal.
 */
const mergeOverlapping = (
    raw: ReadonlyArray<Insight>,
): ReadonlyArray<Insight> => {
    const byKey = new Map<string, Insight[]>();
    for (const ins of raw) {
        const k = `${String(
            ins.targetCell.owner._tag === "Player"
                ? ins.targetCell.owner.player
                : "case-file",
        )}|${String(ins.targetCell.card)}|${ins.proposedValue}`;
        const list = byKey.get(k) ?? [];
        list.push(ins);
        byKey.set(k, list);
    }
    const out: Insight[] = [];
    for (const list of byKey.values()) {
        if (list.length === 1) {
            const only = list[0];
            if (only !== undefined) out.push(only);
            continue;
        }
        const freq = list.find(
            i => i.kind._tag === "FrequentSuggester",
        );
        const hole = list.find(i => i.kind._tag === "CategoricalHole");
        if (
            freq !== undefined
            && hole !== undefined
            && freq.kind._tag === "FrequentSuggester"
            && hole.kind._tag === "CategoricalHole"
        ) {
            const player = freq.kind.suggester;
            const card = freq.kind.card;
            out.push({
                dismissedKey: dismissedKeyFor("DualSignal", player, card),
                kind: new DualSignalImpl({
                    suggester: player,
                    card,
                    count: freq.kind.count,
                    category: hole.kind.category,
                    categorySize: hole.kind.categorySize,
                }),
                targetCell: freq.targetCell,
                proposedValue: freq.proposedValue,
                confidence: maxConfidence(freq.confidence, hole.confidence),
            });
        } else {
            // Fallback: same cell, but not the FrequentSuggester +
            // CategoricalHole combo we expect. Keep the highest-confidence
            // one to avoid duplicate rows.
            const best = list.reduce((acc, cur) =>
                CONFIDENCE_RANK[cur.confidence] > CONFIDENCE_RANK[acc.confidence]
                    ? cur
                    : acc,
            );
            out.push(best);
        }
    }
    return out;
};

/**
 * Latest `loggedAt` among suggestions that contributed to the pattern
 * underlying this insight. Used to sort newest-first so the Hypotheses
 * panel reads like a historical log.
 *
 * - `FrequentSuggester` / `DualSignal`: latest suggestion by the same
 *   suggester that named the same card. Both fields together pin the
 *   evidence chain that produced the insight.
 * - `CategoricalHole`: latest suggestion by the same suggester (any
 *   card). The "named everything except one" pattern grows whenever
 *   the suggester logs anything in the category, so the most recent
 *   suggestion by that suggester is the most precise "this pattern
 *   was just touched" signal we have without re-doing the per-category
 *   filter at sort time.
 * - `SharedSuggestionFocus`: latest suggestion that named the card.
 *
 * Returns `0` when no contributing suggestion is found (which would
 * only happen for a synthetic/test insight). The caller treats that
 * as "oldest" so it sinks to the bottom of the list.
 */
const insightRecency = (
    kind: InsightKind,
    suggestions: ReadonlyArray<Suggestion>,
): number => {
    let max = 0;
    for (const s of suggestions) {
        let contributes = false;
        switch (kind._tag) {
            case "FrequentSuggester":
            case "DualSignal":
                contributes =
                    s.suggester === kind.suggester
                    && HashSet.has(s.cards, kind.card);
                break;
            case "CategoricalHole":
                contributes = s.suggester === kind.suggester;
                break;
            case "SharedSuggestionFocus":
                contributes = HashSet.has(s.cards, kind.card);
                break;
        }
        if (contributes && s.loggedAt > max) max = s.loggedAt;
    }
    return max;
};

const sortInsights = (
    insights: ReadonlyArray<Insight>,
    suggestions: ReadonlyArray<Suggestion>,
): ReadonlyArray<Insight> => {
    const recencyByKey = new Map<string, number>();
    for (const ins of insights) {
        recencyByKey.set(ins.dismissedKey, insightRecency(ins.kind, suggestions));
    }
    const arr = [...insights];
    arr.sort((a, b) => {
        // Newest contributing suggestion first — the panel reads like
        // a historical log, so a freshly-detected pattern surfaces at
        // the top.
        const recA = recencyByKey.get(a.dismissedKey) ?? 0;
        const recB = recencyByKey.get(b.dismissedKey) ?? 0;
        if (recA !== recB) return recB - recA;
        const dRank = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
        if (dRank !== 0) return dRank;
        const dTag = a.kind._tag.localeCompare(b.kind._tag);
        if (dTag !== 0) return dTag;
        return a.dismissedKey.localeCompare(b.dismissedKey);
    });
    return arr;
};

/**
 * Run all detectors, merge same-cell duplicates, and sort.
 *
 * Filtering against `dismissedInsights` happens at the call site
 * (where the dismissal map and the current confidence both live) so
 * detectors stay stateless and a newly-deduced cell or freshly-pinned
 * hypothesis auto-clears stale insights without a re-run.
 */
export const generateInsights = (
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
    knowledge: Knowledge,
    hypotheses: HypothesisMap,
    selfPlayer: Player | null,
): ReadonlyArray<Insight> => {
    const freq = detectFrequentSuggester(
        suggestions,
        knowledge,
        hypotheses,
        selfPlayer,
    );
    const hole = detectCategoricalHole(
        setup,
        suggestions,
        knowledge,
        hypotheses,
        selfPlayer,
    );
    const shared = detectSharedSuggestionFocus(
        suggestions,
        knowledge,
        hypotheses,
        selfPlayer,
    );
    // The freq + hole pair both target `(player, card) = Y`, so they
    // can collapse into a `DualSignal`. `shared` targets
    // `(case file, card) = Y` — a different cell — so it's never a
    // merge candidate; we just append it through.
    const merged = mergeOverlapping([...freq, ...hole]);
    return sortInsights([...merged, ...shared], suggestions);
};
