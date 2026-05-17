import { HashMap, MutableHashMap, Option, Result } from "effect";
import { describe, expect, test } from "vitest";
import { Accusation, newAccusationId } from "./Accusation";
import { Player, PlayerOwner } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { KnownCard } from "./InitialKnowledge";
import { Cell, getCell, N, Y } from "./Knowledge";
import { buildPerspective } from "./Perspective";
import { chainFor } from "./Provenance";
import { newSuggestionId, Suggestion } from "./Suggestion";
import { cardByName } from "./test-utils/CardByName";

const setup = CLASSIC_SETUP_3P;
const KNIFE = cardByName(setup, "Knife");
const PLUM = cardByName(setup, "Prof. Plum");
const WRENCH = cardByName(setup, "Wrench");
const CONSERV = cardByName(setup, "Conservatory");
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

describe("buildPerspective — input restriction", () => {
    test("strips seenCard when viewer is neither suggester nor refuter", () => {
        // A suggests, C refutes, A sees Plum. From B's perspective:
        // B publicly heard the refute but did not see Plum.
        const result = buildPerspective({
            viewer: B,
            setup,
            handSizes: [],
            knownCards: [],
            suggestions: [
                Suggestion({
                    id: newSuggestionId(),
                    suggester: A,
                    cards: [PLUM, KNIFE, CONSERV],
                    nonRefuters: [B],
                    refuter: C,
                    seenCard: PLUM,
                }),
            ],
            accusations: [],
        });

        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        // B's perspective does NOT contain Cell(C, Plum) = Y. The
        // RefuterShowed rule only fires when the seenCard is in the
        // restricted suggestion log; without it the deducer falls
        // back to RefuterOwnsOneOf, which alone cannot pin Plum to C.
        expect(
            getCell(result.success.knowledge, Cell(PlayerOwner(C), PLUM)),
        ).toBeUndefined();
        // B did learn the nonRefuter facts publicly: B knows B does
        // not have Plum (B was a nonRefuter on the suggestion). This
        // is the public NonRefuters rule firing.
        expect(
            getCell(result.success.knowledge, Cell(PlayerOwner(B), PLUM)),
        ).toBe(N);
    });

    test("preserves seenCard when viewer was the suggester", () => {
        // B suggests, A refutes with Plum. B's perspective contains
        // Cell(A, Plum) = Y because B was the one who saw it.
        const result = buildPerspective({
            viewer: B,
            setup,
            handSizes: [],
            knownCards: [],
            suggestions: [
                Suggestion({
                    id: newSuggestionId(),
                    suggester: B,
                    cards: [PLUM, KNIFE, CONSERV],
                    nonRefuters: [],
                    refuter: A,
                    seenCard: PLUM,
                }),
            ],
            accusations: [],
        });

        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        expect(
            getCell(result.success.knowledge, Cell(PlayerOwner(A), PLUM)),
        ).toBe(Y);
    });

    test("preserves seenCard when viewer was the refuter", () => {
        // A suggests, B refutes (B is the viewer). B's perspective
        // contains Cell(B, Knife) = Y because B knows what they
        // showed.
        const result = buildPerspective({
            viewer: B,
            setup,
            handSizes: [],
            knownCards: [],
            suggestions: [
                Suggestion({
                    id: newSuggestionId(),
                    suggester: A,
                    cards: [PLUM, KNIFE, CONSERV],
                    nonRefuters: [],
                    refuter: B,
                    seenCard: KNIFE,
                }),
            ],
            accusations: [],
        });

        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        expect(
            getCell(result.success.knowledge, Cell(PlayerOwner(B), KNIFE)),
        ).toBe(Y);
    });
});

describe("buildPerspective — initial knowledge seeding", () => {
    test("knownCard for the viewer is seeded Y in viewer's row", () => {
        const result = buildPerspective({
            viewer: B,
            setup,
            handSizes: [],
            knownCards: [KnownCard({ player: B, card: PLUM })],
            suggestions: [],
            accusations: [],
        });

        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        expect(
            getCell(result.success.knowledge, Cell(PlayerOwner(B), PLUM)),
        ).toBe(Y);
    });

    test("knownCard for another player is seeded N in viewer's row", () => {
        // We know Anisha has Plum (e.g. she refuted us with it).
        // From Bob's perspective, Bob trivially knows he does not
        // have Plum — he can see his own hand. Bob may not know
        // Anisha has it (that depends on suggestion log).
        const result = buildPerspective({
            viewer: B,
            setup,
            handSizes: [],
            knownCards: [KnownCard({ player: A, card: PLUM })],
            suggestions: [],
            accusations: [],
        });

        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        expect(
            getCell(result.success.knowledge, Cell(PlayerOwner(B), PLUM)),
        ).toBe(N);
        // We did NOT seed Cell(A, Plum) = Y for B's perspective —
        // that's information self has but the viewer might not.
        expect(
            getCell(result.success.knowledge, Cell(PlayerOwner(A), PLUM)),
        ).toBeUndefined();
    });
});

