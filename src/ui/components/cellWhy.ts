import { Equal } from "effect";
import type { useTranslations } from "next-intl";

import type { Accusation } from "../../logic/Accusation";
import type { Card, Owner } from "../../logic/GameObjects";
import { ownerLabel } from "../../logic/GameObjects";
import type { GameSetup } from "../../logic/GameSetup";
import { cardName } from "../../logic/GameSetup";
import type { HypothesisMap } from "../../logic/Hypothesis";
import type { KnownCard } from "../../logic/InitialKnowledge";
import { Cell, type CellValue, N } from "../../logic/Knowledge";
import {
    type ChainEntry,
    chainFor,
    describeReason,
    type InitialKnownCardSource,
    type Provenance,
    type ReasonDescription,
} from "../../logic/Provenance";
import type { Suggestion } from "../../logic/Suggestion";

/**
 * Result of consolidating a cell's provenance chain into a
 * conclusion-first, three-block "why" summary.
 *
 * - `headline`: one-liner stating what the cell's value is.
 * - `givens`: pre-rendered bullets, one per `(owner, source, value)`
 *   group of initial inputs.
 * - `reasoning`: zero (cell is purely a given), one (R3 consolidated
 *   the chain into a rich sentence), or many (verbose per-rule
 *   fallback) sentences.
 */
interface CellWhy {
    readonly headline: string | undefined;
    readonly givens: ReadonlyArray<string>;
    readonly reasoning: ReadonlyArray<string>;
}

/**
 * One displayed step in the chain — either a single non-initial
 * derivation rendered as-is, or a `consolidated` run of consecutive
 * `initial-known-card` entries sharing (owner, source, value).
 *
 * The run shape mirrors the `player-hand` Rule-1 dependsOn shape — when
 * the user marks an entire hand as Y, those Y cells fan into a single
 * downstream rule, and listing each as its own "Given:" line is noise.
 * Grouping by (owner, source, value) keeps unrelated givens distinct.
 */
type ChainStep =
    | { readonly kind: "single"; readonly entry: ChainEntry }
    | {
          readonly kind: "initial-run";
          readonly source: InitialKnownCardSource;
          readonly cellPlayer: string;
          readonly value: CellValue;
          readonly cardNames: ReadonlyArray<string>;
      };

const LIST_FORMAT = new Intl.ListFormat("en", {
    style: "long",
    type: "conjunction",
});

/**
 * Group consecutive `initial-known-card` entries that share an
 * `(owner, source, value)` tuple into a single `initial-run` step.
 * Non-initial entries pass through as `single` steps. Run boundaries
 * are emitted in input order — the consolidator depends on that to
 * recognise "every initial group is contiguous" for partition output.
 */
const groupChainEntries = (
    chain: ReadonlyArray<ChainEntry>,
    describe: (entry: ChainEntry) => ReasonDescription,
): ReadonlyArray<ChainStep> => {
    const steps: ChainStep[] = [];
    let run:
        | {
              source: InitialKnownCardSource;
              owner: Owner;
              cellPlayer: string;
              value: CellValue;
              cardNames: string[];
          }
        | null = null;
    const flush = () => {
        if (run === null) return;
        steps.push({
            kind: "initial-run",
            source: run.source,
            cellPlayer: run.cellPlayer,
            value: run.value,
            cardNames: run.cardNames,
        });
        run = null;
    };
    for (const entry of chain) {
        const desc = describe(entry);
        if (desc.kind === "initial-known-card") {
            const source = desc.params.source;
            const owner = entry.cell.owner;
            const value = entry.reason.value;
            const cardLabel = desc.params.cellCard;
            if (
                run !== null &&
                run.source === source &&
                Equal.equals(run.owner, owner) &&
                run.value === value
            ) {
                run.cardNames.push(cardLabel);
            } else {
                flush();
                run = {
                    source,
                    owner,
                    cellPlayer: desc.params.cellPlayer,
                    value,
                    cardNames: [cardLabel],
                };
            }
        } else {
            flush();
            steps.push({ kind: "single", entry });
        }
    }
    flush();
    return steps;
};

