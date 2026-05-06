import { HashMap, Option, Result } from "effect";
import { Cell, Contradiction, getCell, Knowledge, setCell, type CellValue } from "./Knowledge";
import type { ContradictionTrace } from "./Deducer";

/**
 * A "hypothesis" is a per-cell what-if assumption the user toggles on
 * to explore what the deducer would derive if that assumption were
 * true. Hypotheses are SOFT: they don't enter the canonical fact set
 * (so they don't raise the global contradiction banner), and the
 * underlying real-only deduction always continues to run alongside.
 *
 * Encoded as `HashMap<Cell, "Y" | "N">` mirroring the Knowledge
 * checklist shape — "off" is encoded by absence, just like an unknown
 * cell in `Knowledge.checklist`.
 */
export type HypothesisValue = CellValue;
export type HypothesisMap = HashMap.HashMap<Cell, HypothesisValue>;
export const emptyHypotheses: HypothesisMap = HashMap.empty();

/**
 * Per-cell relation to the active hypothesis set. Drives both the
 * cell's visual treatment and the why-popover's microcopy.
 *
 * - `off`: no hypothesis touches this cell directly or indirectly.
 * - `active`: the user placed a hypothesis on this cell and the joint
 *   deduction (real ∪ hypotheses) succeeded.
 * - `derived`: the user did not place a hypothesis here, but the joint
 *   deduction proves a value the real-only deduction couldn't — i.e.
 *   "this would follow if your hypotheses are true".
 * - `confirmed`: the user placed a hypothesis here and the real-only
 *   deduction independently proves the same value (the hypothesis is
 *   correct; the user can clear it as redundant).
 * - `directlyContradicted`: the user placed a hypothesis here, but the
 *   real-only deduction proves the OPPOSITE value (the hypothesis can
 *   never be true). The cell shows the real value; the popover surfaces
 *   the contradiction.
 * - `jointlyConflicts`: the user placed a hypothesis here, real proves
 *   nothing yet, but the joint deduction over the whole hypothesis set
 *   contradicts. We don't single out a culprit — every active hypothesis
 *   in this state contributes to the contradiction.
 */
export type HypothesisStatus =
    | { readonly kind: "off" }
    | { readonly kind: "active"; readonly value: HypothesisValue }
    | { readonly kind: "derived"; readonly value: CellValue }
    | { readonly kind: "confirmed"; readonly value: HypothesisValue }
    | {
          readonly kind: "directlyContradicted";
          readonly hypothesis: HypothesisValue;
          readonly real: CellValue;
      }
    | {
          readonly kind: "jointlyConflicts";
          readonly value: HypothesisValue;
      };

const traceFromContradiction = (e: Contradiction): ContradictionTrace => ({
    reason: e.reason,
    offendingCells: e.offendingCells,
    offendingSuggestionIndices:
        e.suggestionIndex !== undefined ? [e.suggestionIndex] : [],
    offendingAccusationIndices:
        e.accusationIndex !== undefined ? [e.accusationIndex] : [],
    sliceLabel: e.sliceLabel,
    contradictionKind: e.contradictionKind,
});

/**
 * Fold every hypothesis into an initial Knowledge as if it were a
 * known cell. `setCell` throws `Contradiction` if a hypothesis disagrees
 * with a value already present in `initial` (i.e. a known card), and
 * we materialise that into a `Result.Failure` so the joint-deduction
 * caller can branch on it without a try/catch.
 *
 * Cells whose hypothesis matches an existing initial value are no-ops
 * (setCell returns the same Knowledge unchanged).
 */
export const foldHypothesesInto = (
    initial: Knowledge,
    hypotheses: HypothesisMap,
): Result.Result<Knowledge, ContradictionTrace> => {
    let k = initial;
    try {
        for (const [cell, value] of hypotheses) {
            k = setCell(k, cell, value);
        }
        return Result.succeed(k);
    } catch (e) {
        if (e instanceof Contradiction) {
            return Result.fail(traceFromContradiction(e));
        }
        throw e;
    }
};

/**
 * Compute a single cell's hypothesis status from the two deduction
 * results plus the user's hypothesis map. Pure and cheap — called once
 * per visible cell on every render.
 *
 * `realKnowledge` is undefined when the real-only deduction failed —
 * in that case the global contradiction banner is showing and we
 * suppress hypothesis status entirely (return "off").
 *
 * `jointKnowledge` is undefined when either no hypotheses are active
 * (in which case we'd never reach this function with a non-off result)
 * or the joint deduction failed (`jointFailed === true`). The cell
 * still shows whatever the real-only render would, plus the
 * jointly-conflicts marker on each direct-hypothesis cell.
 */
export const statusFor = (
    cell: Cell,
    realKnowledge: Knowledge | undefined,
    jointKnowledge: Knowledge | undefined,
    hypotheses: HypothesisMap,
    jointFailed: boolean,
): HypothesisStatus => {
    if (realKnowledge === undefined) return { kind: "off" };

    const real = getCell(realKnowledge, cell);
    const hyp = HashMap.get(hypotheses, cell);

    if (Option.isSome(hyp)) {
        const h = hyp.value;
        if (real !== undefined && real !== h) {
            return { kind: "directlyContradicted", hypothesis: h, real };
        }
        if (real !== undefined && real === h) {
            return { kind: "confirmed", value: h };
        }
        if (jointFailed) {
            return { kind: "jointlyConflicts", value: h };
        }
        return { kind: "active", value: h };
    }

    // No direct hypothesis on this cell. Is its value derived from one?
    if (real !== undefined) return { kind: "off" };
    if (jointKnowledge === undefined) return { kind: "off" };
    const joint = getCell(jointKnowledge, cell);
    if (joint === undefined) return { kind: "off" };
    return { kind: "derived", value: joint };
};

