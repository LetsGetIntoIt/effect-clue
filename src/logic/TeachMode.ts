import { HashMap, Result } from "effect";
import type { CardSet } from "./CardSet";
import { allCardIds, categoryOfCard } from "./CardSet";
import type { Owner, Player } from "./GameObjects";
import { CaseFileOwner, PlayerOwner } from "./GameObjects";
import type { GameSetup } from "./GameSetup";
import { Cell, getCell, type CellValue, type Knowledge } from "./Knowledge";
import type { DeductionResult } from "./Deducer";

/**
 * The user's manual Y/N cell entries while teach-me mode is on. Distinct
 * from `knownCards` (which represents observed evidence and feeds the
 * deducer): user deductions are render-only guesses the user is working
 * through to learn Clue. The deducer ignores them; the Check feature
 * compares them against the real-only deducer to produce the verdict
 * taxonomy.
 *
 * Encoded as `HashMap<Cell, "Y" | "N">` mirroring the Knowledge checklist
 * shape — "off" / "blank" is encoded by absence.
 */
export type UserDeductionValue = CellValue;
export type UserDeductionMap = HashMap.HashMap<Cell, UserDeductionValue>;
export const emptyUserDeductions: UserDeductionMap = HashMap.empty();

/**
 * Per-cell verdict produced by the Check feature in teach-mode. Compares
 * the user's mark against the real-only deducer's verdict, with a
 * separate "Inconsistent" state for cells participating in an intrinsic
 * contradiction (independent of evidence — e.g., two players marked Y
 * for the same card).
 *
 * Verdict precedence: `inconsistent` always wins. Otherwise the
 * combination of `(userMark, deducerVerdict)` produces one of the four
 * remaining states.
 */
export type TeachModeVerdict =
    | { readonly kind: "verifiable"; readonly userMark: UserDeductionValue }
    | { readonly kind: "falsifiable"; readonly userMark: UserDeductionValue; readonly deducerVerdict: CellValue }
    | { readonly kind: "plausible"; readonly userMark: UserDeductionValue }
    | { readonly kind: "missed"; readonly deducerVerdict: CellValue }
    | { readonly kind: "inconsistent"; readonly userMark: UserDeductionValue; readonly conflictingCells: ReadonlyArray<Cell> }
    | { readonly kind: "unknown" };

/**
 * Pure classifier. `conflictingCellsFor` returns the list of *other* cells
 * the input cell collides with under the intrinsic-contradiction validator
 * (empty when not part of a collision).
 */
export const classifyCell = (
    cell: Cell,
    userMark: UserDeductionValue | undefined,
    deducerVerdict: CellValue | undefined,
    conflictingCellsFor: (cell: Cell) => ReadonlyArray<Cell>,
): TeachModeVerdict => {
    const conflicts = conflictingCellsFor(cell);
    if (userMark !== undefined && conflicts.length > 0) {
        return { kind: "inconsistent", userMark, conflictingCells: conflicts };
    }
    if (userMark === undefined && deducerVerdict !== undefined) {
        return { kind: "missed", deducerVerdict };
    }
    if (userMark === undefined) {
        return { kind: "unknown" };
    }
    if (deducerVerdict === undefined) {
        return { kind: "plausible", userMark };
    }
    if (userMark === deducerVerdict) {
        return { kind: "verifiable", userMark };
    }
    return { kind: "falsifiable", userMark, deducerVerdict };
};

/**
 * Result of running the intrinsic-contradiction validator over the
 * user's deductions. Maps each offending cell to the OTHER cells it
 * collides with, so per-cell verdicts can list the conflicting cells
 * by name.
 *
 * Two collision flavors are detected without any deducer pass:
 * - **Same card, multiple Y owners**: each card can have exactly one
 *   owner (player or case file). If two or more cells with the same
 *   card are marked Y, all of them are inconsistent.
 * - **Player Y count exceeds hand size**: if hand size is set and the
 *   user has marked more Ys for that player than the size allows, the
 *   excess cells are inconsistent. We report ALL of that player's Y
 *   cells as the collision set (the user has to remove some — they
 *   pick which).
 */
/**
 * Stable string key for a Cell. Cell is a `Data.Class` whose structural
 * equality only works through Effect's `Equal`/`HashMap` — vanilla
 * `Map<Cell, …>` / `Set<Cell>` compare by reference, which fails when
 * the producer and consumer build their own Cell instances from the
 * same (owner, card) tuple. Use this key everywhere a non-Effect
 * collection holds Cell values.
 */
export const cellKey = (cell: Cell): string => {
    const ownerKey =
        cell.owner._tag === "Player"
            ? `p:${String(cell.owner.player)}`
            : "c";
    return `${ownerKey}|${String(cell.card)}`;
};

