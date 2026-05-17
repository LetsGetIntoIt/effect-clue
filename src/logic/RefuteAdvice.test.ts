import { Result } from "effect";
import { describe, expect, test } from "vitest";
import type { DraftSuggestion } from "./ClueState";
import { Player } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { KnownCard } from "./InitialKnowledge";
import { buildPerspective, type Perspective } from "./Perspective";
import {
    classifyRefuteCandidates,
    type RefuteAdviceCandidate,
} from "./RefuteAdvice";
import { newSuggestionId, Suggestion, type SuggestionId } from "./Suggestion";
import { cardByName } from "./test-utils/CardByName";

const setup = CLASSIC_SETUP_3P;
const KNIFE = cardByName(setup, "Knife");
const PLUM = cardByName(setup, "Prof. Plum");
const WRENCH = cardByName(setup, "Wrench");
const CONSERV = cardByName(setup, "Conservatory");
const ROPE = cardByName(setup, "Rope");
const SCARLET = cardByName(setup, "Miss Scarlet");
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

const draft = (input: {
    readonly suggester: Player;
    readonly cards: ReadonlyArray<ReturnType<typeof cardByName>>;
    readonly refuter?: Player;
    readonly seenCard?: ReturnType<typeof cardByName>;
    readonly nonRefuters?: ReadonlyArray<Player>;
    readonly id?: SuggestionId;
}): DraftSuggestion => ({
    id: input.id ?? newSuggestionId(),
    suggester: input.suggester,
    cards: input.cards,
    nonRefuters: input.nonRefuters ?? [],
    refuter: input.refuter,
    seenCard: input.seenCard,
});

const toDomainSuggestion = (s: DraftSuggestion) =>
    Suggestion({
        id: s.id,
        suggester: s.suggester,
        cards: s.cards,
        nonRefuters: s.nonRefuters,
        refuter: s.refuter,
        seenCard: s.seenCard,
        loggedAt: s.loggedAt ?? 0,
    });

const perspectiveFor = (
    viewer: Player,
    suggestions: ReadonlyArray<DraftSuggestion>,
    knownCards: ReadonlyArray<KnownCard> = [],
): Perspective | undefined => {
    const result = buildPerspective({
        viewer,
        setup,
        handSizes: [],
        knownCards,
        suggestions: suggestions.map(toDomainSuggestion),
        accusations: [],
    });
    return Result.isSuccess(result) ? result.success : undefined;
};

describe("classifyRefuteCandidates — empty input", () => {
    test("returns [] when handCandidates is empty", () => {
        const out = classifyRefuteCandidates({
            selfPlayer: A,
            pendingSuggester: B,
            handCandidates: [],
            suggestions: [],
            suggesterPerspective: undefined,
        });
        expect(out).toEqual([]);
    });
});

