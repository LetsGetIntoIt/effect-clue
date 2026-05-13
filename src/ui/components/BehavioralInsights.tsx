"use client";

import { Duration, HashMap } from "effect";
import {
    AnimatePresence,
    LayoutGroup,
    motion,
} from "motion/react";
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
    insightAccepted,
    insightDismissed,
    insightSurfaced,
    type InsightConfidenceTag,
    type InsightKindTag,
} from "../../analytics/events";
import {
    type Insight,
    type InsightConfidence,
    type InsightKind,
} from "../../logic/BehavioralInsights";
import type { Player } from "../../logic/GameObjects";
import { cardName, categoryName } from "../../logic/GameSetup";
import type { HypothesisValue } from "../../logic/Hypothesis";
import type { Cell } from "../../logic/Knowledge";
import { requestFocusChecklistCell } from "../checklistFocus";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { PANE_SETTLE, T_FAST, T_STANDARD, useReducedTransition } from "../motion";
import { useSelection } from "../SelectionContext";
import { useClue } from "../state";
import { ProseChecklistIcon } from "./CellGlyph";
import { CheckIcon, ChevronRightIcon, XIcon } from "./Icons";

/**
 * Hypotheses panel: section title, optional context-aware help copy,
 * and two grouped lists.
 *
 * - **Suggested** (top): soft, behavior-driven hypothesis suggestions
 *   surfaced from the suggestion log (see {@link Insight}). Each row
 *   has a one-click `setHypothesis` accept and a `dismissInsight`
 *   suppress, plus a bold `Suggested:` prefix to distinguish it from
 *   adopted hypotheses.
 * - **Active** (below): every hypothesis the user has adopted, sorted
 *   newest-first (most-recently pinned at the top — `state.hypothesisOrder`
 *   maintains this). Each row is a clickable text item that opens the
 *   corresponding cell's explanation popover and scrolls the cell into
 *   view, where the existing `HypothesisControl` lets the user edit /
 *   clear it.
 *
 * Animations:
 * - `<AnimatePresence mode="popLayout">` per group so removed items
 *   fade out and remaining siblings slide up.
 * - Each item carries `layout` so reorders animate.
 * - Each item also carries a shared `layoutId` keyed by its target
 *   cell — when the user accepts a suggested item, framer-motion
 *   morphs the same `<li>` from the Suggested group's position into
 *   the top of the Active group, picking up the active styling along
 *   the way.
 */
