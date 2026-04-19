import { Equal, HashMap, Match, MutableHashMap, MutableHashSet, Option } from "effect";
import { Card, CardCategory, Player } from "./GameObjects";
import { Cell, CellValue, Knowledge } from "./Knowledge";
import { applyConsistencyRules, applyDeductionRules } from "./Rules";
import {
    cardName,
    categoryName,
    GameSetup,
} from "./GameSetup";
import { Suggestion, suggestionCards } from "./Suggestion";

/**
 * Structured identity of the rule family that produced a deduction.
 * This is richer than just a string tag — the UI renders different
 * explanations depending on `kind`, and "offer a quick fix" for
 * contradictions needs to identify the originating suggestion or
 * input.
 */
export type ReasonKind =
    | { readonly kind: "initial-known-card" }
    | { readonly kind: "initial-hand-size" }
    | { readonly kind: "card-ownership"; readonly card: Card }
    | { readonly kind: "player-hand"; readonly player: Player }
    | { readonly kind: "case-file-category"; readonly category: CardCategory }
    | { readonly kind: "non-refuters"; readonly suggestionIndex: number }
    | { readonly kind: "refuter-showed"; readonly suggestionIndex: number }
    | { readonly kind: "refuter-owns-one-of"; readonly suggestionIndex: number };

/**
 * A short, human-readable reason for why a particular cell has the value
 * it does. These power the "why do we know this?" feature in the UI —
 * hovering / clicking a cell in the checklist walks the `dependsOn`
 * chain backwards to rebuild the derivation.
 *
 * - `iteration`: 0 for initial inputs, 1+ for rule passes.
 * - `kind`:      structured identity of the rule that set this cell.
 * - `detail`:    free-form human-readable detail.
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
    readonly detail: string;
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
    readonly detail: string;
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
export const chainFor = (
    provenance: Provenance,
    cell: Cell,
): ReadonlyArray<Reason> => {
    const seen = MutableHashSet.empty<Cell>();
    const out: Reason[] = [];
    const stack: Cell[] = [cell];
    let next = stack.pop();
    while (next !== undefined) {
        if (!MutableHashSet.has(seen, next)) {
            MutableHashSet.add(seen, next);
            const reason = Option.getOrUndefined(
                MutableHashMap.get(provenance, next),
            );
            if (reason !== undefined) {
                out.push(reason);
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
export type ReasonDescription =
    | {
          readonly kind: "initial-known-card";
          readonly params: Record<string, never>;
      }
    | {
          readonly kind: "initial-hand-size";
          readonly params: Record<string, never>;
      }
    | {
          readonly kind: "card-ownership";
          readonly params: { readonly card: string };
      }
    | {
          readonly kind: "player-hand";
          readonly params: { readonly player: string };
      }
    | {
          readonly kind: "case-file-category";
          readonly params: { readonly category: string };
      }
    | {
          readonly kind: "non-refuters";
          readonly params: {
              readonly suggestionIndex: number;
              readonly suggester: string | undefined;
          };
      }
    | {
          readonly kind: "refuter-showed";
          readonly params: {
              readonly suggestionIndex: number;
              readonly refuter: string | undefined;
              readonly seen: string | undefined;
          };
      }
    | {
          readonly kind: "refuter-owns-one-of";
          readonly params: {
              readonly suggestionIndex: number;
              readonly suggester: string | undefined;
              readonly refuter: string | undefined;
              readonly cardLabels: string | undefined;
          };
      };

export const describeReason = (
    reason: Reason,
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
): ReasonDescription =>
    Match.value(reason.kind).pipe(
        Match.discriminatorsExhaustive("kind")({
            "initial-known-card": (): ReasonDescription => ({
                kind: "initial-known-card",
                params: {},
            }),
            "initial-hand-size": (): ReasonDescription => ({
                kind: "initial-hand-size",
                params: {},
            }),
            "card-ownership": ({ card }): ReasonDescription => ({
                kind: "card-ownership",
                params: { card: cardName(setup, card) },
            }),
            "player-hand": ({ player }): ReasonDescription => ({
                kind: "player-hand",
                params: { player: String(player) },
            }),
            "case-file-category": ({ category }): ReasonDescription => ({
                kind: "case-file-category",
                params: { category: categoryName(setup, category) },
            }),
            "non-refuters": ({ suggestionIndex }): ReasonDescription => ({
                kind: "non-refuters",
                params: {
                    suggestionIndex,
                    suggester:
                        suggestions[suggestionIndex]?.suggester !== undefined
                            ? String(suggestions[suggestionIndex]!.suggester)
                            : undefined,
                },
            }),
            "refuter-showed": ({ suggestionIndex }): ReasonDescription => {
                const s = suggestions[suggestionIndex];
                return {
                    kind: "refuter-showed",
                    params: {
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
            "refuter-owns-one-of": ({ suggestionIndex }): ReasonDescription => {
                const s = suggestions[suggestionIndex];
                return {
                    kind: "refuter-owns-one-of",
                    params: {
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
        }),
    );

/**
 * Run the deducer once and record, for every cell that was newly
 * assigned, the rule iteration and kind that first set it. This is a
 * separate traced deduction path — the regular `deduce` stays fast and
 * pure — so the UI can opt in to explanations without paying the cost
 * for every recompute.
 */
export const deduceWithExplanations = (
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
    initial: Knowledge,
): { knowledge: Knowledge; provenance: Provenance } => {
    const provenance: Provenance = MutableHashMap.empty<Cell, Reason>();
    let current = initial;
    let currentIteration = 0;

    // Seed provenance with the initial inputs so the UI can explain
    // them as "you told us this".
    HashMap.forEach(initial.checklist, (_value, cell) => {
        MutableHashMap.set(provenance, cell, {
            iteration: 0,
            kind: { kind: "initial-known-card" },
            detail: "given from starting knowledge",
            dependsOn: [],
        });
    });

    const tracer: Tracer = (record) => {
        if (MutableHashMap.has(provenance, record.cell)) return; // first-write-wins
        MutableHashMap.set(provenance, record.cell, {
            iteration: currentIteration,
            kind: record.kind,
            detail: record.detail,
            dependsOn: record.dependsOn,
        });
    };

    const maxIterations = 1000;
    for (let i = 0; i < maxIterations; i++) {
        currentIteration = i + 1;
        const before = current;
        current = applyConsistencyRules(setup, tracer)(current);
        current = applyDeductionRules(suggestions, tracer)(current);
        if (Equal.equals(current, before)) break;
    }

    return { knowledge: current, provenance };
};
