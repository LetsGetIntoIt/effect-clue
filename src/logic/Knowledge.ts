import { Data, Equal, HashMap, Option } from "effect";
import { Card, Owner, ownerLabel, Player, PlayerOwner } from "./GameObjects";

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
 * Thrown when a rule tries to set a cell to a value that contradicts
 * what is already known, or when a slice becomes internally impossible
 * (e.g. a "case file has exactly one weapon" slice that ends up with
 * two weapons marked Y). Caught at the top of the deducer and surfaced
 * to the caller as part of the deduction result so that inconsistent
 * games get a proper error instead of silently producing a bogus
 * answer.
 */
export class Contradiction extends Error {
    readonly _tag = "Contradiction" as const;
    constructor(public readonly reason: string) {
        super(`Contradiction: ${reason}`);
    }
}

export const cellConflictContradiction = (
    cell: Cell,
    attempted: CellValue,
    existing: CellValue,
): Contradiction => {
    const [owner, card] = cell;
    return new Contradiction(
        `tried to set ${ownerLabel(owner)}/${card} to ${attempted} ` +
        `but it is already ${existing}`,
    );
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

/**
 * Given an iterable of (player, cards) pairs, mark each player as owning
 * each card with "Y". Used to seed the knowledge with cards you know about
 * (your own hand, or cards other players have publicly revealed).
 */
export const seedPlayerHands = (
    knowledge: Knowledge,
    hands: Iterable<readonly [Player, Iterable<Card>]>,
): Knowledge => {
    let k = knowledge;
    for (const [player, cards] of hands) {
        for (const card of cards) {
            k = setCell(k, Cell(PlayerOwner(player), card), Y);
        }
    }
    return k;
};

export const knowledgeEquals = (a: Knowledge, b: Knowledge): boolean =>
    Equal.equals(a, b);
