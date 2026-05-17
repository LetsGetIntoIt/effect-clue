"use client";

import { Result } from "effect";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { type Card, type Player, PlayerOwner } from "../../logic/GameObjects";
import { cardName, type GameSetup } from "../../logic/GameSetup";
import type { Perspective } from "../../logic/Perspective";
import {
    classifyRefuteCandidates,
    type PriorReveal,
    type RefuteAdviceCandidate,
    type RefuteAdviceTier,
} from "../../logic/RefuteAdvice";
import { useClue } from "../state";
import { buildCellWhy } from "./cellWhy";

interface Props {
    /**
     * When true, the parent surface (mobile FAB teaser, or the
     * desktop section's collapsed banner-only header) is in its
     * collapsed state. The panel renders nothing in that case —
     * the user expands the surface to see the advice.
     */
    readonly teaser?: boolean;
    /**
     * Banner variant — `"stacked"` is the full-width mobile bar that
     * sits above the BottomNav when the FAB panel is closed. The
     * panel never renders inside the stacked-bar variant; it appears
     * only when the user opens the My Cards surface and the default
     * banner is rendered.
     */
    readonly variant?: "default" | "stacked";
}

// Hoist literal i18n key constants so `i18next/no-literal-string`
// doesn't flag inline lookups, and so `scripts/check-i18n-keys.mjs`
// finds each key string in source.
const TIER_LABEL_KEY: Record<RefuteAdviceTier, string> = {
    alreadyShownToSuggester: "tierAlreadyShownToSuggesterLabel",
    suggesterCanDeduce: "tierSuggesterCanDeduceLabel",
    alreadyShownToOther: "tierAlreadyShownToOtherLabel",
    freshLeak: "tierFreshLeakLabel",
};

const KEY_RATIONALE_ALREADY_SHOWN_TO_SUGGESTER =
    "rationaleAlreadyShownToSuggester";
const KEY_RATIONALE_ALREADY_SHOWN_TO_SUGGESTER_SOLE =
    "rationaleAlreadyShownToSuggesterSole";
const KEY_RATIONALE_SUGGESTER_CAN_DEDUCE_SUMMARY =
    "rationaleSuggesterCanDeduceSummary";
const KEY_RATIONALE_SUGGESTER_CAN_DEDUCE_SOLE_SUMMARY =
    "rationaleSuggesterCanDeduceSoleSummary";
const KEY_RATIONALE_SUGGESTER_CAN_DEDUCE_DETAILS =
    "rationaleSuggesterCanDeduceDetailsToggle";
const KEY_RATIONALE_ALREADY_SHOWN_TO_OTHER = "rationaleAlreadyShownToOther";
const KEY_RATIONALE_ALREADY_SHOWN_TO_OTHER_SOLE =
    "rationaleAlreadyShownToOtherSole";
const KEY_RATIONALE_FRESH_LEAK = "rationaleFreshLeak";
const KEY_RATIONALE_FRESH_LEAK_SOLE = "rationaleFreshLeakSole";
const KEY_ALL_FRESH_LEAK_NOTE = "allFreshLeakNote";

/**
 * Refute-advice panel rendered below the existing `SuggestionBanner`
 * in the `KIND_CAN_REFUTE` branch. Classifies each candidate refute
 * card by leak tier and renders plain-English rationale per row,
 * highlighting the lowest-leak option(s).
 *
 * Returns `null` when:
 *   - teach-me mode is on (deducer-derived advice is suppressed);
 *   - identity unset (`selfPlayerId === null`);
 *   - no in-flight draft;
 *   - the draft has no suggester or no cards yet;
 *   - self is the suggester (refute-advice is for refuters);
 *   - none of self's cards match the drafted triple;
 *   - the surface is in teaser / stacked-collapsed state.
 *
 * Defense-in-depth: the existing teach-mode gates at the call sites
 * (`MyHandPanel.tsx`, `MyCardsFAB.tsx`) already suppress this surface;
 * the in-component gate is so future call sites can't bypass it.
 */