describe("classifyRefuteCandidates — tier classification", () => {
    test("Tier 1: prior reveal to the same suggester", () => {
        const priorId = newSuggestionId();
        const suggestions = [
            draft({
                id: priorId,
                suggester: B,
                cards: [PLUM, KNIFE, CONSERV],
                refuter: A,
                seenCard: PLUM,
            }),
        ];
        const out = classifyRefuteCandidates({
            selfPlayer: A,
            pendingSuggester: B,
            handCandidates: [PLUM],
            suggestions,
            suggesterPerspective: undefined,
        });
        expect(out).toHaveLength(1);
        const c = out[0] as RefuteAdviceCandidate;
        expect(c.tier).toBe("alreadyShownToSuggester");
        expect(c.priorRevealToSuggester?.suggestionId).toBe(priorId);
        expect(c.priorRevealToSuggester?.suggester).toBe(B);
        expect(c.priorRevealToSuggester?.triple).toEqual([PLUM, KNIFE, CONSERV]);
        expect(c.priorRevealsToOthers).toEqual([]);
        expect(c.perspectiveChain).toBeUndefined();
    });

    test("Tier 2: pending suggester's perspective deduces self holds the card", () => {
        // Bob holds Plum + Knife (his own hand). Cho suggests
        // {Plum, Knife, Conservatory}, A refutes with Conservatory
        // (Cho sees it; Bob does NOT — he heard the refute act but
        // not the seenCard). From Bob's perspective the slice rules
        // pin Cell(A, Conservatory) = Y because Bob has Plum + Knife
        // himself, ruling them out for A, and the refute forces A to
        // own one of {Plum, Knife, Conservatory}.
        const suggestions = [
            draft({
                suggester: C,
                cards: [PLUM, KNIFE, CONSERV],
                refuter: A,
                seenCard: CONSERV,
            }),
        ];
        const perspective = perspectiveFor(B, suggestions, [
            KnownCard({ player: B, card: PLUM }),
            KnownCard({ player: B, card: KNIFE }),
        ]);
        expect(perspective).toBeDefined();
        // Pending: B suggests {Conservatory, ...}. A holds
        // Conservatory.
        const out = classifyRefuteCandidates({
            selfPlayer: A,
            pendingSuggester: B,
            handCandidates: [CONSERV],
            suggestions,
            suggesterPerspective: perspective,
        });
        const c = out[0] as RefuteAdviceCandidate;
        expect(c.tier).toBe("suggesterCanDeduce");
        expect(c.priorRevealToSuggester).toBeUndefined();
        expect(c.priorRevealsToOthers).toEqual([]);
        expect(c.perspectiveChain).toBeDefined();
        expect((c.perspectiveChain ?? []).length).toBeGreaterThan(0);
    });

    test("Tier 3: prior reveal to a DIFFERENT suggester", () => {
        const suggestions = [
            draft({
                suggester: C,
                cards: [PLUM, KNIFE, CONSERV],
                refuter: A,
                seenCard: PLUM,
            }),
        ];
        const out = classifyRefuteCandidates({
            selfPlayer: A,
            pendingSuggester: B,
            handCandidates: [PLUM],
            suggestions,
            suggesterPerspective: undefined,
        });
        const c = out[0] as RefuteAdviceCandidate;
        expect(c.tier).toBe("alreadyShownToOther");
        expect(c.priorRevealToSuggester).toBeUndefined();
        expect(c.priorRevealsToOthers).toHaveLength(1);
        expect(c.priorRevealsToOthers[0]?.suggester).toBe(C);
    });

    test("Tier 4: fresh game, no prior reveals, not deducible", () => {
        const out = classifyRefuteCandidates({
            selfPlayer: A,
            pendingSuggester: B,
            handCandidates: [PLUM],
            suggestions: [],
            suggesterPerspective: undefined,
        });
        expect((out[0] as RefuteAdviceCandidate).tier).toBe("freshLeak");
    });
});