export interface IntrinsicContradictionReport {
    /**
     * Cells flagged as participating in any collision, keyed by
     * `cellKey()` so lookups work across producer/consumer boundaries.
     */
    readonly offendingCells: ReadonlySet<string>;
    /**
     * Per-cell list of *other* cells in the collision. Keyed by
     * `cellKey()`. `get(cellKey(cell))` is undefined when the cell
     * isn't in `offendingCells`.
     */
    readonly conflictsByCell: ReadonlyMap<string, ReadonlyArray<Cell>>;
}

export const findIntrinsicContradictions = (
    userDeductions: UserDeductionMap,
    cardSet: CardSet,
    handSizes: ReadonlyArray<readonly [Player, number]>,
): IntrinsicContradictionReport => {
    const offendingCells = new Set<string>();
    const yCellsByCard = new Map<string, Cell[]>();
    const yCellsByPlayer = new Map<string, Cell[]>();

    HashMap.forEach(userDeductions, (value, cell) => {
        if (value !== "Y") return;
        const cardK = String(cell.card);
        const list = yCellsByCard.get(cardK) ?? [];
        list.push(cell);
        yCellsByCard.set(cardK, list);
        if (cell.owner._tag === "Player") {
            const playerK = String(cell.owner.player);
            const plist = yCellsByPlayer.get(playerK) ?? [];
            plist.push(cell);
            yCellsByPlayer.set(playerK, plist);
        }
    });

    // Collision 1: same card, multiple Y owners.
    for (const cells of yCellsByCard.values()) {
        if (cells.length < 2) continue;
        for (const c of cells) offendingCells.add(cellKey(c));
    }

    // Collision 2: player Y count exceeds hand size.
    const handSizeByPlayer = new Map<string, number>();
    for (const [player, size] of handSizes) {
        handSizeByPlayer.set(String(player), size);
    }
    for (const [playerK, cells] of yCellsByPlayer.entries()) {
        const handSize = handSizeByPlayer.get(playerK);
        if (handSize === undefined) continue;
        if (cells.length <= handSize) continue;
        for (const c of cells) offendingCells.add(cellKey(c));
    }

    // Collision 3: a category in the case file has multiple Y owners
    // (e.g. user marks two suspects as the case file's suspect). The
    // case file holds exactly one card per category.
    const caseFileYByCategory = new Map<string, Cell[]>();
    HashMap.forEach(userDeductions, (value, cell) => {
        if (value !== "Y") return;
        if (cell.owner._tag !== "CaseFile") return;
        const catId = categoryOfCard(cardSet, cell.card);
        if (catId === undefined) return;
        const list = caseFileYByCategory.get(String(catId)) ?? [];
        list.push(cell);
        caseFileYByCategory.set(String(catId), list);
    });
    for (const cells of caseFileYByCategory.values()) {
        if (cells.length < 2) continue;
        for (const c of cells) offendingCells.add(cellKey(c));
    }

    // Build the per-cell conflict lists. For each offending cell, the
    // "conflicts" list is the other cells that triggered its collision.
    // Keyed by `cellKey(c)` so lookups work across reference boundaries.
    const conflictsByCell = new Map<string, Cell[]>();
    const addConflicts = (cells: Cell[]): void => {
        for (const c of cells) {
            const k = cellKey(c);
            const list = conflictsByCell.get(k) ?? [];
            for (const other of cells) {
                if (other !== c && !list.includes(other)) list.push(other);
            }
            conflictsByCell.set(k, list);
        }
    };
    for (const cells of yCellsByCard.values()) {
        if (cells.length < 2) continue;
        addConflicts(cells);
    }
    for (const [playerK, cells] of yCellsByPlayer.entries()) {
        const handSize = handSizeByPlayer.get(playerK);
        if (handSize === undefined) continue;
        if (cells.length <= handSize) continue;
        addConflicts(cells);
    }
    for (const cells of caseFileYByCategory.values()) {
        if (cells.length < 2) continue;
        addConflicts(cells);
    }

    return {
        offendingCells,
        conflictsByCell,
    };
};

/**
 * Snapshot the real-only deducer's output into a `UserDeductionMap`.
 * Used by the mid-game toggle prompt's "Keep what we've deduced"
 * option — seeds `userDeductions` with every cell the deducer has
 * proven so the user picks up where the game stands.
 */
export const seedFromKnowledge = (knowledge: Knowledge): UserDeductionMap => {
    let m: UserDeductionMap = emptyUserDeductions;
    HashMap.forEach(knowledge.checklist, (value, cell) => {
        m = HashMap.set(m, cell, value);
    });
    return m;
};

