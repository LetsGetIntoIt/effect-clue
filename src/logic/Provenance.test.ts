import { describe, expect, test } from "vitest";
import { HashMap, MutableHashMap, Result } from "effect";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { CaseFileOwner, Player, PlayerOwner } from "./GameObjects";
import { Cell, emptyKnowledge, N, setCell, setHandSize, Y } from "./Knowledge";
import { KnownCard } from "./InitialKnowledge";
import {
    CardOwnership,
    CaseFileCategory,
    chainFor,
    describeReason,
    DisjointGroupsHandLock,
    FailedAccusation,
    FailedAccusationPairwiseNarrowing,
    InitialKnownCard,
    NonRefuters,
    PlayerHand,
    type Provenance,
    type Reason,
    RefuterOwnsOneOf,
    RefuterShowed,
} from "./Provenance";
import { cardByName } from "./test-utils/CardByName";
import { Accusation, newAccusationId } from "./Accusation";
import { newSuggestionId, Suggestion } from "./Suggestion";
import { runDeduceWithExplanations } from "./test-utils/RunDeduce";

const setup = CLASSIC_SETUP_3P;
const KNIFE = cardByName(setup, "Knife");
const PLUM = cardByName(setup, "Prof. Plum");
const KITCHEN = cardByName(setup, "Kitchen");
const CONSERV = cardByName(setup, "Conservatory");
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

    test("DisjointGroupsHandLock tags itself and carries player + indices", () => {
        const r = DisjointGroupsHandLock({
            player: B,
            suggestionIndices: [0, 3, 5],
        });
        expect(r._tag).toBe("DisjointGroupsHandLock");
        if (r._tag !== "DisjointGroupsHandLock") throw new Error("unreachable");
        expect(r.player).toBe(B);
        expect(r.suggestionIndices).toEqual([0, 3, 5]);
    });

    test("FailedAccusation tags itself and carries the accusationIndex", () => {
        const r = FailedAccusation({ accusationIndex: 4 });
        expect(r._tag).toBe("FailedAccusation");
        if (r._tag !== "FailedAccusation") throw new Error("unreachable");
        expect(r.accusationIndex).toBe(4);
    });

    test("FailedAccusationPairwiseNarrowing tags itself and carries pinnedCard + indices", () => {
        const r = FailedAccusationPairwiseNarrowing({
            pinnedCard: PLUM,
            accusationIndices: [0, 2, 5],
        });
        expect(r._tag).toBe("FailedAccusationPairwiseNarrowing");
        if (r._tag !== "FailedAccusationPairwiseNarrowing") {
            throw new Error("unreachable");
        }
        expect(r.pinnedCard).toBe(PLUM);
        expect(r.accusationIndices).toEqual([0, 2, 5]);
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

    test("InitialKnownCard with cell in knownCards → source: observation", () => {
        const desc = describeReason(
            baseReason(InitialKnownCard()),
            cell,
            setup,
            [],
            [],
            [KnownCard({ player: A, card: KNIFE })],
            HashMap.empty(),
        );
        expect(desc.kind).toBe("initial-known-card");
        if (desc.kind !== "initial-known-card") throw new Error("unreachable");
        expect(desc.params.source).toBe("observation");
    });

    test("InitialKnownCard with cell in hypotheses → source: hypothesis", () => {
        const desc = describeReason(
            baseReason(InitialKnownCard(), N),
            cell,
            setup,
            [],
            [],
            [],
            HashMap.fromIterable([[cell, N] as const]),
        );
        if (desc.kind !== "initial-known-card") throw new Error("unreachable");
        expect(desc.params.source).toBe("hypothesis");
    });

    test("InitialKnownCard in both → hypothesis wins (foldHypothesesInto overwrites)", () => {
        const desc = describeReason(
            baseReason(InitialKnownCard()),
            cell,
            setup,
            [],
            [],
            [KnownCard({ player: A, card: KNIFE })],
            HashMap.fromIterable([[cell, Y] as const]),
        );
        if (desc.kind !== "initial-known-card") throw new Error("unreachable");
        expect(desc.params.source).toBe("hypothesis");
    });

    test("InitialKnownCard with no matching sources → defaults to observation", () => {
        const desc = describeReason(
            baseReason(InitialKnownCard()),
            cell,
            setup,
            [],
            [],
            [],
            HashMap.empty(),
        );
        if (desc.kind !== "initial-known-card") throw new Error("unreachable");
        expect(desc.params.source).toBe("observation");
    });

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

// -----------------------------------------------------------------------
// suggester-owned cascade chain (regression for Item 1 of the optimization
// plan): asserts that when refuterOwnsOneOf forces a cell because the
// suggester owns one of the suggested cards, the provenance chain walks
// back through the card-ownership cascade so the UI tooltip can explain
// the full derivation.
// -----------------------------------------------------------------------

describe("suggester-owned cascade provenance", () => {
    test("chainFor walks RefuterOwnsOneOf → CardOwnership → initial input", () => {
        let knowledge = emptyKnowledge;
        knowledge = setCell(knowledge, Cell(PlayerOwner(A), PLUM),  Y);
        knowledge = setCell(knowledge, Cell(PlayerOwner(B), KNIFE), N);

        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
        })];

        const result = runDeduceWithExplanations(setup, suggestions, knowledge);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        const { provenance } = result.success;
        const conservCell = Cell(PlayerOwner(B), CONSERV);
        const chain = chainFor(provenance, conservCell);
        const tags = chain.map(e => e.reason.kind._tag);

        // The terminal entry is the cell we asked about — forced by
        // refuterOwnsOneOf.
        expect(chain.at(-1)?.cell).toEqual(conservCell);
        expect(tags.at(-1)).toBe("RefuterOwnsOneOf");
        // Somewhere upstream the chain must include the card-ownership
        // cascade that turned A/Plum=Y into B/Plum=N.
        expect(tags).toContain("CardOwnership");
    });
});