describe("classifyRefuteCandidates — tier precedence", () => {
    test("Tier 1 wins over Tier 3 when both prior-reveal types exist", () => {
        const suggestions = [
            draft({
                suggester: C,
                cards: [PLUM, KNIFE, CONSERV],
                refuter: A,
                seenCard: PLUM,
            }),
            draft({
                suggester: B,
                cards: [PLUM, ROPE, CONSERV],
                refuter: A,
                seenCard: PLUM,
            }),
        ];
        const out = classifyRefuteCandidates({
            selfPlayer: A,
            pendingSuggester: B,
            handCandidates: [PLUM],
            suggestions,
            suggesterPerspective: undefined,
        });
        const c = out[0] as RefuteAdviceCandidate;
        expect(c.tier).toBe("alreadyShownToSuggester");
        expect(c.priorRevealToSuggester?.suggester).toBe(B);
        // Even though there's an older reveal to C, the Tier 1
        // branch wins and Tier 3's bookkeeping doesn't fire.
        expect(c.priorRevealsToOthers).toEqual([]);
    });

    test("Tier 1 wins over Tier 2 when both fire on the same card", () => {
        // Earlier suggestion: B was the suggester of
        // {Plum, Knife, Conservatory}; A (self) refuted with Plum
        // and B saw the seenCard. From B's perspective the deducer
        // pins Cell(A, Plum) = Y via RefuterShowed (B both suggested
        // AND witnessed the refute), so Tier 2 would also fire. But
        // Tier 1 has precedence — the directly-recorded prior reveal
        // to this same suggester is more concrete than the same
        // suggester's engine-derived deduction. Pending: B suggests
        // {Plum, ...} again; A still holds Plum.
        const priorId = newSuggestionId();
        const suggestions = [
            draft({
                id: priorId,
                suggester: B,
                cards: [PLUM, KNIFE, CONSERV],
                refuter: A,
                seenCard: PLUM,
            }),
        ];
        const perspective = perspectiveFor(B, suggestions);
        expect(perspective).toBeDefined();
        const out = classifyRefuteCandidates({
            selfPlayer: A,
            pendingSuggester: B,
            handCandidates: [PLUM],
            suggestions,
            suggesterPerspective: perspective,
        });
        const c = out[0] as RefuteAdviceCandidate;
        expect(c.tier).toBe("alreadyShownToSuggester");
        expect(c.priorRevealToSuggester?.suggestionId).toBe(priorId);
        // Tier 1 short-circuits — Tier 2's perspectiveChain bookkeeping
        // does not fire.
        expect(c.perspectiveChain).toBeUndefined();
    });

    test("Tier 2 wins over Tier 3 when suggester can deduce AND we showed someone else", () => {
        const suggestions = [
            // Tier-3 candidate: we showed Conservatory to C earlier.
            draft({
                suggester: C,
                cards: [SCARLET, ROPE, CONSERV],
                refuter: A,
                seenCard: CONSERV,
            }),
            // Tier-2-driving suggestion: Cho suggests
            // {Plum, Knife, Conservatory}, A refutes, Cho saw it
            // but Bob did not. Bob's perspective will pin
            // Cell(A, Conservatory) = Y via slice rules below.
            draft({
                suggester: C,
                cards: [PLUM, KNIFE, CONSERV],
                refuter: A,
                seenCard: CONSERV,
            }),
        ];
        const perspective = perspectiveFor(B, suggestions, [
            KnownCard({ player: B, card: PLUM }),
            KnownCard({ player: B, card: KNIFE }),
        ]);
        const out = classifyRefuteCandidates({
            selfPlayer: A,
            pendingSuggester: B,
            handCandidates: [CONSERV],
            suggestions,
            suggesterPerspective: perspective,
        });
        expect((out[0] as RefuteAdviceCandidate).tier).toBe("suggesterCanDeduce");
    });
});

describe("classifyRefuteCandidates — recommendation flag", () => {
    test("all candidates at the best tier are recommended", () => {
        // Two Tier-4 candidates → both recommended.
        const out = classifyRefuteCandidates({
            selfPlayer: A,
            pendingSuggester: B,
            handCandidates: [PLUM, WRENCH],
            suggestions: [],
            suggesterPerspective: undefined,
        });
        expect(out.map(c => c.recommended)).toEqual([true, true]);
        expect(out.map(c => c.tier)).toEqual(["freshLeak", "freshLeak"]);
    });

    test("only the best-tier candidates are recommended when tiers differ", () => {
        const suggestions = [
            draft({
                suggester: B,
                cards: [PLUM, KNIFE, CONSERV],
                refuter: A,
                seenCard: PLUM,
            }),
        ];
        const out = classifyRefuteCandidates({
            selfPlayer: A,
            pendingSuggester: B,
            handCandidates: [PLUM, KNIFE],
            suggestions,
            suggesterPerspective: undefined,
        });
        const plumRow = out.find(c => c.card === PLUM) as RefuteAdviceCandidate;
        const knifeRow = out.find(c => c.card === KNIFE) as RefuteAdviceCandidate;
        expect(plumRow.tier).toBe("alreadyShownToSuggester");
        expect(plumRow.recommended).toBe(true);
        expect(knifeRow.tier).toBe("freshLeak");
        expect(knifeRow.recommended).toBe(false);
    });
});

