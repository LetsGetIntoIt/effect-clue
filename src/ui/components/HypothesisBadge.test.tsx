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

    test("renders the X glyph when directly contradicted", () => {
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
        expect(findBadge(container).getAttribute("data-glyph")).toBe("x");
    });

    test("renders the X glyph when jointly conflicting", () => {
        const { container } = render(
            <HypothesisBadge
                value={Y}
                status={{ kind: "jointlyConflicts", value: Y }}
            />,
        );
        expect(findBadge(container).getAttribute("data-glyph")).toBe("x");
    });

    test("rejected badges tone to text-danger", () => {
        const { container: directly } = render(
            <HypothesisBadge
                value={Y}
                status={{
                    kind: "directlyContradicted",
                    hypothesis: Y,
                    real: N,
                }}
            />,
        );
        expect(findBadge(directly).getAttribute("class") ?? "").toContain(
            "text-danger",
        );

        const { container: joint } = render(
            <HypothesisBadge
                value={N}
                status={{ kind: "jointlyConflicts", value: N }}
            />,
        );
        expect(findBadge(joint).getAttribute("class") ?? "").toContain(
            "text-danger",
        );
    });

    test("rejected badges with `animated` include motion-safe:animate-pulse", () => {
        const { container: directly } = render(
            <HypothesisBadge
                value={Y}
                status={{
                    kind: "directlyContradicted",
                    hypothesis: Y,
                    real: N,
                }}
                animated
            />,
        );
        expect(findBadge(directly).getAttribute("class") ?? "").toContain(
            "motion-safe:animate-pulse",
        );

        const { container: joint } = render(
            <HypothesisBadge
                value={N}
                status={{ kind: "jointlyConflicts", value: N }}
                animated
            />,
        );
        expect(findBadge(joint).getAttribute("class") ?? "").toContain(
            "motion-safe:animate-pulse",
        );
    });

    test("rejected badges WITHOUT `animated` are static (no animation class)", () => {
        const { container: directly } = render(
            <HypothesisBadge
                value={Y}
                status={{
                    kind: "directlyContradicted",
                    hypothesis: Y,
                    real: N,
                }}
            />,
        );
        expect(findBadge(directly).getAttribute("class") ?? "").not.toContain(
            "animate-",
        );

        const { container: joint } = render(
            <HypothesisBadge
                value={N}
                status={{ kind: "jointlyConflicts", value: N }}
                animated={false}
            />,
        );
        expect(findBadge(joint).getAttribute("class") ?? "").not.toContain(
            "animate-",
        );
    });

    test("non-rejected badges never animate, even with `animated` true", () => {
        const { container: active } = render(
            <HypothesisBadge
                value={Y}
                status={{ kind: "active", value: Y }}
                animated
            />,
        );
        expect(findBadge(active).getAttribute("class") ?? "").not.toContain(
            "animate-",
        );

        const { container: confirmed } = render(
            <HypothesisBadge
                value={Y}
                status={{ kind: "confirmed", value: Y }}
                animated
            />,
        );
        expect(findBadge(confirmed).getAttribute("class") ?? "").not.toContain(
            "animate-",
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