export function BehavioralInsights() {
    const t = useTranslations("suggestions");
    const { derived, dispatch, state } = useClue();
    const insights = derived.behavioralInsights;
    const isDesktop = useIsDesktop();
    const { setPopoverCell } = useSelection();

    // Active hypotheses, in render order (most-recent first).
    // `hypothesisOrder` is the source of truth for ordering; we also
    // resolve the value from `state.hypotheses` and skip any cell
    // whose value is missing (drift between the two should not
    // happen, but we render defensively rather than crash).
    const activeRows: ReadonlyArray<{
        readonly cell: Cell;
        readonly value: HypothesisValue;
    }> = state.hypothesisOrder.flatMap(cell => {
        const v = HashMap.get(state.hypotheses, cell);
        return v._tag === "Some" ? [{ cell, value: v.value }] : [];
    });

    // Per-session dedupe so `insight_surfaced` only fires once per
    // unique insight (regardless of how many renders surface the same
    // row). Cleared on full-page reload, which matches the analytics
    // notion of a "session".
    const surfacedKeysRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        for (const ins of insights) {
            if (surfacedKeysRef.current.has(ins.dismissedKey)) continue;
            surfacedKeysRef.current.add(ins.dismissedKey);
            insightSurfaced({
                kind: ins.kind._tag as InsightKindTag,
                confidence: ins.confidence as InsightConfidenceTag,
            });
        }
    }, [insights]);

    const totalCount = insights.length + activeRows.length;
    const helpText = totalCount === 0
        ? t("insightsHelpEmpty")
        : activeRows.length === 0
            ? t("insightsHelpSuggestedOnly")
            : null;

    const onActiveClick = (cell: Cell) => {
        setPopoverCell(cell);
        if (state.uiMode !== "checklist" && !isDesktop) {
            dispatch({ type: "setUiMode", mode: "checklist" });
            // Wait for the mobile pane slide to settle before asking
            // Checklist to scroll/focus the cell — the Checklist
            // subtree only mounts on the new pane after the slide
            // completes, so cellNodesByKeyRef is empty until then.
            window.setTimeout(() => {
                requestFocusChecklistCell({ cell });
            }, Duration.toMillis(PANE_SETTLE));
        } else {
            requestFocusChecklistCell({ cell });
        }
    };

    return (
        <div
            className="mt-4 border-t border-border pt-4"
            data-tour-anchor="suggest-insights"
        >
            <h3 className="m-0 mb-1 font-sans! text-[1.125rem] font-bold uppercase tracking-wide text-accent">
                {totalCount === 0
                    ? t("insightsTitle")
                    : t("insightsTitleWithCount", { count: totalCount })}
            </h3>
            {helpText !== null ? (
                <p className="m-0 mb-2 text-[1.125rem] leading-snug text-muted">
                    {helpText}
                </p>
            ) : null}
            <LayoutGroup id="hypotheses-panel">
                {insights.length === 0 ? null : (
                    <ul className="m-0 mb-2 flex list-none flex-col gap-2 p-0">
                        <AnimatePresence
                            // eslint-disable-next-line i18next/no-literal-string -- AnimatePresence mode prop
                            mode="popLayout"
                            initial={false}
                        >
                            {insights.map(ins => (
                                <SuggestedRow
                                    key={cellLayoutId(ins.targetCell)}
                                    insight={ins}
                                    setup={state.setup}
                                    onAccept={() => {
                                        insightAccepted({
                                            kind: ins.kind._tag as InsightKindTag,
                                            confidence:
                                                ins.confidence as InsightConfidenceTag,
                                        });
                                        dispatch({
                                            type: "setHypothesis",
                                            cell: ins.targetCell,
                                            value: ins.proposedValue,
                                        });
                                    }}
                                    onDismiss={() => {
                                        insightDismissed({
                                            kind: ins.kind._tag as InsightKindTag,
                                            confidence:
                                                ins.confidence as InsightConfidenceTag,
                                        });
                                        dispatch({
                                            type: "dismissInsight",
                                            key: ins.dismissedKey,
                                            atConfidence: ins.confidence,
                                        });
                                    }}
                                />
                            ))}
                        </AnimatePresence>
                    </ul>
                )}
                {activeRows.length === 0 ? null : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                        <AnimatePresence
                            // eslint-disable-next-line i18next/no-literal-string -- AnimatePresence mode prop
                            mode="popLayout"
                            initial={false}
                        >
                            {activeRows.map(({ cell, value }) => (
                                <ActiveRow
                                    key={cellLayoutId(cell)}
                                    cell={cell}
                                    value={value}
                                    setup={state.setup}
                                    onClick={() => onActiveClick(cell)}
                                />
                            ))}
                        </AnimatePresence>
                    </ul>
                )}
            </LayoutGroup>
            {state.dismissedInsights.size === 0 ? null : (
                <button
                    type="button"
                    onClick={() => dispatch({ type: "clearDismissedInsights" })}
                    className="mt-2 cursor-pointer border-none bg-transparent p-0 text-[1rem] text-muted underline decoration-dotted underline-offset-2 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    data-action="clear-dismissed-insights"
                >
                    {t("clearDismissalsLink", {
                        count: state.dismissedInsights.size,
                    })}
                </button>
            )}
        </div>
    );
}

