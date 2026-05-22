import { describe, expect, test } from "vitest";
import { Player } from "../../logic/GameObjects";
import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { cardByName } from "../../logic/test-utils/CardByName";
import {
    PILL_PASSERS,
    PILL_REFUTER,
    PILL_SEEN,
    subsumePriorWarnings,
    type PillId,
    type SoftWarning,
} from "./SuggestionForm";

// ----------------------------------------------------------------------------
// `subsumePriorWarnings` removes redundant prior-log warnings before the
// display layer renders them. Today the only rule is:
//
//   • If `refuterCannotRefute` (W2) is present in the REFUTER slot, drop
//     the SEENCARD-slot warning (W3 / W5 / W6) — the named refuter has
//     none of the suggested cards, so questions about which card they
//     showed are downstream noise.
//
// Other cross-slot pairs (W4 + SEENCARD; W1 + anything) are kept because
// they describe genuinely different players or dimensions, OR they're
// mutex by construction (W4 vs W3/W5/W6) and never co-fire.
// ----------------------------------------------------------------------------

const setup = CLASSIC_SETUP_3P;
const ANISHA = Player("Anisha");
const BOB = Player("Bob");
const CHO = Player("Cho");
const KNIFE = cardByName(setup, "Knife");

const mapOf = (
    entries: ReadonlyArray<readonly [PillId, SoftWarning]>,
): ReadonlyMap<PillId, SoftWarning> => new Map(entries);

describe("subsumePriorWarnings — W2 silences the SEENCARD slot", () => {
    test("W2 + W3 → SEENCARD dropped", () => {
        const input = mapOf([
            [
                PILL_REFUTER,
                { kind: "refuterCannotRefute", player: CHO },
            ],
            [
                PILL_SEEN,
                { kind: "shownCardNotInRefuterHand", player: CHO },
            ],
        ]);
        const out = subsumePriorWarnings(input);
        expect(out.has(PILL_SEEN)).toBe(false);
        expect(out.get(PILL_REFUTER)?.kind).toBe("refuterCannotRefute");
    });

    test("W2 + W5 → SEENCARD dropped", () => {
        const input = mapOf([
            [
                PILL_REFUTER,
                { kind: "refuterCannotRefute", player: CHO },
            ],
            [PILL_SEEN, { kind: "selfSuggesterMissingSeenCard" }],
        ]);
        const out = subsumePriorWarnings(input);
        expect(out.has(PILL_SEEN)).toBe(false);
        expect(out.size).toBe(1);
    });

    test("W2 + W6 → SEENCARD dropped (the screenshot scenario)", () => {
        const input = mapOf([
            [
                PILL_REFUTER,
                { kind: "refuterCannotRefute", player: ANISHA },
            ],
            [PILL_SEEN, { kind: "selfRefuterMissingSeenCard" }],
        ]);
        const out = subsumePriorWarnings(input);
        expect(out.has(PILL_SEEN)).toBe(false);
        expect(out.get(PILL_REFUTER)).toEqual({
            kind: "refuterCannotRefute",
            player: ANISHA,
        });
    });

    test("W2 + W6 alongside W1 keeps W1 (different player)", () => {
        const input = mapOf([
            [
                PILL_PASSERS,
                {
                    kind: "passersIncludePlayersWhoCanRefute",
                    players: [BOB],
                },
            ],
            [
                PILL_REFUTER,
                { kind: "refuterCannotRefute", player: ANISHA },
            ],
            [PILL_SEEN, { kind: "selfRefuterMissingSeenCard" }],
        ]);
        const out = subsumePriorWarnings(input);
        expect(out.has(PILL_SEEN)).toBe(false);
        expect(out.get(PILL_PASSERS)?.kind).toBe(
            "passersIncludePlayersWhoCanRefute",
        );
        expect(out.get(PILL_REFUTER)?.kind).toBe("refuterCannotRefute");
        expect(out.size).toBe(2);
    });
});

describe("subsumePriorWarnings — pass-through cases", () => {
    test("W2 alone → unchanged", () => {
        const input = mapOf([
            [
                PILL_REFUTER,
                { kind: "refuterCannotRefute", player: CHO },
            ],
        ]);
        const out = subsumePriorWarnings(input);
        expect(out).toBe(input);
    });

    test("W3 alone (no W2) → unchanged", () => {
        const input = mapOf([
            [
                PILL_SEEN,
                { kind: "shownCardNotInRefuterHand", player: CHO },
            ],
        ]);
        const out = subsumePriorWarnings(input);
        expect(out).toBe(input);
        expect(out.get(PILL_SEEN)?.kind).toBe("shownCardNotInRefuterHand");
    });

    test("W5 alone (no W2) → unchanged", () => {
        const input = mapOf([
            [PILL_SEEN, { kind: "selfSuggesterMissingSeenCard" }],
        ]);
        const out = subsumePriorWarnings(input);
        expect(out).toBe(input);
    });

    test("W6 alone (no W2) → unchanged", () => {
        const input = mapOf([
            [PILL_SEEN, { kind: "selfRefuterMissingSeenCard" }],
        ]);
        const out = subsumePriorWarnings(input);
        expect(out).toBe(input);
    });

    test("W4 + W1 → unchanged (W4 is mutex with SEENCARD; nothing to subsume)", () => {
        const input = mapOf([
            [
                PILL_PASSERS,
                {
                    kind: "passersIncludePlayersWhoCanRefute",
                    players: [BOB],
                },
            ],
            [
                PILL_REFUTER,
                {
                    kind: "someoneCanRefuteButNobodyMarked",
                    players: [CHO],
                },
            ],
        ]);
        const out = subsumePriorWarnings(input);
        expect(out).toBe(input);
        expect(out.size).toBe(2);
    });

    test("W1 alone → unchanged", () => {
        const input = mapOf([
            [
                PILL_PASSERS,
                {
                    kind: "passersIncludePlayersWhoCanRefute",
                    players: [BOB],
                },
            ],
        ]);
        const out = subsumePriorWarnings(input);
        expect(out).toBe(input);
    });

    test("empty map → unchanged", () => {
        const input = mapOf([]);
        const out = subsumePriorWarnings(input);
        expect(out).toBe(input);
        expect(out.size).toBe(0);
    });

    // Defensive: a refuter warning of a kind OTHER than
    // `refuterCannotRefute` (today only `someoneCanRefuteButNobodyMarked`)
    // must not trigger the subsumption. The guard checks `.kind` so a
    // future warning added to the REFUTER slot wouldn't accidentally
    // silence SEENCARD.
    test("REFUTER slot with non-W2 kind does not silence SEENCARD", () => {
        const input = mapOf([
            [
                PILL_REFUTER,
                {
                    kind: "someoneCanRefuteButNobodyMarked",
                    players: [BOB],
                },
            ],
            // Hypothetical: W3 is mutex with W4 in practice (W3 needs
            // refuter set, W4 needs blank). We still construct the
            // pair directly to confirm the helper's guard works on the
            // wire-shape alone, independent of the validator's mutex
            // invariants. Use KNIFE to satisfy the SoftWarning shape.
            [
                PILL_SEEN,
                { kind: "shownCardNotInRefuterHand", player: BOB },
            ],
        ]);
        const out = subsumePriorWarnings(input);
        expect(out).toBe(input);
        expect(out.has(PILL_SEEN)).toBe(true);
        // Touch KNIFE to keep the fixture honest if a future case
        // wants to assert against a specific shown card.
        expect(KNIFE).toBeDefined();
    });
});
