import { describe, expect, test, vi } from "vitest";
import { HashMap, MutableHashMap } from "effect";

import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { CaseFileOwner, Player, PlayerOwner } from "../../logic/GameObjects";
import { Cell, N } from "../../logic/Knowledge";
import { KnownCard } from "../../logic/InitialKnowledge";
import {
    CardOwnership,
    InitialKnownCard,
    NonRefuters,
    PlayerHand,
    type Provenance,
    type Reason,
    RefuterOwnsOneOf,
    RefuterShowed,
} from "../../logic/Provenance";
import { cardByName } from "../../logic/test-utils/CardByName";
import { newSuggestionId, Suggestion } from "../../logic/Suggestion";

import { buildCellWhy } from "./cellWhy";

// -----------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------

const setup = CLASSIC_SETUP_3P;
const KNIFE = cardByName(setup, "Knife");
const PLUM = cardByName(setup, "Prof. Plum");
const MUSTARD = cardByName(setup, "Col. Mustard");
const CONSERV = cardByName(setup, "Conservatory");

const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

const ownerA = PlayerOwner(A);
const ownerB = PlayerOwner(B);
const ownerC = PlayerOwner(C);
const ownerCF = CaseFileOwner();

const cellA_KNIFE = Cell(ownerA, KNIFE);
const cellA_PLUM = Cell(ownerA, PLUM);
const cellB_KNIFE = Cell(ownerB, KNIFE);
const cellB_MUSTARD = Cell(ownerB, MUSTARD);
const cellB_CONSERV = Cell(ownerB, CONSERV);
const cellC_KNIFE = Cell(ownerC, KNIFE);
const cellCF_KNIFE = Cell(ownerCF, KNIFE);

// Translation mocks. Plain `t(key)` returns the bare key; `t(key,
// values)` returns `key:{json}` so tests can assert both the key and
// the interpolated values. Mirrors the mock pattern used in
// CellExplanationRow.test.tsx / Checklist.deduce.test.tsx.
const t = (key: string, values?: Record<string, unknown>): string =>
    values ? `${key}:${JSON.stringify(values)}` : key;
const tDeduce = t as unknown as Parameters<typeof buildCellWhy>[0]["tDeduce"];
const tReasons = t as unknown as Parameters<typeof buildCellWhy>[0]["tReasons"];

const setProv = (
    prov: Provenance,
    cell: Cell,
    reason: Reason,
): Provenance => {
    MutableHashMap.set(prov, cell, reason);
    return prov;
};

const initialReason = (value: "Y" | "N"): Reason => ({
    iteration: 0,
    kind: InitialKnownCard(),
    value,
    dependsOn: [],
});

const cardOwnershipReason = (
    card: typeof KNIFE,
    value: "Y" | "N",
    dependsOn: ReadonlyArray<Cell>,
): Reason => ({
    iteration: 1,
    kind: CardOwnership({ card }),
    value,
    dependsOn,
});

const refuterOwnsOneOfReason = (
    suggestionIndex: number,
    dependsOn: ReadonlyArray<Cell>,
): Reason => ({
    iteration: 1,
    kind: RefuterOwnsOneOf({ suggestionIndex }),
    value: "Y",
    dependsOn,
});

const refuterShowedReason = (suggestionIndex: number): Reason => ({
    iteration: 1,
    kind: RefuterShowed({ suggestionIndex }),
    value: "Y",
    dependsOn: [],
});

const nonRefutersReason = (suggestionIndex: number): Reason => ({
    iteration: 1,
    kind: NonRefuters({ suggestionIndex }),
    value: "N",
    dependsOn: [],
});

const playerHandReason = (
    player: typeof A,
    value: "Y" | "N",
    dependsOn: ReadonlyArray<Cell>,
): Reason => ({
    iteration: 1,
    kind: PlayerHand({ player }),
    value,
    dependsOn,
});

