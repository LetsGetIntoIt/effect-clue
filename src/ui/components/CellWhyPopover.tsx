"use client";

import { useTranslations } from "next-intl";
import { ownerLabel } from "../../logic/GameObjects";
import type { GameSetup } from "../../logic/GameSetup";
import type { Cell } from "../../logic/Knowledge";
import { findCardEntry } from "../../logic/GameSetup";
import type {
    HypothesisMap,
    HypothesisStatus,
    HypothesisValue,
} from "../../logic/Hypothesis";
import { HashMap } from "effect";
import { AlertIcon, CheckIcon, LightbulbIcon } from "./Icons";
import { HypothesisControl } from "./HypothesisControl";

interface CellWhyPopoverProps {
    readonly cell: Cell;
    readonly setup: GameSetup;
    readonly status: HypothesisStatus;
    readonly hypotheses: HypothesisMap;
    readonly hypothesisValue: HypothesisValue | undefined;
    readonly onHypothesisChange: (next: HypothesisValue | undefined) => void;
    /** Multi-line "why" chain text rendered below the control, when present. */
    readonly whyText: string | undefined;
    /**
     * "Candidate for suggestion #N — refuter's unseen card could be here."
     * Rendered with the same lightbulb glyph as the in-cell footnote chip
     * so users can match the chip to its explanation. Independent of
     * `whyText`: a blank cell can be a refuter-candidate without having a
     * deduction chain.
     */
    readonly footnoteText: string | undefined;
}

/**
 * Structured content for the why popover. The hypothesis control sits
 * at the top so the popover always offers a useful action — even on
 * blank cells where the deducer has nothing to say. Status microcopy
 * surfaces below the control when the hypothesis warrants explanation
 * (confirmed, contradicted, jointly conflicts, derived). The existing
 * deduction "why" chain follows.
 */
export function CellWhyPopover({
    cell,
    setup,
    status,
    hypotheses,
    hypothesisValue,
    onHypothesisChange,
    whyText,
    footnoteText,
}: CellWhyPopoverProps) {
    const t = useTranslations("hypothesis");

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
    const renderListBelow = showHypothesisList && !useDerivedSingular;

    const statusMessage = (() => {
        switch (status.kind) {
            case "off":
            case "active":
                return undefined;
            case "confirmed":
                return t("statusConfirmed");
            case "directlyContradicted":
                return t("statusDirectlyContradicted");
            case "jointlyConflicts":
                return t("statusJointlyConflicts");
            case "derived":
                return useDerivedSingular
                    ? t("statusDerivedSingular", {
                          description: activeHypothesisLabels[0]!,
                      })
                    : t("statusDerived");
        }
    })();

    const isContradicted =
        status.kind === "directlyContradicted" ||
        status.kind === "jointlyConflicts";
    const isJointConflict = status.kind === "jointlyConflicts";
    // The conflict list lives INSIDE the danger box for joint
    // conflicts (so the bullets read as part of the warning) and
    // BELOW the popover body for derived cells (where they're
    // explanatory, not part of an alert).
    const renderListInsideDanger =
        isJointConflict && activeHypothesisLabels.length > 0;
    const renderListOutside =
        renderListBelow && !renderListInsideDanger && activeHypothesisLabels.length > 0;

    const statusBox = statusMessage === undefined ? null : isContradicted ? (
        // Connect the dots to the cell's alert icon: a bordered red
        // panel with the same warning icon makes the cause visible at
        // popover-open time. Joint-conflict lists live inside this
        // box so the bullets read as part of the warning.
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-danger-border bg-danger-bg p-2 text-[12px] text-danger">
            <AlertIcon size={14} className="mt-[1px] flex-shrink-0" />
            <div className="flex flex-col gap-1">
                <span>{statusMessage}</span>
                {renderListInsideDanger && (
                    <ul className="ml-3 list-disc">
                        {activeHypothesisLabels.map(lbl => (
                            <li key={lbl}>{lbl}</li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    ) : status.kind === "confirmed" ? (
        // Mirror the contradiction panel but in the success palette
        // so the affirmative status reads with matching weight.
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-yes/40 bg-yes-bg p-2 text-[12px] text-yes">
            <CheckIcon size={14} className="mt-[1px] flex-shrink-0" />
            <span>{statusMessage}</span>
        </div>
    ) : (
        <div className="text-[12px] text-muted">{statusMessage}</div>
    );

    return (
        <div className="contents">
            <div className="flex flex-col gap-3">
                <div className="text-[14px] font-semibold uppercase tracking-wide text-fg">
                    {t("cellHeading", {
                        owner: ownerLabel(cell.owner),
                        card: cardLabel,
                    })}
                </div>
                {(whyText !== undefined || footnoteText !== undefined) && (
                    <div className="flex flex-col gap-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-fg">
                            {t("hardFactsLabel")}
                        </div>
                        {whyText !== undefined && (
                            <div className="whitespace-pre-line">{whyText}</div>
                        )}
                        {footnoteText !== undefined && (
                            <div className="flex items-start gap-1.5 text-accent">
                                <LightbulbIcon
                                    size={14}
                                    className="mt-[2px] flex-shrink-0"
                                />
                                <span>{footnoteText}</span>
                            </div>
                        )}
                    </div>
                )}
                <div
                    className={
                        whyText !== undefined || footnoteText !== undefined
                            ? "flex flex-col gap-2 border-t border-border pt-3"
                            : "flex flex-col gap-2"
                    }
                >
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-fg">
                        {t("hypothesisLabel")}
                    </div>
                    <p className="text-[12px] leading-snug text-muted">
                        {t("helpText")}
                    </p>
                    <HypothesisControl
                        value={hypothesisValue}
                        onChange={onHypothesisChange}
                        status={status}
                    />
                    {statusBox}
                    {renderListOutside && (
                        <ul className="ml-3 list-disc text-[12px] text-muted">
                            {activeHypothesisLabels.map(lbl => (
                                <li key={lbl}>{lbl}</li>
                            ))}
                        </ul>
                    )}
                    {whyText === undefined &&
                        footnoteText === undefined &&
                        status.kind === "off" && (
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