export function RefuteAdvicePanel({
    teaser = false,
    variant = "default",
}: Props = {}) {
    const t = useTranslations("refuteAdvice");
    const tDeduce = useTranslations("deduce");
    const tReasons = useTranslations("reasons");
    const advice = useRefuteAdvice();

    if (advice === null) return null;
    if (teaser || variant === "stacked") return null;
    if (advice.candidates.length === 0) return null;

    const { candidates, pendingSuggester, perspective, selfPlayer, setup } =
        advice;
    const soleCandidate = candidates.length === 1;
    // When every candidate is a fresh leak (best tier across all
    // candidates IS freshLeak) and there's more than one of them,
    // there's no "Recommended" or even "Acceptable" pick — every
    // choice leaks a new card and the user must decide. Render a
    // single panel-level "forced" note in place of per-row rationale
    // and per-row Recommended badges. The sole-Tier-4 case keeps its
    // own per-row "forced" rationale (`rationaleFreshLeakSole`) since
    // it phrases the same idea around a single candidate.
    const allFreshLeak =
        !soleCandidate &&
        candidates.find(c => c.recommended)?.tier === "freshLeak";

    return (
        <section
            data-tour-anchor="refute-advice"
            aria-labelledby="refute-advice-title"
            className="mt-2 rounded border border-border/30 bg-panel p-2.5"
        >
            <h3
                id="refute-advice-title"
                className="m-0 mb-2 font-sans! text-[1rem] font-bold uppercase tracking-wide text-accent"
            >
                {t("title")}
            </h3>
            {allFreshLeak ? (
                <p
                    data-refute-advice-forced-note=""
                    className="m-0 mb-2 text-[1rem] leading-snug text-muted"
                >
                    {t(KEY_ALL_FRESH_LEAK_NOTE)}
                </p>
            ) : null}
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {candidates.map(c => (
                    <RefuteAdviceRow
                        key={c.card}
                        candidate={c}
                        pendingSuggester={pendingSuggester}
                        perspective={perspective}
                        selfPlayer={selfPlayer}
                        setup={setup}
                        soleCandidate={soleCandidate}
                        allFreshLeak={allFreshLeak}
                        t={t}
                        tDeduce={tDeduce}
                        tReasons={tReasons}
                    />
                ))}
            </ul>
        </section>
    );
}

interface RowProps {
    readonly candidate: RefuteAdviceCandidate;
    readonly pendingSuggester: Player;
    readonly perspective: Perspective | undefined;
    readonly selfPlayer: Player;
    readonly setup: GameSetup;
    readonly soleCandidate: boolean;
    /**
     * True when ALL candidates are fresh leaks AND there's more than
     * one of them — the "all options leak something new, your call"
     * case. The row collapses to just the card name + the tier label;
     * no Recommended badge, no per-row rationale, no accent border —
     * the panel-level forced note frames the situation instead.
     */
    readonly allFreshLeak: boolean;
    readonly t: ReturnType<typeof useTranslations<"refuteAdvice">>;
    readonly tDeduce: ReturnType<typeof useTranslations<"deduce">>;
    readonly tReasons: ReturnType<typeof useTranslations<"reasons">>;
}

function RefuteAdviceRow({
    candidate,
    pendingSuggester,
    perspective,
    selfPlayer,
    setup,
    soleCandidate,
    allFreshLeak,
    t,
    tDeduce,
    tReasons,
}: RowProps) {
    const cardLabel = cardName(setup, candidate.card);
    const suggesterLabel = String(pendingSuggester);
    // "Recommended" badge fires for best-tier rows in a multi-
    // candidate scenario when there IS a real recommendation — i.e.
    // when the best tier is one of the safer tiers (already shown,
    // already deducible, partial leak). When every option is a fresh
    // leak there's no useful "best" to highlight, so the badge is
    // dropped and the panel-level forced note carries the framing.
    const showRecommendedBadge =
        candidate.recommended && !soleCandidate && !allFreshLeak;
    const rowClass = showRecommendedBadge
        ? "rounded border border-accent/40 bg-accent/10 p-2"
        : "rounded border border-border/30 bg-bg p-2";

    return (
        <li
            data-tier={candidate.tier}
            data-recommended={candidate.recommended ? "true" : "false"}
            className={rowClass}
        >
            <div className="flex items-center gap-2">
                <span className="font-semibold">{cardLabel}</span>
                <span className="rounded bg-panel px-1.5 py-0.5 text-[0.8125rem] text-muted">
                    {t(TIER_LABEL_KEY[candidate.tier])}
                </span>
                {showRecommendedBadge ? (
                    <span className="rounded bg-accent px-1.5 py-0.5 text-[0.8125rem] font-semibold text-white">
                        {t("recommendedBadge")}
                    </span>
                ) : null}
            </div>
            {allFreshLeak ? null : (
                <p className="m-0 mt-1 text-[1rem] leading-snug">
                    {renderRationale({
                        candidate,
                        cardLabel,
                        suggesterLabel,
                        setup,
                        soleCandidate,
                        t,
                    })}
                </p>
            )}
            {!allFreshLeak &&
            candidate.tier === "suggesterCanDeduce" &&
            perspective !== undefined &&
            candidate.perspectiveChain !== undefined &&
            candidate.perspectiveChain.length > 0 ? (
                <details className="mt-1 text-[1rem]">
                    <summary className="cursor-pointer text-muted">
                        {t(KEY_RATIONALE_SUGGESTER_CAN_DEDUCE_DETAILS, {
                            suggester: suggesterLabel,
                        })}
                    </summary>
                    <PerspectiveChainDetails
                        card={candidate.card}
                        selfPlayer={selfPlayer}
                        perspective={perspective}
                        setup={setup}
                        tDeduce={tDeduce}
                        tReasons={tReasons}
                    />
                </details>
            ) : null}
        </li>
    );
}

