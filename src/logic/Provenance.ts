import { Data, Effect, Equal, HashMap, Match, MutableHashMap, MutableHashSet, Option } from "effect";
import { Card, CardCategory, Player, ownerLabel } from "./GameObjects";
import { Cell, CellValue, Contradiction, Knowledge } from "./Knowledge";
import {
    applyAccusationRules,
    applyConsistencyRules,
    applyDeductionRules,
} from "./Rules";
import {
    cardName,
    categoryName,
    GameSetup,
} from "./GameSetup";
import { Accusation, accusationCards } from "./Accusation";
import { Suggestion, suggestionCards } from "./Suggestion";
import { KnownCard } from "./InitialKnowledge";
import type { HypothesisMap } from "./Hypothesis";
import {
    getAccusations,
    getCardSet,
    getPlayerSet,
    getSuggestions,
} from "./services";

/**
 * Structured identity of the rule family that produced a deduction.
 * This is richer than just a string tag — the UI renders different
 * explanations depending on the `_tag`, and "offer a quick fix" for
 * contradictions needs to identify the originating suggestion or
 * input.
 *
 * Each variant is its own `Data.TaggedClass` so pattern-matches can
 * use `Match.tagsExhaustive` (tighter v4 idiom) and HashMap keys that
 * contain reason values get structural `Equal` for free.
 */
class InitialKnownCardImpl extends Data.TaggedClass("InitialKnownCard")<{}> {}
class InitialHandSizeImpl extends Data.TaggedClass("InitialHandSize")<{}> {}
class CardOwnershipImpl extends Data.TaggedClass("CardOwnership")<{
    readonly card: Card;
}> {}
class PlayerHandImpl extends Data.TaggedClass("PlayerHand")<{
    readonly player: Player;
}> {}
class CaseFileCategoryImpl extends Data.TaggedClass("CaseFileCategory")<{
    readonly category: CardCategory;
}> {}
class NonRefutersImpl extends Data.TaggedClass("NonRefuters")<{
    readonly suggestionIndex: number;
}> {}
class RefuterShowedImpl extends Data.TaggedClass("RefuterShowed")<{
    readonly suggestionIndex: number;
}> {}
class RefuterOwnsOneOfImpl extends Data.TaggedClass("RefuterOwnsOneOf")<{
    readonly suggestionIndex: number;
}> {}
class DisjointGroupsHandLockImpl extends Data.TaggedClass(
    "DisjointGroupsHandLock",
)<{
    readonly player: Player;
    readonly suggestionIndices: ReadonlyArray<number>;
}> {}
class FailedAccusationImpl extends Data.TaggedClass("FailedAccusation")<{
    readonly accusationIndex: number;
}> {}
class FailedAccusationPairwiseNarrowingImpl extends Data.TaggedClass(
    "FailedAccusationPairwiseNarrowing",
)<{
    /**
     * The case-file Y card that activated the narrowing — knowing this
     * card is in the case file is what reduces every accusation in
     * `accusationIndices` to a 2-card constraint over the partner +
     * third-category cards.
     */
    readonly pinnedCard: Card;
    /**
     * The accusations (by index in the input array) whose third-category
     * cards collectively cover every still-candidate card in that
     * category, forcing the partner card to N.
     */
    readonly accusationIndices: ReadonlyArray<number>;
}> {}

export type ReasonKind =
    | InitialKnownCardImpl
    | InitialHandSizeImpl
    | CardOwnershipImpl
    | PlayerHandImpl
    | CaseFileCategoryImpl
    | NonRefutersImpl
    | RefuterShowedImpl
    | RefuterOwnsOneOfImpl
    | DisjointGroupsHandLockImpl
    | FailedAccusationImpl
    | FailedAccusationPairwiseNarrowingImpl;

export const InitialKnownCard = (): ReasonKind => new InitialKnownCardImpl();
// InitialHandSize is declared in the ReasonKind union but not yet
// emitted by any rule — kept for future hand-size-driven deductions.
export const CardOwnership = (params: { readonly card: Card }): ReasonKind =>
    new CardOwnershipImpl(params);