/**
 * Seed `userDeductions` with the "free" facts derived from the user's
 * own hand: for every card the user holds, Y on their cell + N on
 * every other player's column AND the case file. This is the natural
 * starting state when the user enables teach-mode from the setup
 * wizard — they don't need to mark these cells by hand because they
 * literally have the cards in their hand at the physical table.
 *
 * Returns an empty map when `selfPlayerId === null` (the user skipped
 * the identity step) or the user has no recorded hand yet.
 */
export const seedFromOwnHand = (
    knownCards: ReadonlyArray<{ readonly player: Player; readonly card: import("./GameObjects").Card }>,
    selfPlayerId: Player | null,
    allPlayers: ReadonlyArray<Player>,
): UserDeductionMap => {
    if (selfPlayerId === null) return emptyUserDeductions;
    let m: UserDeductionMap = emptyUserDeductions;
    for (const kc of knownCards) {
        if (kc.player !== selfPlayerId) continue;
        // Y on the user's own column for this card.
        m = HashMap.set(m, Cell(PlayerOwner(selfPlayerId), kc.card), "Y");
        // N on every other player's column for the same card.
        for (const p of allPlayers) {
            if (p === selfPlayerId) continue;
            m = HashMap.set(m, Cell(PlayerOwner(p), kc.card), "N");
        }
        // N on the case file for the same card.
        m = HashMap.set(m, Cell(CaseFileOwner(), kc.card), "N");
    }
    return m;
};

/**
 * Combine `deductionResult` and a `UserDeductionMap` into a tally of
 * verdict counts. Used by the Check feature's vague summary banner
 * (does not need per-cell detail — just the buckets).
 */
export interface VerdictTally {
    readonly verifiable: number;
    readonly falsifiable: number;
    readonly plausible: number;
    readonly missed: number;
    readonly inconsistent: number;
    /** Whether the deducer itself is in a contradictory state (knownCards inconsistent). */
    readonly evidenceContradiction: boolean;
}

const owners = (setup: GameSetup): ReadonlyArray<Owner> => {
    const out: Owner[] = [CaseFileOwner()];
    for (const p of setup.players) out.push(PlayerOwner(p));
    return out;
};

export const tallyVerdicts = (
    setup: GameSetup,
    userDeductions: UserDeductionMap,
    deductionResult: DeductionResult,
    intrinsic: IntrinsicContradictionReport,
): VerdictTally => {
    if (Result.isFailure(deductionResult)) {
        // Can still surface user-mark intrinsic contradictions and any
        // user marks (as plausible, since the deducer is broken). The
        // banner will lead with the evidence contradiction.
        let inconsistent = 0;
        let plausible = 0;
        HashMap.forEach(userDeductions, (_value, cell) => {
            if (intrinsic.offendingCells.has(cellKey(cell))) inconsistent++;
            else plausible++;
        });
        return {
            verifiable: 0,
            falsifiable: 0,
            plausible,
            missed: 0,
            inconsistent,
            evidenceContradiction: true,
        };
    }
    const knowledge = deductionResult.success;
    const allCards = allCardIds(setup);
    let verifiable = 0;
    let falsifiable = 0;
    let plausible = 0;
    let missed = 0;
    let inconsistent = 0;
    for (const owner of owners(setup)) {
        for (const card of allCards) {
            const cell = Cell(owner, card);
            const userMark = HashMap.get(userDeductions, cell);
            const deducerVerdict = getCell(knowledge, cell);
            const userMarkValue = userMark._tag === "Some" ? userMark.value : undefined;
            if (intrinsic.offendingCells.has(cellKey(cell))) {
                inconsistent++;
                continue;
            }
            if (userMarkValue === undefined && deducerVerdict !== undefined) {
                missed++;
            } else if (userMarkValue === undefined) {
                // unknown — not counted in the tally
            } else if (deducerVerdict === undefined) {
                plausible++;
            } else if (userMarkValue === deducerVerdict) {
                verifiable++;
            } else {
                falsifiable++;
            }
        }
    }
    return {
        verifiable,
        falsifiable,
        plausible,
        missed,
        inconsistent,
        evidenceContradiction: false,
    };
};

/**
 * True when the tally reports something actionable (anything the user
 * should pay attention to during a Check). Verifiable cells alone are
 * "Looking good" — the vague banner uses this to pick its copy.
 */
export const tallyHasIssues = (tally: VerdictTally): boolean =>
    tally.evidenceContradiction
    || tally.falsifiable > 0
    || tally.missed > 0
    || tally.inconsistent > 0
    || tally.plausible > 0;
