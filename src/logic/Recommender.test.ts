import { Card, CaseFileOwner, Player, PlayerOwner } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import {
    Cell,
    emptyKnowledge,
    N,
    setCell,
    Y,
} from "./Knowledge";
import {
    caseFileCandidatesFor,
    recommendSuggestions,
} from "./Recommender";

import "./test-utils/EffectExpectEquals";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

describe("recommendSuggestions", () => {
    test("fresh game returns 5 non-empty recommendations", () => {
        const result = recommendSuggestions(setup, emptyKnowledge, A, 5);
        expect(result.recommendations.length).toBe(5);
        for (const rec of result.recommendations) {
            expect(rec.score).toBeGreaterThan(0);
            expect(rec.cellInfoScore).toBeGreaterThan(0);
            expect(rec.caseFileOpennessScore).toBeGreaterThan(0);
            expect(rec.refuterUncertaintyScore).toBeGreaterThan(0);
            expect(rec.cards.length).toBe(3); // classic = 3 categories
        }
    });

    test("fully-pinned case file returns no recommendations", () => {
        // Pin case-file suspect to Miss Scarlet, weapon to Knife,
        // room to Kitchen — by setting Y on those three and N on
        // every other case-file cell. cartesianCandidates enumerates
        // {Miss Scarlet} × {Knife} × {Kitchen} = 1 triple; that
        // single triple has no unknown cells in other players' rows
        // (it's already Y in the case file for all of them via
        // ownership-slice implications) — actually cellInfoScore comes
        // from *other players'* cells, not the case file. We also need
        // other players to be fully N on those three cards, which they
        // aren't. Instead: if every category has exactly 0 remaining
        // candidates, the cartesian yields nothing. Force that by
        // marking every card of every category N for the case file.
        let k = emptyKnowledge;
        for (const c of setup.categories) {
            for (const card of c.cards) {
                k = setCell(k, Cell(CaseFileOwner(), card), N);
            }
        }

        const result = recommendSuggestions(setup, k, A, 5);
        expect(result.recommendations.length).toBe(0);
    });

    test("recommendations prefer cards with more case-file candidates", () => {
        // Narrow the suspects category to just 2 candidates (pin 4 of 6 as
        // N for the case file). Rooms/weapons stay fully open. The
        // caseFileOpennessScore factor should push triples containing
        // room/weapon cards no higher than those using the two remaining
        // suspects — since the product includes all three counts, the
        // triples containing any of the four ruled-out suspects are
        // filtered out (they're no longer live case-file candidates).
        let k = emptyKnowledge;
        for (const card of setup.categories[0].cards.slice(0, 4)) {
            k = setCell(k, Cell(CaseFileOwner(), card), N);
        }
        const result = recommendSuggestions(setup, k, A, 50);
        // Every recommendation's suspect must be one of the two remaining.
        const allowed = new Set(setup.categories[0].cards.slice(4).map(String));
        for (const rec of result.recommendations) {
            expect(allowed.has(String(rec.cards[0]))).toBe(true);
        }
    });

    test("refuter-uncertainty tiebreak: 2 possible refuters beats 1", () => {
        // Setup: Both Bob and Cho could refute suggestion X; only Bob
        // could refute suggestion Y (Cho is known to lack all three
        // cards of Y). So X should rank above Y.
        //
        // Easiest construction: mark all of Cho's cells for 3 specific
        // cards as N (one per category). A suggestion using those three
        // cards has refuterUncertainty = 1 (only Bob); any other
        // suggestion has refuterUncertainty = 2 (both Bob and Cho).
        const badSuspect = Card("Miss Scarlet");
        const badWeapon  = Card("Knife");
        const badRoom    = Card("Kitchen");
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(C), badSuspect), N);
        k = setCell(k, Cell(PlayerOwner(C), badWeapon),  N);
        k = setCell(k, Cell(PlayerOwner(C), badRoom),    N);

        const result = recommendSuggestions(setup, k, A, 50);
        // Find the "bad" triple and compare its position.
        const badIdx = result.recommendations.findIndex(r =>
            String(r.cards[0]) === String(badSuspect) &&
            String(r.cards[1]) === String(badWeapon) &&
            String(r.cards[2]) === String(badRoom));
        // The bad triple has refuterUncertainty=1; its score will be
        // lower than any competitor with refuterUncertainty=2 and the
        // same cellInfo/caseFileOpenness factors. Given the
        // universe of triples, the bad one shouldn't be in the top 5.
        expect(badIdx === -1 || badIdx >= 5).toBe(true);
    });

    test("no recommendations when all other players are known non-refuters", () => {
        // If every other player is known to lack all cards in every
        // possible triple, refuterUncertaintyScore is 0 everywhere.
        let k = emptyKnowledge;
        for (const c of setup.categories) {
            for (const card of c.cards) {
                k = setCell(k, Cell(PlayerOwner(B), card), N);
                k = setCell(k, Cell(PlayerOwner(C), card), N);
            }
        }
        const result = recommendSuggestions(setup, k, A, 5);
        expect(result.recommendations.length).toBe(0);
    });

    test("tie-break is stable and deterministic by joined card names", () => {
        const result = recommendSuggestions(setup, emptyKnowledge, A, 5);
        // Fresh board: every triple ties at the top. The lexicographic
        // tie-break by joined names means result[0] is the
        // alphabetically-earliest joined string.
        const joined = result.recommendations.map(r => r.cards.join("|"));
        const sorted = [...joined].sort();
        expect(joined.length).toBe(sorted.length);
        for (let i = 0; i < joined.length; i++) {
            expect(joined[i]).toBe(sorted[i]);
        }
    });
});

describe("caseFileCandidatesFor", () => {
    test("returns all category cards on empty knowledge", () => {
        const suspects = caseFileCandidatesFor(
            setup, emptyKnowledge, setup.categories[0].name);
        expect(suspects.length).toBe(setup.categories[0].cards.length);
    });

    test("excludes cards marked N for the case file", () => {
        const k = setCell(
            emptyKnowledge,
            Cell(CaseFileOwner(), Card("Miss Scarlet")),
            N,
        );
        const suspects = caseFileCandidatesFor(
            setup, k, setup.categories[0].name);
        expect(suspects.length).toBe(setup.categories[0].cards.length - 1);
        expect(suspects.map(String)).not.toContain("Miss Scarlet");
    });
});