export const PlayerHand = (params: { readonly player: Player }): ReasonKind =>
    new PlayerHandImpl(params);
export const CaseFileCategory = (params: {
    readonly category: CardCategory;
}): ReasonKind => new CaseFileCategoryImpl(params);
export const NonRefuters = (params: {
    readonly suggestionIndex: number;
}): ReasonKind => new NonRefutersImpl(params);
export const RefuterShowed = (params: {
    readonly suggestionIndex: number;
}): ReasonKind => new RefuterShowedImpl(params);
export const RefuterOwnsOneOf = (params: {
    readonly suggestionIndex: number;
}): ReasonKind => new RefuterOwnsOneOfImpl(params);
export const DisjointGroupsHandLock = (params: {
    readonly player: Player;
    readonly suggestionIndices: ReadonlyArray<number>;
}): ReasonKind => new DisjointGroupsHandLockImpl(params);
export const FailedAccusation = (params: {
    readonly accusationIndex: number;
}): ReasonKind => new FailedAccusationImpl(params);
export const FailedAccusationPairwiseNarrowing = (params: {
    readonly pinnedCard: Card;
    readonly accusationIndices: ReadonlyArray<number>;
}): ReasonKind => new FailedAccusationPairwiseNarrowingImpl(params);

/**
 * A short, human-readable reason for why a particular cell has the value
 * it does. These power the "why do we know this?" feature in the UI —
 * hovering / clicking a cell in the checklist walks the `dependsOn`
 * chain backwards to rebuild the derivation.
 *
 * - `iteration`: 0 for initial inputs, 1+ for rule passes.
 * - `kind`:      structured identity of the rule that set this cell.
 * - `value`:     the Y / N value this reason forced into the output cell.
 * - `dependsOn`: cells whose values were consulted to derive this one.
 *                For initial inputs this is empty. For slice-based
 *                deductions it's the already-set cells in the slice.
 *                For suggestion-driven rules it's typically the cells
 *                the rule inspected (e.g. the two N cells that made
 *                `refuterOwnsOneOf` narrow down to the third).
 */
export interface Reason {
    readonly iteration: number;
    readonly kind: ReasonKind;
    readonly value: CellValue;
    readonly dependsOn: ReadonlyArray<Cell>;
}

/**
 * Provenance map: Cell → Reason. Backed by Effect's `MutableHashMap` so
 * lookups use structural `Equal` on the Cell key (rather than the
 * `keyOf` string-hash surrogate we used before). Mutable because we
 * build it imperatively during the deducer's single traced pass and
 * then hand off a read-only view to the UI.
 */
export type Provenance = MutableHashMap.MutableHashMap<Cell, Reason>;

/**
 * A single cell-setting event emitted by a rule while the tracer is
 * hooked up. Rules that don't set any cells don't emit anything; rules
 * that set multiple cells emit multiple events. First-write-wins in the
 * provenance map — subsequent rules that "re-set" the same cell to the
 * same value don't overwrite the original explanation.
 */
export interface SetCellRecord {
    readonly cell: Cell;
    readonly value: CellValue;
    readonly kind: ReasonKind;
    readonly dependsOn: ReadonlyArray<Cell>;
}

/**
 * Optional callback threaded through the rule layer so that
 * `deduceWithExplanations` can record per-cell provenance without the
 * rule code caring. When a rule passes `undefined` (the fast `deduce`
 * path), the tracer is skipped entirely — zero overhead.
 */
export type Tracer = (record: SetCellRecord) => void;

/**
 * Walk the provenance chain for a cell, producing the full list of
 * reasons in dependency order (root causes first). Used by
 * ChecklistGrid's title-tooltip builder to render the derivation
 * chain.
 *
 * Dedup uses a HashSet keyed on Cell directly (structural Equal), so
 * no hash-surrogate string is needed.
 */