// -----------------------------------------------------------------------
// disjointGroupsHandLock provenance — the rule fires the new
// DisjointGroupsHandLock ReasonKind on every out-of-union N it forces.
// describeReason should resolve the right kind / params.
// -----------------------------------------------------------------------

describe("disjoint-groups-hand-lock provenance", () => {
    test("chainFor reports DisjointGroupsHandLock for forced out-of-union Ns", () => {
        const SCARLET = cardByName(setup, "Miss Scarlet");
        const ROPE    = cardByName(setup, "Rope");
        const LIBRARY = cardByName(setup, "Library");
        const GREEN   = cardByName(setup, "Mr. Green");

        let knowledge = emptyKnowledge;
        knowledge = setHandSize(knowledge, PlayerOwner(B), 2);
        const suggestions = [
            Suggestion({ suggester: A, cards: [PLUM, KNIFE, CONSERV],
                nonRefuters: [], refuter: B }),
            Suggestion({ suggester: A, cards: [SCARLET, ROPE, LIBRARY],
                nonRefuters: [], refuter: B }),
        ];

        const result = runDeduceWithExplanations(setup, suggestions, knowledge);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        const { provenance } = result.success;
        const greenCell = Cell(PlayerOwner(B), GREEN);
        const chain = chainFor(provenance, greenCell);
        const last = chain.at(-1);
        expect(last?.cell).toEqual(greenCell);
        expect(last?.reason.kind._tag).toBe("DisjointGroupsHandLock");
        if (last?.reason.kind._tag !== "DisjointGroupsHandLock") return;
        expect(last.reason.kind.player).toBe(B);
        expect(last.reason.kind.suggestionIndices).toEqual([0, 1]);
    });

    test("describeReason → disjoint-groups-hand-lock with formatted numbers", () => {
        const cell = Cell(PlayerOwner(B), KNIFE);
        const reason: Reason = {
            iteration: 1,
            kind: DisjointGroupsHandLock({
                player: B,
                suggestionIndices: [2, 4, 6],
            }),
            value: N,
            dependsOn: [],
        };
        const desc = describeReason(reason, cell, setup, []);
        expect(desc.kind).toBe("disjoint-groups-hand-lock");
        if (desc.kind !== "disjoint-groups-hand-lock") return;
        expect(desc.params.player).toBe("Bob");
        expect(desc.params.groupCount).toBe(3);
        expect(desc.params.suggestionIndices).toEqual([2, 4, 6]);
        expect(desc.params.suggestionNumbers).toBe("#3, #5, #7");
        expect(desc.params.cellPlayer).toBe("Bob");
        expect(desc.params.cellCard).toBe("Knife");
        expect(desc.params.value).toBe(N);
    });
});

