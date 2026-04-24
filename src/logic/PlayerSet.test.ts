import { describe, expect, test } from "vitest";
import { Equal } from "effect";
import { Player } from "./GameObjects";
import { PlayerSet } from "./PlayerSet";

const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

describe("PlayerSet", () => {
    test("preserves the players array", () => {
        const ps = PlayerSet({ players: [A, B, C] });
        expect(ps.players).toEqual([A, B, C]);
    });

    test("preserves order", () => {
        const ps = PlayerSet({ players: [C, A, B] });
        expect(ps.players).toEqual([C, A, B]);
    });

    test("accepts an empty roster", () => {
        const ps = PlayerSet({ players: [] });
        expect(ps.players).toEqual([]);
    });

    test("two PlayerSets with the same players in the same order are Equal.equals", () => {
        const a = PlayerSet({ players: [A, B, C] });
        const b = PlayerSet({ players: [A, B, C] });
        expect(Equal.equals(a, b)).toBe(true);
    });

    test("reordering players breaks equality (order is semantic — seat order)", () => {
        const a = PlayerSet({ players: [A, B, C] });
        const b = PlayerSet({ players: [C, B, A] });
        expect(Equal.equals(a, b)).toBe(false);
    });

    test("different rosters are not equal", () => {
        const a = PlayerSet({ players: [A, B] });
        const b = PlayerSet({ players: [A, B, C] });
        expect(Equal.equals(a, b)).toBe(false);
    });
});
