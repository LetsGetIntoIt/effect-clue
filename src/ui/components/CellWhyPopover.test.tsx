import { render, screen } from "@testing-library/react";
import { HashMap } from "effect";
import { describe, expect, test, vi } from "vitest";

import { Player, PlayerOwner, CaseFileOwner } from "../../logic/GameObjects";
import { CLASSIC_SETUP_3P, allCardIds } from "../../logic/GameSetup";
import { Cell, Y, N } from "../../logic/Knowledge";
import type {
    CellDisplay,
    HypothesisMap,
    HypothesisStatus,
    HypothesisValue,
} from "../../logic/Hypothesis";
import { CellWhyPopover } from "./CellWhyPopover";

// Same translation mock pattern as Checklist.deduce.test.tsx:
// `t(key, values)` returns `"key:{json}"` when given values so the
// test can assert on both the key and the substituted values, and
// returns the raw key otherwise.
vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    return {
        useTranslations: () => t,
    };
});

const setup = CLASSIC_SETUP_3P;
const cards = allCardIds(setup);
const cardA = cards[0]!;
const cardB = cards[1]!;
const player1 = setup.players[0]!;
const ownerP1 = PlayerOwner(player1);
const cellP1A = Cell(ownerP1, cardA);

const noHypotheses: HypothesisMap = HashMap.empty();

const baseProps = {
    cell: cellP1A,
    setup,
    hypotheses: noHypotheses,
    onHypothesisChange: vi.fn(),
    whyText: undefined,
    footnoteNumbers: [] as ReadonlyArray<number>,
    hypothesisValue: undefined as HypothesisValue | undefined,
    display: { tag: "blank" } as CellDisplay,
    status: { kind: "off" } as HypothesisStatus,
};

describe("CellWhyPopover - section visibility", () => {
    test("blank cell with no footnote, no hypothesis: only Hypothesis section + emptyHint", () => {
        render(<CellWhyPopover {...baseProps} />);

        // Hypothesis heading + empty hint + helpText all render.
        expect(screen.getByText("hypothesisLabel")).toBeInTheDocument();
        expect(screen.getByText("emptyHint")).toBeInTheDocument();
        expect(screen.getByText("helpText")).toBeInTheDocument();

        // Deductions and Leads headings are hidden.
        expect(screen.queryByText("deductionsLabel")).toBeNull();
        expect(screen.queryByText("leadsLabel")).toBeNull();
    });

    test("hides Deductions and Leads when no content; toggle alone shows", () => {
        render(<CellWhyPopover {...baseProps} hypothesisValue={undefined} />);
        // No long-form status box for either.
        expect(screen.queryByText("statusConfirmed")).toBeNull();
        expect(screen.queryByText("statusDirectlyContradicted")).toBeNull();
        expect(screen.queryByText("statusJointlyConflicts")).toBeNull();
    });
});

