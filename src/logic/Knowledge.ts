import { Data, HashMap, Option } from "effect";
import { Card, Owner, ownerLabel } from "./GameObjects";

/**
 * Each cell in the checklist has one of two values: "Y" for "this owner
 * definitely has this card" and "N" for "definitely doesn't". Absence
 * from the map means "we don't know yet".
 */
export type CellValue = "Y" | "N";

export const Y: CellValue = "Y";
export const N: CellValue = "N";

/**
 * Identifier for a single cell in the unified checklist (owner × card).
 * We use Data.tuple so that structural equality and hashing Just Work
 * inside HashMap.
 */
export type Cell = Data.Data<readonly [Owner, Card]>;
export const Cell = (owner: Owner, card: Card): Cell =>
    Data.tuple(owner, card);

/**
 * Knowledge about a game in progress. The checklist is a single unified
 * map — rather than the original two-checklist design which had separate
 * maps for players and the case file — because the case file is modelled
 * as just another kind of Owner. That lets a single combinator enforce
 * "each card has exactly one owner" without special-casing.
 */
export type Knowledge = Data.Data<{
    readonly checklist: HashMap.HashMap<Cell, CellValue>;
    readonly handSizes: HashMap.HashMap<Owner, number>;
}>;

export const Knowledge = (params: {
    checklist: HashMap.HashMap<Cell, CellValue>;
    handSizes: HashMap.HashMap<Owner, number>;
}): Knowledge => Data.struct(params);

export const emptyKnowledge: Knowledge = Knowledge({
    checklist: HashMap.empty(),
    handSizes: HashMap.empty(),
});

/**
 * Look up a cell value, returning undefined for "unknown". We deliberately
 * use undefined rather than Option here because the rule-application code
 * is dense with value tests and the ceremony of Option.match would
 * obscure intent. See the plan doc (item 4d) for the rationale.
 */
export const getCell = (
    knowledge: Knowledge,
    cell: Cell,
): CellValue | undefined =>
    Option.getOrUndefined(HashMap.get(knowledge.checklist, cell));

export const getCellByOwnerCard = (
    knowledge: Knowledge,
    owner: Owner,
    card: Card,
): CellValue | undefined => getCell(knowledge, Cell(owner, card));

export const getHandSize = (
    knowledge: Knowledge,
    owner: Owner,
): number | undefined =>
    Option.getOrUndefined(HashMap.get(knowledge.handSizes, owner));

// ---- Mutation helpers (immutable) --------------------------------------

/**
 * Structured info carried by every Contradiction. Lets the UI point at
 * the inputs that produced the conflict and offer one-click quick fixes
 * rather than only showing the raw reason string.
 *
 * - `offendingCells`: cells whose current values are (part of) the
 *   conflict. For a cell-set conflict both cells are listed (the existing
 *   one + the cell we were trying to set — they're the same cell in that
 *   case, but listing it anyway keeps the UI logic uniform). For a slice
 *   over-saturation, every Y or N cell that's part of the over-saturated
 *   side is listed.
 * - `sliceLabel`: the human-readable label of the slice that detected
 *   the conflict, when applicable.
 * - `suggestionIndex`: when a suggestion-driven rule detected the
 *   contradiction (e.g. `refuterShowedCard` saw the refuter already owns
 *   a Y cell that conflicts with setting the seen card to Y), the index
 *   of that suggestion in the suggestions array — so the UI can surface
 *   a "remove this suggestion" quick fix.
 */
interface ContradictionInfo {
    readonly reason: string;
    readonly offendingCells: ReadonlyArray<Cell>;
    readonly sliceLabel?: string | undefined;
    readonly suggestionIndex?: number | undefined;
}

/**
 * Thrown when a rule tries to set a cell to a value that contradicts
 * what is already known, or when a slice becomes internally impossible
 * (e.g. a "case file has exactly one weapon" slice that ends up with
 * two weapons marked Y). Caught at the top of the deducer and surfaced
 * to the caller as part of the deduction result so that inconsistent
 * games get a proper error instead of silently producing a bogus
 * answer.
 *
 * Accepts either a plain string (legacy, for rules that haven't been
 * migrated) or a structured ContradictionInfo. Carrying the info inline
 * on the thrown Error lets rules deep in the call stack attach
 * provenance without plumbing extra return types up through `applySlice`.
 */
export class Contradiction extends Error {
    readonly _tag = "Contradiction" as const;
    readonly reason: string;
    readonly offendingCells: ReadonlyArray<Cell>;
    readonly sliceLabel?: string | undefined;
    readonly suggestionIndex?: number | undefined;
    constructor(info: ContradictionInfo | string) {
        const full: ContradictionInfo =
            typeof info === "string"
                ? { reason: info, offendingCells: [] }
                : info;
        super(`Contradiction: ${full.reason}`);
        this.reason = full.reason;
        this.offendingCells = full.offendingCells;
        this.sliceLabel = full.sliceLabel;
        this.suggestionIndex = full.suggestionIndex;
    }
}

const cellConflictContradiction = (
    cell: Cell,
    attempted: CellValue,
    existing: CellValue,
): Contradiction => {
    const [owner, card] = cell;
    return new Contradiction({
        reason:
            `tried to set ${ownerLabel(owner)}/${card} to ${attempted} ` +
            `but it is already ${existing}`,
        offendingCells: [cell],
    });
};

/**
 * Immutably set a single cell. If the cell is already set to the same
 * value this is a no-op; if it's set to the opposite value we throw a
 * Contradiction (caught at the top of the deducer).
 */
export const setCell = (
    knowledge: Knowledge,
    cell: Cell,
    value: CellValue,
): Knowledge => {
    const current = getCell(knowledge, cell);
    if (current === value) return knowledge;
    if (current !== undefined) {
        throw cellConflictContradiction(cell, value, current);
    }
    return Knowledge({
        checklist: HashMap.set(knowledge.checklist, cell, value),
        handSizes: knowledge.handSizes,
    });
};

export const setHandSize = (
    knowledge: Knowledge,
    owner: Owner,
    size: number,
): Knowledge => Knowledge({
    checklist: knowledge.checklist,
    handSizes: HashMap.set(knowledge.handSizes, owner, size),
});

