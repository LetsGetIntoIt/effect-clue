import { fireEvent, render, screen } from "@testing-library/react";
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
import { CellExplanationRow } from "./CellExplanationRow";

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
    whyHeadline: undefined as string | undefined,
    whyGivens: [] as ReadonlyArray<string>,
    whyReasoning: [] as ReadonlyArray<string>,
    footnoteNumbers: [] as ReadonlyArray<number>,
    hypothesisValue: undefined as HypothesisValue | undefined,
    display: { tag: "blank" } as CellDisplay,
    status: { kind: "off" } as HypothesisStatus,
    observed: false,
    onObservationChange: vi.fn(),
    selfPlayerId: null,
    onClose: vi.fn(),
};

describe("CellExplanationRow - section visibility", () => {
    test("blank cell with no footnote, no hypothesis: all three section labels render with null-state copy where empty", () => {
        render(<CellExplanationRow {...baseProps} />);

        // All three section labels render unconditionally so the
        // layout doesn't shift when content fills in. Observations is
        // not its own section anymore — its checkbox lives inside a
        // disclosure within the Deductions section.
        expect(screen.queryByText("observationsLabel")).toBeNull();
        expect(screen.getByText("deductionsLabel")).toBeInTheDocument();
        expect(screen.getByText("leadsLabel")).toBeInTheDocument();
        expect(screen.getByText("hypothesisLabel")).toBeInTheDocument();

        // Deductions + Leads show their null-state copy because no
        // deduction/lead exists for this cell yet.
        expect(screen.getByText("deductionsEmpty")).toBeInTheDocument();
        expect(screen.getByText("leadsEmpty")).toBeInTheDocument();

        // Hypothesis still shows the action-oriented empty hint and
        // its standing helpText.
        expect(screen.getByText("emptyHint")).toBeInTheDocument();
        expect(screen.getByText("helpText")).toBeInTheDocument();
    });

    test("no long-form status boxes when toggle alone is off", () => {
        render(<CellExplanationRow {...baseProps} hypothesisValue={undefined} />);
        // No long-form status box for either.
        expect(screen.queryByText("statusConfirmed")).toBeNull();
        expect(screen.queryByText("statusDirectlyContradicted")).toBeNull();
        expect(screen.queryByText("statusJointlyConflicts")).toBeNull();
    });
});