const callBuildCellWhy = (params: {
    provenance: Provenance | undefined;
    suggestions?: ReadonlyArray<Suggestion>;
    knownCards?: ReadonlyArray<KnownCard>;
    hypotheses?: Parameters<typeof buildCellWhy>[0]["hypotheses"];
    owner: Parameters<typeof buildCellWhy>[0]["owner"];
    card: typeof KNIFE;
}) =>
    buildCellWhy({
        provenance: params.provenance,
        suggestions: params.suggestions ?? [],
        accusations: [],
        setup,
        owner: params.owner,
        card: params.card,
        knownCards: params.knownCards ?? [],
        hypotheses: params.hypotheses ?? HashMap.empty(),
        tDeduce,
        tReasons,
    });

// Helpful parser for assertions: `{key}:{json}` strings produced by the
// mock translation function come back here as a parsed `[key, values]`.
const parseTKey = (
    s: string,
): { key: string; values: Record<string, unknown> | undefined } => {
    const colon = s.indexOf(":");
    if (colon < 0) return { key: s, values: undefined };
    return {
        key: s.slice(0, colon),
        values: JSON.parse(s.slice(colon + 1)) as Record<string, unknown>,
    };
};

// -----------------------------------------------------------------------
// Degenerate / empty cases
// -----------------------------------------------------------------------

describe("buildCellWhy - empty / degenerate chains", () => {
    test("missing provenance returns empty triple", () => {
        const why = callBuildCellWhy({
            provenance: undefined,
            owner: ownerA,
            card: KNIFE,
        });
        expect(why).toEqual({
            headline: undefined,
            givens: [],
            reasoning: [],
        });
    });

    test("no entry for the target cell returns empty triple", () => {
        const prov: Provenance = MutableHashMap.empty();
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerA,
            card: KNIFE,
        });
        expect(why).toEqual({
            headline: undefined,
            givens: [],
            reasoning: [],
        });
    });
});

// -----------------------------------------------------------------------
// R1 — Headline (conclusion-first)
// -----------------------------------------------------------------------

describe("buildCellWhy - R1 headline", () => {
    test("player cell Y uses headlinePlayer with value=Y", () => {
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellA_KNIFE, initialReason("Y"));
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerA,
            card: KNIFE,
            knownCards: [KnownCard({ player: A, card: KNIFE })],
        });
        const parsed = parseTKey(why.headline ?? "");
        expect(parsed.key).toBe("headlinePlayer");
        expect(parsed.values).toEqual({
            cellPlayer: "Anisha",
            cellCard: "Knife",
            value: "Y",
        });
    });

    test("player cell N uses headlinePlayer with value=N", () => {
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellA_KNIFE, initialReason("Y"));
        setProv(
            prov,
            cellB_KNIFE,
            cardOwnershipReason(KNIFE, "N", [cellA_KNIFE]),
        );
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerB,
            card: KNIFE,
        });
        const parsed = parseTKey(why.headline ?? "");
        expect(parsed.key).toBe("headlinePlayer");
        expect(parsed.values).toMatchObject({
            cellPlayer: "Bob",
            cellCard: "Knife",
            value: "N",
        });
    });

    test("case-file cell uses headlineCaseFile (with definite article)", () => {
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellCF_KNIFE, initialReason("Y"));
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerCF,
            card: KNIFE,
        });
        const parsed = parseTKey(why.headline ?? "");
        expect(parsed.key).toBe("headlineCaseFile");
        expect(parsed.values).toMatchObject({
            cellCard: "Knife",
            value: "Y",
        });
    });
});

// -----------------------------------------------------------------------
// R2 — Given bullets
// -----------------------------------------------------------------------

