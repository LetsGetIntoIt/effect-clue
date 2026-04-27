import { describe, expect, test } from "vitest";
import { Effect, HashMap } from "effect";
import { CLASSIC_SETUP_3P } from "../GameSetup";
import { emptyKnowledge } from "../Knowledge";
import { Suggestion } from "../Suggestion";
import { Accusation } from "../Accusation";
import { Player } from "../GameObjects";
import {
    getAccusations,
    getCardSet,
    getKnowledge,
    getPlayerSet,
    getSuggestions,
    makeClueLayer,
    makeSetupLayer,
} from "./index";

/**
 * End-to-end plumbing tests for the service layer. The services
 * themselves are thin read-only accessors — the goal here is to
 * prove that the pair / full layer composes without DI cycles and
 * that an `Effect.gen` yielding them returns the expected snapshots
 * from a concrete input.
 *
 * Consumer-level coverage (deduce, recommendSuggestions, etc.)
 * lives alongside each consumer's own test file.
 */
describe("setup layer", () => {
    const layer = makeSetupLayer(CLASSIC_SETUP_3P);

    test("CardSetService exposes the setup's deck half", () => {
        const program = Effect.gen(function* () {
            return yield* getCardSet;
        });
        const out = Effect.runSync(program.pipe(Effect.provide(layer)));
        expect(out.categories).toBe(CLASSIC_SETUP_3P.cardSet.categories);
    });

    test("PlayerSetService exposes the setup's roster half", () => {
        const program = Effect.gen(function* () {
            return yield* getPlayerSet;
        });
        const out = Effect.runSync(program.pipe(Effect.provide(layer)));
        expect(out.players).toBe(CLASSIC_SETUP_3P.playerSet.players);
    });

    test("both services can be yielded side-by-side in one Effect.gen", () => {
        const program = Effect.gen(function* () {
            const cards = yield* getCardSet;
            const players = yield* getPlayerSet;
            return {
                categoryCount: cards.categories.length,
                playerCount: players.players.length,
            };
        });
        const out = Effect.runSync(program.pipe(Effect.provide(layer)));
        expect(out.categoryCount).toBe(CLASSIC_SETUP_3P.cardSet.categories.length);
        expect(out.playerCount).toBe(CLASSIC_SETUP_3P.playerSet.players.length);
    });
});

describe("full clue layer", () => {
    const suggestion = Suggestion({
        suggester: Player("Anisha"),
        cards: [],
        nonRefuters: [],
    });
    const accusation = Accusation({
        accuser: Player("Bob"),
        cards: [],
    });
    const layer = makeClueLayer({
        setup: CLASSIC_SETUP_3P,
        suggestions: [suggestion],
        accusations: [accusation],
        knowledge: emptyKnowledge,
    });

    test("SuggestionsService exposes the provided log", () => {
        const program = Effect.gen(function* () {
            return yield* getSuggestions;
        });
        const out = Effect.runSync(program.pipe(Effect.provide(layer)));
        expect(out).toHaveLength(1);
        expect(String(out[0]!.suggester)).toBe("Anisha");
    });

    test("KnowledgeService exposes the current deduced state", () => {
        const program = Effect.gen(function* () {
            return yield* getKnowledge;
        });
        const out = Effect.runSync(program.pipe(Effect.provide(layer)));
        expect(HashMap.size(out.checklist)).toBe(
            HashMap.size(emptyKnowledge.checklist),
        );
    });

    test("AccusationsService exposes the provided accusation log", () => {
        const program = Effect.gen(function* () {
            return yield* getAccusations;
        });
        const out = Effect.runSync(program.pipe(Effect.provide(layer)));
        expect(out).toHaveLength(1);
        expect(String(out[0]!.accuser)).toBe("Bob");
    });

    test("all five services coexist in a single Effect.gen", () => {
        const program = Effect.gen(function* () {
            const cards = yield* getCardSet;
            const players = yield* getPlayerSet;
            const suggestions = yield* getSuggestions;
            const accusations = yield* getAccusations;
            const knowledge = yield* getKnowledge;
            return {
                categories: cards.categories.length,
                players: players.players.length,
                suggestions: suggestions.length,
                accusations: accusations.length,
                knowledgeBacked: knowledge === emptyKnowledge,
            };
        });
        const out = Effect.runSync(program.pipe(Effect.provide(layer)));
        expect(out).toEqual({
            categories: CLASSIC_SETUP_3P.cardSet.categories.length,
            players: CLASSIC_SETUP_3P.playerSet.players.length,
            suggestions: 1,
            accusations: 1,
            knowledgeBacked: true,
        });
    });
});
