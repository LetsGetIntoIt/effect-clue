import { Equal, HashMap } from "effect";
import type { DraftSuggestion } from "./ClueState";
import type { Card, Player } from "./GameObjects";
import { PlayerOwner } from "./GameObjects";
import { Cell, Y } from "./Knowledge";
import type { Perspective } from "./Perspective";
import { type ChainEntry, chainFor } from "./Provenance";
import type { SuggestionId } from "./Suggestion";

/**
 * Leak-tier classification for one candidate refute card.
 *
 * Ordered best (Tier 1) to worst (Tier 4):
 *
 * 1. `alreadyShownToSuggester` — self has already shown this card
 *    to the same suggester in a prior refute. Re-showing it now
 *    leaks nothing new.
 * 2. `suggesterCanDeduce` — the pending suggester can already
 *    derive that self has this card from public information they
 *    have observed (own past refutes' seen cards, public non-
 *    refuter marks, accusations). Per the perspective engine
 *    (`buildPerspective`), this is a lower bound — if the
 *    perspective concludes it, the suggester definitely can.
 * 3. `alreadyShownToOther` — self has shown this card before, but
 *    to a different suggester. Some players at the table already
 *    know; the current suggester does not.
 * 4. `freshLeak` — never shown, not deducible. Showing it
 *    discloses a new card from self's hand.
 */
export type RefuteAdviceTier =
    | "alreadyShownToSuggester"
    | "suggesterCanDeduce"
    | "alreadyShownToOther"
    | "freshLeak";

/**
 * Reference to a prior suggestion that proves an
 * `alreadyShownToSuggester` (Tier 1) or `alreadyShownToOther`
 * (Tier 3) classification. Carries the originally-named triple so
 * the rationale copy can read "...when they suggested X, Y, Z."
 */
export interface PriorReveal {
    readonly suggestionId: SuggestionId;
    readonly suggester: Player;
    readonly triple: ReadonlyArray<Card>;
}

export interface RefuteAdviceCandidate {
    readonly card: Card;
    readonly tier: RefuteAdviceTier;
    /**
     * Set for Tier 1. The (most-recent) prior reveal of this card
     * to the current pending suggester.
     */
    readonly priorRevealToSuggester: PriorReveal | undefined;
    /**
     * Set for Tier 3. One PriorReveal per distinct other-suggester
     * we've shown this card to before. Sorted most-recent-first.
     */
    readonly priorRevealsToOthers: ReadonlyArray<PriorReveal>;
    /**
     * Set for Tier 2. The chain by which the suggester's
     * perspective derives that self has this card. The UI renders
     * it in the "Why does {suggester} know?" disclosure.
     */
    readonly perspectiveChain: ReadonlyArray<ChainEntry> | undefined;
    /**
     * True iff this candidate ties for the best tier across all
     * candidates. The panel highlights every recommended row.
     */
    readonly recommended: boolean;
}

const TIER_RANK: Record<RefuteAdviceTier, number> = {
    alreadyShownToSuggester: 1,
    suggesterCanDeduce: 2,
    alreadyShownToOther: 3,
    freshLeak: 4,
};

/**
 * Classify each `handCandidate` card with its leak tier and the
 * supporting evidence the UI will render as plain-English
 * rationale. Marks the best-tier candidates as recommended.
 *
 * Precedence on ties between tiers: Tier 1 wins over Tier 2 (a
 * directly-recorded prior reveal is more concrete than an engine-
 * derived "they can deduce it"). Tier 2 wins over Tier 3 (a
 * suggester who can already deduce learns nothing new, whereas a
 * partial leak to others still leaks to the current suggester).
 */
export const classifyRefuteCandidates = (args: {
    readonly selfPlayer: Player;
    readonly pendingSuggester: Player;
    readonly handCandidates: ReadonlyArray<Card>;
    readonly suggestions: ReadonlyArray<DraftSuggestion>;
    readonly suggesterPerspective: Perspective | undefined;
}): ReadonlyArray<RefuteAdviceCandidate> => {
    const {
        selfPlayer,
        pendingSuggester,
        handCandidates,
        suggestions,
        suggesterPerspective,
    } = args;
    if (handCandidates.length === 0) return [];

    const initial = handCandidates.map(card =>
        classifyOne(card, {
            selfPlayer,
            pendingSuggester,
            suggestions,
            suggesterPerspective,
        }),
    );
    const bestRank = Math.min(...initial.map(c => TIER_RANK[c.tier]));
    return initial.map(c => ({ ...c, recommended: TIER_RANK[c.tier] === bestRank }));
};

