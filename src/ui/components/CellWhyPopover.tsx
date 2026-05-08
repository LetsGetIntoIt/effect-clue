"use client";

import { useTranslations } from "next-intl";
import { ownerLabel } from "../../logic/GameObjects";
import type { GameSetup } from "../../logic/GameSetup";
import type { Cell } from "../../logic/Knowledge";
import { findCardEntry } from "../../logic/GameSetup";
import {
    type CellDisplay,
    type HypothesisMap,
    type HypothesisStatus,
    type HypothesisValue,
} from "../../logic/Hypothesis";
import { HashMap } from "effect";
import { AlertIcon, CheckIcon, LightbulbIcon } from "./Icons";
import { HypothesisControl } from "./HypothesisControl";
import {
    cellToneClass,
    glyphKindFor,
    ProseChecklistIcon,
    renderGlyphNode,
} from "./CellGlyph";

// i18n key tags hoisted to module scope so the `no-literal-string`
// lint rule reads them as code identifiers, not UI text. Each maps a
// hypothesis status to the short above-the-toggle help line that
// echoes the cell's top-right hypothesis badge.
const KEY_HELP_ACTIVE = "selectedHelpActive" as const;
const KEY_HELP_CONFIRMED = "selectedHelpConfirmed" as const;
const KEY_HELP_CONTRADICTED = "selectedHelpContradicted" as const;
const KEY_HELP_JOINTLY_CONFLICTS = "selectedHelpJointlyConflicts" as const;

interface CellWhyPopoverProps {
    readonly cell: Cell;
    readonly setup: GameSetup;
    readonly display: CellDisplay;
    readonly status: HypothesisStatus;
    readonly hypotheses: HypothesisMap;
    readonly hypothesisValue: HypothesisValue | undefined;
    readonly onHypothesisChange: (next: HypothesisValue | undefined) => void;
    /** Multi-line "why" chain text rendered as the Deductions body. */
    readonly whyText: string | undefined;
    /**
     * Suggestion numbers driving the in-cell top-left lightbulb chip
     * (refuter-candidate footnote). When non-empty, the popover renders
     * a Leads section with the same chip + the translated explanation.
     */
    readonly footnoteNumbers: ReadonlyArray<number>;
}

/**
 * Structured content for the why popover. Three sections — Deductions,
 * Leads, Hypothesis — map 1:1 to the three visual badges on the cell
 * (center glyph, top-left chip, top-right hypothesis badge), and each
 * section embeds the same exact badge styling next to its explanation
 * so users learn to read the in-cell badges without opening the
 * popover. Sections without content hide themselves entirely.
 */