/**
 * Render a single non-initial `ReasonDescription` as `{headline,
 * detail}` strings via the "reasons" i18n namespace. Used by the
 * verbose-fallback path of the reasoning section.
 *
 * `initial-known-card` is not handled here — those flow through
 * `groupChainEntries` → bullet rendering in the Given section.
 */
const resolveReasonCopy = (
    desc: Exclude<ReasonDescription, { kind: "initial-known-card" }>,
    tReasons: ReturnType<typeof useTranslations<"reasons">>,
): { readonly headline: string; readonly detail: string } => {
    switch (desc.kind) {
        case "initial-hand-size":
            return {
                headline: tReasons(`${desc.kind}.headline`),
                detail: tReasons(`${desc.kind}.detail`, { ...desc.params }),
            };
        case "card-ownership":
        case "player-hand":
        case "case-file-category":
            return {
                headline: tReasons(`${desc.kind}.headline`),
                detail: tReasons(`${desc.kind}.detail`, { ...desc.params }),
            };
        case "non-refuters": {
            const headline = tReasons("suggestionHeadline", {
                number: desc.params.suggestionIndex + 1,
            });
            const detail =
                desc.params.suggester !== undefined
                    ? tReasons("non-refuters.detailKnown", {
                          cellPlayer: desc.params.cellPlayer,
                          cellCard: desc.params.cellCard,
                          suggester: desc.params.suggester,
                          number: desc.params.suggestionIndex + 1,
                      })
                    : tReasons("non-refuters.detailUnknown", {
                          cellPlayer: desc.params.cellPlayer,
                          cellCard: desc.params.cellCard,
                          number: desc.params.suggestionIndex + 1,
                      });
            return { headline, detail };
        }
        case "refuter-showed": {
            const headline = tReasons("suggestionHeadline", {
                number: desc.params.suggestionIndex + 1,
            });
            if (desc.params.refuter === undefined) {
                return {
                    headline,
                    detail: tReasons("refuter-showed.detailUnknown", {
                        cellPlayer: desc.params.cellPlayer,
                        cellCard: desc.params.cellCard,
                        number: desc.params.suggestionIndex + 1,
                    }),
                };
            }
            return {
                headline,
                detail:
                    desc.params.seen !== undefined
                        ? tReasons("refuter-showed.detailKnown", {
                              cellPlayer: desc.params.cellPlayer,
                              cellCard: desc.params.cellCard,
                              refuter: desc.params.refuter,
                              seen: desc.params.seen,
                              number: desc.params.suggestionIndex + 1,
                          })
                        : tReasons("refuter-showed.detailKnownNoCard", {
                              cellPlayer: desc.params.cellPlayer,
                              cellCard: desc.params.cellCard,
                              refuter: desc.params.refuter,
                              number: desc.params.suggestionIndex + 1,
                          }),
            };
        }
        case "refuter-owns-one-of": {
            const headline = tReasons("suggestionHeadline", {
                number: desc.params.suggestionIndex + 1,
            });
            if (
                desc.params.refuter === undefined ||
                desc.params.suggester === undefined ||
                desc.params.cardLabels === undefined
            ) {
                return {
                    headline,
                    detail: tReasons("refuter-owns-one-of.detailUnknown", {
                        cellPlayer: desc.params.cellPlayer,
                        cellCard: desc.params.cellCard,
                        number: desc.params.suggestionIndex + 1,
                    }),
                };
            }
            return {
                headline,
                detail: tReasons("refuter-owns-one-of.detailKnown", {
                    cellPlayer: desc.params.cellPlayer,
                    cellCard: desc.params.cellCard,
                    refuter: desc.params.refuter,
                    suggester: desc.params.suggester,
                    cardLabels: desc.params.cardLabels,
                    number: desc.params.suggestionIndex + 1,
                }),
            };
        }
        case "disjoint-groups-hand-lock":
            return {
                headline: tReasons("disjoint-groups-hand-lock.headline"),
                detail: tReasons("disjoint-groups-hand-lock.detail", {
                    cellPlayer: desc.params.cellPlayer,
                    cellCard: desc.params.cellCard,
                    player: desc.params.player,
                    groupCount: desc.params.groupCount,
                    suggestionNumbers: desc.params.suggestionNumbers,
                }),
            };
        case "failed-accusation": {
            const headline = tReasons("accusationHeadline", {
                number: desc.params.accusationIndex + 1,
            });
            if (
                desc.params.accuser === undefined ||
                desc.params.cardLabels === undefined
            ) {
                return {
                    headline,
                    detail: tReasons("failed-accusation.detailUnknown", {
                        cellPlayer: desc.params.cellPlayer,
                        cellCard: desc.params.cellCard,
                        number: desc.params.accusationIndex + 1,
                    }),
                };
            }
            return {
                headline,
                detail: tReasons("failed-accusation.detailKnown", {
                    cellPlayer: desc.params.cellPlayer,
                    cellCard: desc.params.cellCard,
                    accuser: desc.params.accuser,
                    cardLabels: desc.params.cardLabels,
                    number: desc.params.accusationIndex + 1,
                }),
            };
        }
        case "failed-accusation-pairwise":
            return {
                headline: tReasons("failed-accusation-pairwise.headline"),
                detail: tReasons("failed-accusation-pairwise.detail", {
                    cellPlayer: desc.params.cellPlayer,
                    cellCard: desc.params.cellCard,
                    pinnedCardLabel: desc.params.pinnedCardLabel,
                    accusationCount: desc.params.accusationIndices.length,
                    accusationNumbers: desc.params.accusationNumbers,
                }),
            };
    }
};