describe("buildCellWhy - R2 given bullets", () => {
    test("single initial observation Y → one observation bullet", () => {
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellA_KNIFE, initialReason("Y"));
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerA,
            card: KNIFE,
            knownCards: [KnownCard({ player: A, card: KNIFE })],
        });
        expect(why.givens).toHaveLength(1);
        const parsed = parseTKey(why.givens[0]!);
        expect(parsed.key).toBe("givenBulletObservation");
        expect(parsed.values).toMatchObject({
            count: 1,
            cellPlayer: "Anisha",
            value: "Y",
            cardList: "Knife",
        });
    });

    test("two consecutive same-(owner, source, Y) initials merge into one bullet with a card list", () => {
        // Build a chain where both A.KNIFE and A.PLUM are initial
        // observations Y, feeding a CardOwnership intermediate that
        // marks B.KNIFE = N. The two A-side initials sit in the
        // chain's initial segment and share (owner=A, source=obs,
        // value=Y), so groupChainEntries merges them.
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellA_KNIFE, initialReason("Y"));
        setProv(prov, cellA_PLUM, initialReason("Y"));
        // Synthetic player-hand rule: B.KNIFE is N because A holds
        // both KNIFE and PLUM (toy example — the dependsOn shape is
        // what matters, not whether the rule fires in the real
        // deducer).
        setProv(
            prov,
            cellB_KNIFE,
            playerHandReason(A, "N", [cellA_KNIFE, cellA_PLUM]),
        );
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerB,
            card: KNIFE,
            knownCards: [
                KnownCard({ player: A, card: KNIFE }),
                KnownCard({ player: A, card: PLUM }),
            ],
        });
        expect(why.givens).toHaveLength(1);
        const parsed = parseTKey(why.givens[0]!);
        expect(parsed.key).toBe("givenBulletObservation");
        // Two cards merge into one bullet with the list formatter
        // producing "Knife and Prof. Plum" (English conjunction).
        expect(parsed.values).toMatchObject({
            count: 2,
            cellPlayer: "Anisha",
            value: "Y",
        });
        expect(String(parsed.values?.["cardList"])).toContain("Knife");
        expect(String(parsed.values?.["cardList"])).toContain("Prof. Plum");
    });

    test("hypothesis initial uses headlineHypothesis bullet template", () => {
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellA_KNIFE, initialReason("N"));
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerA,
            card: KNIFE,
            hypotheses: HashMap.fromIterable([[cellA_KNIFE, N] as const]),
        });
        expect(why.givens).toHaveLength(1);
        const parsed = parseTKey(why.givens[0]!);
        expect(parsed.key).toBe("givenBulletHypothesis");
        expect(parsed.values).toMatchObject({ value: "N" });
    });

    test("observation + hypothesis with different (owner, source) produce two bullets", () => {
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellA_KNIFE, initialReason("Y")); // obs Y
        setProv(prov, cellB_CONSERV, initialReason("N")); // hyp N
        // A consolidator final-rule placeholder so non-initial chain
        // walking includes the inputs. RefuterOwnsOneOf on a stale
        // suggestion index will fall back, but that's fine — we just
        // need the initials to appear in chainFor's output.
        setProv(
            prov,
            cellB_MUSTARD,
            refuterOwnsOneOfReason(0, [cellB_KNIFE, cellB_CONSERV]),
        );
        // Stub the missing cellB_KNIFE entry as another initial so
        // chainFor doesn't bottom out before reaching the conservatory.
        setProv(prov, cellB_KNIFE, initialReason("N"));
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerB,
            card: MUSTARD,
            knownCards: [KnownCard({ player: A, card: KNIFE })],
            hypotheses: HashMap.fromIterable([[cellB_CONSERV, N] as const]),
        });
        // Three initial bullets (A.KNIFE obs, B.KNIFE obs, B.CONSERV hyp).
        // B.KNIFE is also an observation (no entry in `hypotheses`),
        // so it groups with A.KNIFE only if owner matches — which it
        // doesn't, so we get separate bullets per owner.
        expect(why.givens.length).toBeGreaterThanOrEqual(2);
        const keys = why.givens.map(b => parseTKey(b).key);
        expect(keys).toContain("givenBulletObservation");
        expect(keys).toContain("givenBulletHypothesis");
    });
});