export function CellWhyPopover({
    cell,
    setup,
    display,
    status,
    hypotheses,
    hypothesisValue,
    onHypothesisChange,
    whyText,
    footnoteNumbers,
}: CellWhyPopoverProps) {
    const t = useTranslations("hypothesis");
    const tDeduce = useTranslations("deduce");

    const cardLabel =
        findCardEntry(setup, cell.card)?.name ?? String(cell.card);

    // For derived + joint-conflict popovers, list every active
    // hypothesis by name so the user knows which assumption(s) are
    // shaping this cell. The deducer doesn't currently track per-cell
    // provenance for hypotheses, so we list the full active set rather
    // than narrowing to the specific subset that drove this value —
    // good-enough until we wire up leave-one-out attribution.
    const showHypothesisList =
        status.kind === "jointlyConflicts" || status.kind === "derived";
    const activeHypothesisLabels: ReadonlyArray<string> = (() => {
        if (!showHypothesisList) return [];
        const out: Array<string> = [];
        for (const [c, v] of hypotheses) {
            const cardName = findCardEntry(setup, c.card)?.name ?? String(c.card);
            out.push(`${ownerLabel(c.owner)} / ${cardName} = ${v}`);
        }
        return out;
    })();

    // For a `derived` popover with exactly one active hypothesis,
    // collapse the heading + bulleted list into a single inline
    // sentence ("from your active hypothesis (Player 1 / Miss Scarlet
    // = Y)."). Reads better when there's only one source to cite.
    const useDerivedSingular =
        status.kind === "derived" && activeHypothesisLabels.length === 1;

    const isContradicted =
        status.kind === "directlyContradicted" ||
        status.kind === "jointlyConflicts";
    const isJointConflict = status.kind === "jointlyConflicts";

    // Section visibility:
    //   - Deductions shows when the real-only deducer has a chain
    //     (`whyText`) OR when the cell is "derived" — i.e. its `?` value
    //     flows from the user's active hypotheses. Both cases describe
    //     why the center glyph is what it is.
    //   - Leads shows when there's at least one footnote number.
    //   - Hypothesis is always shown (the toggle is its content).
    const showDeductions =
        whyText !== undefined ||
        status.kind === "derived" ||
        display.tag === "hypothesis";
    const showLeads = footnoteNumbers.length > 0;

    // Long-form status box (rendered below the toggle) for the kinds
    // that warrant their own panel: confirmed (success), directly
    // contradicted / jointly conflicts (danger). The `derived` case
    // moved to the Deductions section above. `off` and `active` show
    // no status box at all.
    const longStatusMessage = (() => {
        switch (status.kind) {
            case "confirmed":
                return t("statusConfirmed");
            case "directlyContradicted":
                return t("statusDirectlyContradicted");
            case "jointlyConflicts":
                return t("statusJointlyConflicts");
            default:
                return undefined;
        }
    })();

    const statusBox = longStatusMessage === undefined ? null : isContradicted &&
      hypothesisValue !== undefined ? (
        // Contradiction state — alert (triangle) icon, NOT an X.
        // The cell-grid uses X for "doesn't own", so reusing X for a
        // problem signal here would conflate two unrelated meanings.
        // The pulse animation moves into the popover whenever it's
        // open — the matching cell badge stops animating while the
        // popover is visible (see Checklist's `isPopoverOnThisCell`).
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-danger-border bg-danger-bg p-2 text-[12px] text-danger">
            <AlertIcon
                size={14}
                className="mt-[1px] flex-shrink-0 motion-safe:animate-pulse"
            />
            <div className="flex flex-col gap-1">
                <span>{longStatusMessage}</span>
                {isJointConflict && activeHypothesisLabels.length > 0 && (
                    <ul className="ml-3 list-disc">
                        {activeHypothesisLabels.map(lbl => (
                            <li key={lbl}>{lbl}</li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    ) : isContradicted ? null : (
        // Confirmed — mirror the contradiction panel in success palette.
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-yes/40 bg-yes-bg p-2 text-[12px] text-yes">
            <CheckIcon size={14} className="mt-[1px] flex-shrink-0" />
            <span>{longStatusMessage}</span>
        </div>
    );

    // Short above-the-toggle help line that swaps based on the
    // selected hypothesis's status. The badge is the same one as the
    // cell's top-right corner, so the popover and cell read as
    // visually paired.
    const renderHypothesisHelp = () => {
        if (hypothesisValue === undefined) {
            return (
                <p className="text-[12px] leading-snug text-muted">
                    {t("helpText")}
                </p>
            );
        }
        const shortKey = (() => {
            switch (status.kind) {
                case "confirmed":
                    return KEY_HELP_CONFIRMED;
                case "directlyContradicted":
                    return KEY_HELP_CONTRADICTED;
                case "jointlyConflicts":
                    return KEY_HELP_JOINTLY_CONFLICTS;
                // `off` for a value-set cell only fires when the global
                // contradiction banner is up; fall through to the
                // active wording so the row still renders something.
                case "off":
                case "active":
                case "derived":
                default:
                    return KEY_HELP_ACTIVE;
            }
        })();
        // Two chips on this row, with different roles:
        //   - The leading badge is the inverted "?" variant —
        //     dark tone + white "?" — matching the deductions
        //     section's 20×20 leading icon size. For confirmed cells
        //     (where the hypothesis matches reality) we drop the "?"
        //     and just show the concrete icon, since the value isn't
        //     hypothetical at that point.
        //   - The inline-prose chip is about the user's chosen value,
        //     not its hypothesis state — always shows the concrete
        //     icon for Y / N. Default (light) style so it reads as
        //     part of the sentence rather than as another badge.
        const badgeIsHypothesis = status.kind !== "confirmed";
        return (
            <div className="flex items-center gap-2 text-[12px] leading-snug text-fg">
                <ProseChecklistIcon
                    value={hypothesisValue}
                    isHypothesis={badgeIsHypothesis}
                    invertedStyle
                    className="!h-5 !w-5 text-[20px]"
                />
                <span>
                    {t.rich(shortKey, {
                        value: hypothesisValue,
                        chip: () => (
                            <ProseChecklistIcon
                                value={hypothesisValue}
                            />
                        ),
                    })}
                </span>
            </div>
        );
    };

    return (
        <div className="contents">
            <div className="flex flex-col gap-3">
                <div className="text-[14px] font-semibold uppercase tracking-wide text-fg">
                    {t("cellHeading", {
                        owner: ownerLabel(cell.owner),
                        card: cardLabel,
                    })}
                </div>
                {showDeductions && (
                    <div className="flex flex-col gap-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-fg">
                            {t("deductionsLabel")}
                        </div>
                        <div className="flex items-start gap-2">
                            <span
                                aria-hidden
                                className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center border border-border text-[12px] font-semibold leading-none ${cellToneClass(display)}`}
                                data-glyph={glyphKindFor(display, status)}
                            >
                                {renderGlyphNode(
                                    glyphKindFor(display, status),
                                    { compact: true },
                                )}
                            </span>
                            <div className="flex flex-col gap-1">
                                {whyText !== undefined && (
                                    <div className="whitespace-pre-line">
                                        {whyText}
                                    </div>
                                )}
                                {status.kind === "derived" && (
                                    <div className="flex flex-col gap-1 text-[12px] text-muted">
                                        <span>
                                            {useDerivedSingular
                                                ? t.rich(
                                                      "statusDerivedSingular",
                                                      {
                                                          chip: () => (
                                                              <ProseChecklistIcon
                                                                  value={
                                                                      status.value
                                                                  }
                                                              />
                                                          ),
                                                          description:
                                                              activeHypothesisLabels[0]!,
                                                      },
                                                  )
                                                : t.rich("statusDerived", {
                                                      chip: () => (
                                                          <ProseChecklistIcon
                                                              value={
                                                                  status.value
                                                              }
                                                          />
                                                      ),
                                                  })}
                                        </span>
                                        {!useDerivedSingular &&
                                            activeHypothesisLabels.length >
                                                0 && (
                                                <ul className="ml-3 list-disc">
                                                    {activeHypothesisLabels.map(
                                                        lbl => (
                                                            <li key={lbl}>
                                                                {lbl}
                                                            </li>
                                                        ),
                                                    )}
                                                </ul>
                                            )}
                                    </div>
                                )}
                                {display.tag === "hypothesis" &&
                                    status.kind !== "derived" && (
                                        // Cell directly carries a user
                                        // hypothesis (real-only didn't
                                        // conclude). The leftmost chip
                                        // already shows the parens-
                                        // wrapped icon; this line just
                                        // names what the leading badge
                                        // is communicating.
                                        <div className="text-[12px] text-muted">
                                            {t("statusActiveHypothesisCell")}
                                        </div>
                                    )}
                            </div>
                        </div>
                    </div>
                )}
                {showLeads && (
                    <div className="flex flex-col gap-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-fg">
                            {t("leadsLabel")}
                        </div>
                        <div className="flex items-start gap-2 text-accent">
                            <span
                                aria-hidden
                                className="mt-[2px] inline-flex flex-shrink-0 items-center gap-[2px] rounded-[3px] border border-accent/40 px-[3px] py-px text-[10px] font-semibold leading-none text-accent tabular-nums"
                            >
                                <LightbulbIcon size={9} />
                                {footnoteNumbers.join(",")}
                            </span>
                            <span>
                                {tDeduce("footnoteLine", {
                                    labels: footnoteNumbers
                                        .map(n => `#${n}`)
                                        .join(", "),
                                })}
                            </span>
                        </div>
                    </div>
                )}
                <div
                    className={
                        showDeductions || showLeads
                            ? "flex flex-col gap-2 border-t border-border pt-3"
                            : "flex flex-col gap-2"
                    }
                >
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-fg">
                        {t("hypothesisLabel")}
                    </div>
                    {renderHypothesisHelp()}
                    <HypothesisControl
                        value={hypothesisValue}
                        onChange={onHypothesisChange}
                        status={status}
                    />
                    {statusBox}
                    {!showDeductions &&
                        !showLeads &&
                        hypothesisValue === undefined && (
                            <div className="text-[12px] text-muted">
                                {t("emptyHint")}
                            </div>
                        )}
                </div>
            </div>
        </div>
    );
}

// Re-export so Checklist consumers can import the helper from one
// place rather than digging for the in-list direct lookup.
export const hypothesisValueFor = (
    hypotheses: HypothesisMap,
    cell: Cell,
): HypothesisValue | undefined => {
    const opt = HashMap.get(hypotheses, cell);
    return opt._tag === "Some" ? opt.value : undefined;
};