describe("CellExplanationRow - Deductions section", () => {
    test("renders with headline + Y-tinted glyph box for a real Y cell", () => {
        const { container } = render(
            <CellExplanationRow
                {...baseProps}
                whyHeadline="Anisha has Miss Scarlet."
                display={{ tag: "real", value: Y }}
                status={{ kind: "off" }}
            />,
        );
        expect(screen.getByText("deductionsLabel")).toBeInTheDocument();
        expect(
            screen.getByText("Anisha has Miss Scarlet."),
        ).toBeInTheDocument();

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
            <CellExplanationRow
                {...baseProps}
                whyHeadline="Bob does not have Miss Scarlet."
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

    test("derived cell, one hypothesis: singular preamble + headline + Given bullets + Reasoning", () => {
        // Build a hypothesis map with one entry so the singular
        // preamble fires above the consolidated headline / Given /
        // Reasoning triple.
        const otherCell = Cell(PlayerOwner(player1), cardB);
        const hypotheses = HashMap.set(
            HashMap.empty<typeof otherCell, HypothesisValue>(),
            otherCell,
            "Y",
        );
        render(
            <CellExplanationRow
                {...baseProps}
                hypotheses={hypotheses}
                display={{ tag: "derived", value: Y }}
                status={{ kind: "derived", value: Y }}
                whyHeadline="Bob does not have Miss Scarlet."
                whyGivens={[
                    "Known observation: Anisha has Miss Scarlet.",
                ]}
                whyReasoning={[
                    "Miss Scarlet is already owned by someone else, so Bob doesn't own it.",
                ]}
            />,
        );
        // Deductions heading shows.
        expect(screen.getByText("deductionsLabel")).toBeInTheDocument();

        // Singular preamble appears (mock returns bare key for plain
        // `t(...)` calls).
        expect(
            screen.getByText("statusDerivedSingular"),
        ).toBeInTheDocument();
        // The plural preamble does NOT render in the singular case.
        expect(screen.queryByText("statusDerived")).toBeNull();

        // Conclusion-first headline renders.
        expect(
            screen.getByText("Bob does not have Miss Scarlet."),
        ).toBeInTheDocument();
        // Given section renders with its bullet.
        expect(screen.getByText("givenSectionLabel")).toBeInTheDocument();
        expect(
            screen.getByText("Known observation: Anisha has Miss Scarlet."),
        ).toBeInTheDocument();
        // Reasoning section renders with its single sentence (no list
        // wrapper when there's exactly one reasoning entry).
        expect(screen.getByText("reasoningSectionLabel")).toBeInTheDocument();
        expect(
            screen.getByText(
                "Miss Scarlet is already owned by someone else, so Bob doesn't own it.",
            ),
        ).toBeInTheDocument();
        // No long-form statusBox in the Hypothesis section for derived.
        expect(screen.queryByText("statusConfirmed")).toBeNull();
    });

    test("derived cell with two hypotheses: plural preamble + headline + Given + Reasoning", () => {
        const cellH1 = Cell(PlayerOwner(player1), cardA);
        const cellH2 = Cell(PlayerOwner(setup.players[1]!), cardB);
        const hypotheses = HashMap.fromIterable<typeof cellH1, HypothesisValue>([
            [cellH1, "Y"],
            [cellH2, "N"],
        ]);
        render(
            <CellExplanationRow
                {...baseProps}
                hypotheses={hypotheses}
                cell={Cell(CaseFileOwner(), cardA)}
                display={{ tag: "derived", value: N }}
                status={{ kind: "derived", value: N }}
                whyHeadline="The case file does not have Col. Mustard."
                whyGivens={[
                    "Known observation: Anisha has Col. Mustard.",
                ]}
                whyReasoning={[
                    "Col. Mustard is already owned by someone else, so the case file doesn't own it.",
                ]}
            />,
        );
        expect(screen.getByText("deductionsLabel")).toBeInTheDocument();
        // Plural preamble appears, singular does NOT.
        expect(screen.getByText("statusDerived")).toBeInTheDocument();
        expect(screen.queryByText("statusDerivedSingular")).toBeNull();
        // Case-file headline reads cleanly.
        expect(
            screen.getByText("The case file does not have Col. Mustard."),
        ).toBeInTheDocument();
        // Given + Reasoning both render.
        expect(screen.getByText("givenSectionLabel")).toBeInTheDocument();
        expect(screen.getByText("reasoningSectionLabel")).toBeInTheDocument();
    });

    test("multi-sentence reasoning falls back to a numbered list", () => {
        render(
            <CellExplanationRow
                {...baseProps}
                whyHeadline="Bob does not have Miss Scarlet."
                whyGivens={["Known observation: Anisha has Miss Scarlet."]}
                whyReasoning={[
                    "Sentence one.",
                    "Sentence two.",
                    "Sentence three.",
                ]}
                display={{ tag: "real", value: N }}
                status={{ kind: "off" }}
            />,
        );
        // Reasoning renders as <ol> with three <li>s, one per sentence.
        const list = document.querySelector("ol.list-decimal");
        expect(list).not.toBeNull();
        expect(list?.querySelectorAll("li")).toHaveLength(3);
    });
});

describe("CellExplanationRow - Leads section", () => {
    test("renders chip + footnote text for non-empty footnoteNumbers", () => {
        const { container } = render(
            <CellExplanationRow {...baseProps} footnoteNumbers={[2, 3]} />,
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

    test("Leads label still renders with leadsEmpty null-state when footnoteNumbers is empty", () => {
        const { container } = render(
            <CellExplanationRow {...baseProps} footnoteNumbers={[]} />,
        );
        expect(screen.getByText("leadsLabel")).toBeInTheDocument();
        expect(screen.getByText("leadsEmpty")).toBeInTheDocument();
        // No accent chip with tabular-nums (the populated-state chip).
        const chip = Array.from(
            container.querySelectorAll<HTMLElement>("span"),
        ).find(s =>
            s.className.includes("border-accent/40") &&
            s.className.includes("tabular-nums"),
        );
        expect(chip).toBeUndefined();
    });
});

describe("CellExplanationRow - Hypothesis section help text", () => {
    test("hypothesisValue undefined: shows the unchanged helpText", () => {
        render(<CellExplanationRow {...baseProps} />);
        expect(screen.getByText("helpText")).toBeInTheDocument();
        // No badge SVG inside the Hypothesis section's help row.
        const helpEl = screen.getByText("helpText");
        expect(helpEl.querySelector("svg")).toBeNull();
    });

    test("active Y hypothesis: short selectedHelpActive line + hypothesis badge, no statusBox", () => {
        const { container } = render(
            <CellExplanationRow
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
            <CellExplanationRow
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
            <CellExplanationRow
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
            <CellExplanationRow
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
            <CellExplanationRow
                {...baseProps}
                hypothesisValue="Y"
                status={{ kind: "active", value: "Y" }}
                display={{ tag: "hypothesis", value: "Y" }}
            />,
        );
        // emptyHint hidden while a hypothesis is active.
        expect(screen.queryByText("emptyHint")).toBeNull();

        rerender(
            <CellExplanationRow
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

describe("CellExplanationRow - cell-heading line", () => {
    test("renders the owner / card heading line", () => {
        render(<CellExplanationRow {...baseProps} />);
        const heading = screen.getByText(/^cellHeading:/);
        // Player(...) is a Brand.nominal helper — passes strings through.
        expect(heading.textContent).toContain(`"owner":"${String(player1)}"`);
    });
});

describe("CellExplanationRow - observation disclosure inside Deductions", () => {
    test("disclosure button renders for a player-owned cell with the expand label", () => {
        render(<CellExplanationRow {...baseProps} />);
        // The disclosure button replaces the standalone Observations
        // section. It lives inside Deductions and toggles a checkbox.
        const button = screen.getByRole("button", {
            name: /observationsExpandLabel/,
        });
        expect(button).toBeInTheDocument();
        expect(button.getAttribute("aria-expanded")).toBe("false");
    });

    test("checkbox uses 'I have this card in my hand' label when popover is on the user's own row", () => {
        // observed=true seeds the disclosure open at mount, so the
        // checkbox is in the DOM without needing to click the button.
        render(
            <CellExplanationRow
                {...baseProps}
                selfPlayerId={player1}
                observed={true}
            />,
        );
        // Self-flavoured copy uses the 'Own' key. The mock returns the
        // bare key when no values are passed, so we look for it
        // directly.
        expect(
            screen.getByText("observationsCheckboxLabelOwn"),
        ).toBeInTheDocument();
        // The 'Other' key (with substitutions) does not render.
        expect(
            screen.queryByText(/^observationsCheckboxLabelOther:/),
        ).toBeNull();
    });

    test("checkbox uses 'I have seen that {player} owns {card}' label for another player's row", () => {
        render(
            <CellExplanationRow
                {...baseProps}
                selfPlayerId={null}
                observed={true}
            />,
        );
        // 'Other' copy includes player + card substitutions. The mock
        // serializes values into the rendered text as JSON.
        const labelEl = screen.getByText(/^observationsCheckboxLabelOther:/);
        expect(labelEl).toBeInTheDocument();
        expect(labelEl.textContent).toContain(`"player":"${String(player1)}"`);
        expect(labelEl.textContent).toContain(`"card":`);
    });

    test("falls through to 'Other' copy when selfPlayerId is null even on the owner's row", () => {
        // Defensive: regardless of selfPlayerId === null, we should
        // not use the 'Own' copy when we cannot identify ownership.
        render(
            <CellExplanationRow
                {...baseProps}
                selfPlayerId={null}
                observed={true}
            />,
        );
        expect(
            screen.queryByText("observationsCheckboxLabelOwn"),
        ).toBeNull();
        expect(
            screen.getByText(/^observationsCheckboxLabelOther:/),
        ).toBeInTheDocument();
    });

    test("case-file cells render no disclosure button", () => {
        const caseCell = Cell(CaseFileOwner(), cardA);
        render(<CellExplanationRow {...baseProps} cell={caseCell} />);
        // The disclosure is gated on player-owned cells. Case-file
        // cells get the 3 standard sections with no observation toggle.
        expect(
            screen.queryByRole("button", {
                name: /observationsExpandLabel/,
            }),
        ).toBeNull();
        // The 3 section labels still render for case-file cells.
        expect(screen.getByText("deductionsLabel")).toBeInTheDocument();
        expect(screen.getByText("leadsLabel")).toBeInTheDocument();
        expect(screen.getByText("hypothesisLabel")).toBeInTheDocument();
    });

    test("checkbox checked state mirrors the `observed` prop (disclosure auto-opens when observed)", () => {
        const { container } = render(
            <CellExplanationRow {...baseProps} observed={true} />,
        );
        // observed=true seeds the disclosure open, so the checkbox
        // is rendered immediately with checked=true.
        const checkbox = container.querySelector(
            'input[type="checkbox"]',
        ) as HTMLInputElement;
        expect(checkbox).not.toBeNull();
        expect(checkbox.checked).toBe(true);
    });

    test("toggling the checkbox calls onObservationChange with the inverted value", () => {
        const handler = vi.fn();
        const { container } = render(
            <CellExplanationRow
                {...baseProps}
                observed={true}
                onObservationChange={handler}
            />,
        );
        const checkbox = container.querySelector(
            'input[type="checkbox"]',
        ) as HTMLInputElement;
        checkbox.click();
        expect(handler).toHaveBeenCalledWith(false);
    });

    test("clicking the disclosure button toggles aria-expanded", () => {
        render(<CellExplanationRow {...baseProps} observed={false} />);
        const button = screen.getByRole("button", {
            name: /observationsExpandLabel/,
        });
        // Starts collapsed because observed=false seeds open=false.
        expect(button.getAttribute("aria-expanded")).toBe("false");
        // `fireEvent.click` wraps the dispatch in `act()` so React's
        // state update + re-render happens synchronously before we
        // re-read the attribute. Native `.click()` skips that wrap and
        // leaves the DOM stale.
        fireEvent.click(button);
        expect(button.getAttribute("aria-expanded")).toBe("true");
    });
});

// `Player` is imported above to keep the symbol in scope when readers
// inspect the test.
void Player;
