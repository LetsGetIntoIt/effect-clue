"use client";

import { Effect, Layer, Result } from "effect";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Player } from "../../logic/GameObjects";
import { cardName } from "../../logic/GameSetup";
import {
    consolidateRecommendations,
    describeRecommendation,
    recommendSuggestions,
} from "../../logic/Recommender";
import {
    makeKnowledgeLayer,
    makeSetupLayer,
} from "../../logic/services";
import { useHover } from "../HoverContext";
import { useListFormatter } from "../hooks/useListFormatter";
import { SuggestionForm } from "./SuggestionForm";
import { Tooltip } from "./Tooltip";
import {
    DraftSuggestion,
    useClue,
} from "../state";

const SECTION_TITLE = "mt-0 mb-2 text-[14px] font-semibold";
// Kept for the recommendations chooser below — the suggestion form
// no longer uses these classes (it renders pills, not <select>s).
const SELECT_CLASS =
    "flex-1 rounded border border-border p-1.5 text-[13px]";
const LABEL_ROW = "flex items-center gap-1.5 text-[13px]";

/**
 * Consolidated card for everything the solver's primary loop touches:
 * adding a suggestion, getting recommendations for the next one, and
 * reviewing / editing the log of prior suggestions.
 */
export function SuggestionLogPanel() {
    const t = useTranslations("suggestions");
    return (
        <section className="min-w-0 rounded-[var(--radius)] border border-border bg-panel p-4">
            <h2 className="m-0 mb-3 text-[16px] uppercase tracking-[0.05em] text-accent">
                {t("title")}
            </h2>
            <div className="mb-5">
                <Recommendations />
            </div>
            <AddSuggestion />
            <PriorSuggestions />
        </section>
    );
}

/**
 * Top of the log: the pill-driven form for composing a new
 * suggestion. Delegates the entire UI to `<SuggestionForm>` — the
 * panel only wires the reducer dispatch.
 */
function AddSuggestion() {
    const { dispatch, state } = useClue();
    return (
        <SuggestionForm
            setup={state.setup}
            onSubmit={draft =>
                dispatch({ type: "addSuggestion", suggestion: draft })
            }
        />
    );
}

/**
 * Pick the ICU `select` branch for the refutation-summary template
 * in `suggestions.refutationLine`. Combining the refuted/nobody axis
 * with the seen-card and non-refuters axes via select keeps the copy
 * as a single translatable sentence per case rather than a
 * concatenation of fragments.
 */
const refutationStatus = (
    s: DraftSuggestion,
):
    | "refutedSeenPassed"
    | "refutedSeen"
    | "refutedPassed"
    | "refuted"
    | "nobodyPassed"
    | "nobody" => {
    const hasRefuter = s.refuter !== undefined;
    const hasSeen = s.seenCard !== undefined;
    const hasPassers = s.nonRefuters.length > 0;
    if (hasRefuter && hasSeen && hasPassers) return "refutedSeenPassed";
    if (hasRefuter && hasSeen) return "refutedSeen";
    if (hasRefuter && hasPassers) return "refutedPassed";
    if (hasRefuter) return "refuted";
    if (hasPassers) return "nobodyPassed";
    return "nobody";
};

