import { describe, expect, test } from "vitest";
import { isValidElement } from "react";
import { render } from "@testing-library/react";
import { N, Y } from "../../logic/Knowledge";
import type {
    CellDisplay,
    HypothesisStatus,
} from "../../logic/Hypothesis";
import {
    glyphKindFor,
    ProseChecklistIcon,
    renderGlyphNode,
} from "./CellGlyph";
import { CheckIcon, XIcon } from "./Icons";

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
    test("yes renders a CheckIcon element", () => {
        const node = renderGlyphNode("yes");
        expect(isValidElement(node)).toBe(true);
        expect(
            isValidElement(node) ? node.type : null,
        ).toBe(CheckIcon);
    });

    test("no renders an XIcon element", () => {
        const node = renderGlyphNode("no");
        expect(isValidElement(node)).toBe(true);
        expect(
            isValidElement(node) ? node.type : null,
        ).toBe(XIcon);
    });

    test("question renders as ?", () => {
        expect(renderGlyphNode("question")).toBe("?");
    });

    test("blank renders as null", () => {
        expect(renderGlyphNode("blank")).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// `<ProseChecklistIcon>` is the prose-context chip — the thing that goes
// inline in popover help text and (eventually) contradiction prose. The
// chip's tone (Y vs N) and its inner glyph (icon vs "?") are independent
// axes:
//
//   value="Y", isHypothesis=false → green chip with ✓
//   value="N", isHypothesis=false → red chip with ×
//   value="Y", isHypothesis=true  → green chip with "?"  (hypothetical Y)
//   value="N", isHypothesis=true  → red chip with "?"    (hypothetical N)
//
// All four combinations matter — the live grid uses the same convention
// for derived/hypothesis cells, where the tone marks "what value would
// this be if the hypothesis holds" and the "?" marks "but it's not
// confirmed yet."
// ---------------------------------------------------------------------------
describe("ProseChecklistIcon", () => {
    test("Y / not-hypothesis renders a green chip with a CheckIcon", () => {
        const { container } = render(<ProseChecklistIcon value={Y} />);
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-yes-bg/);
        expect(chip.className).toMatch(/text-yes/);
        expect(chip.querySelector("svg")).not.toBeNull();
        // Checkmark polyline (CheckIcon) — distinct from the X's two lines.
        expect(chip.querySelector("svg polyline")).not.toBeNull();
    });

    test("N / not-hypothesis renders a red chip with an XIcon", () => {
        const { container } = render(<ProseChecklistIcon value={N} />);
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-no-bg/);
        expect(chip.className).toMatch(/text-no/);
        // X icon: two crossed lines.
        expect(chip.querySelectorAll("svg line").length).toBe(2);
    });

    test("Y / isHypothesis renders a green chip with a '?' glyph (no icon)", () => {
        const { container } = render(
            <ProseChecklistIcon value={Y} isHypothesis />,
        );
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-yes-bg/);
        expect(chip.querySelector("svg")).toBeNull();
        expect(chip.textContent).toBe("?");
    });

    test("N / isHypothesis renders a red chip with a '?' glyph (no icon)", () => {
        const { container } = render(
            <ProseChecklistIcon value={N} isHypothesis />,
        );
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-no-bg/);
        expect(chip.querySelector("svg")).toBeNull();
        expect(chip.textContent).toBe("?");
    });

    test("chip is aria-hidden in all variants", () => {
        const { container } = render(<ProseChecklistIcon value={Y} />);
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.getAttribute("aria-hidden")).not.toBeNull();
    });

    test("Y / invertedStyle uses the dark Y bg with white text", () => {
        const { container } = render(
            <ProseChecklistIcon value={Y} invertedStyle />,
        );
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-yes\b/);
        expect(chip.className).toMatch(/text-white/);
        // The inverted variant must NOT also carry the light-bg
        // classes — that would compound and confuse the cascade.
        expect(chip.className).not.toMatch(/bg-yes-bg/);
    });

    test("N / invertedStyle uses the dark N bg with white text", () => {
        const { container } = render(
            <ProseChecklistIcon value={N} invertedStyle />,
        );
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-no\b/);
        expect(chip.className).toMatch(/text-white/);
        expect(chip.className).not.toMatch(/bg-no-bg/);
    });

    test("invertedStyle composes with isHypothesis (dark bg, '?' glyph)", () => {
        const { container } = render(
            <ProseChecklistIcon value={Y} invertedStyle isHypothesis />,
        );
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-yes\b/);
        expect(chip.className).toMatch(/text-white/);
        expect(chip.querySelector("svg")).toBeNull();
        expect(chip.textContent).toBe("?");
    });
});
