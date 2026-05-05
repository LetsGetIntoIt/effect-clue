import { Data, Effect, Equal, HashMap, Result } from "effect";
import type { Accusation } from "./Accusation";
import {
    allCardIds,
    GameSetup,
} from "./GameSetup";
import {
    Card,
    CaseFileOwner,
    Owner,
    Player,
    PlayerOwner,
} from "./GameObjects";
import {
    Cell,
    CellValue,
    getCell,
    Knowledge,
    setCell,
} from "./Knowledge";
import type { Suggestion } from "./Suggestion";
import { deduceSync, type DeductionResult, type ContradictionTrace } from "./Deducer";

class CellHypothesisImpl extends Data.Class<{
    readonly owner: Owner;
    readonly card: Card;
    readonly value: CellValue;
}> {}

export type CellHypothesis = CellHypothesisImpl;

export const CellHypothesis = (params: {
    readonly owner: Owner;
    readonly card: Card;
    readonly value: CellValue;
}): CellHypothesis => new CellHypothesisImpl(params);

export type HypothesisStatus =
    | "verified"
    | "falsified"
    | "plausible"
    | "blocked";

export interface HypothesisEvaluation {
    readonly hypothesis: CellHypothesis;
    readonly status: HypothesisStatus;
    readonly impactCount: number;
    readonly contradiction?: ContradictionTrace | undefined;
}

interface EvaluateHypothesesArgs {
    readonly setup: GameSetup;
    readonly suggestions: ReadonlyArray<Suggestion>;
    readonly accusations: ReadonlyArray<Accusation>;
    readonly initialKnowledge: Knowledge;
    readonly factualResult: DeductionResult;
    readonly hypotheses: ReadonlyArray<CellHypothesis>;
}

export const cellOfHypothesis = (hypothesis: CellHypothesis): Cell =>
    Cell(hypothesis.owner, hypothesis.card);

const cellKey = (cell: Cell): string =>
    cell.owner._tag === "Player"
        ? `player:${String(cell.owner.player)}:${String(cell.card)}`
        : `case-file:${String(cell.card)}`;

export const hypothesisKey = (hypothesis: CellHypothesis): string =>
    cellKey(cellOfHypothesis(hypothesis));

export const findHypothesisForCell = (
    hypotheses: ReadonlyArray<CellHypothesis>,
    cell: Cell,
): CellHypothesis | undefined =>
    hypotheses.find(h => Equal.equals(cellOfHypothesis(h), cell));

export const findEvaluationForCell = (
    evaluations: ReadonlyArray<HypothesisEvaluation>,
    cell: Cell,
): HypothesisEvaluation | undefined =>
    evaluations.find(e => Equal.equals(cellOfHypothesis(e.hypothesis), cell));

export const setHypothesisForCell = (
    hypotheses: ReadonlyArray<CellHypothesis>,
    cell: Cell,
    value: CellValue | undefined,
): ReadonlyArray<CellHypothesis> => {
    const current = findHypothesisForCell(hypotheses, cell);
    if (current?.value === value) return hypotheses;
    if (current === undefined && value === undefined) return hypotheses;
    const withoutCell = hypotheses.filter(
        h => !Equal.equals(cellOfHypothesis(h), cell),
    );
    if (value === undefined) return withoutCell;
    return [
        ...withoutCell,
        CellHypothesis({ owner: cell.owner, card: cell.card, value }),
    ];
};

export const pruneHypothesesToSetup = (
    setup: GameSetup,
    hypotheses: ReadonlyArray<CellHypothesis>,
): ReadonlyArray<CellHypothesis> => {
    const playerSet = new Set(setup.players.map(p => String(p)));
    const cardSet = new Set(allCardIds(setup).map(card => String(card)));
    return hypotheses.filter(h => {
        if (!cardSet.has(String(h.card))) return false;
        if (h.owner._tag === "CaseFile") return true;
        return playerSet.has(String(h.owner.player));
    });
};

export const renamePlayerInHypotheses = (
    hypotheses: ReadonlyArray<CellHypothesis>,
    oldName: Player,
    newName: Player,
): ReadonlyArray<CellHypothesis> =>
    hypotheses.map(h =>
        h.owner._tag === "Player" && h.owner.player === oldName
            ? CellHypothesis({
                  owner: PlayerOwner(newName),
                  card: h.card,
                  value: h.value,
              })
            : h,
    );

export const ownerToPersisted = (
    owner: Owner,
): { readonly _tag: "Player"; readonly player: Player } | { readonly _tag: "CaseFile" } =>
    owner._tag === "Player"
        ? { _tag: "Player", player: owner.player }
        : { _tag: "CaseFile" };

export const ownerFromPersisted = (owner:
    | { readonly _tag: "Player"; readonly player: Player }
    | { readonly _tag: "CaseFile" }
): Owner =>
    owner._tag === "Player"
        ? PlayerOwner(owner.player)
        : CaseFileOwner();

const evaluateOne = (
    args: EvaluateHypothesesArgs,
    hypothesis: CellHypothesis,
): HypothesisEvaluation => {
    if (Result.isFailure(args.factualResult)) {
        return {
            hypothesis,
            status: "blocked",
            impactCount: 0,
            contradiction: args.factualResult.failure,
        };
    }

    const cell = cellOfHypothesis(hypothesis);
    const factualKnowledge = args.factualResult.success;
    const factualValue = getCell(factualKnowledge, cell);
    if (factualValue === hypothesis.value) {
        return { hypothesis, status: "verified", impactCount: 0 };
    }
    if (factualValue !== undefined) {
        return { hypothesis, status: "falsified", impactCount: 0 };
    }

    let assumedInitial: Knowledge;
    try {
        assumedInitial = setCell(
            args.initialKnowledge,
            cell,
            hypothesis.value,
        );
    } catch {
        return { hypothesis, status: "falsified", impactCount: 0 };
    }

    const hypotheticalResult = deduceSync(
        args.setup,
        args.suggestions,
        args.accusations,
        assumedInitial,
    );
    if (Result.isFailure(hypotheticalResult)) {
        return {
            hypothesis,
            status: "falsified",
            impactCount: 0,
            contradiction: hypotheticalResult.failure,
        };
    }

    let impactCount = 0;
    HashMap.forEach(hypotheticalResult.success.checklist, (_value, nextCell) => {
        if (Equal.equals(nextCell, cell)) return;
        if (getCell(factualKnowledge, nextCell) === undefined) {
            impactCount += 1;
        }
    });

    return { hypothesis, status: "plausible", impactCount };
};

export const evaluateHypotheses = Effect.fn("hypotheses.evaluate")(
    function* (args: EvaluateHypothesesArgs) {
        return args.hypotheses.map(h => evaluateOne(args, h));
    },
);