export interface ChainEntry {
    readonly cell: Cell;
    readonly reason: Reason;
}

export const chainFor = (
    provenance: Provenance,
    cell: Cell,
): ReadonlyArray<ChainEntry> => {
    const seen = MutableHashSet.empty<Cell>();
    const out: ChainEntry[] = [];
    const stack: Cell[] = [cell];
    let next = stack.pop();
    while (next !== undefined) {
        if (!MutableHashSet.has(seen, next)) {
            MutableHashSet.add(seen, next);
            const reason = Option.getOrUndefined(
                MutableHashMap.get(provenance, next),
            );
            if (reason !== undefined) {
                out.push({ cell: next, reason });
                for (const dep of reason.dependsOn) stack.push(dep);
            }
        }
        next = stack.pop();
    }
    return out.reverse();
};

/**
 * Structured description of a Reason, keyed by the reason's kind. The
 * UI layer resolves the tagged shape into localized copy via
 * `messages/en.json` under `reasons.*` — keeping this module pure so
 * solver tests (and future non-React callers) don't depend on
 * next-intl.
 *
 * The shape stays isomorphic with `ReasonKind`: one variant per kind,
 * carrying the name-resolved strings the UI needs to interpolate.
 * Optional fields are populated when the relevant suggestion is
 * present in the `suggestions` array — stale provenance entries
 * (suggestion removed) fall back to the no-params branch of the
 * matching message.
 */
/**
 * Params every variant carries about the cell this reason set. The i18n
 * templates interpolate these so lines read as concrete facts about a
 * specific (player, card) rather than a generic "this cell".
 */
interface CellParams {
    readonly cellPlayer: string;
    readonly cellCard: string;
    readonly value: CellValue;
}

/**
 * Distinguishes the two ways a cell can land in `initial.checklist` —
 * either the user marked it as a real-life observation (`observation`)
 * or it's an active hypothesis being explored (`hypothesis`). Read at
 * popover-render time by cross-checking the cell against the
 * `knownCards` array and the `hypotheses` map; the value here drives
 * the per-step label ("Known observation" vs "Hypothesis").
 *
 * If both sources hold, hypothesis wins — `foldHypothesesInto`
 * overwrites the real value, so the deducer ran on the hypothesis
 * value and the chain's `value` matches.
 */
export type InitialKnownCardSource = "observation" | "hypothesis";

export type ReasonDescription =
    | {
          readonly kind: "initial-known-card";
          readonly params: CellParams & {
              readonly source: InitialKnownCardSource;
          };
      }
    | {
          readonly kind: "initial-hand-size";
          readonly params: CellParams;
      }
    | {
          readonly kind: "card-ownership";
          readonly params: CellParams & { readonly card: string };
      }
    | {
          readonly kind: "player-hand";
          readonly params: CellParams & { readonly player: string };
      }
    | {
          readonly kind: "case-file-category";
          readonly params: CellParams & { readonly category: string };
      }
    | {
          readonly kind: "non-refuters";
          readonly params: CellParams & {
              readonly suggestionIndex: number;
              readonly suggester: string | undefined;
          };
      }
    | {
          readonly kind: "refuter-showed";
          readonly params: CellParams & {
              readonly suggestionIndex: number;
              readonly refuter: string | undefined;
              readonly seen: string | undefined;
          };
      }
    | {
          readonly kind: "refuter-owns-one-of";
          readonly params: CellParams & {
              readonly suggestionIndex: number;
              readonly suggester: string | undefined;
              readonly refuter: string | undefined;
              readonly cardLabels: string | undefined;
          };
      }
    | {
          readonly kind: "disjoint-groups-hand-lock";
          readonly params: CellParams & {
              readonly player: string;
              readonly groupCount: number;
              readonly suggestionIndices: ReadonlyArray<number>;
              // 1-based, comma-separated for the i18n template; rendered
              // as e.g. "#3, #5, #7" so users can find the contributing
              // suggestions in the log.
              readonly suggestionNumbers: string;
          };
      }
    | {
          readonly kind: "failed-accusation";
          readonly params: CellParams & {
              readonly accusationIndex: number;
              readonly accuser: string | undefined;
              // Comma-separated card names from the failed accusation.
              // `undefined` when the accusation isn't in the input array
              // (stale provenance entry — accusation removed).
              readonly cardLabels: string | undefined;
          };
      }
    | {
          readonly kind: "failed-accusation-pairwise";
          readonly params: CellParams & {
              readonly pinnedCardLabel: string;
              readonly accusationIndices: ReadonlyArray<number>;
              // 1-based, comma-separated for the i18n template; rendered
              // as e.g. "#3, #5, #7" so users can find the contributing
              // accusations in the log.
              readonly accusationNumbers: string;
          };
      };