describe("classifyRefuteCandidates — degraded perspective", () => {
    test("suggesterPerspective undefined disables Tier 2; remaining tiers still work", () => {
        // Same suggestion-log fixture that would yield Tier 2 in
        // the precedence test above, but with the perspective
        // omitted. The Tier 2 branch is skipped; classification
        // falls through to Tier 3 because A previously showed
        // Conservatory to C in this log.
        const suggestions = [
            draft({
                suggester: C,
                cards: [PLUM, KNIFE, CONSERV],
                refuter: A,
                seenCard: CONSERV,
            }),
        ];
        const out = classifyRefuteCandidates({
            selfPlayer: A,
            pendingSuggester: B,
            handCandidates: [CONSERV],
            suggestions,
            suggesterPerspective: undefined,
        });
        expect((out[0] as RefuteAdviceCandidate).tier).toBe("alreadyShownToOther");
    });

    test("suggesterPerspective undefined + no prior reveals → Tier 4", () => {
        // No log entries, no perspective. The only available
        // classification is Tier 4.
        const out = classifyRefuteCandidates({
            selfPlayer: A,
            pendingSuggester: B,
            handCandidates: [CONSERV],
            suggestions: [],
            suggesterPerspective: undefined,
        });
        expect((out[0] as RefuteAdviceCandidate).tier).toBe("freshLeak");
    });
});

describe("classifyRefuteCandidates — Tier 3 dedup", () => {
    test("multiple reveals to the same other-suggester collapse to one PriorReveal", () => {
        const suggestions = [
            draft({
                suggester: C,
                cards: [PLUM, KNIFE, CONSERV],
                refuter: A,
                seenCard: PLUM,
            }),
            draft({
                suggester: C,
                cards: [PLUM, SCARLET, CONSERV],
                refuter: A,
                seenCard: PLUM,
            }),
        ];
        const out = classifyRefuteCandidates({
            selfPlayer: A,
            pendingSuggester: B,
            handCandidates: [PLUM],
            suggestions,
            suggesterPerspective: undefined,
        });
        const c = out[0] as RefuteAdviceCandidate;
        expect(c.tier).toBe("alreadyShownToOther");
        expect(c.priorRevealsToOthers).toHaveLength(1);
        expect(c.priorRevealsToOthers[0]?.suggester).toBe(C);
    });

    test("reveals to distinct other-suggesters are kept", () => {
        const suggestions = [
            draft({
                suggester: B,
                cards: [PLUM, KNIFE, CONSERV],
                refuter: A,
                seenCard: PLUM,
            }),
            draft({
                suggester: C,
                cards: [PLUM, SCARLET, CONSERV],
                refuter: A,
                seenCard: PLUM,
            }),
        ];
        const out = classifyRefuteCandidates({
            selfPlayer: A,
            // Pending suggester is some OTHER player — using the
            // setup's third name. With our 3-player CLASSIC setup
            // we need a fourth player to exercise "shown to two
            // OTHERS" cleanly; instead we test "shown to B and C,
            // pending suggester is A" — Tier 3 fires with both B
            // and C in the list.
            pendingSuggester: A,
            handCandidates: [PLUM],
            suggestions,
            suggesterPerspective: undefined,
        });
        const c = out[0] as RefuteAdviceCandidate;
        expect(c.tier).toBe("alreadyShownToOther");
        expect(c.priorRevealsToOthers.map(r => r.suggester).sort()).toEqual(
            [B, C].sort(),
        );
    });
});