// -----------------------------------------------------------------------
// R3 — Reasoning sentences (consolidation + fallback)
// -----------------------------------------------------------------------

describe("buildCellWhy - R3 reasoning consolidation", () => {
    test("RefuterOwnsOneOf with two initial-known-card predicates → one rich sentence", () => {
        // Shape: B has KNIFE = N (observed N for B), B has CONSERV =
        // N (observed N for B), so B refuted A's suggestion (KNIFE,
        // MUSTARD, CONSERV) must mean B has MUSTARD.
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellB_KNIFE, initialReason("N"));
        setProv(prov, cellB_CONSERV, initialReason("N"));
        setProv(
            prov,
            cellB_MUSTARD,
            refuterOwnsOneOfReason(0, [cellB_KNIFE, cellB_CONSERV]),
        );
        const suggestion = Suggestion({
            id: newSuggestionId(),
            suggester: A,
            cards: [KNIFE, MUSTARD, CONSERV],
            nonRefuters: [],
            refuter: B,
        });
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerB,
            card: MUSTARD,
            suggestions: [suggestion],
        });
        // Exactly one reasoning sentence, the rich template.
        expect(why.reasoning).toHaveLength(1);
        const parsed = parseTKey(why.reasoning[0]!);
        expect(parsed.key).toBe("refuter-owns-one-of.detailRich");
        expect(parsed.values).toMatchObject({
            refuter: "Bob",
            suggester: "Anisha",
            number: 1,
            cellCard: "Col. Mustard",
        });
        // Evidence clauses for both predicates were resolved.
        expect(parsed.values?.["evidence1"]).toBeDefined();
        expect(parsed.values?.["evidence2"]).toBeDefined();
        // Both clauses are initial-known-card observation evidences
        // since the predicates were initials (not intermediates).
        expect(String(parsed.values?.["evidence1"])).toContain(
            "initial-known-card.evidenceClauseObservation",
        );
        expect(String(parsed.values?.["evidence2"])).toContain(
            "initial-known-card.evidenceClauseObservation",
        );
    });

    test("RefuterOwnsOneOf with a CardOwnership-N intermediate predicate (the screenshot case) → rich sentence; intermediate is dropped", () => {
        // The screenshot: A holds KNIFE (initial Y). B refuted A's
        // suggestion (KNIFE, MUSTARD, CONSERV); B doesn't have
        // CONSERV (hypothesis N); CardOwnership rules out B.KNIFE
        // (because A has it); so B must have MUSTARD.
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellA_KNIFE, initialReason("Y"));
        setProv(prov, cellB_CONSERV, initialReason("N"));
        setProv(
            prov,
            cellB_KNIFE,
            cardOwnershipReason(KNIFE, "N", [cellA_KNIFE]),
        );
        setProv(
            prov,
            cellB_MUSTARD,
            refuterOwnsOneOfReason(0, [cellB_KNIFE, cellB_CONSERV]),
        );
        const suggestion = Suggestion({
            id: newSuggestionId(),
            suggester: A,
            cards: [KNIFE, MUSTARD, CONSERV],
            nonRefuters: [],
            refuter: B,
        });
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerB,
            card: MUSTARD,
            suggestions: [suggestion],
            knownCards: [KnownCard({ player: A, card: KNIFE })],
            hypotheses: HashMap.fromIterable([[cellB_CONSERV, N] as const]),
        });
        // Exactly one reasoning sentence: the rich consolidated form.
        // The intermediate CardOwnership step is dropped (R3 drop).
        expect(why.reasoning).toHaveLength(1);
        const parsed = parseTKey(why.reasoning[0]!);
        expect(parsed.key).toBe("refuter-owns-one-of.detailRich");
        // The two evidence clauses come from different sources: one
        // from the CardOwnership intermediate (clause names A as the
        // other owner of Knife), one from the hypothesis initial.
        const allEvidence = [
            String(parsed.values?.["evidence1"]),
            String(parsed.values?.["evidence2"]),
        ].join("\n");
        expect(allEvidence).toContain("card-ownership.evidenceClause");
        expect(allEvidence).toContain(
            "initial-known-card.evidenceClauseHypothesis",
        );
        // Initials are reflected in the givens bullets.
        const givenKeys = why.givens.map(b => parseTKey(b).key);
        expect(givenKeys).toContain("givenBulletObservation");
        expect(givenKeys).toContain("givenBulletHypothesis");
    });

    test("RefuterOwnsOneOf with stale suggestion (suggester/refuter missing) → falls back to verbose detailUnknown", () => {
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellB_KNIFE, initialReason("N"));
        setProv(prov, cellB_CONSERV, initialReason("N"));
        setProv(
            prov,
            cellB_MUSTARD,
            refuterOwnsOneOfReason(0, [cellB_KNIFE, cellB_CONSERV]),
        );
        // No suggestion at index 0 — stale provenance.
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerB,
            card: MUSTARD,
            suggestions: [],
        });
        expect(why.reasoning).toHaveLength(1);
        const parsed = parseTKey(why.reasoning[0]!);
        expect(parsed.key).toBe("refuter-owns-one-of.detailUnknown");
    });

    test("RefuterOwnsOneOf with an unsupported predicate kind (PlayerHand-N) → falls back to verbose multi-sentence", () => {
        // Intermediate is a PlayerHand-N entry, which evidenceClauseFor
        // doesn't handle. R3 returns undefined and the verbose
        // fallback emits one sentence per non-initial entry.
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellA_KNIFE, initialReason("Y"));
        setProv(prov, cellA_PLUM, initialReason("Y"));
        setProv(
            prov,
            cellB_KNIFE,
            playerHandReason(A, "N", [cellA_KNIFE, cellA_PLUM]),
        );
        setProv(prov, cellB_CONSERV, initialReason("N"));
        setProv(
            prov,
            cellB_MUSTARD,
            refuterOwnsOneOfReason(0, [cellB_KNIFE, cellB_CONSERV]),
        );
        const suggestion = Suggestion({
            id: newSuggestionId(),
            suggester: A,
            cards: [KNIFE, MUSTARD, CONSERV],
            nonRefuters: [],
            refuter: B,
        });
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerB,
            card: MUSTARD,
            suggestions: [suggestion],
        });
        // Verbose fallback: more than one reasoning sentence
        // (PlayerHand + RefuterOwnsOneOf).
        expect(why.reasoning.length).toBeGreaterThan(1);
        const keys = why.reasoning.map(s => parseTKey(s).key);
        expect(keys).toContain("refuter-owns-one-of.detailKnown");
        expect(keys.some(k => k.startsWith("player-hand"))).toBe(true);
    });
});