interface SuggestedRowProps {
    readonly insight: Insight;
    readonly onAccept: () => void;
    readonly onDismiss: () => void;
    readonly setup: ReturnType<typeof useClue>["state"]["setup"];
}

function SuggestedRow({
    insight,
    onAccept,
    onDismiss,
    setup,
}: SuggestedRowProps) {
    const t = useTranslations("suggestions");
    const layoutTransition = useReducedTransition(T_STANDARD);
    const exitTransition = useReducedTransition(T_FAST);
    const rationale = renderRationale(insight.kind, setup, t);
    const cardLabel = cardLabelOf(insight.kind, setup);
    const isCaseFile = insight.kind._tag === "SharedSuggestionFocus";
    const acceptAria = isCaseFile
        ? t("insightAcceptAriaCaseFile", { card: cardLabel })
        : t("insightAcceptAria", {
              suggester: String(playerSuggesterOf(insight.kind)),
              card: cardLabel,
          });
    const dismissAria = isCaseFile
        ? t("insightDismissAriaCaseFile")
        : t("insightDismissAria");

    return (
        <motion.li
            layout
            layoutId={cellLayoutId(insight.targetCell)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: exitTransition }}
            transition={layoutTransition}
            className="flex flex-wrap items-center gap-2 rounded border border-border bg-row-header px-2 py-1.5"
            data-insight-key={insight.dismissedKey}
            data-insight-kind={insight.kind._tag}
        >
            <div className="min-w-0 flex-1 text-[1rem]">
                <strong className="me-1">{t("insightSuggestedPrefix")}</strong>
                {rationale}
            </div>
            <ConfidencePill confidence={insight.confidence} />
            <div className="flex gap-1">
                <button
                    type="button"
                    onClick={onAccept}
                    aria-label={acceptAria}
                    className="rounded p-1 text-yes hover:bg-yes-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    data-action="accept"
                >
                    <CheckIcon size={16} />
                </button>
                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label={dismissAria}
                    className="rounded p-1 text-muted hover:bg-control focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    data-action="dismiss"
                >
                    <XIcon size={16} />
                </button>
            </div>
        </motion.li>
    );
}

interface ActiveRowProps {
    readonly cell: Cell;
    readonly value: HypothesisValue;
    readonly setup: ReturnType<typeof useClue>["state"]["setup"];
    readonly onClick: () => void;
}

function ActiveRow({ cell, value, setup, onClick }: ActiveRowProps) {
    const t = useTranslations("suggestions");
    const layoutTransition = useReducedTransition(T_STANDARD);
    const exitTransition = useReducedTransition(T_FAST);
    const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>;
    const chip = () => <ProseChecklistIcon value={value} />;
    const cardLabel = cardName(setup, cell.card);
    const isPlayer = cell.owner._tag === "Player";
    const ownerLabel = isPlayer
        ? String(cell.owner.player)
        : t("activeHypothesisCaseFileLabel");
    const label = isPlayer
        ? t.rich("activeHypothesisPlayer", {
              player: String(cell.owner.player),
              card: cardLabel,
              strong,
              chip,
          })
        : t.rich("activeHypothesisCaseFile", {
              caseFile: ownerLabel,
              card: cardLabel,
              strong,
              chip,
          });
    const aria = isPlayer
        ? t("activeHypothesisOpenAriaPlayer", {
              player: String(cell.owner.player),
              card: cardLabel,
              value,
          })
        : t("activeHypothesisOpenAriaCaseFile", {
              card: cardLabel,
              value,
          });
    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
        }
    };
    return (
        <motion.li
            layout
            layoutId={cellLayoutId(cell)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: exitTransition }}
            transition={layoutTransition}
            data-active-hypothesis-key={cellLayoutId(cell)}
            data-active-hypothesis-value={value}
        >
            <div
                role="button"
                tabIndex={0}
                onClick={onClick}
                onKeyDown={onKeyDown}
                aria-label={aria}
                className="flex cursor-pointer items-center gap-2 rounded border border-border px-2 py-1 text-[1rem] hover:bg-row-header focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <span className="min-w-0 flex-1">{label}</span>
                <ChevronRightIcon
                    size={14}
                    className="shrink-0 text-muted"
                />
            </div>
        </motion.li>
    );
}

