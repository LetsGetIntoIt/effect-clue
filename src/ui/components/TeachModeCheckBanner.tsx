"use client";

import { useTranslations } from "next-intl";
import { HashMap } from "effect";
import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { Cell } from "../../logic/Knowledge";
import {
    classifyCell,
    tallyVerdicts,
    tallyHasIssues,
} from "../../logic/TeachMode";
import { allCardIds } from "../../logic/CardSet";
import { CaseFileOwner, PlayerOwner } from "../../logic/GameObjects";
import { Result } from "effect";
import { getCell } from "../../logic/Knowledge";
import { teachModeCheckUsed } from "../../analytics/events";
import { T_STANDARD, useReducedTransition } from "../motion";
import { useClue } from "../state";
import { AlertIcon, CheckIcon, XIcon } from "./Icons";
import { cellKey } from "../../logic/TeachMode";
import { useTeachModeCheck } from "./TeachModeCheckContext";

/**
 * The vague-summary banner that appears after the user presses the
 * Toolbar "Check" button in teach-mode. Shows a single line summarising
 * how their marks line up against the evidence; the user can then tap
 * "Show me where" to outline each cell per verdict on the Checklist.
 *
 * The banner sits below the contradiction-banner slot (which is
 * suppressed in teach-mode anyway) and above the page header offset,
 * matching the same fixed-top pattern.
 */
export function TeachModeCheckBanner() {
    const t = useTranslations("teachMode");
    const { state, derived } = useClue();
    const {
        bannerOpen,
        revealActive,
        enableReveal,
        closeBanner,
        setVerdictMap,
    } = useTeachModeCheck();
    const transition = useReducedTransition(T_STANDARD, { fadeMs: 120 });

    const tally = useMemo(
        () =>
            tallyVerdicts(
                state.setup,
                state.userDeductions,
                derived.deductionResult,
                derived.intrinsicContradictions,
            ),
        [
            state.setup,
            state.userDeductions,
            derived.deductionResult,
            derived.intrinsicContradictions,
        ],
    );

    const nothingMarked =
        HashMap.size(state.userDeductions) === 0
        && tally.missed === 0
        && tally.inconsistent === 0
        && !tally.evidenceContradiction;

    const summaryParts: string[] = [];
    if (tally.evidenceContradiction) {
        summaryParts.push(t("bannerEvidenceContradiction"));
    }
    if (tally.inconsistent > 0) {
        summaryParts.push(t("bannerHasInconsistent"));
    }
    if (tally.falsifiable > 0) {
        summaryParts.push(t("bannerHasFalsifiable"));
    }
    if (tally.missed > 0) {
        summaryParts.push(t("bannerHasMissed"));
    }
    if (tally.plausible > 0) {
        summaryParts.push(t("bannerHasPlausible"));
    }

    const summary = nothingMarked
        ? t("bannerNothingMarked")
        : !tallyHasIssues(tally)
        ? t("bannerLookingGood")
        : summaryParts.join(t("bannerSummaryAnd"));

    const onShowMeWhere = () => {
        // Build per-cell verdict map now that the user has asked to
        // dig in. Cells without a meaningful verdict (Verifiable
        // matches don't need a callout) are excluded.
        //
        // Keyed by stable string (see `cellKey`) — Cell is a Data.Class
        // and reference-keyed maps wouldn't match the cells built
        // independently inside Checklist's render.
        const verdictMap = new Map<string, string>();
        const knowledge = Result.isSuccess(derived.deductionResult)
            ? derived.deductionResult.success
            : undefined;
        const owners = [
            CaseFileOwner(),
            ...state.setup.players.map(p => PlayerOwner(p)),
        ];
        for (const owner of owners) {
            for (const card of allCardIds(state.setup.cardSet)) {
                const cell = Cell(owner, card);
                const markOpt = HashMap.get(state.userDeductions, cell);
                const mark =
                    markOpt._tag === "Some" ? markOpt.value : undefined;
                const deducerVerdict =
                    knowledge !== undefined
                        ? getCell(knowledge, cell)
                        : undefined;
                const conflicts =
                    derived.intrinsicContradictions.conflictsByCell.get(
                        cellKey(cell),
                    ) ?? [];
                const verdict = classifyCell(
                    cell,
                    mark,
                    deducerVerdict,
                    () => conflicts,
                );
                if (
                    verdict.kind === "falsifiable"
                    || verdict.kind === "plausible"
                    || verdict.kind === "missed"
                    || verdict.kind === "inconsistent"
                ) {
                    verdictMap.set(cellKey(cell), verdict.kind);
                }
            }
        }
        setVerdictMap(verdictMap);
        enableReveal();
        teachModeCheckUsed({
            revealLevel: "full",
            verifiable: tally.verifiable,
            falsifiable: tally.falsifiable,
            plausible: tally.plausible,
            missed: tally.missed,
            inconsistent: tally.inconsistent,
            evidenceContradiction: tally.evidenceContradiction,
        });
    };

    return (
        <AnimatePresence>
            {bannerOpen && (
                <motion.div
                    key="teach-mode-check-banner"
                    role="alert"
                    initial={{ y: -16, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -16, opacity: 0 }}
                    transition={transition}
                    className="fixed inset-x-0 top-0 z-[var(--z-contradiction-banner)] border-b border-accent/30 bg-panel/95 shadow-lg backdrop-blur-sm"
                >
                    <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-5 py-2">
                        {tallyHasIssues(tally) ? (
                            <AlertIcon
                                size={20}
                                className="flex-shrink-0 text-accent"
                            />
                        ) : (
                            <CheckIcon
                                size={20}
                                className="flex-shrink-0 text-yes"
                            />
                        )}
                        <span className="flex-1 text-[1.125rem] leading-snug text-fg">
                            {summary}
                        </span>
                        {!nothingMarked
                            && tallyHasIssues(tally)
                            && !revealActive && (
                                <button
                                    type="button"
                                    onClick={onShowMeWhere}
                                    className="cursor-pointer rounded border border-accent bg-accent px-3 py-1 text-[1rem] font-semibold text-panel hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                                >
                                    {t("bannerShowMeWhere")}
                                </button>
                            )}
                        <button
                            type="button"
                            onClick={closeBanner}
                            aria-label={t("bannerDismissAria")}
                            className="flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                        >
                            <XIcon size={16} />
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
