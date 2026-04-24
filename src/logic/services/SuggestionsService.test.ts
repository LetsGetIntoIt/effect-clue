import { it } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect } from "effect";
import { Player } from "../GameObjects";
import { CLASSIC_SETUP_3P } from "../GameSetup";
import { cardByName } from "../test-utils/CardByName";
import { newSuggestionId, Suggestion } from "../Suggestion";
import {
    getSuggestions,
    makeSuggestionsLayer,
    SuggestionsService,
} from "./SuggestionsService";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const MUSTARD = cardByName(setup, "Col. Mustard");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");

const makeSuggestion = (suggester = A) =>
    Suggestion({
        id: newSuggestionId(),
        suggester,
        cards: [MUSTARD, KNIFE, KITCHEN],
        nonRefuters: [],
    });

describe("SuggestionsService", () => {
    it.effect("yields an empty list when no suggestions are provided", () =>
        Effect.gen(function* () {
            const suggestions = yield* getSuggestions;
            expect(suggestions).toEqual([]);
        }).pipe(Effect.provide(makeSuggestionsLayer([]))),
    );

    it.effect("yields the provided suggestions in order", () => {
        const list = [makeSuggestion(A), makeSuggestion(B)];
        return Effect.gen(function* () {
            const suggestions = yield* getSuggestions;
            expect(suggestions).toHaveLength(2);
            expect(suggestions[0]?.suggester).toBe(A);
            expect(suggestions[1]?.suggester).toBe(B);
        }).pipe(Effect.provide(makeSuggestionsLayer(list)));
    });

    it.effect("returns the same array reference on every yield", () => {
        const list = [makeSuggestion()];
        return Effect.gen(function* () {
            const a = yield* getSuggestions;
            const b = yield* getSuggestions;
            expect(a).toBe(b);
        }).pipe(Effect.provide(makeSuggestionsLayer(list)));
    });

    it.effect("providing a different layer swaps the log", () => {
        const first = [makeSuggestion(A)];
        const second = [makeSuggestion(A), makeSuggestion(B)];
        return Effect.gen(function* () {
            const suggestions = yield* getSuggestions;
            expect(suggestions).toBe(second);
            expect(suggestions).not.toBe(first);
        }).pipe(Effect.provide(makeSuggestionsLayer(second)));
    });

    it.effect("exposes the same data through SuggestionsService directly", () => {
        const list = [makeSuggestion()];
        return Effect.gen(function* () {
            const svc = yield* SuggestionsService;
            expect(svc.get()).toBe(list);
        }).pipe(Effect.provide(makeSuggestionsLayer(list)));
    });
});