/**
 * Build a one-clause evidence fragment for a predicate cell — used
 * inside a parent rule's rich detail to inline "why we know this
 * predicate" instead of restating it as its own numbered step.
 *
 * Resolution depth: ONE hop. Two predicate kinds supported:
 *   1. The predicate is an initial-known-card (observation or
 *      hypothesis) — clause restates the user's input.
 *   2. The predicate is a card-ownership-N entry whose upstream is
 *      a single initial Y cell — clause names the actual owner.
 *
 * Anything deeper or of an unsupported kind returns `undefined`, which
 * makes the caller fall back to the verbose form. This deliberate
 * ceiling keeps R3 explainable; deep chains stay readable via the
 * per-step list.
 */
const evidenceClauseFor = (
    predicateCell: Cell,
    chain: ReadonlyArray<ChainEntry>,
    describe: (entry: ChainEntry) => ReasonDescription,
    tReasons: ReturnType<typeof useTranslations<"reasons">>,
): string | undefined => {
    const entry = chain.find(e => Equal.equals(e.cell, predicateCell));
    if (entry === undefined) return undefined;
    const desc = describe(entry);
    if (desc.kind === "initial-known-card") {
        return tReasons(
            desc.params.source === "hypothesis"
                ? "initial-known-card.evidenceClauseHypothesis"
                : "initial-known-card.evidenceClauseObservation",
            {
                cellPlayer: desc.params.cellPlayer,
                value: desc.params.value,
                cellCard: desc.params.cellCard,
            },
        );
    }
    if (desc.kind === "card-ownership" && desc.params.value === N) {
        const upstreamCells = entry.reason.dependsOn;
        const upstream = upstreamCells[0];
        if (upstreamCells.length !== 1 || upstream === undefined) {
            return undefined;
        }
        return tReasons("card-ownership.evidenceClause", {
            cellCard: desc.params.cellCard,
            otherOwner: ownerLabel(upstream.owner),
        });
    }
    return undefined;
};

