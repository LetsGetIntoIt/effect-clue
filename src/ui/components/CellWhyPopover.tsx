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
}: CellWhyPopoverProps) {
    const t = useTranslations("hypothesis");

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
                return t("statusDerived");
        }
    })();

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

    return (
        <div className="contents">
            <div className="flex flex-col gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {t("sectionLabel", {
                        owner: ownerLabel(cell.owner),
                        card: cardLabel,
                    })}
                </div>
                <p className="text-[12px] leading-snug text-muted">
                    {t("helpText")}
                </p>
                <HypothesisControl
                    value={hypothesisValue}
                    onChange={onHypothesisChange}
                    status={status}
                />
                {statusMessage !== undefined && (
                    <div
                        className={
                            "text-[12px] " +
                            (status.kind === "directlyContradicted" ||
                            status.kind === "jointlyConflicts"
                                ? "text-danger"
                                : "text-muted")
                        }
                    >
                        {statusMessage}
                    </div>
                )}
                {showHypothesisList && activeHypothesisLabels.length > 0 && (
                    <ul className="ml-3 list-disc text-[12px] text-muted">
                        {activeHypothesisLabels.map(label => (
                            <li key={label}>{label}</li>
                        ))}
                    </ul>
                )}
                {whyText !== undefined && (
                    <div className="flex flex-col gap-2 border-t border-border/50 pt-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                            {t("hardFactsLabel")}
                        </div>
                        <div className="whitespace-pre-line">{whyText}</div>
                    </div>
                )}
                {whyText === undefined && status.kind === "off" && (
                    <div className="text-[12px] text-muted">
                        {t("emptyHint")}
                    </div>
                )}
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
