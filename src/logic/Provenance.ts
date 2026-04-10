import { Equal } from "effect";
import { Card, Owner, ownerLabel } from "./GameObjects";
import { Cell, getCell, Knowledge } from "./Knowledge";
import { allCards, allOwners } from "./GameSetup";
import { applyConsistencyRules, applyDeductionRules } from "./Rules";
import { GameSetup } from "./GameSetup";
import { Suggestion } from "./Suggestion";

/**
 * A short, human-readable reason for why a particular cell has the value
 * it does. These power the "why do we know this?" feature in the UI —
 * hovering a cell in the checklist shows the explanation that was
 * attached when the solver first filled it in.
 */
export interface Reason {
    readonly iteration: number;
    readonly rule: string;
    readonly detail: string;
}

export type Provenance = Map<string, Reason>;

const keyOf = (cell: Cell): string => {
    const [owner, card] = cell;
    return `${ownerLabel(owner)}|${card}`;
};

export const explainCell = (
    provenance: Provenance,
    owner: Owner,
    card: Card,
): Reason | undefined => provenance.get(keyOf(Cell(owner, card)));

/**
 * Run the deducer once and record, for every cell that was newly
 * assigned, the rule iteration and name that first set it. This is a
 * separate traced deduction path — the regular `deduce` stays fast and
 * pure — so the UI can opt in to explanations without paying the cost
 * for every recompute.
 */
export const deduceWithExplanations = (
    setup: GameSetup,
    suggestions: Iterable<Suggestion>,
    initial: Knowledge,
): { knowledge: Knowledge; provenance: Provenance } => {
    const provenance: Provenance = new Map();
    let current = initial;

    const owners = allOwners(setup);
    const cards = allCards(setup);

    // Visit every cell in the owner × card grid and apply `f`. We use
    // this rather than iterating the HashMap directly so the module
    // doesn't depend on HashMap-iteration APIs that shifted between
    // Effect versions.
    const forEachCell = (
        k: Knowledge,
        f: (cell: Cell, value: "Y" | "N") => void,
    ): void => {
        for (const owner of owners) {
            for (const card of cards) {
                const cell = Cell(owner, card);
                const v = getCell(k, cell);
                if (v !== undefined) f(cell, v);
            }
        }
    };

    // Seed provenance with initial cells so the UI can explain them too.
    forEachCell(current, (cell) => {
        provenance.set(keyOf(cell), {
            iteration: 0,
            rule: "initial",
            detail: "given from starting knowledge",
        });
    });

    const stages: ReadonlyArray<{
        name: string;
        step: (k: Knowledge) => Knowledge;
    }> = [
        { name: "consistency", step: applyConsistencyRules(setup) },
        { name: "deduction", step: applyDeductionRules(suggestions) },
    ];

    const maxIterations = 1000;
    for (let i = 0; i < maxIterations; i++) {
        const before = current;
        for (const stage of stages) {
            const next = stage.step(current);
            forEachCell(next, (cell, value) => {
                const key = keyOf(cell);
                if (provenance.has(key)) return;
                provenance.set(key, {
                    iteration: i + 1,
                    rule: stage.name,
                    detail: `${stage.name} rule set ${key} = ${value}`,
                });
            });
            current = next;
        }
        if (Equal.equals(current, before)) break;
    }

    return { knowledge: current, provenance };
};