const renderRationale = (args: {
    readonly candidate: RefuteAdviceCandidate;
    readonly cardLabel: string;
    readonly suggesterLabel: string;
    readonly setup: GameSetup;
    readonly soleCandidate: boolean;
    readonly t: ReturnType<typeof useTranslations<"refuteAdvice">>;
}): React.ReactNode => {
    const { candidate, cardLabel, suggesterLabel, setup, soleCandidate, t } =
        args;
    // Every tier has a sole-variant rationale that leads with the
    // "this is your only matching card, so showing it is forced"
    // framing and then names what the leak level actually costs — so
    // the user sees both that the choice is forced AND what they're
    // revealing by playing the forced card.
    if (candidate.tier === "alreadyShownToSuggester") {
        const reveal: PriorReveal | undefined =
            candidate.priorRevealToSuggester;
        const tripleLabel = reveal
            ? formatPriorTriple(reveal, setup, t("tripleJoin"))
            : "";
        const key = soleCandidate
            ? KEY_RATIONALE_ALREADY_SHOWN_TO_SUGGESTER_SOLE
            : KEY_RATIONALE_ALREADY_SHOWN_TO_SUGGESTER;
        return t.rich(key, {
            card: cardLabel,
            suggester: suggesterLabel,
            priorTriple: tripleLabel,
            bold: boldChunks,
        });
    }
    if (candidate.tier === "suggesterCanDeduce") {
        const key = soleCandidate
            ? KEY_RATIONALE_SUGGESTER_CAN_DEDUCE_SOLE_SUMMARY
            : KEY_RATIONALE_SUGGESTER_CAN_DEDUCE_SUMMARY;
        return t.rich(key, {
            card: cardLabel,
            suggester: suggesterLabel,
            bold: boldChunks,
        });
    }
    if (candidate.tier === "alreadyShownToOther") {
        const others = candidate.priorRevealsToOthers.map(r =>
            String(r.suggester),
        );
        const othersLabel = joinOthers(others, t);
        const key = soleCandidate
            ? KEY_RATIONALE_ALREADY_SHOWN_TO_OTHER_SOLE
            : KEY_RATIONALE_ALREADY_SHOWN_TO_OTHER;
        return t.rich(key, {
            card: cardLabel,
            suggester: suggesterLabel,
            others: othersLabel,
            bold: boldChunks,
        });
    }
    // Tier 4
    if (soleCandidate) {
        return t.rich(KEY_RATIONALE_FRESH_LEAK_SOLE, {
            card: cardLabel,
            suggester: suggesterLabel,
            bold: boldChunks,
        });
    }
    return t.rich(KEY_RATIONALE_FRESH_LEAK, {
        card: cardLabel,
        suggester: suggesterLabel,
        bold: boldChunks,
    });
};

const formatPriorTriple = (
    reveal: PriorReveal,
    setup: GameSetup,
    joinStr: string,
): string =>
    reveal.triple.map(c => cardName(setup, c)).join(joinStr);

const joinOthers = (
    names: ReadonlyArray<string>,
    t: ReturnType<typeof useTranslations<"refuteAdvice">>,
): string => {
    if (names.length === 0) return "";
    if (names.length === 1) return names[0] ?? "";
    if (names.length === 2) {
        return [names[0], names[1]].join(t("othersJoinLast"));
    }
    const head = names.slice(0, -1).join(t("othersJoin"));
    const tail = names[names.length - 1] ?? "";
    return `${head}${t("othersJoinLast")}${tail}`;
};

function boldChunks(chunks: React.ReactNode): React.ReactNode {
    return <strong>{chunks}</strong>;
}

interface PerspectiveDetailsProps {
    readonly card: Card;
    readonly selfPlayer: Player;
    readonly perspective: Perspective;
    readonly setup: GameSetup;
    readonly tDeduce: ReturnType<typeof useTranslations<"deduce">>;
    readonly tReasons: ReturnType<typeof useTranslations<"reasons">>;
}

