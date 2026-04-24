import { describe, expect, test } from "vitest";
import { MutableHashMap } from "effect";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { CaseFileOwner, Player, PlayerOwner } from "./GameObjects";
import { Cell, N, Y } from "./Knowledge";
import {
    CardOwnership,
    CaseFileCategory,
    chainFor,
    describeReason,
    NonRefuters,
    PlayerHand,
    type Provenance,
    type Reason,
    RefuterOwnsOneOf,
    RefuterShowed,
} from "./Provenance";
import { cardByName } from "./test-utils/CardByName";
import { newSuggestionId, Suggestion } from "./Suggestion";

const setup = CLASSIC_SETUP_3P;
const KNIFE = cardByName(setup, "Knife");
const PLUM = cardByName(setup, "Prof. Plum");
const KITCHEN = cardByName(setup, "Kitchen");
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");
const suspectsCategory = setup.categories.find(c => c.name === "Suspect")!;

// -----------------------------------------------------------------------
// ReasonKind constructors
// -----------------------------------------------------------------------

describe("ReasonKind constructors", () => {
    test("CardOwnership tags itself and carries the card", () => {
        const r = CardOwnership({ card: KNIFE });
        expect(r._tag).toBe("CardOwnership");
        if (r._tag !== "CardOwnership") throw new Error("unreachable");
        expect(r.card).toBe(KNIFE);
    });

    test("PlayerHand tags itself and carries the player", () => {
        const r = PlayerHand({ player: A });
        expect(r._tag).toBe("PlayerHand");
        if (r._tag !== "PlayerHand") throw new Error("unreachable");
        expect(r.player).toBe(A);
    });

    test("CaseFileCategory tags itself and carries the category", () => {
        const r = CaseFileCategory({ category: suspectsCategory.id });
        expect(r._tag).toBe("CaseFileCategory");
        if (r._tag !== "CaseFileCategory") throw new Error("unreachable");
        expect(r.category).toBe(suspectsCategory.id);
    });

    test("NonRefuters tags itself and carries the suggestionIndex", () => {
        const r = NonRefuters({ suggestionIndex: 7 });
        expect(r._tag).toBe("NonRefuters");
        if (r._tag !== "NonRefuters") throw new Error("unreachable");
        expect(r.suggestionIndex).toBe(7);
    });

    test("RefuterShowed tags itself and carries the suggestionIndex", () => {
        const r = RefuterShowed({ suggestionIndex: 0 });
        expect(r._tag).toBe("RefuterShowed");
        if (r._tag !== "RefuterShowed") throw new Error("unreachable");
        expect(r.suggestionIndex).toBe(0);
    });

    test("RefuterOwnsOneOf tags itself and carries the suggestionIndex", () => {
        const r = RefuterOwnsOneOf({ suggestionIndex: 2 });
        expect(r._tag).toBe("RefuterOwnsOneOf");
        if (r._tag !== "RefuterOwnsOneOf") throw new Error("unreachable");
        expect(r.suggestionIndex).toBe(2);
    });
});

// -----------------------------------------------------------------------
// chainFor
// -----------------------------------------------------------------------

const makeProv = (): Provenance => MutableHashMap.empty<Cell, Reason>();

