import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { N, Y } from "../../logic/Knowledge";
import { HypothesisBadge } from "./HypothesisBadge";

const findBadge = (container: HTMLElement) =>
    container.querySelector("svg[data-glyph]") as SVGElement;

describe("HypothesisBadge", () => {
    test("renders the check glyph when the hypothesis is confirmed", () => {
        const { container } = render(
            <HypothesisBadge
                value={Y}
                status={{ kind: "confirmed", value: Y }}
            />,
        );
        const badge = findBadge(container);
        expect(badge.getAttribute("data-glyph")).toBe("check");
    });

    test("renders the question glyph for the active state", () => {
        const { container } = render(
            <HypothesisBadge
                value={Y}
                status={{ kind: "active", value: Y }}
            />,
        );
        expect(findBadge(container).getAttribute("data-glyph")).toBe(
            "question",
        );
    });

    test("renders the question glyph when directly contradicted", () => {
        const { container } = render(
            <HypothesisBadge
                value={Y}
                status={{
                    kind: "directlyContradicted",
                    hypothesis: Y,
                    real: N,
                }}
            />,
        );
        expect(findBadge(container).getAttribute("data-glyph")).toBe(
            "question",
        );
    });

    test("renders the question glyph when jointly conflicting", () => {
        const { container } = render(
            <HypothesisBadge
                value={Y}
                status={{ kind: "jointlyConflicts", value: Y }}
            />,
        );
        expect(findBadge(container).getAttribute("data-glyph")).toBe(
            "question",
        );
    });

    test("tones the badge by the hypothesis value (Y → text-yes)", () => {
        const { container } = render(
            <HypothesisBadge
                value={Y}
                status={{ kind: "confirmed", value: Y }}
            />,
        );
        expect(findBadge(container).getAttribute("class")).toContain(
            "text-yes",
        );
    });

    test("tones the badge by the hypothesis value (N → text-no)", () => {
        const { container } = render(
            <HypothesisBadge
                value={N}
                status={{ kind: "confirmed", value: N }}
            />,
        );
        expect(findBadge(container).getAttribute("class")).toContain(
            "text-no",
        );
    });
});
