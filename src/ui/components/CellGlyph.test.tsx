import { describe, expect, test } from "vitest";
import { N, Y } from "../../logic/Knowledge";
import type {
    CellDisplay,
    HypothesisStatus,
} from "../../logic/Hypothesis";
import { glyphKindFor, renderGlyphNode } from "./CellGlyph";

describe("glyphKindFor", () => {
    test("real Y → 'yes'", () => {
        const display: CellDisplay = { tag: "real", value: Y };
        expect(glyphKindFor(display, { kind: "off" })).toBe("yes");
    });

    test("real N → 'no'", () => {
        const display: CellDisplay = { tag: "real", value: N };
        expect(glyphKindFor(display, { kind: "off" })).toBe("no");
    });

    test("hypothesis → 'question'", () => {
        const display: CellDisplay = { tag: "hypothesis", value: Y };
        expect(glyphKindFor(display, { kind: "active", value: Y })).toBe(
            "question",
        );
    });

    test("derived → 'question'", () => {
        const display: CellDisplay = { tag: "derived", value: N };
        expect(glyphKindFor(display, { kind: "derived", value: N })).toBe(
            "question",
        );
    });

    test("blank → 'blank'", () => {
        expect(glyphKindFor({ tag: "blank" }, { kind: "off" })).toBe("blank");
    });

    test("directlyContradicted shows the deduced (real) Y, NOT an alert", () => {
        // The hypothesis is N but the real-only deduction proved Y. Center
        // glyph should show the real Y; the conflict signal lives in the
        // top-right `HypothesisBadge`, which renders X + bounce.
        const display: CellDisplay = { tag: "real", value: Y };
        const status: HypothesisStatus = {
            kind: "directlyContradicted",
            hypothesis: N,
            real: Y,
        };
        expect(glyphKindFor(display, status)).toBe("yes");
    });

    test("jointlyConflicts on a still-blank cell falls through to 'blank'", () => {
        // Joint deduction failed, so the checklist falls back to real-only
        // and this cell has no value yet. Center glyph stays blank; the
        // hypothesis badge carries the X + bounce.
        const display: CellDisplay = { tag: "blank" };
        const status: HypothesisStatus = {
            kind: "jointlyConflicts",
            value: Y,
        };
        expect(glyphKindFor(display, status)).toBe("blank");
    });
});

describe("renderGlyphNode", () => {
    test("yes renders as ✓", () => {
        expect(renderGlyphNode("yes")).toBe("✓");
    });

    test("no renders as ·", () => {
        expect(renderGlyphNode("no")).toBe("·");
    });

    test("question renders as ?", () => {
        expect(renderGlyphNode("question")).toBe("?");
    });

    test("blank renders as null", () => {
        expect(renderGlyphNode("blank")).toBeNull();
    });
});