describe("chainFor", () => {
    test("returns an empty chain for a cell with no recorded reason", () => {
        const prov = makeProv();
        const cell = Cell(PlayerOwner(A), KNIFE);
        expect(chainFor(prov, cell)).toEqual([]);
    });

    test("returns the cell's own reason when it has no dependencies", () => {
        const prov = makeProv();
        const cell = Cell(PlayerOwner(A), KNIFE);
        MutableHashMap.set(prov, cell, {
            iteration: 0,
            kind: CardOwnership({ card: KNIFE }),
            value: Y,
            dependsOn: [],
        });
        const chain = chainFor(prov, cell);
        expect(chain).toHaveLength(1);
        expect(chain[0]?.cell).toBe(cell);
        expect(chain[0]?.reason.value).toBe(Y);
    });

    test("walks dependencies and returns them in root-first order", () => {
        const prov = makeProv();
        const root = Cell(PlayerOwner(A), KNIFE);
        const mid = Cell(PlayerOwner(B), KNIFE);
        const leaf = Cell(CaseFileOwner(), KNIFE);
        MutableHashMap.set(prov, root, {
            iteration: 0,
            kind: CardOwnership({ card: KNIFE }),
            value: Y,
            dependsOn: [],
        });
        MutableHashMap.set(prov, mid, {
            iteration: 1,
            kind: CardOwnership({ card: KNIFE }),
            value: N,
            dependsOn: [root],
        });
        MutableHashMap.set(prov, leaf, {
            iteration: 2,
            kind: CardOwnership({ card: KNIFE }),
            value: N,
            dependsOn: [mid],
        });
        const chain = chainFor(prov, leaf);
        expect(chain.map(e => e.cell)).toEqual([root, mid, leaf]);
    });

    test("dedupes when multiple branches converge on the same ancestor", () => {
        const prov = makeProv();
        const shared = Cell(PlayerOwner(A), KNIFE);
        const branch1 = Cell(PlayerOwner(B), KNIFE);
        const branch2 = Cell(PlayerOwner(C), KNIFE);
        const top = Cell(CaseFileOwner(), KNIFE);
        MutableHashMap.set(prov, shared, {
            iteration: 0,
            kind: CardOwnership({ card: KNIFE }),
            value: Y,
            dependsOn: [],
        });
        MutableHashMap.set(prov, branch1, {
            iteration: 1,
            kind: CardOwnership({ card: KNIFE }),
            value: N,
            dependsOn: [shared],
        });
        MutableHashMap.set(prov, branch2, {
            iteration: 1,
            kind: CardOwnership({ card: KNIFE }),
            value: N,
            dependsOn: [shared],
        });
        MutableHashMap.set(prov, top, {
            iteration: 2,
            kind: CardOwnership({ card: KNIFE }),
            value: Y,
            dependsOn: [branch1, branch2],
        });
        const chain = chainFor(prov, top);
        const cells = chain.map(e => e.cell);
        // `shared` appears exactly once.
        expect(cells.filter(c => c === shared)).toHaveLength(1);
        expect(cells).toHaveLength(4);
    });

    test("skips dependencies that have no provenance entry", () => {
        const prov = makeProv();
        const known = Cell(PlayerOwner(A), KNIFE);
        const ghost = Cell(PlayerOwner(B), KNIFE); // no entry
        MutableHashMap.set(prov, known, {
            iteration: 0,
            kind: CardOwnership({ card: KNIFE }),
            value: Y,
            dependsOn: [ghost],
        });
        const chain = chainFor(prov, known);
        expect(chain).toHaveLength(1);
        expect(chain[0]?.cell).toBe(known);
    });
});

// -----------------------------------------------------------------------
// describeReason
// -----------------------------------------------------------------------

const baseReason = (
    kind: Reason["kind"],
    value: Reason["value"] = Y,
): Reason => ({
    iteration: 1,
    kind,
    value,
    dependsOn: [],
});