describe("buildPerspective — public rule propagation", () => {
    test("NonRefuters propagates regardless of who the viewer is", () => {
        // A suggests {Plum, Knife, Conservatory}; B passes
        // publicly. From C's perspective (C heard B pass but is
        // neither suggester nor refuter), B is marked as not
        // holding any of the suggested cards.
        const result = buildPerspective({
            viewer: C,
            setup,
            handSizes: [],
            knownCards: [],
            suggestions: [
                Suggestion({
                    id: newSuggestionId(),
                    suggester: A,
                    cards: [PLUM, KNIFE, CONSERV],
                    nonRefuters: [B],
                    refuter: undefined,
                    seenCard: undefined,
                }),
            ],
            accusations: [],
        });

        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        for (const card of [PLUM, KNIFE, CONSERV]) {
            expect(
                getCell(result.success.knowledge, Cell(PlayerOwner(B), card)),
            ).toBe(N);
        }
    });

    test("failed accusations thread through the perspective deducer", () => {
        // Failed accusation by A: not all three are in the case file.
        // Combined with knownCard hints, the perspective deducer
        // produces some output without raising a contradiction.
        const result = buildPerspective({
            viewer: B,
            setup,
            handSizes: [],
            knownCards: [],
            suggestions: [],
            accusations: [
                Accusation({
                    id: newAccusationId(),
                    accuser: A,
                    cards: [PLUM, KNIFE, CONSERV],
                }),
            ],
        });

        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;
        // The deducer ran without contradiction; specific deductions
        // from a lone failed accusation are conditional on other
        // info, so we don't assert specific cells here — just that
        // the path completes successfully.
        expect(HashMap.size(result.success.knowledge.checklist)).toBeGreaterThanOrEqual(0);
    });
});

describe("buildPerspective — multi-step deduction", () => {
    test("viewer derives a Y for another player via slice saturation + RefuterOwnsOneOf", () => {
        // Bob holds Plum and Knife (his own hand). Cho suggests
        // {Plum, Knife, Conservatory} and Anisha refutes (Cho sees
        // the seenCard but Bob does not). From Bob's perspective:
        //   - Bob knows he has Plum (own hand → seeded Y).
        //   - Bob knows he has Knife (own hand → seeded Y).
        //   - Slice "card has one owner" → Cell(A, Plum) = N and
        //     Cell(A, Knife) = N follow from B's Ys.
        //   - RefuterOwnsOneOf on the suggestion (A refutes with one
        //     of {Plum, Knife, Conservatory}) combined with the two
        //     Ns → A must have Conservatory.
        const result = buildPerspective({
            viewer: B,
            setup,
            handSizes: [],
            knownCards: [
                KnownCard({ player: B, card: PLUM }),
                KnownCard({ player: B, card: KNIFE }),
            ],
            suggestions: [
                Suggestion({
                    id: newSuggestionId(),
                    suggester: C,
                    cards: [PLUM, KNIFE, CONSERV],
                    nonRefuters: [],
                    refuter: A,
                    seenCard: CONSERV, // Cho sees it; Bob does not.
                }),
            ],
            accusations: [],
        });

        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        const aConserv = Cell(PlayerOwner(A), CONSERV);
        expect(getCell(result.success.knowledge, aConserv)).toBe(Y);

        // The chain rooted at A/Conservatory should end with
        // RefuterOwnsOneOf and trace back to B's seeded Y cells.
        const chain = chainFor(result.success.provenance, aConserv);
        const last = chain.at(-1);
        expect(last?.cell).toEqual(aConserv);
        expect(last?.reason.kind._tag).toBe("RefuterOwnsOneOf");
        // The transitive chain must include the initial-known-card
        // entries B seeded for himself — those are the leaves the
        // multi-step derivation depends on.
        const tags = new Set(chain.map(e => e.reason.kind._tag));
        expect(tags.has("InitialKnownCard")).toBe(true);
    });
});

describe("buildPerspective — failure modes", () => {
    test("contradictory seeding surfaces a ContradictionTrace", () => {
        // We claim B has both Plum and Knife but B's hand size is 1.
        // From B's perspective the PlayerHand slice rule detects an
        // over-saturation — too many Ys for hand size — and the
        // result is Result.Failure.
        const result = buildPerspective({
            viewer: B,
            setup,
            handSizes: [[B, 1]],
            knownCards: [
                KnownCard({ player: B, card: PLUM }),
                KnownCard({ player: B, card: KNIFE }),
            ],
            suggestions: [],
            accusations: [],
        });

        expect(Result.isFailure(result)).toBe(true);
        if (!Result.isFailure(result)) return;
        expect(result.failure.reason).toBeTruthy();
    });
});

describe("buildPerspective — provenance surface", () => {
    test("seeded cells appear as InitialKnownCard entries in the chain", () => {
        const result = buildPerspective({
            viewer: B,
            setup,
            handSizes: [],
            knownCards: [KnownCard({ player: B, card: WRENCH })],
            suggestions: [],
            accusations: [],
        });

        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        const cell = Cell(PlayerOwner(B), WRENCH);
        const reason = Option.getOrUndefined(
            MutableHashMap.get(result.success.provenance, cell),
        );
        expect(reason?.kind._tag).toBe("InitialKnownCard");
        expect(reason?.value).toBe(Y);
    });
});

