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
// returns the raw key otherwise. `t.rich` invokes each callback chunk
// (e.g. the `chip` chunk that renders `<ProseChecklistIcon>`) so the
// rendered tree includes the chip alongside the key.
vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    (t as unknown as { rich: unknown }).rich = (
        key: string,
        values?: Record<string, unknown>,
    ): unknown => {
        if (values === undefined) return key;
        const out: Array<unknown> = [`${key}:`];
        for (const [chunkName, val] of Object.entries(values)) {
            if (typeof val === "function") {
                out.push((val as () => unknown)());
            } else {
                out.push(`[${chunkName}=${String(val)}]`);
            }
        }
        return out;
    };
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
        // Y glyph is a CheckIcon SVG (post-M4 icon swap).
        expect(glyphBox?.querySelector("svg")).not.toBeNull();
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
        // N glyph is an XIcon SVG (post-M4 icon swap).
        expect(glyphBox?.querySelector("svg")).not.toBeNull();
    });

    test("derived cell, one hypothesis: singular preamble + chain text from whyText, no bullet list", () => {
        // Build a hypothesis map with one entry so the singular
        // preamble fires: "Based on your active hypothesis:" followed
        // by the chain text (computed externally from joint
        // provenance and passed in as `whyText`).
        const otherCell = Cell(PlayerOwner(player1), cardB);
        const hypotheses = HashMap.set(
            HashMap.empty<typeof otherCell, HypothesisValue>(),
            otherCell,
            "Y",
        );
        const fakeChain =
            "1. Given: You marked that Anisha owns Miss Scarlet.\n2. Card ownership: Miss Scarlet is already owned by someone else, so Bob doesn't own it.";
        const { container } = render(
            <CellWhyPopover
                {...baseProps}
                hypotheses={hypotheses}
                display={{ tag: "derived", value: Y }}
                status={{ kind: "derived", value: Y }}
                whyText={fakeChain}
            />,
        );
        // Deductions heading shows.
        expect(screen.getByText("deductionsLabel")).toBeInTheDocument();
        // Y-tone tile renders the parens-wrapped CheckIcon.
        const glyphBox = container.querySelector('[data-glyph="derivedYes"]');
        expect(glyphBox).not.toBeNull();
        expect(glyphBox?.className).toMatch(/bg-yes-bg/);
        expect(glyphBox?.textContent).toBe("()");
        expect(glyphBox?.querySelector("svg polyline")).not.toBeNull();

        // Singular preamble appears (mock returns bare key for plain
        // `t(...)` calls).
        expect(
            screen.getByText("statusDerivedSingular"),
        ).toBeInTheDocument();
        // The plural preamble does NOT render in the singular case.
        expect(screen.queryByText("statusDerived")).toBeNull();
        // Chain text (passed via whyText prop) renders below the
        // preamble in a `whitespace-pre-line` block.
        const chainEl = Array.from(
            container.querySelectorAll(".whitespace-pre-line"),
        ).find(el => (el.textContent ?? "").includes("Card ownership"));
        expect(chainEl).toBeDefined();
        expect(chainEl?.textContent ?? "").toContain(
            "You marked that Anisha owns Miss Scarlet",
        );
        // No hypothesis bullet list inside the Deductions section.
        expect(container.querySelector("ul > li")).toBeNull();
        // No long-form statusBox in the Hypothesis section for derived.
        expect(screen.queryByText("statusConfirmed")).toBeNull();
    });

    test("derived cell with two hypotheses: plural preamble + chain text from whyText, no bullet list", () => {
        const cellH1 = Cell(PlayerOwner(player1), cardA);
        const cellH2 = Cell(PlayerOwner(setup.players[1]!), cardB);
        const hypotheses = HashMap.fromIterable<typeof cellH1, HypothesisValue>([
            [cellH1, "Y"],
            [cellH2, "N"],
        ]);
        const fakeChain =
            "1. Given: You marked that Anisha owns Col. Mustard.\n2. Card ownership: Col. Mustard is already owned by someone else, so the case file doesn't have it.";
        const { container } = render(
            <CellWhyPopover
                {...baseProps}
                hypotheses={hypotheses}
                cell={Cell(CaseFileOwner(), cardA)}
                display={{ tag: "derived", value: N }}
                status={{ kind: "derived", value: N }}
                whyText={fakeChain}
            />,
        );
        expect(screen.getByText("deductionsLabel")).toBeInTheDocument();
        // Plural preamble appears, singular does NOT.
        expect(screen.getByText("statusDerived")).toBeInTheDocument();
        expect(screen.queryByText("statusDerivedSingular")).toBeNull();
        // Chain text rendered.
        const chainEl = Array.from(
            container.querySelectorAll(".whitespace-pre-line"),
        ).find(el => (el.textContent ?? "").includes("Card ownership"));
        expect(chainEl).toBeDefined();
        // No hypothesis bullet list inside Deductions — the user
        // explicitly wanted that dropped for derived cells (it stays
        // for jointly-conflicting cells, which has its own test).
        expect(container.querySelector("ul > li")).toBeNull();
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
        // Locate the help-text wrapper and verify it carries both the
        // i18n key prefix and a ProseChecklistIcon chip for the value.
        const helpSpan = Array.from(
            container.querySelectorAll("span"),
        ).find(s => (s.textContent ?? "").includes("selectedHelpActive:"));
        expect(helpSpan).toBeDefined();
        // value=Y inline-prose chip is the default (light) style.
        expect(helpSpan?.querySelector("span.bg-yes-bg")).not.toBeNull();

        // The leading badge (standalone chip beside the prose) uses
        // the inverted style — dark Y bg, white glyph — so it visually
        // matches the cell's top-right inset badge.
        const helpRow = helpSpan?.parentElement as HTMLElement;
        const invertedChips = helpRow.querySelectorAll(
            "span.bg-yes:not(.bg-yes-bg), span.bg-no:not(.bg-no-bg)",
        );
        expect(invertedChips.length).toBe(1);
        // Plus the inline-prose chip in default (light) style.
        const lightChips = helpRow.querySelectorAll(
            "span.bg-yes-bg, span.bg-no-bg",
        );
        expect(lightChips.length).toBe(1);

        // No long-form status panel for "active".
        expect(screen.queryByText("statusConfirmed")).toBeNull();
        expect(screen.queryByText("statusDirectlyContradicted")).toBeNull();
        expect(screen.queryByText("statusJointlyConflicts")).toBeNull();
    });

    test("confirmed: short selectedHelpConfirmed + long statusConfirmed box", () => {
        const { container } = render(
            <CellWhyPopover
                {...baseProps}
                hypothesisValue="Y"
                status={{ kind: "confirmed", value: "Y" }}
                display={{ tag: "real", value: Y }}
            />,
        );
        const helpSpan = Array.from(
            container.querySelectorAll("span"),
        ).find(s => (s.textContent ?? "").includes("selectedHelpConfirmed:"));
        expect(helpSpan).toBeDefined();
        expect(screen.getByText("statusConfirmed")).toBeInTheDocument();
    });

    test("directly contradicted: short selectedHelpContradicted + long statusDirectlyContradicted box with animated X badge", () => {
        const { container } = render(
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
        const helpSpan = Array.from(
            container.querySelectorAll("span"),
        ).find(s =>
            (s.textContent ?? "").includes("selectedHelpContradicted:"),
        );
        expect(helpSpan).toBeDefined();
        expect(screen.getByText("statusDirectlyContradicted")).toBeInTheDocument();

        // The status box now renders the (triangle) AlertIcon —
        // not an X — because X is reserved for the cell's "doesn't
        // own" semantic. No pulse: the global contradiction banner
        // already grabs attention, the in-popover icon is static.
        const alertSvgs = Array.from(
            container.querySelectorAll("svg"),
        ).filter(svg => {
            const path = svg.querySelector("path");
            return (
                path !== null &&
                (path.getAttribute("d") ?? "").startsWith("M10.29")
            );
        });
        expect(alertSvgs.length).toBe(1);
        const pulsingSvgs = Array.from(
            container.querySelectorAll("svg"),
        ).filter(svg =>
            (svg.getAttribute("class") ?? "").includes(
                "motion-safe:animate-pulse",
            ),
        );
        expect(pulsingSvgs.length).toBe(0);
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
        const helpSpan = Array.from(
            container.querySelectorAll("span"),
        ).find(s =>
            (s.textContent ?? "").includes("selectedHelpJointlyConflicts:"),
        );
        expect(helpSpan).toBeDefined();
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
