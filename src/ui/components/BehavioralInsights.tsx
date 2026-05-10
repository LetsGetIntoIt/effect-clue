"use client";

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
import { cardName, categoryName } from "../../logic/GameSetup";
import { useClue } from "../state";
import { CheckIcon, XIcon } from "./Icons";

/**
 * Bottom section of the suggestion log: "Insights" — soft, behavior-
 * driven hypothesis suggestions surfaced from the suggestion log
 * (see {@link Insight}). Each row maps to a one-click `setHypothesis`
 * dispatch on its target cell, or a `dismissInsight` that suppresses
 * this row until the underlying signal grows strictly past its
 * current confidence tier.
 */
export function BehavioralInsights() {
    const t = useTranslations("suggestions");
    const { derived, dispatch, state } = useClue();
    const insights = derived.behavioralInsights;

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

    return (
        <div
            className="mt-4 border-t border-border pt-4"
            data-tour-anchor="suggest-insights"
        >
            <h3 className="m-0 mb-1 text-[14px] font-semibold">
                {insights.length === 0
                    ? t("insightsTitle")
                    : t("insightsTitleWithCount", { count: insights.length })}
            </h3>
            <p className="m-0 mb-2 text-[12px] leading-snug text-muted">
                {t("insightsHelp")}
            </p>
            {insights.length === 0 ? null : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {insights.map(ins => (
                        <InsightRow
                            key={ins.dismissedKey}
                            insight={ins}
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
                            setup={state.setup}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
}

interface InsightRowProps {
    readonly insight: Insight;
    readonly onAccept: () => void;
    readonly onDismiss: () => void;
    readonly setup: ReturnType<typeof useClue>["state"]["setup"];
}

function InsightRow({
    insight,
    onAccept,
    onDismiss,
    setup,
}: InsightRowProps) {
    const t = useTranslations("suggestions");
    const rationale = renderRationale(insight.kind, setup, t);
    const cardLabel = cardLabelOf(insight.kind, setup);
    const playerLabel = playerLabelOf(insight.kind);

    return (
        <li
            className="flex flex-wrap items-center gap-2 rounded border border-border bg-row-header px-2 py-1.5"
            data-insight-key={insight.dismissedKey}
            data-insight-kind={insight.kind._tag}
        >
            <div className="min-w-0 flex-1 text-[13px]">{rationale}</div>
            <ConfidencePill confidence={insight.confidence} />
            <div className="flex gap-1">
                <button
                    type="button"
                    onClick={onAccept}
                    aria-label={t("insightAcceptAria", {
                        suggester: playerLabel,
                        card: cardLabel,
                    })}
                    className="rounded p-1 text-yes hover:bg-yes-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    data-action="accept"
                >
                    <CheckIcon size={16} />
                </button>
                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label={t("insightDismissAria", {
                        suggester: playerLabel,
                        card: cardLabel,
                    })}
                    className="rounded p-1 text-muted hover:bg-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    data-action="dismiss"
                >
                    <XIcon size={16} />
                </button>
            </div>
        </li>
    );
}

const CONFIDENCE_PILL_CLASSES: Readonly<Record<InsightConfidence, string>> = {
    high: "bg-yes-bg text-yes",
    med: "bg-row-header text-fg",
    low: "bg-bg text-muted",
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
            className={`rounded px-1.5 py-0.5 text-[11px] uppercase tracking-[0.04em] ${CONFIDENCE_PILL_CLASSES[confidence]}`}
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
    }
};

const cardLabelOf = (
    kind: InsightKind,
    setup: ReturnType<typeof useClue>["state"]["setup"],
): string => {
    switch (kind._tag) {
        case "FrequentSuggester":
        case "DualSignal":
            return cardName(setup, kind.card);
        case "CategoricalHole":
            return cardName(setup, kind.missingCard);
    }
};

const playerLabelOf = (kind: InsightKind): string => String(kind.suggester);
