"use client";

import { Effect, Layer, Result } from "effect";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Card, Player } from "../../logic/GameObjects";
import { footnotesForCell } from "../../logic/Footnotes";
import { GameSetup, cardName } from "../../logic/GameSetup";
import { chainFor } from "../../logic/Provenance";
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
import {
    displayCard,
    displayCardOpt,
    displayPassers,
    displayPlayer,
    displayPlayerOpt,
    isNobody,
    MultiSelectList,
    NOBODY,
    type Nobody,
    type Option,
    PillPopover,
    pillStatusForCard,
    pillStatusForPassers,
    pillStatusForPlayer,
    SingleSelectList,
} from "./SuggestionPills";
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
                                        const categoryLabel = rawName.toLowerCase();
                                        return (
                                            <span key={ci}>
                                                {ci > 0 && " + "}
                                                {c === "any" ? (
                                                    <em className="text-muted">
                                                        {t("anyCategory", {
                                                            category: categoryLabel,
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
    const { state } = useClue();
    const suggestions = state.suggestions;
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
                <ol className="m-0 flex list-none flex-col gap-2 p-0">
                    {suggestions.map((s, idx) => (
                        <PriorSuggestionItem
                            key={s.id}
                            suggestion={s}
                            idx={idx}
                        />
                    ))}
                </ol>
            )}
        </div>
    );
}

/**
 * One row in the prior-suggestions list. Two display modes:
 *  - idle: renders the existing sentence pair ("Player 3 suggested …"
 *    + refutation summary).
 *  - pill-mode (hover or any pill-popover open): swaps in the pill row
 *    from the Add form, with live-commit semantics — every change
 *    dispatches `updateSuggestion`. No Add button, no auto-advance.
 *
 * The card outline surrounds the number, unlike the old native
 * `list-decimal` layout. When highlighted (self-hover, a popover is
 * open, or a checklist cell whose chain references this row is
 * hovered), the card flips to the red accent and pills render in the
 * `onAccent` inverse variant.
 */
function PriorSuggestionItem({
    suggestion: s,
    idx,
}: {
    readonly suggestion: DraftSuggestion;
    readonly idx: number;
}) {
    const t = useTranslations("suggestions");
    const { state, dispatch, derived } = useClue();
    const { setHoveredSuggestion, hoveredCell } = useHover();
    const setup = state.setup;
    const listFormatter = useListFormatter();

    const [isSelfHovered, setIsSelfHovered] = useState(false);
    const [openPillId, setOpenPillId] = useState<string | null>(null);

    // Pill-mode stays engaged while any popover is open, even if the
    // pointer has left the card (popovers render in a portal outside
    // our DOM subtree).
    const isInPillMode = isSelfHovered || openPillId !== null;

    // Cell → suggestion hover (reverse of the Checklist's
    // `cellIsHighlighted`). Two ways a cell can reference a suggestion:
    //   1. Provenance chain: the cell was SET by a rule that consulted
    //      this suggestion. `chainFor` walks back through dependsOn.
    //   2. Footnote candidacy: the cell is still in the running as the
    //      refuter's shown card for this suggestion (the superscript
    //      numbers in the grid). `footnotesForCell` indexes those,
    //      1-based, against the cell.
    const isHighlightedByCell = useMemo(() => {
        if (!hoveredCell) return false;
        if (derived.provenance) {
            for (const reason of chainFor(derived.provenance, hoveredCell)) {
                const tag = reason.kind._tag;
                if (
                    tag === "NonRefuters" ||
                    tag === "RefuterShowed" ||
                    tag === "RefuterOwnsOneOf"
                ) {
                    if (reason.kind.suggestionIndex === idx) return true;
                }
            }
        }
        if (derived.footnotes) {
            const fnNumbers = footnotesForCell(
                derived.footnotes,
                hoveredCell,
            );
            if (fnNumbers.includes(idx + 1)) return true;
        }
        return false;
    }, [hoveredCell, derived.provenance, derived.footnotes, idx]);

    const isHighlighted = isInPillMode || isHighlightedByCell;
    const pillVariant = isHighlighted ? "onAccent" : "default";

    const commit = (patch: Partial<DraftSuggestion>) =>
        dispatch({
            type: "updateSuggestion",
            suggestion: { ...s, ...patch },
        });

    const commitRefuter = (value: Player | Nobody) =>
        dispatch({
            type: "updateSuggestion",
            // Use destructure-without-field trick: exactOptionalPropertyTypes
            // requires absent key (not `undefined`) for the optional slot.
            suggestion: isNobody(value)
                ? ((): DraftSuggestion => {
                      const { refuter: _r, seenCard: _sc, ...rest } = s;
                      return rest;
                  })()
                : { ...s, refuter: value },
        });

    const commitSeenCard = (value: Card | Nobody) =>
        dispatch({
            type: "updateSuggestion",
            suggestion: isNobody(value)
                ? ((): DraftSuggestion => {
                      const { seenCard: _sc, ...rest } = s;
                      return rest;
                  })()
                : { ...s, seenCard: value },
        });

    const commitPassers = (value: ReadonlyArray<Player> | Nobody) =>
        dispatch({
            type: "updateSuggestion",
            suggestion: {
                ...s,
                nonRefuters: isNobody(value) ? [] : Array.from(new Set(value)),
            },
        });

    const clearRefuter = () => {
        const { refuter: _r, seenCard: _sc, ...rest } = s;
        dispatch({ type: "updateSuggestion", suggestion: rest });
    };
    const clearSeenCard = () => {
        const { seenCard: _sc, ...rest } = s;
        dispatch({ type: "updateSuggestion", suggestion: rest });
    };
    const clearPassers = () =>
        dispatch({
            type: "updateSuggestion",
            suggestion: { ...s, nonRefuters: [] },
        });

    const onRemove = () => {
        if (window.confirm(t("removeConfirm"))) {
            dispatch({ type: "removeSuggestion", id: s.id });
        }
    };

    // Option builders mirror the exclusion logic in SuggestionForm:
    // suggester ↔ refuter ↔ passers are pairwise disjoint in Clue.
    const playerChoices = (
        exclude: ReadonlyArray<Player | undefined>,
    ): ReadonlyArray<Option<Player>> => {
        const excl = new Set<Player>();
        for (const p of exclude) if (p !== undefined) excl.add(p);
        return setup.players
            .filter(p => !excl.has(p))
            .map(p => ({ value: p, label: String(p) }));
    };
    const suggesterOpts = useMemo(
        () => playerChoices([s.refuter, ...s.nonRefuters]),
        [s, setup.players],
    );
    const refuterOpts = useMemo(
        () => playerChoices([s.suggester, ...s.nonRefuters]),
        [s, setup.players],
    );
    const passersOpts = useMemo(
        () => playerChoices([s.suggester, s.refuter]),
        [s, setup.players],
    );
    const seenCardOpts = useMemo(
        () =>
            s.cards.flatMap((id): Array<Option<Card>> => {
                for (const cat of setup.categories) {
                    const entry = cat.cards.find(e => e.id === id);
                    if (entry !== undefined)
                        return [{ value: id, label: entry.name }];
                }
                return [];
            }),
        [s.cards, setup.categories],
    );

    const onMouseEnter = () => {
        setIsSelfHovered(true);
        setHoveredSuggestion(idx);
    };
    const onMouseLeave = () => {
        setIsSelfHovered(false);
        // Only clear the cross-panel hover if no popover is still open;
        // otherwise the Checklist halo disappears mid-edit.
        if (openPillId === null) setHoveredSuggestion(null);
    };

    // Pill open-state toggle shared by every pill on the row.
    const onOpenChangeFor = (pillId: string) => (open: boolean) => {
        setOpenPillId(prev =>
            open ? pillId : prev === pillId ? null : prev,
        );
        if (!open && !isSelfHovered) setHoveredSuggestion(null);
    };

    // Refuter pill disables the Shown card pill when absent (same rule
    // the Add form uses: can't pick a shown card if nobody refuted).
    const seenDisabled = s.refuter === undefined;

    // Passed-by value: map from DraftSuggestion's always-array shape
    // to the pill-status-friendly null-when-empty shape. The underlying
    // data can't distinguish "explicit nobody" from "not decided" —
    // empty array collapses both.
    const passersValue =
        s.nonRefuters.length === 0 ? null : s.nonRefuters;

    return (
        <li
            className={
                "relative flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2 text-[13px] transition-colors " +
                (isHighlighted
                    ? "border-accent bg-accent text-white"
                    : "border-border")
            }
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <span className="font-semibold">{idx + 1}.</span>
            <div className="min-w-0 flex-1 pr-5">
                {isInPillMode ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <PillPopover
                            pillId={`suggester-${s.id}`}
                            label={t("pillSuggester")}
                            status={pillStatusForPlayer(s.suggester, false)}
                            valueDisplay={displayPlayer(s.suggester)}
                            variant={pillVariant}
                            open={openPillId === `suggester-${s.id}`}
                            onOpenChange={onOpenChangeFor(`suggester-${s.id}`)}
                        >
                            <SingleSelectList<Player>
                                options={suggesterOpts}
                                selected={s.suggester}
                                onCommit={value => {
                                    if (!isNobody(value))
                                        commit({ suggester: value });
                                    setOpenPillId(null);
                                }}
                                nobodyLabel={null}
                                nobodyValue={null}
                            />
                        </PillPopover>

                        {setup.categories.map((cat, i) => {
                            const cardId = s.cards[i] ?? null;
                            const pid = `card-${s.id}-${i}`;
                            return (
                                <PillPopover
                                    key={cat.id}
                                    pillId={pid}
                                    label={cat.name}
                                    status={pillStatusForCard(cardId, false)}
                                    valueDisplay={displayCard(cardId, setup)}
                                    variant={pillVariant}
                                    open={openPillId === pid}
                                    onOpenChange={onOpenChangeFor(pid)}
                                >
                                    <SingleSelectList<Card>
                                        options={cat.cards.map(c => ({
                                            value: c.id,
                                            label: c.name,
                                        }))}
                                        selected={cardId}
                                        onCommit={value => {
                                            if (!isNobody(value)) {
                                                const next = [...s.cards];
                                                next[i] = value;
                                                commit({ cards: next });
                                            }
                                            setOpenPillId(null);
                                        }}
                                        nobodyLabel={null}
                                        nobodyValue={null}
                                    />
                                </PillPopover>
                            );
                        })}

                        <PillPopover
                            pillId={`passers-${s.id}`}
                            label={t("pillPassers")}
                            status={pillStatusForPassers(passersValue)}
                            valueDisplay={displayPassers(passersValue, t)}
                            variant={pillVariant}
                            open={openPillId === `passers-${s.id}`}
                            onOpenChange={onOpenChangeFor(`passers-${s.id}`)}
                            onClear={
                                s.nonRefuters.length > 0
                                    ? clearPassers
                                    : undefined
                            }
                        >
                            <MultiSelectList
                                options={passersOpts}
                                selected={s.nonRefuters}
                                nobodyChosen={false}
                                nobodyLabel={t("popoverNobodyPassed")}
                                commitHint={t("popoverCommitHint")}
                                onCommit={commitPassers}
                            />
                        </PillPopover>

                        <PillPopover
                            pillId={`refuter-${s.id}`}
                            label={t("pillRefuter")}
                            status={pillStatusForPlayer(
                                s.refuter ?? null,
                                true,
                            )}
                            valueDisplay={displayPlayerOpt(
                                s.refuter ?? null,
                                t,
                            )}
                            variant={pillVariant}
                            open={openPillId === `refuter-${s.id}`}
                            onOpenChange={onOpenChangeFor(`refuter-${s.id}`)}
                            onClear={
                                s.refuter !== undefined ? clearRefuter : undefined
                            }
                        >
                            <SingleSelectList<Player>
                                options={refuterOpts}
                                selected={s.refuter ?? null}
                                onCommit={value => {
                                    commitRefuter(value);
                                    setOpenPillId(null);
                                }}
                                nobodyLabel={t("popoverNobodyRefuted")}
                                nobodyValue={NOBODY}
                            />
                        </PillPopover>

                        <PillPopover
                            pillId={`seenCard-${s.id}`}
                            label={t("pillSeen")}
                            status={pillStatusForCard(
                                s.seenCard ?? null,
                                true,
                            )}
                            valueDisplay={displayCardOpt(
                                s.seenCard ?? null,
                                setup,
                                t,
                            )}
                            disabled={seenDisabled}
                            disabledHint={t("pillSeenDisabledHint")}
                            variant={pillVariant}
                            open={openPillId === `seenCard-${s.id}`}
                            onOpenChange={onOpenChangeFor(
                                `seenCard-${s.id}`,
                            )}
                            onClear={
                                s.seenCard !== undefined
                                    ? clearSeenCard
                                    : undefined
                            }
                        >
                            <SingleSelectList<Card>
                                options={seenCardOpts}
                                selected={s.seenCard ?? null}
                                onCommit={value => {
                                    commitSeenCard(value);
                                    setOpenPillId(null);
                                }}
                                nobodyLabel={t("popoverNoShownCard")}
                                nobodyValue={NOBODY}
                            />
                        </PillPopover>
                    </div>
                ) : (
                    <>
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
                        <div
                            className={
                                isHighlighted
                                    ? "text-[13px] text-white/80"
                                    : "text-[13px] text-muted"
                            }
                        >
                            {t.rich("refutationLine", {
                                status: refutationStatus(s),
                                refuter: s.refuter ? String(s.refuter) : "",
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
                    </>
                )}
            </div>
            <button
                type="button"
                aria-label={t("removeAction")}
                className={
                    "absolute right-1.5 top-1 cursor-pointer rounded border-none bg-transparent px-1 text-[16px] leading-none " +
                    (isHighlighted
                        ? "text-white/70 hover:text-white"
                        : "text-muted hover:text-accent")
                }
                onClick={onRemove}
            >
                ×
            </button>
        </li>
    );
}
