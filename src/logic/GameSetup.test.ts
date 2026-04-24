import { describe, expect, test } from "vitest";
import { disambiguateName, toRoman } from "./GameSetup";

describe("toRoman", () => {
    test("small numbers", () => {
        expect(toRoman(1)).toBe("i");
        expect(toRoman(2)).toBe("ii");
        expect(toRoman(3)).toBe("iii");
        expect(toRoman(4)).toBe("iv");
        expect(toRoman(5)).toBe("v");
        expect(toRoman(9)).toBe("ix");
        expect(toRoman(10)).toBe("x");
        expect(toRoman(14)).toBe("xiv");
        expect(toRoman(40)).toBe("xl");
        expect(toRoman(99)).toBe("xcix");
    });
    test("zero and negatives return empty", () => {
        expect(toRoman(0)).toBe("");
        expect(toRoman(-5)).toBe("");
    });
});

describe("disambiguateName", () => {
    test("returns the proposed name when no collision", () => {
        expect(disambiguateName("Miss Scarlet", [])).toBe("Miss Scarlet");
        expect(disambiguateName("Miss Scarlet", ["Col. Mustard"])).toBe(
            "Miss Scarlet",
        );
    });

    test("single collision appends (ii)", () => {
        expect(
            disambiguateName("Miss Scarlet", ["Miss Scarlet"]),
        ).toBe("Miss Scarlet (ii)");
    });

    test("double collision escalates to (iii)", () => {
        expect(
            disambiguateName("Knife", ["Knife", "Knife (ii)"]),
        ).toBe("Knife (iii)");
    });

    test("skips already-taken suffix numbers", () => {
        // If "Knife" and "Knife (iii)" exist, the next free is (ii).
        expect(disambiguateName("Knife", ["Knife", "Knife (iii)"])).toBe(
            "Knife (ii)",
        );
    });

    test("trims whitespace on the proposed name", () => {
        expect(disambiguateName("  Knife  ", ["Knife"])).toBe("Knife (ii)");
    });

    test("empty proposed name stays empty", () => {
        expect(disambiguateName("", ["Knife"])).toBe("");
        expect(disambiguateName("   ", ["Knife"])).toBe("");
    });

    test("user-supplied parenthesised suffixes don't interfere", () => {
        // Someone named two cards "Knife (2)" and "Knife (alt)" — a new
        // "Knife" shouldn't accidentally match either; it gets (ii).
        expect(
            disambiguateName("Knife", [
                "Knife",
                "Knife (2)",
                "Knife (alt)",
            ]),
        ).toBe("Knife (ii)");
    });

    test("disambiguating against existing Roman-suffix clones", () => {
        // Adding another "Knife" when two already exist should pick (iv),
        // not (ii), because (ii) and (iii) are the existing clones.
        expect(
            disambiguateName("Knife", [
                "Knife",
                "Knife (ii)",
                "Knife (iii)",
            ]),
        ).toBe("Knife (iv)");
    });
});