export const describeReason = (
    reason: Reason,
    cell: Cell,
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
    accusations: ReadonlyArray<Accusation> = [],
    knownCards: ReadonlyArray<KnownCard> = [],
    hypotheses: HypothesisMap = HashMap.empty(),
): ReasonDescription => {
    const base: CellParams = {
        cellPlayer: ownerLabel(cell.owner),
        cellCard: cardName(setup, cell.card),
        value: reason.value,
    };
    const classifyInitialKnownCard = (): InitialKnownCardSource => {
        if (HashMap.has(hypotheses, cell)) return "hypothesis";
        if (cell.owner._tag === "Player") {
            const player = cell.owner.player;
            const matchKnown = knownCards.some(
                kc => kc.player === player && kc.card === cell.card,
            );
            if (matchKnown) return "observation";
        }
        return "observation";
    };
    return Match.value(reason.kind).pipe(
        Match.tagsExhaustive({
            InitialKnownCard: (): ReasonDescription => ({
                kind: "initial-known-card",
                params: { ...base, source: classifyInitialKnownCard() },
            }),
            InitialHandSize: (): ReasonDescription => ({
                kind: "initial-hand-size",
                params: base,
            }),
            CardOwnership: ({ card }): ReasonDescription => ({
                kind: "card-ownership",
                params: { ...base, card: cardName(setup, card) },
            }),
            PlayerHand: ({ player }): ReasonDescription => ({
                kind: "player-hand",
                params: { ...base, player: String(player) },
            }),
            CaseFileCategory: ({ category }): ReasonDescription => ({
                kind: "case-file-category",
                params: { ...base, category: categoryName(setup, category) },
            }),
            NonRefuters: ({ suggestionIndex }): ReasonDescription => ({
                kind: "non-refuters",
                params: {
                    ...base,
                    suggestionIndex,
                    suggester:
                        suggestions[suggestionIndex]?.suggester !== undefined
                            ? String(suggestions[suggestionIndex]!.suggester)
                            : undefined,
                },
            }),
            RefuterShowed: ({ suggestionIndex }): ReasonDescription => {
                const s = suggestions[suggestionIndex];
                return {
                    kind: "refuter-showed",
                    params: {
                        ...base,
                        suggestionIndex,
                        refuter:
                            s?.refuter !== undefined
                                ? String(s.refuter)
                                : undefined,
                        seen:
                            s?.seenCard !== undefined
                                ? cardName(setup, s.seenCard)
                                : undefined,
                    },
                };
            },
            RefuterOwnsOneOf: ({ suggestionIndex }): ReasonDescription => {
                const s = suggestions[suggestionIndex];
                return {
                    kind: "refuter-owns-one-of",
                    params: {
                        ...base,
                        suggestionIndex,
                        suggester:
                            s?.suggester !== undefined
                                ? String(s.suggester)
                                : undefined,
                        refuter:
                            s?.refuter !== undefined
                                ? String(s.refuter)
                                : undefined,
                        cardLabels: s
                            ? suggestionCards(s)
                                  .map((id: Card) => cardName(setup, id))
                                  .join(", ")
                            : undefined,
                    },
                };
            },
            DisjointGroupsHandLock: ({
                player,
                suggestionIndices,
            }): ReasonDescription => ({
                kind: "disjoint-groups-hand-lock",
                params: {
                    ...base,
                    player: String(player),
                    groupCount: suggestionIndices.length,
                    suggestionIndices,
                    suggestionNumbers: suggestionIndices
                        .map(i => `#${i + 1}`)
                        .join(", "),
                },
            }),
            FailedAccusation: ({ accusationIndex }): ReasonDescription => {
                const a = accusations[accusationIndex];
                return {
                    kind: "failed-accusation",
                    params: {
                        ...base,
                        accusationIndex,
                        accuser:
                            a?.accuser !== undefined
                                ? String(a.accuser)
                                : undefined,
                        cardLabels: a
                            ? accusationCards(a)
                                  .map((id: Card) => cardName(setup, id))
                                  .join(", ")
                            : undefined,
                    },
                };
            },
            FailedAccusationPairwiseNarrowing: ({
                pinnedCard,
                accusationIndices,
            }): ReasonDescription => ({
                kind: "failed-accusation-pairwise",
                params: {
                    ...base,
                    pinnedCardLabel: cardName(setup, pinnedCard),
                    accusationIndices,
                    accusationNumbers: accusationIndices
                        .map(i => `#${i + 1}`)
                        .join(", "),
                },
            }),
        }),
    );
};