function Recommendations() {
    const t = useTranslations("suggestions");
    const tRecs = useTranslations("recommendations");
    const { state, derived } = useClue();
    const setup = state.setup;
    const result = derived.deductionResult;
    const [asPlayer, setAsPlayer] = useState<string>(
        setup.players[0] ?? "",
    );
    // Collapsed by default — the recommendation body runs a non-trivial
    // Effect.runSync per render, so skipping it while closed keeps the
    // suggestion-log panel snappy for users who don't need the hint.
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        if (asPlayer && setup.players.some(p => String(p) === asPlayer))
            return;
        setAsPlayer(setup.players[0] ?? "");
    }, [setup.players, asPlayer]);

    // Wrapping the button in an <h3> matches the sibling "Add a
    // suggestion" header: globals.css applies the display font to all
    // h1–h3 (and SECTION_TITLE sets shared size/weight), so the two
    // headings render identically. The button owns aria-expanded and
    // the click behaviour; the caret is trailing so every header in
    // this pane starts at the same x.
    const header = (
        <h3 className={SECTION_TITLE}>
            <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded(v => !v)}
                className="flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-left font-[inherit] text-[inherit] hover:text-accent"
            >
                <span>{t("recommendationsTitle")}</span>
                <span
                    aria-hidden
                    className="inline-block text-[16px] leading-none text-muted"
                >
                    {/* eslint-disable-next-line i18next/no-literal-string */}
                    {expanded ? "▾" : "▸"}
                </span>
            </button>
        </h3>
    );

    if (!expanded) {
        return <div>{header}</div>;
    }

    const knowledge = Result.getOrUndefined(result);
    if (knowledge === undefined || !asPlayer) {
        return (
            <div>
                {header}
                <div className="mt-2 text-[13px] text-muted">
                    {knowledge === undefined
                        ? t("resolveContradictionFirst")
                        : t("addPlayersFirst")}
                </div>
            </div>
        );
    }

    // Shared service layer for the three recommender Effect.gen
    // paths below — built once per render, reused across all calls.
    const recommendLayer = useMemo(
        () =>
            Layer.mergeAll(
                makeSetupLayer(setup),
                makeKnowledgeLayer(knowledge),
            ),
        [setup, knowledge],
    );

    const rec = Effect.runSync(
        recommendSuggestions(Player(asPlayer), 50).pipe(
            Effect.provide(recommendLayer),
        ),
    );
    const consolidated = Effect.runSync(
        consolidateRecommendations(rec.recommendations).pipe(
            Effect.provide(recommendLayer),
        ),
    ).slice(0, 5);

    return (
        <div>
            {header}
            <label className={`${LABEL_ROW} mt-2`}>
                {t("suggestingAs")}
                <select
                    value={asPlayer}
                    onChange={e => setAsPlayer(e.currentTarget.value)}
                    className={SELECT_CLASS}
                >
                    {setup.players.map(p => (
                        <option key={p} value={p}>
                            {p}
                        </option>
                    ))}
                </select>
            </label>
            {consolidated.length === 0 ? (
                <div className="mt-2 text-[13px] text-muted">
                    {t("nothingUseful")}
                </div>
            ) : (
                <ol className="mt-2 list-decimal pl-6 text-[13px]">
                    {consolidated.map((r, i) => {
                        const desc = Effect.runSync(
                            describeRecommendation({
                                cards: r.cards.flatMap(c =>
                                    c === "any" ? [] : [c],
                                ),
                                cellInfoScore: r.cellInfoScore,
                                caseFileOpennessScore: r.caseFileOpennessScore,
                                refuterUncertaintyScore: r.refuterUncertaintyScore,
                            }).pipe(Effect.provide(recommendLayer)),
                        );
                        const explanation = tRecs(desc.kind, desc.params);
                        const scoreBreakdown = (
                            <div>
                                <div className="font-semibold">
                                    {t("scoreBreakdownHeader", {
                                        score: r.score,
                                    })}
                                </div>
                                <div className="mt-1 text-muted">
                                    {t("scoreBreakdownDetails", {
                                        info: r.cellInfoScore,
                                        combos: r.caseFileOpennessScore,
                                        refuters: r.refuterUncertaintyScore,
                                    })}
                                </div>
                                {r.groupSize > 1 && (
                                    <div className="mt-1 text-muted">
                                        {t("scoreBreakdownCoverage", {
                                            count: r.groupSize,
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                        return (
                            <Tooltip key={i} content={scoreBreakdown}>
                            <li className="py-1.5">
                                <div>
                                    {r.cards.map((c, ci) => {
                                        const rawName =
                                            setup.categories[ci]?.name ??
                                            t("defaultCategorySingular");
                                        // Category names are typically plural
                                        // ("Weapons", "Rooms"); strip a trailing
                                        // "s" so the collapsed label reads as
                                        // "any weapon / room" rather than
                                        // "any weapons / rooms".
                                        const singular = rawName.replace(
                                            /s$/,
                                            "",
                                        ).toLowerCase();
                                        return (
                                            <span key={ci}>
                                                {ci > 0 && " + "}
                                                {c === "any" ? (
                                                    <em className="text-muted">
                                                        {t("anyCategory", {
                                                            category: singular,
                                                        })}
                                                    </em>
                                                ) : (
                                                    <strong>
                                                        {cardName(setup, c)}
                                                    </strong>
                                                )}
                                            </span>
                                        );
                                    })}
                                    <span className="ml-1 text-muted">
                                        {t("score", { score: r.score })}
                                    </span>
                                </div>
                                <div className="text-[12px] text-muted">
                                    {explanation}
                                </div>
                            </li>
                            </Tooltip>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}

function PriorSuggestions() {
    const t = useTranslations("suggestions");
    const { state, dispatch } = useClue();
    const { hoveredSuggestionIndex, setHoveredSuggestion } = useHover();
    const setup = state.setup;
    const suggestions = state.suggestions;
    const [editingId, setEditingId] = useState<string | null>(null);
    // "and"-aware list join for the passers line ("Player 2, Player 3
    // and Player 4 could not refute"). Defaults (long / conjunction)
    // are what we want — no args needed. Cards stay joined with " + "
    // in the suggested line because that separator is load-bearing
    // visual branding for the suggestion triple, not a natural-
    // language list.
    const listFormatter = useListFormatter();
    return (
        <div className="mt-4 border-t border-border pt-4">
            <h3 className={SECTION_TITLE}>
                {t("priorTitle", { count: suggestions.length })}
            </h3>
            {suggestions.length === 0 ? (
                <div className="text-[13px] text-muted">
                    {t("priorEmpty")}
                </div>
            ) : (
                <ol className="m-0 max-h-[300px] list-decimal overflow-y-auto pl-6">
                    {suggestions.map((s, idx) => {
                        const isHovered = hoveredSuggestionIndex === idx;
                        const highlightClass = isHovered
                            ? " -mx-2 rounded bg-yes-bg/40 px-2 ring-1 ring-accent/60"
                            : "";
                        return editingId === s.id ? (
                            <li
                                key={s.id}
                                className="border-b border-border py-2 text-[13px] last:border-b-0"
                            >
                                <SuggestionForm
                                    setup={setup}
                                    suggestion={s}
                                    onSubmit={updated => {
                                        dispatch({
                                            type: "updateSuggestion",
                                            suggestion: updated,
                                        });
                                        setEditingId(null);
                                    }}
                                    onCancel={() => setEditingId(null)}
                                />
                            </li>
                        ) : (
                            <li
                                key={s.id}
                                className={
                                    "border-b border-border py-2 text-[13px] last:border-b-0 transition-[background-color,box-shadow] duration-100" +
                                    highlightClass
                                }
                                onMouseEnter={() => setHoveredSuggestion(idx)}
                                onMouseLeave={() => setHoveredSuggestion(null)}
                            >
                                <div>
                                    {t.rich("suggestedLine", {
                                        suggester: String(s.suggester),
                                        cards: s.cards
                                            .map(id => cardName(setup, id))
                                            .join(" + "),
                                        strong: chunks => (
                                            <strong>{chunks}</strong>
                                        ),
                                    })}
                                </div>
                                <div className="text-[13px] text-muted">
                                    {t.rich("refutationLine", {
                                        status: refutationStatus(s),
                                        refuter: s.refuter
                                            ? String(s.refuter)
                                            : "",
                                        seen: s.seenCard
                                            ? cardName(setup, s.seenCard)
                                            : "",
                                        passers: listFormatter.format(
                                            s.nonRefuters.map(String),
                                        ),
                                        strong: chunks => (
                                            <strong>{chunks}</strong>
                                        ),
                                    })}
                                </div>
                                <div className="mt-1 flex gap-2">
                                    <button
                                        type="button"
                                        className="cursor-pointer border-none bg-transparent p-0 text-[12px] text-accent underline"
                                        onClick={() =>
                                            setEditingId(s.id)
                                        }
                                    >
                                        {t("editAction")}
                                    </button>
                                    <button
                                        type="button"
                                        className="cursor-pointer border-none bg-transparent p-0 text-[12px] text-danger underline"
                                        onClick={() =>
                                            dispatch({
                                                type: "removeSuggestion",
                                                id: s.id,
                                            })
                                        }
                                    >
                                        {t("removeAction")}
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}