/**
 * R3: attempt to consolidate the final entry's verbose detail into a
 * single rich sentence with its predicates inlined as evidence
 * clauses. Returns `undefined` if the rule isn't supported or any
 * predicate can't be resolved — the caller then falls back to the
 * verbose per-step form.
 *
 * Today we consolidate only `RefuterOwnsOneOf` — the most common
 * "suggestion-driven with predicates" chain shape, and the one the
 * screenshot motivates. Other rules with non-empty dependsOn
 * (`DisjointGroupsHandLock`, `FailedAccusationPairwiseNarrowing`) fall
 * through to the verbose form.
 */
const tryConsolidateFinalRule = (
    finalEntry: ChainEntry,
    chain: ReadonlyArray<ChainEntry>,
    describe: (entry: ChainEntry) => ReasonDescription,
    tReasons: ReturnType<typeof useTranslations<"reasons">>,
): string | undefined => {
    const desc = describe(finalEntry);
    if (desc.kind !== "refuter-owns-one-of") return undefined;
    if (
        desc.params.refuter === undefined ||
        desc.params.suggester === undefined ||
        desc.params.cardLabels === undefined
    ) {
        return undefined; // stale suggestion — verbose fallback handles this
    }
    if (finalEntry.reason.dependsOn.length !== 2) return undefined;
    const [p1, p2] = finalEntry.reason.dependsOn;
    if (p1 === undefined || p2 === undefined) return undefined;
    const evidence1 = evidenceClauseFor(p1, chain, describe, tReasons);
    const evidence2 = evidenceClauseFor(p2, chain, describe, tReasons);
    if (evidence1 === undefined || evidence2 === undefined) return undefined;
    return tReasons("refuter-owns-one-of.detailRich", {
        refuter: desc.params.refuter,
        suggester: desc.params.suggester,
        number: desc.params.suggestionIndex + 1,
        cardLabels: desc.params.cardLabels,
        cellCard: desc.params.cellCard,
        evidence1,
        evidence2,
    });
};

/**
 * R1: build the conclusion-first headline from the chain's final
 * entry. Case-file owners get a dedicated template so the copy reads
 * "The case file has X." rather than "Case file has X."
 */
const buildHeadline = (
    finalEntry: ChainEntry,
    setup: GameSetup,
    tDeduce: ReturnType<typeof useTranslations<"deduce">>,
): string => {
    const cellCard = cardName(setup, finalEntry.cell.card);
    if (finalEntry.cell.owner._tag === "CaseFile") {
        return tDeduce("headlineCaseFile", {
            value: finalEntry.reason.value,
            cellCard,
        });
    }
    return tDeduce("headlinePlayer", {
        value: finalEntry.reason.value,
        cellPlayer: ownerLabel(finalEntry.cell.owner),
        cellCard,
    });
};

/**
 * R2: render the partitioned "Given" bullets. `groupChainEntries`
 * still does the same-(owner, source, value) consolidation; this
 * formats the resulting runs as standalone bullet strings.
 */
const buildGivenBullets = (
    initialEntries: ReadonlyArray<ChainEntry>,
    describe: (entry: ChainEntry) => ReasonDescription,
    tDeduce: ReturnType<typeof useTranslations<"deduce">>,
): ReadonlyArray<string> => {
    const grouped = groupChainEntries(initialEntries, describe);
    const bullets: string[] = [];
    for (const step of grouped) {
        if (step.kind !== "initial-run") continue; // by construction
        bullets.push(
            tDeduce(
                step.source === "hypothesis"
                    ? "givenBulletHypothesis"
                    : "givenBulletObservation",
                {
                    count: step.cardNames.length,
                    cellPlayer: step.cellPlayer,
                    value: step.value,
                    cardList: LIST_FORMAT.format(step.cardNames),
                },
            ),
        );
    }
    return bullets;
};