/**
 * Renders the suggester's perspective chain that proves self holds
 * the candidate card. Reuses `buildCellWhy` (the same consolidator
 * the cell-explanation popover uses) so the rendering language is
 * consistent across the app.
 *
 * Known limitation: `describeReason` is currently first-person
 * (`"You marked..."`) for `InitialKnownCard` entries. For a
 * perspective view those entries describe the viewer's own hand,
 * not self's — the wording reads slightly off. Follow-up: add a
 * `viewer` parameter to `describeReason` so it can produce
 * second/third-person variants.
 */
function PerspectiveChainDetails({
    card,
    selfPlayer,
    perspective,
    setup,
    tDeduce,
    tReasons,
}: PerspectiveDetailsProps) {
    const { state, derived } = useClue();
    const cellWhy = useMemo(
        () =>
            buildCellWhy({
                provenance: perspective.provenance,
                suggestions: derived.suggestionsAsData,
                accusations: derived.accusationsAsData,
                setup,
                owner: PlayerOwner(selfPlayer),
                card,
                knownCards: state.knownCards,
                hypotheses: state.hypotheses,
                tDeduce,
                tReasons,
            }),
        [
            perspective,
            derived.suggestionsAsData,
            derived.accusationsAsData,
            setup,
            selfPlayer,
            card,
            state.knownCards,
            state.hypotheses,
            tDeduce,
            tReasons,
        ],
    );

    if (cellWhy.reasoning.length === 0 && cellWhy.givens.length === 0) {
        return null;
    }

    return (
        <div className="mt-1 text-muted">
            {cellWhy.headline !== undefined ? (
                <p className="m-0 mb-1 font-semibold">{cellWhy.headline}</p>
            ) : null}
            {cellWhy.givens.length > 0 ? (
                <ul className="m-0 mb-1 list-disc pl-5">
                    {cellWhy.givens.map((line, i) => (
                        <li key={i}>{line}</li>
                    ))}
                </ul>
            ) : null}
            {cellWhy.reasoning.length > 0 ? (
                <ol className="m-0 list-decimal pl-5">
                    {cellWhy.reasoning.map((line, i) => (
                        <li key={i}>{line}</li>
                    ))}
                </ol>
            ) : null}
        </div>
    );
}

interface RefuteAdvice {
    readonly candidates: ReadonlyArray<RefuteAdviceCandidate>;
    readonly pendingSuggester: Player;
    readonly selfPlayer: Player;
    readonly perspective: Perspective | undefined;
    readonly setup: GameSetup;
}

/**
 * Module-internal hook. Derives the panel's payload from the
 * canonical state + the per-player perspectives in `derived`.
 * Returns `null` whenever the panel should be hidden — every gate
 * that suppresses the panel collapses into the same null branch.
 */
function useRefuteAdvice(): RefuteAdvice | null {
    const { state, derived } = useClue();
    return useMemo<RefuteAdvice | null>(() => {
        if (state.teachMode) return null;
        const selfPlayer = state.selfPlayerId;
        if (selfPlayer === null) return null;
        const draft = state.pendingSuggestion;
        if (draft === null) return null;
        const pendingSuggester = draft.suggester;
        if (pendingSuggester === null) return null;
        if (pendingSuggester === selfPlayer) return null;
        const filledCards = draft.cards.filter(
            (c): c is Card => c !== null,
        );
        if (filledCards.length === 0) return null;

        const myCards = new Set(
            state.knownCards
                .filter(kc => kc.player === selfPlayer)
                .map(kc => kc.card),
        );
        const handCandidates = filledCards.filter(c => myCards.has(c));
        if (handCandidates.length === 0) return null;

        const perspectiveResult = derived.perspectives.get(pendingSuggester);
        const perspective =
            perspectiveResult !== undefined && Result.isSuccess(perspectiveResult)
                ? perspectiveResult.success
                : undefined;

        const candidates = classifyRefuteCandidates({
            selfPlayer,
            pendingSuggester,
            handCandidates,
            suggestions: state.suggestions,
            suggesterPerspective: perspective,
        });

        return {
            candidates,
            pendingSuggester,
            selfPlayer,
            perspective,
            setup: state.setup,
        };
    }, [
        state.teachMode,
        state.selfPlayerId,
        state.pendingSuggestion,
        state.knownCards,
        state.suggestions,
        state.setup,
        derived.perspectives,
    ]);
}