const CASE_FILE_OWNER_KEY = "case-file";

const cellLayoutId = (cell: Cell): string => {
    const ownerKey = cell.owner._tag === "Player"
        ? `p-${String(cell.owner.player)}`
        : CASE_FILE_OWNER_KEY;
    return `hyp-${ownerKey}-${String(cell.card)}`;
};

const CONFIDENCE_PILL_CLASSES: Readonly<Record<InsightConfidence, string>> = {
    high: "bg-yes-bg text-yes",
    med: "bg-row-header text-fg",
    low: "bg-control text-muted",
};

// i18n key per confidence level. Kept as a typed constant so the
// per-bucket key lookup doesn't trip the `i18next/no-literal-string`
// lint rule on inline ternaries.
const CONFIDENCE_LABEL_KEY: Readonly<Record<InsightConfidence, string>> = {
    high: "insightConfidenceHigh",
    med: "insightConfidenceMed",
    low: "insightConfidenceLow",
};

function ConfidencePill({ confidence }: { confidence: InsightConfidence }) {
    const t = useTranslations("suggestions");
    return (
        <span
            data-confidence={confidence}
            className={`rounded px-1.5 py-0.5 text-[1rem] uppercase tracking-[0.04em] ${CONFIDENCE_PILL_CLASSES[confidence]}`}
        >
            {t(CONFIDENCE_LABEL_KEY[confidence])}
        </span>
    );
}

type RichTranslator = ReturnType<typeof useTranslations>;

const renderRationale = (
    kind: InsightKind,
    setup: ReturnType<typeof useClue>["state"]["setup"],
    t: RichTranslator,
) => {
    const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>;
    switch (kind._tag) {
        case "FrequentSuggester":
            return t.rich("insightFrequentSuggester", {
                suggester: String(kind.suggester),
                card: cardName(setup, kind.card),
                count: kind.count,
                strong,
            });
        case "CategoricalHole":
            return t.rich("insightCategoricalHole", {
                suggester: String(kind.suggester),
                category: categoryName(setup, kind.category),
                card: cardName(setup, kind.missingCard),
                strong,
            });
        case "DualSignal":
            return t.rich("insightDualSignal", {
                suggester: String(kind.suggester),
                card: cardName(setup, kind.card),
                count: kind.count,
                category: categoryName(setup, kind.category),
                strong,
            });
        case "SharedSuggestionFocus":
            return t.rich("insightSharedSuggestionFocus", {
                card: cardName(setup, kind.card),
                distinctSuggesters: kind.distinctSuggesters,
                strong,
            });
    }
};

const cardLabelOf = (
    kind: InsightKind,
    setup: ReturnType<typeof useClue>["state"]["setup"],
): string => {
    switch (kind._tag) {
        case "FrequentSuggester":
        case "DualSignal":
        case "SharedSuggestionFocus":
            return cardName(setup, kind.card);
        case "CategoricalHole":
            return cardName(setup, kind.missingCard);
    }
};

/**
 * The single suggester a player-targeted insight focuses on. Only
 * defined for kinds whose target cell is `(player, card)`; case-file
 * insights (`SharedSuggestionFocus`) have multiple suggesters and use
 * a separate aria template that doesn't mention any specific player.
 */
const playerSuggesterOf = (
    kind: InsightKind,
): Player | undefined => {
    switch (kind._tag) {
        case "FrequentSuggester":
        case "CategoricalHole":
        case "DualSignal":
            return kind.suggester;
        case "SharedSuggestionFocus":
            return undefined;
    }
};