describe("CellWhyPopover - Deductions section", () => {
    test("renders with whyText and a Y-tinted glyph box for a real Y cell", () => {
        const { container } = render(
            <CellWhyPopover
                {...baseProps}
                whyText="why-line-1\nwhy-line-2"
                display={{ tag: "real", value: Y }}
                status={{ kind: "off" }}
            />,
        );
        expect(screen.getByText("deductionsLabel")).toBeInTheDocument();
        // Whitespace-pre-line so the rendered text contains both lines.
        expect(screen.getByText(/why-line-1/)).toBeInTheDocument();

        const glyphBox = container.querySelector('[data-glyph="yes"]');
        expect(glyphBox).not.toBeNull();
        expect(glyphBox?.className).toMatch(/bg-yes-bg/);
        // Border-border (cell-style box).
        expect(glyphBox?.className).toMatch(/border-border/);
        // The Y glyph's text content is "✓".
        expect(glyphBox?.textContent).toBe("✓");
    });

    test("renders with N-tinted glyph box for a real N cell", () => {
        const { container } = render(
            <CellWhyPopover
                {...baseProps}
                whyText="reason-line"
                display={{ tag: "real", value: N }}
                status={{ kind: "off" }}
            />,
        );
        const glyphBox = container.querySelector('[data-glyph="no"]');
        expect(glyphBox).not.toBeNull();
        expect(glyphBox?.className).toMatch(/bg-no-bg/);
        expect(glyphBox?.textContent).toBe("·");
    });

    test("derived cell: '?' glyph on Y tone, statusDerivedSingular text, no statusBox in hypothesis section", () => {
        // Build a hypothesis map with one entry so the singular path is
        // taken: "This value follows from your active hypothesis (X)."
        const otherCell = Cell(PlayerOwner(player1), cardB);
        const hypotheses = HashMap.set(
            HashMap.empty<typeof otherCell, HypothesisValue>(),
            otherCell,
            "Y",
        );
        const { container } = render(
            <CellWhyPopover
                {...baseProps}
                hypotheses={hypotheses}
                display={{ tag: "derived", value: Y }}
                status={{ kind: "derived", value: Y }}
            />,
        );
        // Deductions heading shows.
        expect(screen.getByText("deductionsLabel")).toBeInTheDocument();
        // Question-mark glyph on Y-tone tile.
        const glyphBox = container.querySelector('[data-glyph="question"]');
        expect(glyphBox).not.toBeNull();
        expect(glyphBox?.className).toMatch(/bg-yes-bg/);
        expect(glyphBox?.textContent).toBe("?");

        // Singular "this follows from" line carries both the cell's
        // derived value (so "?" badges aren't ambiguous) and the
        // hypothesis label.
        const derivedLine = screen.getByText(/^statusDerivedSingular:/);
        expect(derivedLine.textContent).toContain("= Y");
        expect(derivedLine.textContent).toContain('"value":"Y"');

        // The plural copy must NOT render in the singular case.
        expect(screen.queryByText(/^statusDerived:/)).toBeNull();

        // No long-form statusBox in the Hypothesis section for derived.
        expect(screen.queryByText("statusConfirmed")).toBeNull();
    });

    test("derived cell with two hypotheses: plural copy + bulleted list inside Deductions", () => {
        const cellH1 = Cell(PlayerOwner(player1), cardA);
        const cellH2 = Cell(PlayerOwner(setup.players[1]!), cardB);
        const hypotheses = HashMap.fromIterable<typeof cellH1, HypothesisValue>([
            [cellH1, "Y"],
            [cellH2, "N"],
        ]);
        const { container } = render(
            <CellWhyPopover
                {...baseProps}
                hypotheses={hypotheses}
                cell={Cell(CaseFileOwner(), cardA)}
                display={{ tag: "derived", value: N }}
                status={{ kind: "derived", value: N }}
            />,
        );
        expect(screen.getByText("deductionsLabel")).toBeInTheDocument();
        // Plural derived heading line, carrying the cell's derived
        // value so the "?" badge isn't ambiguous on its own.
        const derivedLine = screen.getByText(/^statusDerived:/);
        expect(derivedLine.textContent).toContain('"value":"N"');
        // Bulleted list with two items.
        const items = container.querySelectorAll("ul > li");
        expect(items.length).toBe(2);
    });
});

describe("CellWhyPopover - Leads section", () => {
    test("renders chip + footnote text for non-empty footnoteNumbers", () => {
        const { container } = render(
            <CellWhyPopover {...baseProps} footnoteNumbers={[2, 3]} />,
        );
        expect(screen.getByText("leadsLabel")).toBeInTheDocument();

        // Chip styling — accent border and tabular-nums, matching the
        // top-left in-cell chip exactly.
        const chip = Array.from(
            container.querySelectorAll<HTMLElement>("span"),
        ).find(s =>
            s.className.includes("border-accent/40") &&
            s.className.includes("text-accent") &&
            s.className.includes("tabular-nums"),
        );
        expect(chip).toBeDefined();
        expect(chip?.textContent).toContain("2,3");
        // Lightbulb icon nested inside the chip.
        expect(chip?.querySelector("svg")).not.toBeNull();

        // Footnote line carries the formatted "#2, #3" labels.
        const footnoteLine = screen.getByText(/^footnoteLine:/);
        expect(footnoteLine.textContent).toContain("#2, #3");
    });

    test("hides Leads section when footnoteNumbers is empty", () => {
        render(<CellWhyPopover {...baseProps} footnoteNumbers={[]} />);
        expect(screen.queryByText("leadsLabel")).toBeNull();
    });
});