/**
 * R3 with fallback to verbose. Returns the reasoning sentences:
 *   - empty when the chain has no derivations (cell is purely a given)
 *   - one rich consolidated sentence when R3 fires
 *   - one verbose sentence per non-initial entry as fallback
 *
 * R3 fires when the final entry is consolidatable AND every
 * non-final non-initial entry is an inlined predicate of the final
 * — so dropping the intermediates loses no information; nothing else
 * in the chain references them.
 */
const buildReasoningSentences = (
    chain: ReadonlyArray<ChainEntry>,
    describe: (entry: ChainEntry) => ReasonDescription,
    tReasons: ReturnType<typeof useTranslations<"reasons">>,
): ReadonlyArray<string> => {
    const nonInitials = chain.filter(
        e => describe(e).kind !== "initial-known-card",
    );
    if (nonInitials.length === 0) return [];
    const finalEntry = nonInitials[nonInitials.length - 1];
    if (finalEntry === undefined) return [];

    const rich = tryConsolidateFinalRule(
        finalEntry,
        chain,
        describe,
        tReasons,
    );
    if (rich !== undefined) {
        const predicateCells = finalEntry.reason.dependsOn;
        const intermediates = nonInitials.slice(0, -1);
        const allInlined = intermediates.every(e =>
            predicateCells.some(pc => Equal.equals(pc, e.cell)),
        );
        if (allInlined) return [rich];
    }

    // Verbose fallback: one sentence per non-initial entry, with just
    // the rule's detail copy — the rule-family headline ("Who has the
    // card", "Suggestion #N") is solver-engine vocabulary the reader
    // doesn't need now that the conclusion-first headline names the
    // result at the top.
    return nonInitials
        .map(entry => {
            const desc = describe(entry);
            if (desc.kind === "initial-known-card") return ""; // filtered above
            const { detail } = resolveReasonCopy(desc, tReasons);
            return detail;
        })
        .filter(s => s.length > 0);
};

/**
 * Top-level consolidator: walk the cell's provenance chain and
 * produce a three-section `CellWhy` summary (headline / givens /
 * reasoning). When provenance is missing or empty, all three fields
 * are empty / undefined and the renderer falls back to its null
 * state.
 */
export const buildCellWhy = (args: {
    provenance: Provenance | undefined;
    suggestions: ReadonlyArray<Suggestion>;
    accusations: ReadonlyArray<Accusation>;
    setup: GameSetup;
    owner: Owner;
    card: Card;
    knownCards: ReadonlyArray<KnownCard>;
    hypotheses: HypothesisMap;
    tDeduce: ReturnType<typeof useTranslations<"deduce">>;
    tReasons: ReturnType<typeof useTranslations<"reasons">>;
}): CellWhy => {
    const {
        provenance,
        suggestions,
        accusations,
        setup,
        owner,
        card,
        knownCards,
        hypotheses,
        tDeduce,
        tReasons,
    } = args;

    const chain = provenance ? chainFor(provenance, Cell(owner, card)) : [];
    if (chain.length === 0) {
        return { headline: undefined, givens: [], reasoning: [] };
    }
    const describe = (entry: ChainEntry): ReasonDescription =>
        describeReason(
            entry.reason,
            entry.cell,
            setup,
            suggestions,
            accusations,
            knownCards,
            hypotheses,
        );
    const finalEntry = chain[chain.length - 1];
    if (finalEntry === undefined) {
        return { headline: undefined, givens: [], reasoning: [] };
    }

    const headline = buildHeadline(finalEntry, setup, tDeduce);
    const initials = chain.filter(
        e => describe(e).kind === "initial-known-card",
    );
    const givens = buildGivenBullets(initials, describe, tDeduce);
    const reasoning = buildReasoningSentences(chain, describe, tReasons);

    return { headline, givens, reasoning };
};
