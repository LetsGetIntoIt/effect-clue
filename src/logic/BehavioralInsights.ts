import { Data, HashMap, HashSet } from "effect";
import {
    Card,
    CardCategory,
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
 * M1 ships two pure-pattern detectors that don't need a per-player
 * perspective engine:
 *
 *   - `FrequentSuggester`: a player has named the same card 3+ times
 *     across all suggestions. Likely they own it (own-cards tactic).
 *   - `CategoricalHole`: a player has named every card in a category
 *     except one. Likely they own the missing one.
 *
 * Both detectors emit only `Y` hypotheses on `(player, card)` cells.
 * Theory-of-mind detectors (e.g. "could they know it's in the case
 * file?") need a perspective engine and are deferred to a later
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

export type InsightKind = FrequentSuggester | CategoricalHole | DualSignal;

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

const sortInsights = (insights: ReadonlyArray<Insight>): ReadonlyArray<Insight> => {
    const arr = [...insights];
    arr.sort((a, b) => {
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
    const merged = mergeOverlapping([...freq, ...hole]);
    return sortInsights(merged);
};