const classifyOne = (
    card: Card,
    ctx: {
        readonly selfPlayer: Player;
        readonly pendingSuggester: Player;
        readonly suggestions: ReadonlyArray<DraftSuggestion>;
        readonly suggesterPerspective: Perspective | undefined;
    },
): RefuteAdviceCandidate => {
    const { selfPlayer, pendingSuggester, suggestions, suggesterPerspective } =
        ctx;
    const priorReveals = collectPriorReveals(card, selfPlayer, suggestions);
    const toSuggester = priorReveals.find(p => p.suggester === pendingSuggester);
    if (toSuggester !== undefined) {
        return {
            card,
            tier: "alreadyShownToSuggester",
            priorRevealToSuggester: toSuggester,
            priorRevealsToOthers: [],
            perspectiveChain: undefined,
            recommended: false,
        };
    }
    const perspectiveChain = perspectiveChainProvingSelfHasCard(
        card,
        selfPlayer,
        suggesterPerspective,
    );
    if (perspectiveChain !== undefined) {
        return {
            card,
            tier: "suggesterCanDeduce",
            priorRevealToSuggester: undefined,
            priorRevealsToOthers: [],
            perspectiveChain,
            recommended: false,
        };
    }
    const others = priorReveals.filter(p => p.suggester !== pendingSuggester);
    if (others.length > 0) {
        return {
            card,
            tier: "alreadyShownToOther",
            priorRevealToSuggester: undefined,
            priorRevealsToOthers: dedupePriorReveals(others),
            perspectiveChain: undefined,
            recommended: false,
        };
    }
    return {
        card,
        tier: "freshLeak",
        priorRevealToSuggester: undefined,
        priorRevealsToOthers: [],
        perspectiveChain: undefined,
        recommended: false,
    };
};

/**
 * Walk `suggestions` (most-recent first) and collect every entry
 * where `selfPlayer` refuted by showing exactly `card`. Returns
 * the prior-reveal objects in most-recent-first order.
 */
const collectPriorReveals = (
    card: Card,
    selfPlayer: Player,
    suggestions: ReadonlyArray<DraftSuggestion>,
): ReadonlyArray<PriorReveal> => {
    const out: PriorReveal[] = [];
    // Walk newest-to-oldest so dedupePriorReveals keeps the most
    // recent reveal per distinct other-suggester.
    for (let i = suggestions.length - 1; i >= 0; i--) {
        const s = suggestions[i];
        if (s === undefined) continue;
        if (s.refuter !== selfPlayer) continue;
        if (s.seenCard !== card) continue;
        out.push({
            suggestionId: s.id,
            suggester: s.suggester,
            triple: [...s.cards],
        });
    }
    return out;
};

const dedupePriorReveals = (
    reveals: ReadonlyArray<PriorReveal>,
): ReadonlyArray<PriorReveal> => {
    const seen = new Set<Player>();
    const out: PriorReveal[] = [];
    for (const r of reveals) {
        if (seen.has(r.suggester)) continue;
        seen.add(r.suggester);
        out.push(r);
    }
    return out;
};

/**
 * Returns the perspective's chain proving `Cell(self, card) = Y`,
 * if any; otherwise `undefined`. Looks up the perspective's
 * knowledge first to avoid building a chain we then discard.
 */
const perspectiveChainProvingSelfHasCard = (
    card: Card,
    selfPlayer: Player,
    perspective: Perspective | undefined,
): ReadonlyArray<ChainEntry> | undefined => {
    if (perspective === undefined) return undefined;
    const cell = Cell(PlayerOwner(selfPlayer), card);
    const value = HashMap.get(perspective.knowledge.checklist, cell);
    if (value._tag !== "Some") return undefined;
    if (!Equal.equals(value.value, Y)) return undefined;
    const chain = chainFor(perspective.provenance, cell);
    if (chain.length === 0) return undefined;
    return chain;
};