// -----------------------------------------------------------------------
// Non-RefuterOwnsOneOf final entries (R3 doesn't fire; verbose path)
// -----------------------------------------------------------------------

describe("buildCellWhy - other rule families in the verbose path", () => {
    test("CardOwnership as the final entry → headline + given + one verbose sentence", () => {
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellA_KNIFE, initialReason("Y"));
        setProv(
            prov,
            cellB_KNIFE,
            cardOwnershipReason(KNIFE, "N", [cellA_KNIFE]),
        );
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerB,
            card: KNIFE,
        });
        expect(parseTKey(why.headline ?? "").key).toBe("headlinePlayer");
        expect(why.givens).toHaveLength(1);
        expect(why.reasoning).toHaveLength(1);
        expect(parseTKey(why.reasoning[0]!).key).toBe("card-ownership.detail");
    });

    test("RefuterShowed as final entry → no initials in chain; reasoning has the verbose detailKnown", () => {
        // RefuterShowed's dependsOn is empty — the chain is just the
        // target cell itself.
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellB_KNIFE, refuterShowedReason(0));
        const suggestion = Suggestion({
            id: newSuggestionId(),
            suggester: A,
            cards: [KNIFE, MUSTARD, CONSERV],
            nonRefuters: [],
            refuter: B,
            seenCard: KNIFE,
        });
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerB,
            card: KNIFE,
            suggestions: [suggestion],
        });
        expect(why.givens).toHaveLength(0);
        expect(why.reasoning).toHaveLength(1);
        expect(parseTKey(why.reasoning[0]!).key).toBe(
            "refuter-showed.detailKnown",
        );
    });

    test("NonRefuters as final entry → no initials; verbose detailKnown", () => {
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellC_KNIFE, nonRefutersReason(0));
        const suggestion = Suggestion({
            id: newSuggestionId(),
            suggester: A,
            cards: [KNIFE],
            nonRefuters: [C],
        });
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerC,
            card: KNIFE,
            suggestions: [suggestion],
        });
        expect(why.givens).toHaveLength(0);
        expect(why.reasoning).toHaveLength(1);
        expect(parseTKey(why.reasoning[0]!).key).toBe(
            "non-refuters.detailKnown",
        );
    });
});

