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

    test("hypothesis Y → 'derivedYes' (parens-wrapped check, post-?-removal)", () => {
        const display: CellDisplay = { tag: "hypothesis", value: Y };
        expect(glyphKindFor(display, { kind: "active", value: Y })).toBe(
            "derivedYes",
        );
    });

    test("derived N → 'derivedNo' (parens-wrapped X, post-?-removal)", () => {
        const display: CellDisplay = { tag: "derived", value: N };
        expect(glyphKindFor(display, { kind: "derived", value: N })).toBe(
            "derivedNo",
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

    test("derivedYes renders a parens-wrapped CheckIcon", () => {
        const { container } = render(<>{renderGlyphNode("derivedYes")}</>);
        // The wrapper holds "(", a CheckIcon SVG, and ")" — the bare
        // text content must include both parens, and the SVG must be
        // a CheckIcon (polyline points "20 6 9 17 4 12").
        expect(container.textContent).toBe("()");
        const svg = container.querySelector("svg");
        expect(svg).not.toBeNull();
        expect(svg?.querySelector("polyline")).not.toBeNull();
    });

    test("derivedNo renders a parens-wrapped XIcon", () => {
        const { container } = render(<>{renderGlyphNode("derivedNo")}</>);
        expect(container.textContent).toBe("()");
        const svg = container.querySelector("svg");
        expect(svg).not.toBeNull();
        // X icon: two crossed lines.
        expect(svg?.querySelectorAll("line").length).toBe(2);
    });

    test("blank renders as null", () => {
        expect(renderGlyphNode("blank")).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// `<ProseChecklistIcon>` is the prose-context chip. Three independent axes:
//
//   value: "Y" | "N"                — tone (green / red)
//   isHypothesis: boolean           — swaps the icon for "?", to
//                                     mark "this cell IS a hypothesis"
//   isHypothesisDependent: boolean  — wraps the icon in `(` `)`, to
//                                     mark "this cell's value follows
//                                     from a hypothesis on another"
//   invertedStyle: boolean          — dark fill + light glyph, no
//                                     border
//
// `isHypothesis` and `isHypothesisDependent` are mutually exclusive
// in practice; `isHypothesis` wins if both are passed.
// ---------------------------------------------------------------------------
describe("ProseChecklistIcon", () => {
    test("Y / default renders a green chip with a bare CheckIcon", () => {
        const { container } = render(<ProseChecklistIcon value={Y} />);
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-yes-bg/);
        expect(chip.className).toMatch(/text-yes/);
        expect(chip.querySelector("svg")).not.toBeNull();
        // Checkmark polyline — distinct from the X's two lines.
        expect(chip.querySelector("svg polyline")).not.toBeNull();
        // No parens / question mark around the icon in default rendering.
        expect(chip.textContent).toBe("");
    });

    test("N / default renders a red chip with a bare XIcon", () => {
        const { container } = render(<ProseChecklistIcon value={N} />);
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-no-bg/);
        expect(chip.className).toMatch(/text-no/);
        expect(chip.querySelectorAll("svg line").length).toBe(2);
        expect(chip.textContent).toBe("");
    });

    test("Y / isHypothesis renders a green chip with a '?' (no icon)", () => {
        const { container } = render(
            <ProseChecklistIcon value={Y} isHypothesis />,
        );
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-yes-bg/);
        expect(chip.querySelector("svg")).toBeNull();
        expect(chip.textContent).toBe("?");
    });

    test("N / isHypothesis renders a red chip with a '?' (no icon)", () => {
        const { container } = render(
            <ProseChecklistIcon value={N} isHypothesis />,
        );
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-no-bg/);
        expect(chip.querySelector("svg")).toBeNull();
        expect(chip.textContent).toBe("?");
    });

    test("Y / isHypothesisDependent renders a green chip with a parens-wrapped CheckIcon", () => {
        const { container } = render(
            <ProseChecklistIcon value={Y} isHypothesisDependent />,
        );
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-yes-bg/);
        // The icon is still there — just wrapped in parens.
        expect(chip.querySelector("svg polyline")).not.toBeNull();
        expect(chip.textContent).toBe("()");
    });

    test("N / isHypothesisDependent renders a red chip with a parens-wrapped XIcon", () => {
        const { container } = render(
            <ProseChecklistIcon value={N} isHypothesisDependent />,
        );
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-no-bg/);
        expect(chip.querySelectorAll("svg line").length).toBe(2);
        expect(chip.textContent).toBe("()");
    });

    test("isHypothesis wins when both flags are passed (defensive)", () => {
        const { container } = render(
            <ProseChecklistIcon
                value={Y}
                isHypothesis
                isHypothesisDependent
            />,
        );
        const chip = container.firstElementChild as HTMLElement;
        // "?" rendered, no SVG, no parens.
        expect(chip.querySelector("svg")).toBeNull();
        expect(chip.textContent).toBe("?");
    });

    test("chip is aria-hidden in all variants", () => {
        const { container } = render(<ProseChecklistIcon value={Y} />);
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.getAttribute("aria-hidden")).not.toBeNull();
    });

    test("Y / invertedStyle uses the dark Y bg with white text and no border", () => {
        const { container } = render(
            <ProseChecklistIcon value={Y} invertedStyle />,
        );
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-yes\b/);
        expect(chip.className).toMatch(/text-white/);
        // The inverted variant must NOT also carry the light-bg
        // classes — that would compound and confuse the cascade.
        expect(chip.className).not.toMatch(/bg-yes-bg/);
        // Border dropped because the dark fill already separates the
        // chip from its surroundings.
        expect(chip.className).not.toMatch(/\bborder\b/);
    });

    test("N / invertedStyle uses the dark N bg with white text and no border", () => {
        const { container } = render(
            <ProseChecklistIcon value={N} invertedStyle />,
        );
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-no\b/);
        expect(chip.className).toMatch(/text-white/);
        expect(chip.className).not.toMatch(/bg-no-bg/);
        expect(chip.className).not.toMatch(/\bborder\b/);
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

    test("invertedStyle composes with isHypothesisDependent (dark bg, parens-wrapped icon)", () => {
        const { container } = render(
            <ProseChecklistIcon
                value={Y}
                invertedStyle
                isHypothesisDependent
            />,
        );
        const chip = container.firstElementChild as HTMLElement;
        expect(chip.className).toMatch(/bg-yes\b/);
        expect(chip.className).toMatch(/text-white/);
        expect(chip.querySelector("svg polyline")).not.toBeNull();
        expect(chip.textContent).toBe("()");
    });
});
