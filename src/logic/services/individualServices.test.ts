import { it } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Context, Effect, HashMap, Layer } from "effect";
import { CardSet } from "../CardSet";
import { CaseFileOwner, Player, PlayerOwner } from "../GameObjects";
import { CLASSIC_SETUP_3P } from "../GameSetup";
import {
    Cell,
    emptyKnowledge,
    Knowledge,
    setCell,
    setHandSize,
    Y,
} from "../Knowledge";
import { PlayerSet } from "../PlayerSet";
import { Accusation, newAccusationId } from "../Accusation";
import { newSuggestionId, Suggestion } from "../Suggestion";
import { cardByName } from "../test-utils/CardByName";
import {
    AccusationsService,
    getAccusations,
    makeAccusationsLayer,
} from "./AccusationsService";
import {
    CardSetService,
    getCardSet,
    makeCardSetLayer,
} from "./CardSetService";
import {
    getKnowledge,
    KnowledgeService,
    makeKnowledgeLayer,
} from "./KnowledgeService";
import {
    getPlayerSet,
    makePlayerSetLayer,
    PlayerSetService,
} from "./PlayerSetService";
import {
    getSuggestions,
    makeSuggestionsLayer,
    SuggestionsService,
} from "./SuggestionsService";

// -----------------------------------------------------------------------
// The five services here are thin read-only accessors over a static
// snapshot. They share one contract: provide a layer with value V,
// `yield* getter` returns V; alt layer with value V', `yield* getter`
// returns V'; the service-tag form returns the same value via `.get()`.
//
// Rather than five near-identical files, we run that contract once
// per service via `runAccessorServiceContract`. Each call captures
// its own `R, T` so types unify per service. Composition of the
// services (via `makeSetupLayer` / `makeClueLayer`) is covered
// separately in `services.test.ts`.
// -----------------------------------------------------------------------

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const MUSTARD = cardByName(setup, "Col. Mustard");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");

const runAccessorServiceContract = <R, T>(
    name: string,
    classicLayer: Layer.Layer<R>,
    classicValue: T,
    altLayer: Layer.Layer<R>,
    altValue: T,
    getter: Effect.Effect<T, never, R>,
    serviceTag: Context.Service<R, { readonly get: () => T }>,
    assertProperty: (v: T) => void,
) => {
    describe(name, () => {
        it.effect("yields the provided snapshot via the getter", () =>
            Effect.gen(function* () {
                const v = yield* getter;
                expect(v).toBe(classicValue);
            }).pipe(Effect.provide(classicLayer)),
        );

        it.effect("exposes the per-service shape on the returned snapshot", () =>
            Effect.gen(function* () {
                const v = yield* getter;
                assertProperty(v);
            }).pipe(Effect.provide(classicLayer)),
        );

        it.effect("returns the same reference on every `yield*`", () =>
            Effect.gen(function* () {
                const a = yield* getter;
                const b = yield* getter;
                expect(a).toBe(b);
            }).pipe(Effect.provide(classicLayer)),
        );

        it.effect("a different layer provides a different snapshot", () =>
            Effect.gen(function* () {
                const v = yield* getter;
                expect(v).toBe(altValue);
                expect(v).not.toBe(classicValue);
            }).pipe(Effect.provide(altLayer)),
        );

        it.effect("yields the same value through the service tag directly", () =>
            Effect.gen(function* () {
                const svc = yield* serviceTag;
                expect(svc.get()).toBe(classicValue);
            }).pipe(Effect.provide(classicLayer)),
        );
    });
};

// ----- CardSetService ---------------------------------------------------
const emptyCardSet = CardSet({ categories: [] });
runAccessorServiceContract<CardSetService, CardSet>(
    "CardSetService",
    makeCardSetLayer(setup.cardSet),
    setup.cardSet,
    makeCardSetLayer(emptyCardSet),
    emptyCardSet,
    getCardSet,
    CardSetService,
    cs => {
        expect(cs.categories.map(c => c.name)).toEqual([
            "Suspect",
            "Weapon",
            "Room",
        ]);
    },
);

// ----- PlayerSetService -------------------------------------------------
const altPlayers = PlayerSet({ players: [Player("Anisha"), Player("Bob")] });
runAccessorServiceContract<PlayerSetService, PlayerSet>(
    "PlayerSetService",
    makePlayerSetLayer(setup.playerSet),
    setup.playerSet,
    makePlayerSetLayer(altPlayers),
    altPlayers,
    getPlayerSet,
    PlayerSetService,
    ps => {
        expect(ps.players).toBe(setup.playerSet.players);
    },
);

// ----- KnowledgeService -------------------------------------------------
const populatedKnowledge: Knowledge = setHandSize(
    setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y),
    CaseFileOwner(),
    3,
);
runAccessorServiceContract<KnowledgeService, Knowledge>(
    "KnowledgeService",
    makeKnowledgeLayer(emptyKnowledge),
    emptyKnowledge,
    makeKnowledgeLayer(populatedKnowledge),
    populatedKnowledge,
    getKnowledge,
    KnowledgeService,
    k => {
        expect(HashMap.size(k.checklist)).toBe(0);
        expect(HashMap.size(k.handSizes)).toBe(0);
    },
);

// ----- AccusationsService -----------------------------------------------
const makeAccusation = (accuser = A) =>
    Accusation({
        id: newAccusationId(),
        accuser,
        cards: [MUSTARD, KNIFE, KITCHEN],
    });
const classicAccusations: ReadonlyArray<Accusation> = [
    makeAccusation(A),
    makeAccusation(B),
];
const altAccusations: ReadonlyArray<Accusation> = [makeAccusation(A)];
runAccessorServiceContract<AccusationsService, ReadonlyArray<Accusation>>(
    "AccusationsService",
    makeAccusationsLayer(classicAccusations),
    classicAccusations,
    makeAccusationsLayer(altAccusations),
    altAccusations,
    getAccusations,
    AccusationsService,
    list => {
        expect(list).toHaveLength(2);
        expect(list[0]?.accuser).toBe(A);
        expect(list[1]?.accuser).toBe(B);
    },
);

// ----- SuggestionsService -----------------------------------------------
const makeSuggestion = (suggester = A) =>
    Suggestion({
        id: newSuggestionId(),
        suggester,
        cards: [MUSTARD, KNIFE, KITCHEN],
        nonRefuters: [],
    });
const classicSuggestions: ReadonlyArray<Suggestion> = [
    makeSuggestion(A),
    makeSuggestion(B),
];
const altSuggestions: ReadonlyArray<Suggestion> = [makeSuggestion(A)];
runAccessorServiceContract<SuggestionsService, ReadonlyArray<Suggestion>>(
    "SuggestionsService",
    makeSuggestionsLayer(classicSuggestions),
    classicSuggestions,
    makeSuggestionsLayer(altSuggestions),
    altSuggestions,
    getSuggestions,
    SuggestionsService,
    list => {
        expect(list).toHaveLength(2);
        expect(list[0]?.suggester).toBe(A);
        expect(list[1]?.suggester).toBe(B);
    },
);
