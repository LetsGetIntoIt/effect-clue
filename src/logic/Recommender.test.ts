import { CaseFileOwner, Player, PlayerOwner } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import {
    Cell,
    emptyKnowledge,
    N,
    setCell,
} from "./Knowledge";
import { caseFileCandidatesFor } from "./Recommender";
import { cardByName } from "./test-utils/CardByName";
import { expectDefined } from "./test-utils/Expect";
import { runRecommend } from "./test-utils/RunRecommend";

import "./test-utils/EffectExpectEquals";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

const suspectsCategory = expectDefined(
    setup.categories.find(c => c.name === "Suspect"),
    "Suspect category",
);

describe("recommendSuggestions", () => {
    test("fresh game returns 5 non-empty recommendations", () => {
        const result = runRecommend(setup, emptyKnowledge, A, 5);
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
        // Mark every card of every category as N for the case file.
        // cartesianCandidates then yields nothing and we bail out.
        let k = emptyKnowledge;
        for (const c of setup.categories) {
            for (const entry of c.cards) {
                k = setCell(k, Cell(CaseFileOwner(), entry.id), N);
            }
        }

        const result = runRecommend(setup, k, A, 5);
        expect(result.recommendations.length).toBe(0);
    });

    test("recommendations prefer cards with more case-file candidates", () => {
        // Narrow the suspects category to just 2 case-file candidates
        // (pin 4 of 6 as N). Rooms/weapons stay fully open. Every
        // recommendation's first card must now be one of the two
        // remaining suspect ids.
        let k = emptyKnowledge;
        for (const entry of suspectsCategory.cards.slice(0, 4)) {
            k = setCell(k, Cell(CaseFileOwner(), entry.id), N);
        }
        const result = runRecommend(setup, k, A, 50);
        const allowed = new Set(
            suspectsCategory.cards.slice(4).map(e => String(e.id)),
        );
        for (const rec of result.recommendations) {
            expect(allowed.has(String(rec.cards[0]))).toBe(true);
        }
    });

    test("refuter-uncertainty tiebreak: 2 possible refuters beats 1", () => {
        // Mark Cho as N on a specific (suspect, weapon, room) triple.
        // Any suggestion using that exact triple has refuterUncertainty=1
        // (only Bob could refute); other suggestions have uncertainty=2.
        // The constrained triple should not appear in the top 5.
        const badSuspect = cardByName(setup, "Miss Scarlet");
        const badWeapon = cardByName(setup, "Knife");
        const badRoom = cardByName(setup, "Kitchen");
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(C), badSuspect), N);
        k = setCell(k, Cell(PlayerOwner(C), badWeapon), N);
        k = setCell(k, Cell(PlayerOwner(C), badRoom), N);

        const result = runRecommend(setup, k, A, 50);
        const badIdx = result.recommendations.findIndex(
            r =>
                String(r.cards[0]) === String(badSuspect) &&
                String(r.cards[1]) === String(badWeapon) &&
                String(r.cards[2]) === String(badRoom),
        );
        expect(badIdx === -1 || badIdx >= 5).toBe(true);
    });

    test("no recommendations when all other players are known non-refuters", () => {
        let k = emptyKnowledge;
        for (const c of setup.categories) {
            for (const entry of c.cards) {
                k = setCell(k, Cell(PlayerOwner(B), entry.id), N);
                k = setCell(k, Cell(PlayerOwner(C), entry.id), N);
            }
        }
        const result = runRecommend(setup, k, A, 5);
        expect(result.recommendations.length).toBe(0);
    });

    test("tie-break is stable and deterministic by joined card ids", () => {
        const result = runRecommend(setup, emptyKnowledge, A, 5);
        // Fresh board: every triple ties at the top. The lexicographic
        // tie-break by joined ids means result[0] is the
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
            setup,
            emptyKnowledge,
            suspectsCategory.id,
        );
        expect(suspects.length).toBe(suspectsCategory.cards.length);
    });

    test("excludes cards marked N for the case file", () => {
        const missScarlet = cardByName(setup, "Miss Scarlet");
        const k = setCell(
            emptyKnowledge,
            Cell(CaseFileOwner(), missScarlet),
            N,
        );
        const suspects = caseFileCandidatesFor(
            setup,
            k,
            suspectsCategory.id,
        );
        expect(suspects.length).toBe(suspectsCategory.cards.length - 1);
        expect(suspects.map(String)).not.toContain(String(missScarlet));
    });
});