describe("failed-accusation provenance", () => {
    test("describeReason → failed-accusation with accuser and cardLabels resolved", () => {
        const accusations = [
            Accusation({
                id: newAccusationId(),
                accuser: A,
                cards: [PLUM, KNIFE, CONSERV],
            }),
        ];
        const cell = Cell(CaseFileOwner(), CONSERV);
        const reason: Reason = {
            iteration: 1,
            kind: FailedAccusation({ accusationIndex: 0 }),
            value: N,
            dependsOn: [],
        };
        const desc = describeReason(reason, cell, setup, [], accusations);
        expect(desc.kind).toBe("failed-accusation");
        if (desc.kind !== "failed-accusation") return;
        expect(desc.params.accusationIndex).toBe(0);
        expect(desc.params.accuser).toBe("Anisha");
        // Card labels are joined with ", " and resolved by name.
        expect(desc.params.cardLabels).toContain("Prof. Plum");
        expect(desc.params.cardLabels).toContain("Knife");
        expect(desc.params.cardLabels).toContain("Conservatory");
    });

    test("describeReason → failed-accusation falls back gracefully when the index is stale", () => {
        const cell = Cell(CaseFileOwner(), CONSERV);
        const reason: Reason = {
            iteration: 1,
            kind: FailedAccusation({ accusationIndex: 99 }),
            value: N,
            dependsOn: [],
        };
        // Empty accusations array — index 99 is out of range.
        const desc = describeReason(reason, cell, setup, []);
        expect(desc.kind).toBe("failed-accusation");
        if (desc.kind !== "failed-accusation") return;
        expect(desc.params.accuser).toBeUndefined();
        expect(desc.params.cardLabels).toBeUndefined();
    });

    test("chainFor walks back to a FailedAccusation reason on a forced N", () => {
        let knowledge = emptyKnowledge;
        knowledge = setCell(knowledge, Cell(CaseFileOwner(), PLUM), Y);
        knowledge = setCell(knowledge, Cell(CaseFileOwner(), KNIFE), Y);
        const accusations = [
            Accusation({ accuser: A, cards: [PLUM, KNIFE, CONSERV] }),
        ];
        const result = runDeduceWithExplanations(
            setup,
            [],
            knowledge,
            accusations,
        );
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;
        const conservCell = Cell(CaseFileOwner(), CONSERV);
        const chain = chainFor(result.success.provenance, conservCell);
        const tags = chain.map(c => c.reason.kind._tag);
        expect(tags).toContain("FailedAccusation");
        // Last chain entry is the conservatory cell itself, set by
        // FailedAccusation.
        const last = chain[chain.length - 1];
        expect(last?.cell).toEqual(conservCell);
        expect(last?.reason.kind._tag).toBe("FailedAccusation");
        if (last?.reason.kind._tag !== "FailedAccusation") return;
        expect(last.reason.kind.accusationIndex).toBe(0);
    });
});

describe("failed-accusation-pairwise (Tier 2) provenance", () => {
    test("describeReason → failed-accusation-pairwise with pinned card + numbers", () => {
        const cell = Cell(CaseFileOwner(), KNIFE);
        const reason: Reason = {
            iteration: 1,
            kind: FailedAccusationPairwiseNarrowing({
                pinnedCard: PLUM,
                accusationIndices: [0, 2, 4],
            }),
            value: N,
            dependsOn: [],
        };
        const desc = describeReason(reason, cell, setup, [], []);
        expect(desc.kind).toBe("failed-accusation-pairwise");
        if (desc.kind !== "failed-accusation-pairwise") return;
        expect(desc.params.pinnedCardLabel).toBe("Prof. Plum");
        expect(desc.params.accusationIndices).toEqual([0, 2, 4]);
        expect(desc.params.accusationNumbers).toBe("#1, #3, #5");
        expect(desc.params.value).toBe(N);
        expect(desc.params.cellCard).toBe("Knife");
        expect(desc.params.cellPlayer).toBe("Case file");
    });

    test("chainFor walks back to a FailedAccusationPairwiseNarrowing reason", () => {
        // Pin PLUM=Y, file (PLUM, KNIFE, R) for every room — Tier 2
        // forces case_KNIFE=N and the provenance entry should reference
        // the new ReasonKind.
        let knowledge = emptyKnowledge;
        knowledge = setCell(knowledge, Cell(CaseFileOwner(), PLUM), Y);
        const roomsCategory = setup.categories.find(c => c.name === "Room")!;
        const accusations = roomsCategory.cards.map(r =>
            Accusation({ accuser: A, cards: [PLUM, KNIFE, r.id] }),
        );
        const result = runDeduceWithExplanations(
            setup,
            [],
            knowledge,
            accusations,
        );
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;
        const knifeCell = Cell(CaseFileOwner(), KNIFE);
        const chain = chainFor(result.success.provenance, knifeCell);
        const last = chain[chain.length - 1];
        expect(last?.cell).toEqual(knifeCell);
        expect(last?.reason.kind._tag).toBe("FailedAccusationPairwiseNarrowing");
        if (last?.reason.kind._tag !== "FailedAccusationPairwiseNarrowing") {
            return;
        }
        expect(last.reason.kind.pinnedCard).toBe(PLUM);
        expect(last.reason.kind.accusationIndices.length).toBe(
            accusations.length,
        );
        // dependsOn includes the pinned PLUM cell + every case-file
        // room cell so the tooltip can walk back to "we knew PLUM was
        // in the case file" and "rooms X, Y, Z were the candidates".
        expect(last.reason.dependsOn.length).toBeGreaterThan(1);
        expect(
            last.reason.dependsOn.some(c =>
                c.owner._tag === "CaseFile" && c.card === PLUM,
            ),
        ).toBe(true);
    });
});
