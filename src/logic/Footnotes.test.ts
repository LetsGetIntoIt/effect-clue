import { Player, PlayerOwner } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import {
    Cell,
    emptyKnowledge,
    N,
    setCell,
    Y,
} from "./Knowledge";
import { MutableHashMap } from "effect";
import { refuterCandidateFootnotes, footnotesForCell } from "./Footnotes";
import { Suggestion, SuggestionId } from "./Suggestion";
import { cardByName } from "./test-utils/CardByName";

import "./test-utils/EffectExpectEquals";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");

const PLUM    = cardByName(setup, "Prof. Plum");
const KNIFE   = cardByName(setup, "Knife");
const CONSERV = cardByName(setup, "Conservatory");

// The custom effect-equals matcher intercepts array comparisons, so we
// compare length + element-wise.
const expectNumbers = (actual: ReadonlyArray<number>, expected: number[]) => {
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
        expect(actual[i]).toBe(expected[i]);
    }
};

describe("refuterCandidateFootnotes", () => {
    test("a single unseen-refuted suggestion tags each suggested card", () => {
        const suggestion = Suggestion({
            id: SuggestionId("s1"),
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
        });
        const footnotes = refuterCandidateFootnotes(
            [suggestion],
            emptyKnowledge,
        );
        expectNumbers(
            footnotesForCell(footnotes, Cell(PlayerOwner(B), PLUM)),
            [1],
        );
        expectNumbers(
            footnotesForCell(footnotes, Cell(PlayerOwner(B), KNIFE)),
            [1],
        );
        expectNumbers(
            footnotesForCell(footnotes, Cell(PlayerOwner(B), CONSERV)),
            [1],
        );
    });

    test("skips suggestions where we saw the refuting card", () => {
        const suggestion = Suggestion({
            id: SuggestionId("s1"),
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
            seenCard: KNIFE,
        });
        const footnotes = refuterCandidateFootnotes(
            [suggestion],
            emptyKnowledge,
        );
        expect(MutableHashMap.size(footnotes.byCell)).toBe(0);
    });

    test("skips cells already ruled out for the refuter", () => {
        const suggestion = Suggestion({
            id: SuggestionId("s1"),
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
        });
        const knowledge = setCell(
            emptyKnowledge,
            Cell(PlayerOwner(B), PLUM),
            N,
        );
        const footnotes = refuterCandidateFootnotes([suggestion], knowledge);
        expect(MutableHashMap.has(footnotes.byCell, Cell(PlayerOwner(B), PLUM)))
            .toBe(false);
        expectNumbers(
            footnotesForCell(footnotes, Cell(PlayerOwner(B), KNIFE)),
            [1],
        );
        expectNumbers(
            footnotesForCell(footnotes, Cell(PlayerOwner(B), CONSERV)),
            [1],
        );
    });

    test("drops the suggestion entirely once refuter owns a suggested card", () => {
        const suggestion = Suggestion({
            id: SuggestionId("s1"),
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
        });
        const knowledge = setCell(
            emptyKnowledge,
            Cell(PlayerOwner(B), PLUM),
            Y,
        );
        const footnotes = refuterCandidateFootnotes([suggestion], knowledge);
        expect(MutableHashMap.size(footnotes.byCell)).toBe(0);
    });

    test("cells hit by multiple suggestions collect both numbers in order", () => {
        const s1 = Suggestion({
            id: SuggestionId("s1"),
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
        });
        const s2 = Suggestion({
            id: SuggestionId("s2"),
            suggester: A,
            cards: [PLUM],
            nonRefuters: [],
            refuter: B,
        });
        const s3 = Suggestion({
            id: SuggestionId("s3"),
            suggester: A,
            cards: [PLUM],
            nonRefuters: [],
            refuter: B,
        });
        const footnotes = refuterCandidateFootnotes(
            [s1, s2, s3],
            emptyKnowledge,
        );
        expectNumbers(
            footnotesForCell(footnotes, Cell(PlayerOwner(B), PLUM)),
            [1, 2, 3],
        );
    });
});