// -----------------------------------------------------------------------
// Initial-only chains
// -----------------------------------------------------------------------

describe("buildCellWhy - initial-only chains (cell is purely a given)", () => {
    test("single initial Y → headline + one bullet + empty reasoning", () => {
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellA_KNIFE, initialReason("Y"));
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerA,
            card: KNIFE,
            knownCards: [KnownCard({ player: A, card: KNIFE })],
        });
        expect(why.headline).toBeDefined();
        expect(why.givens).toHaveLength(1);
        expect(why.reasoning).toHaveLength(0);
    });

    test("single hypothesis initial → headline + one hypothesis bullet + empty reasoning", () => {
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellA_KNIFE, initialReason("N"));
        const why = callBuildCellWhy({
            provenance: prov,
            owner: ownerA,
            card: KNIFE,
            hypotheses: HashMap.fromIterable([[cellA_KNIFE, N] as const]),
        });
        expect(why.givens).toHaveLength(1);
        expect(parseTKey(why.givens[0]!).key).toBe("givenBulletHypothesis");
        expect(why.reasoning).toHaveLength(0);
    });
});

// -----------------------------------------------------------------------
// Reference-equality sanity (lint-suppressed; just to confirm the
// mocks aren't accidentally short-circuited).
// -----------------------------------------------------------------------

describe("buildCellWhy - translation invocations", () => {
    test("calls tDeduce / tReasons (mocks are wired up)", () => {
        const spyT = vi.fn(t);
        const tDeduceSpy =
            spyT as unknown as Parameters<typeof buildCellWhy>[0]["tDeduce"];
        const tReasonsSpy =
            spyT as unknown as Parameters<typeof buildCellWhy>[0]["tReasons"];
        const prov: Provenance = MutableHashMap.empty();
        setProv(prov, cellA_KNIFE, initialReason("Y"));
        setProv(
            prov,
            cellB_KNIFE,
            cardOwnershipReason(KNIFE, "N", [cellA_KNIFE]),
        );
        buildCellWhy({
            provenance: prov,
            suggestions: [],
            accusations: [],
            setup,
            owner: ownerB,
            card: KNIFE,
            knownCards: [],
            hypotheses: HashMap.empty(),
            tDeduce: tDeduceSpy,
            tReasons: tReasonsSpy,
        });
        expect(spyT).toHaveBeenCalled();
        // At least one call should be headlinePlayer (R1).
        const headlineCalls = spyT.mock.calls.filter(
            ([k]) => k === "headlinePlayer",
        );
        expect(headlineCalls.length).toBeGreaterThan(0);
    });
});
