import { it } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, HashMap } from "effect";
import { CaseFileOwner, Player, PlayerOwner } from "../GameObjects";
import { CLASSIC_SETUP_3P } from "../GameSetup";
import {
    Cell,
    emptyKnowledge,
    setCell,
    setHandSize,
    Y,
} from "../Knowledge";
import { cardByName } from "../test-utils/CardByName";
import {
    getKnowledge,
    KnowledgeService,
    makeKnowledgeLayer,
} from "./KnowledgeService";

const KNIFE = cardByName(CLASSIC_SETUP_3P, "Knife");
const A = Player("Anisha");

describe("KnowledgeService", () => {
    const emptyLayer = makeKnowledgeLayer(emptyKnowledge);

    it.effect("yields the provided Knowledge via `getKnowledge`", () =>
        Effect.gen(function* () {
            const k = yield* getKnowledge;
            expect(k).toBe(emptyKnowledge);
        }).pipe(Effect.provide(emptyLayer)),
    );

    it.effect("empty-knowledge layer has no checklist entries", () =>
        Effect.gen(function* () {
            const k = yield* getKnowledge;
            expect(HashMap.size(k.checklist)).toBe(0);
            expect(HashMap.size(k.handSizes)).toBe(0);
        }).pipe(Effect.provide(emptyLayer)),
    );

    it.effect("a populated-knowledge layer exposes its checklist entries", () => {
        let k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y);
        k = setHandSize(k, CaseFileOwner(), 3);
        return Effect.gen(function* () {
            const out = yield* getKnowledge;
            expect(HashMap.size(out.checklist)).toBe(1);
            expect(HashMap.size(out.handSizes)).toBe(1);
        }).pipe(Effect.provide(makeKnowledgeLayer(k)));
    });

    it.effect("providing a different layer swaps the exposed snapshot", () => {
        const populated = setCell(
            emptyKnowledge,
            Cell(PlayerOwner(A), KNIFE),
            Y,
        );
        return Effect.gen(function* () {
            const k = yield* getKnowledge;
            expect(k).toBe(populated);
            expect(k).not.toBe(emptyKnowledge);
        }).pipe(Effect.provide(makeKnowledgeLayer(populated)));
    });

    it.effect("exposes the same data through KnowledgeService directly", () =>
        Effect.gen(function* () {
            const svc = yield* KnowledgeService;
            expect(svc.get()).toBe(emptyKnowledge);
        }).pipe(Effect.provide(emptyLayer)),
    );
});