describe("CellWhyPopover - Hypothesis section help text", () => {
    test("hypothesisValue undefined: shows the unchanged helpText", () => {
        render(<CellWhyPopover {...baseProps} />);
        expect(screen.getByText("helpText")).toBeInTheDocument();
        // No badge SVG inside the Hypothesis section's help row.
        const helpEl = screen.getByText("helpText");
        expect(helpEl.querySelector("svg")).toBeNull();
    });

    test("active Y hypothesis: short selectedHelpActive line + hypothesis badge, no statusBox", () => {
        const { container } = render(
            <CellWhyPopover
                {...baseProps}
                hypothesisValue="Y"
                status={{ kind: "active", value: "Y" }}
                display={{ tag: "hypothesis", value: "Y" }}
            />,
        );
        const line = screen.getByText(/^selectedHelpActive:/);
        expect(line.textContent).toContain('"value":"Y"');

        // Badge SVG renders next to the line.
        const badgeSvg = container.querySelector('svg[data-glyph]');
        expect(badgeSvg).not.toBeNull();

        // No long-form status panel for "active".
        expect(screen.queryByText("statusConfirmed")).toBeNull();
        expect(screen.queryByText("statusDirectlyContradicted")).toBeNull();
        expect(screen.queryByText("statusJointlyConflicts")).toBeNull();
    });

    test("confirmed: short selectedHelpConfirmed + long statusConfirmed box", () => {
        render(
            <CellWhyPopover
                {...baseProps}
                hypothesisValue="Y"
                status={{ kind: "confirmed", value: "Y" }}
                display={{ tag: "real", value: Y }}
            />,
        );
        expect(screen.getByText(/^selectedHelpConfirmed:/)).toBeInTheDocument();
        expect(screen.getByText("statusConfirmed")).toBeInTheDocument();
    });

    test("directly contradicted: short selectedHelpContradicted + long statusDirectlyContradicted box", () => {
        render(
            <CellWhyPopover
                {...baseProps}
                hypothesisValue="N"
                status={{
                    kind: "directlyContradicted",
                    hypothesis: "N",
                    real: Y,
                }}
                display={{ tag: "real", value: Y }}
            />,
        );
        expect(screen.getByText(/^selectedHelpContradicted:/)).toBeInTheDocument();
        expect(screen.getByText("statusDirectlyContradicted")).toBeInTheDocument();
    });

    test("jointly conflicts: short selectedHelpJointlyConflicts + long statusJointlyConflicts box with bullets", () => {
        const otherCell = Cell(PlayerOwner(setup.players[1]!), cardB);
        const hypotheses = HashMap.set(
            HashMap.empty<typeof otherCell, HypothesisValue>(),
            otherCell,
            "Y",
        );
        const { container } = render(
            <CellWhyPopover
                {...baseProps}
                hypothesisValue="Y"
                hypotheses={hypotheses}
                status={{ kind: "jointlyConflicts", value: "Y" }}
                display={{ tag: "hypothesis", value: "Y" }}
            />,
        );
        expect(
            screen.getByText(/^selectedHelpJointlyConflicts:/),
        ).toBeInTheDocument();
        expect(screen.getByText("statusJointlyConflicts")).toBeInTheDocument();
        // Bulleted list inside the danger box (alongside the conflict
        // headline). At least one li for the other hypothesis.
        const items = container.querySelectorAll("ul > li");
        expect(items.length).toBeGreaterThanOrEqual(1);
    });

    test("regression: hypothesisValue cleared with no chain/footnote collapses to emptyHint", () => {
        const { rerender } = render(
            <CellWhyPopover
                {...baseProps}
                hypothesisValue="Y"
                status={{ kind: "active", value: "Y" }}
                display={{ tag: "hypothesis", value: "Y" }}
            />,
        );
        // emptyHint hidden while a hypothesis is active.
        expect(screen.queryByText("emptyHint")).toBeNull();

        rerender(
            <CellWhyPopover
                {...baseProps}
                hypothesisValue={undefined}
                status={{ kind: "off" }}
                display={{ tag: "blank" }}
            />,
        );
        // emptyHint reappears once the toggle is off and there's no
        // chain or footnote.
        expect(screen.getByText("emptyHint")).toBeInTheDocument();
    });
});

describe("CellWhyPopover - cell-heading line", () => {
    test("renders the owner / card heading line", () => {
        render(<CellWhyPopover {...baseProps} />);
        const heading = screen.getByText(/^cellHeading:/);
        // Player(...) is a Brand.nominal helper — passes strings through.
        expect(heading.textContent).toContain(`"owner":"${String(player1)}"`);
    });
});

// `Player` is imported above to keep the symbol in scope when readers
// inspect the test.
void Player;