describe("describeReason", () => {
    const cell = Cell(PlayerOwner(A), KNIFE);

    test("CardOwnership → `card-ownership` with resolved card name", () => {
        const desc = describeReason(
            baseReason(CardOwnership({ card: KNIFE })),
            cell,
            setup,
            [],
        );
        expect(desc.kind).toBe("card-ownership");
        if (desc.kind !== "card-ownership") throw new Error("unreachable");
        expect(desc.params.card).toBe("Knife");
        expect(desc.params.cellPlayer).toBe("Anisha");
        expect(desc.params.cellCard).toBe("Knife");
        expect(desc.params.value).toBe(Y);
    });

    test("PlayerHand → `player-hand` with player name", () => {
        const desc = describeReason(
            baseReason(PlayerHand({ player: B })),
            cell,
            setup,
            [],
        );
        expect(desc.kind).toBe("player-hand");
        if (desc.kind !== "player-hand") throw new Error("unreachable");
        expect(desc.params.player).toBe("Bob");
    });

    test("CaseFileCategory → `case-file-category` with category name", () => {
        const desc = describeReason(
            baseReason(CaseFileCategory({ category: suspectsCategory.id })),
            cell,
            setup,
            [],
        );
        expect(desc.kind).toBe("case-file-category");
        if (desc.kind !== "case-file-category") throw new Error("unreachable");
        expect(desc.params.category).toBe("Suspect");
    });

    test("NonRefuters → `non-refuters` with resolved suggester", () => {
        const s = Suggestion({
            id: newSuggestionId(),
            suggester: A,
            cards: [PLUM, KNIFE, KITCHEN],
            nonRefuters: [B, C],
        });
        const desc = describeReason(
            baseReason(NonRefuters({ suggestionIndex: 0 })),
            cell,
            setup,
            [s],
        );
        expect(desc.kind).toBe("non-refuters");
        if (desc.kind !== "non-refuters") throw new Error("unreachable");
        expect(desc.params.suggestionIndex).toBe(0);
        expect(desc.params.suggester).toBe("Anisha");
    });

    test("NonRefuters with a stale index returns suggester: undefined", () => {
        const desc = describeReason(
            baseReason(NonRefuters({ suggestionIndex: 99 })),
            cell,
            setup,
            [],
        );
        if (desc.kind !== "non-refuters") throw new Error("unreachable");
        expect(desc.params.suggester).toBeUndefined();
    });

    test("RefuterShowed → `refuter-showed` with refuter + seen card", () => {
        const s = Suggestion({
            id: newSuggestionId(),
            suggester: A,
            cards: [PLUM, KNIFE, KITCHEN],
            nonRefuters: [],
            refuter: B,
            seenCard: KNIFE,
        });
        const desc = describeReason(
            baseReason(RefuterShowed({ suggestionIndex: 0 })),
            cell,
            setup,
            [s],
        );
        if (desc.kind !== "refuter-showed") throw new Error("unreachable");
        expect(desc.params.refuter).toBe("Bob");
        expect(desc.params.seen).toBe("Knife");
    });

    test("RefuterShowed with a stale index returns refuter and seen: undefined", () => {
        const desc = describeReason(
            baseReason(RefuterShowed({ suggestionIndex: 0 })),
            cell,
            setup,
            [],
        );
        if (desc.kind !== "refuter-showed") throw new Error("unreachable");
        expect(desc.params.refuter).toBeUndefined();
        expect(desc.params.seen).toBeUndefined();
    });

    test("RefuterShowed without a seenCard on the suggestion returns seen: undefined", () => {
        const s = Suggestion({
            id: newSuggestionId(),
            suggester: A,
            cards: [PLUM, KNIFE, KITCHEN],
            nonRefuters: [],
            refuter: B,
            // no seenCard
        });
        const desc = describeReason(
            baseReason(RefuterShowed({ suggestionIndex: 0 })),
            cell,
            setup,
            [s],
        );
        if (desc.kind !== "refuter-showed") throw new Error("unreachable");
        expect(desc.params.refuter).toBe("Bob");
        expect(desc.params.seen).toBeUndefined();
    });

    test("RefuterOwnsOneOf → `refuter-owns-one-of` with suggester, refuter, cardLabels", () => {
        const s = Suggestion({
            id: newSuggestionId(),
            suggester: A,
            cards: [PLUM, KNIFE, KITCHEN],
            nonRefuters: [],
            refuter: B,
        });
        const desc = describeReason(
            baseReason(RefuterOwnsOneOf({ suggestionIndex: 0 })),
            cell,
            setup,
            [s],
        );
        if (desc.kind !== "refuter-owns-one-of") throw new Error("unreachable");
        expect(desc.params.suggester).toBe("Anisha");
        expect(desc.params.refuter).toBe("Bob");
        // HashSet iteration order is implementation-defined, but every
        // card name must be present in the joined string.
        expect(desc.params.cardLabels).toMatch(/Prof\. Plum/);
        expect(desc.params.cardLabels).toMatch(/Knife/);
        expect(desc.params.cardLabels).toMatch(/Kitchen/);
    });

    test("RefuterOwnsOneOf with a stale index returns undefined params (no suggestion)", () => {
        const desc = describeReason(
            baseReason(RefuterOwnsOneOf({ suggestionIndex: 0 })),
            cell,
            setup,
            [],
        );
        if (desc.kind !== "refuter-owns-one-of") throw new Error("unreachable");
        expect(desc.params.suggester).toBeUndefined();
        expect(desc.params.refuter).toBeUndefined();
        expect(desc.params.cardLabels).toBeUndefined();
    });

    test("base cell params (cellPlayer / cellCard / value) come from the cell, not the reason", () => {
        // CaseFile cell with an N value; reason carries its own value which
        // should also mirror into params.value.
        const caseCell = Cell(CaseFileOwner(), PLUM);
        const desc = describeReason(
            baseReason(CardOwnership({ card: PLUM }), N),
            caseCell,
            setup,
            [],
        );
        expect(desc.params.cellPlayer).toBe("Case file");
        expect(desc.params.cellCard).toBe("Prof. Plum");
        expect(desc.params.value).toBe(N);
    });
});