/**
 * What the cell should *visually* display, factoring real value and
 * hypothesis status. Drives the cell's background color + glyph.
 *
 * - `real`: the real-only deduced value wins (Y/N from the canonical
 *   fact set). Direct-hypothesis cells where the hypothesis is
 *   confirmed or contradicted fall into this branch — the user sees
 *   the real fact, with a status marker in the popover.
 * - `hypothesis`: a direct hypothesis on a cell real doesn't yet
 *   prove. Cell shows `?` over the hypothesis value's color.
 * - `derived`: real proves nothing here, but joint does. Cell shows
 *   `?` over the joint-derived value's color.
 * - `blank`: neither real nor any hypothesis says anything.
 */
export type CellDisplay =
    | { readonly tag: "real"; readonly value: CellValue }
    | { readonly tag: "hypothesis"; readonly value: HypothesisValue }
    | { readonly tag: "derived"; readonly value: CellValue }
    | { readonly tag: "blank" };

export const displayFor = (
    real: CellValue | undefined,
    status: HypothesisStatus,
): CellDisplay => {
    if (real !== undefined) return { tag: "real", value: real };
    if (status.kind === "active" || status.kind === "jointlyConflicts") {
        return { tag: "hypothesis", value: status.value };
    }
    if (status.kind === "derived") {
        return { tag: "derived", value: status.value };
    }
    return { tag: "blank" };
};

/**
 * One row of the hypothesis-conflict banner — a cell the user has
 * placed a hypothesis on, paired with the value they chose. The
 * banner copy doesn't need the real value; that's available via
 * `statusFor` for any cell that wants it.
 *
 * Not exported: callers receive these via `HypothesisConflict.entries`.
 * If a future caller needs the named shape on its own, export it
 * then; today it would be dead surface area.
 */
interface HypothesisConflictEntry {
    readonly cell: Cell;
    readonly value: HypothesisValue;
}

/**
 * Aggregated state of "do the user's hypotheses cause a contradiction
 * the banner should surface?". Two mutually-exclusive kinds:
 *
 * - `directly-contradicted`: at least one hypothesis disagrees with a
 *   real fact. Entries list ONLY the contradicted hypotheses; the
 *   user fixes those first and can re-evaluate after.
 * - `jointly-conflicting`: every hypothesis is individually plausible,
 *   but their union fails to deduce. Entries list ALL active
 *   hypotheses since the conflict is in their interaction.
 *
 * `undefined` means "no banner" — either no hypotheses, the joint
 * deduction succeeded, or the real-only deduction itself is failing
 * (which has its own banner via the deduction-result path).
 */
export type HypothesisConflict =
    | {
          readonly kind: "directly-contradicted";
          readonly entries: ReadonlyArray<HypothesisConflictEntry>;
      }
    | {
          readonly kind: "jointly-conflicting";
          readonly entries: ReadonlyArray<HypothesisConflictEntry>;
      };

/**
 * Aggregate the per-cell hypothesis state into a single banner-level
 * verdict. Pure; preferred over inlining inside React renders so it
 * can be unit-tested directly.
 *
 * Precedence (in order; first match wins):
 *
 *  1. No joint deduction yet (no active hypotheses) → no banner.
 *  2. Joint deduction succeeded → no banner (hypotheses are coherent).
 *  3. Real-only deduction is itself failing → defer to the global
 *     contradiction banner; suppress this one.
 *  4. Any hypothesis directly contradicts a real-fact cell →
 *     `directly-contradicted` (entries: only contradicted ones).
 *  5. Hypotheses exist but the union fails → `jointly-conflicting`
 *     (entries: all active hypotheses).
 *  6. Empty hypothesis map → no banner (defensive; shouldn't reach
 *     here given step 1).
 */
export const computeHypothesisConflict = (
    deductionResult: Result.Result<Knowledge, ContradictionTrace>,
    jointDeductionResult:
        | Result.Result<Knowledge, ContradictionTrace>
        | undefined,
    hypotheses: HypothesisMap,
): HypothesisConflict | undefined => {
    if (jointDeductionResult === undefined) return undefined;
    if (Result.isSuccess(jointDeductionResult)) return undefined;
    if (Result.isFailure(deductionResult)) return undefined;
    const realKnowledge = deductionResult.success;
    const directlyContradicted: Array<HypothesisConflictEntry> = [];
    const allEntries: Array<HypothesisConflictEntry> = [];
    for (const [cell, value] of hypotheses) {
        allEntries.push({ cell, value });
        const real = getCell(realKnowledge, cell);
        if (real !== undefined && real !== value) {
            directlyContradicted.push({ cell, value });
        }
    }
    if (directlyContradicted.length > 0) {
        return {
            kind: "directly-contradicted",
            entries: directlyContradicted,
        };
    }
    if (allEntries.length === 0) return undefined;
    return { kind: "jointly-conflicting", entries: allEntries };
};
