import { Effect, Layer, Result } from "effect";
import type { Accusation } from "./Accusation";
import type { ContradictionTrace } from "./Deducer";
import { Player, PlayerOwner } from "./GameObjects";
import {
    allCardIds,
    defaultHandSizes,
    type GameSetup,
} from "./GameSetup";
import type { KnownCard } from "./InitialKnowledge";
import {
    Cell,
    emptyKnowledge,
    type Knowledge,
    N,
    setCell,
    setHandSize,
    Y,
} from "./Knowledge";
import { deduceWithExplanations, type Provenance } from "./Provenance";
import { Suggestion } from "./Suggestion";
import {
    makeAccusationsLayer,
    makeSetupLayer,
    makeSuggestionsLayer,
} from "./services";

/**
 * A per-player view of the game. Represents what `viewer` can derive
 * from the information they would have observed at the table,
 * assuming `viewer` reasons as well as our solver.
 *
 * **Always a lower bound.** If `perspective.knowledge` has
 * Cell(P, C) = Y, then `viewer` can definitely derive that fact.
 * The converse does not hold: `viewer` may know more than the
 * perspective concludes, from observations we cannot model — e.g.
 * seen cards from refutes the viewer received where self was not
 * the suggester, so self never learned what was shown. Under-
 * classifying is safer than over-classifying: a feature that
 * advises "the suggester already knows this" should err on the
 * conservative side.
 */
export interface Perspective {
    readonly viewer: Player;
    readonly knowledge: Knowledge;
    readonly provenance: Provenance;
}

export type PerspectiveResult = Result.Result<Perspective, ContradictionTrace>;

/**
 * Build `viewer`'s perspective: what they can deduce from the
 * information they would have observed at the table.
 *
 * 1. Restrict the suggestion log: strip `seenCard` from each entry
 *    where `viewer` was neither the suggester nor the refuter. The
 *    viewer publicly heard the refute act, but did not see the
 *    card being shown — `RefuterShowed` won't fire for those;
 *    `RefuterOwnsOneOf` does instead.
 * 2. Seed initial knowledge into the viewer's own row:
 *      - knownCard {player: viewer, card: C} → Cell(viewer, C) = Y
 *      - knownCard {player: P!==viewer, card: C} → Cell(viewer, C) = N
 *    (Viewer trivially knows their own hand; if someone else has C,
 *    viewer does not.) Hand sizes are public — declared at game
 *    start — and go in unmodified.
 * 3. Run `deduceWithExplanations` against the restricted log and
 *    seeded initial knowledge.
 *
 * Returns `Result.failure(trace)` when the viewer's perspective is
 * internally inconsistent. Callers degrade gracefully (e.g. skip
 * Tier 2 advice classification).
 */
export const buildPerspective = (args: {
    readonly viewer: Player;
    readonly setup: GameSetup;
    readonly handSizes: ReadonlyArray<readonly [Player, number]>;
    readonly knownCards: ReadonlyArray<KnownCard>;
    readonly suggestions: ReadonlyArray<Suggestion>;
    readonly accusations: ReadonlyArray<Accusation>;
}): PerspectiveResult => {
    const { viewer, setup, handSizes, knownCards, suggestions, accusations } =
        args;
    const perspectiveSuggestions = restrictSuggestionsToViewer(
        suggestions,
        viewer,
    );
    const initial = seedPerspectiveKnowledge(
        viewer,
        setup,
        handSizes,
        knownCards,
    );
    const layer = Layer.mergeAll(
        makeSetupLayer(setup),
        makeSuggestionsLayer(perspectiveSuggestions),
        makeAccusationsLayer(accusations),
    );
    const traced = Effect.runSync(
        Effect.result(deduceWithExplanations(initial)).pipe(
            Effect.provide(layer),
        ),
    );
    return Result.map(traced, ({ knowledge, provenance }) => ({
        viewer,
        knowledge,
        provenance,
    }));
};

const restrictSuggestionsToViewer = (
    suggestions: ReadonlyArray<Suggestion>,
    viewer: Player,
): ReadonlyArray<Suggestion> =>
    suggestions.map(s => {
        if (s.seenCard === undefined) return s;
        if (s.suggester === viewer || s.refuter === viewer) return s;
        return Suggestion({
            id: s.id,
            suggester: s.suggester,
            cards: s.cards,
            nonRefuters: s.nonRefuters,
            refuter: s.refuter,
            seenCard: undefined,
            loggedAt: s.loggedAt,
        });
    });

const seedPerspectiveKnowledge = (
    viewer: Player,
    setup: GameSetup,
    handSizes: ReadonlyArray<readonly [Player, number]>,
    knownCards: ReadonlyArray<KnownCard>,
): Knowledge => {
    let k = emptyKnowledge;
    const deck = new Set(allCardIds(setup));
    for (const { player, card } of knownCards) {
        if (!setup.players.includes(player)) continue;
        if (!deck.has(card)) continue;
        const value = player === viewer ? Y : N;
        try {
            k = setCell(k, Cell(PlayerOwner(viewer), card), value);
        } catch {
            // Swallow seeding contradictions — the deducer surfaces
            // them downstream with full trace context.
        }
    }
    const explicit = new Map(handSizes);
    const defaults = new Map(defaultHandSizes(setup));
    for (const player of setup.players) {
        const size = explicit.has(player)
            ? explicit.get(player)
            : defaults.get(player);
        if (size === undefined) continue;
        k = setHandSize(k, PlayerOwner(player), size);
    }
    return k;
};