/**
 * Run the deducer once and record, for every cell that was newly
 * assigned, the rule iteration and kind that first set it. This is a
 * separate traced deduction path — the regular `deduce` stays fast and
 * pure — so the UI can opt in to explanations without paying the cost
 * for every recompute.
 *
 * Game setup and suggestion log are ambient context, read from the
 * service layer. Use `runDeduceWithExplanations` from test-utils for
 * synchronous test call sites.
 */
export const deduceWithExplanations = Effect.fn("deducer.evaluateWithProvenance")(
    function* (initial: Knowledge) {
        const cardSet = yield* getCardSet;
        const playerSet = yield* getPlayerSet;
        const suggestions = yield* getSuggestions;
        const accusations = yield* getAccusations;
        const setup = GameSetup({ cardSet, playerSet });
        const provenance: Provenance = MutableHashMap.empty<Cell, Reason>();
        let current = initial;
        let currentIteration = 0;

        // Seed provenance with the initial inputs so the UI can explain
        // them as "you told us this".
        HashMap.forEach(initial.checklist, (value, cell) => {
            MutableHashMap.set(provenance, cell, {
                iteration: 0,
                kind: InitialKnownCard(),
                value,
                dependsOn: [],
            });
        });

        const tracer: Tracer = (record) => {
            if (MutableHashMap.has(provenance, record.cell)) return; // first-write-wins
            MutableHashMap.set(provenance, record.cell, {
                iteration: currentIteration,
                kind: record.kind,
                value: record.value,
                dependsOn: record.dependsOn,
            });
        };

        try {
            const maxIterations = 1000;
            for (let i = 0; i < maxIterations; i++) {
                currentIteration = i + 1;
                const before = current;
                current = applyConsistencyRules(setup, tracer)(current);
                current = applyDeductionRules(setup, suggestions, tracer)(current);
                current = applyAccusationRules(accusations, setup, tracer)(current);
                if (Equal.equals(current, before)) break;
            }
        } catch (e) {
            if (e instanceof Contradiction) {
                return yield* Effect.fail({
                    reason: e.reason,
                    offendingCells: e.offendingCells,
                    offendingSuggestionIndices:
                        e.suggestionIndex !== undefined
                            ? [e.suggestionIndex]
                            : [],
                    offendingAccusationIndices:
                        e.accusationIndex !== undefined
                            ? [e.accusationIndex]
                            : [],
                    sliceLabel: e.sliceLabel,
                });
            }
            throw e;
        }

        return { knowledge: current, provenance };
    });
