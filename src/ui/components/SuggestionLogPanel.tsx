"use client";

import { Effect, Layer, Result } from "effect";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Player } from "../../logic/GameObjects";
import { footnotesForCell } from "../../logic/Footnotes";
import { cardName } from "../../logic/GameSetup";
import { chainFor } from "../../logic/Provenance";
import {
    consolidateRecommendations,
    describeRecommendation,
    isAnySlot,
    recommendSuggestions,
} from "../../logic/Recommender";
import type { AnySlot } from "../../logic/Recommender";
import {
    makeKnowledgeLayer,
    makeSetupLayer,
} from "../../logic/services";
import { useConfirm } from "../hooks/useConfirm";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { useListFormatter } from "../hooks/useListFormatter";
import { useSelection } from "../SelectionContext";
import { InfoPopover } from "./InfoPopover";
import {
    SuggestionForm,
    type FormState,
    type PillErrorCode,
    type PillId,
    PILL_PASSERS,
    PILL_REFUTER,
    PILL_SEEN,
    PILL_SUGGESTER,
    validateFormConsistency,
} from "./SuggestionForm";
import {
    displayCard,
    displayCardOpt,
    displayPassers,
    displayPlayer,
    displayPlayerOpt,
    isInsideSuggestionPopover,
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
import {
    DraftSuggestion,
    useClue,
} from "../state";
import {
    T_FAST,
    T_SPRING_SOFT,
    T_STANDARD,
    useReducedTransition,
} from "../motion";
import { label, matches } from "../keyMap";

const SECTION_TITLE = "mt-0 mb-2 text-[14px] font-semibold";
// Non user-facing glyph rendered as the rotating caret on
// the Recommendations expand/collapse header.
const CARET_GLYPH = "\u25B8";
const HEIGHT_AUTO = "auto";
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

/**
 * Render a collapsed `AnySlot` (e.g. "any weapon owned by Green") into
 * a localized phrase. Keyed off `AnySlot.kind` so adding a new variant
 * is a compile error here — forcing us to supply a translation.
 */
const renderAnySlot = (
    t: ReturnType<typeof useTranslations<"suggestions">>,
    slot: AnySlot,
    singular: string,
): string => {
    switch (slot.kind) {
        case "any":
            return t("anyCategory", { category: singular });
        case "anyYouOwn":
            return t("anyCategoryYouOwn", { category: singular });
        case "anyYouDontOwn":
            return t("anyCategoryYouDontOwn", { category: singular });
        case "anyYouDontKnow":
            return t("anyCategoryYouDontKnow", { category: singular });
        case "anyNotInCaseFile":
            return t("anyCategoryNotInCaseFile", { category: singular });
        case "anyOwnedBy":
            return t("anyCategoryOwnedBy", {
                category: singular,
                player: String(slot.player),
            });
        case "anyNotOwnedBy":
            return t("anyCategoryNotOwnedBy", {
                category: singular,
                player: String(slot.player),
            });
    }
};

function RecommendationInfoIcon({ content }: { readonly content: React.ReactNode }) {
    const tCommon = useTranslations("common");
    return (
        <InfoPopover asButton content={content} side="left">
            {tCommon("infoGlyph")}
        </InfoPopover>
    );
}

function Recommendations() {
    const t = useTranslations("suggestions");
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
    const caretTransition = useReducedTransition(T_STANDARD);
    const bodyTransition = useReducedTransition(T_STANDARD);
    const header = (
        <h3 className={SECTION_TITLE}>
            <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded(v => !v)}
                className="flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-left font-[inherit] text-[inherit] hover:text-accent"
            >
                <span>{t("recommendationsTitle")}</span>
                <motion.span
                    aria-hidden
                    animate={{ rotate: expanded ? 90 : 0 }}
                    transition={caretTransition}
                    className="inline-block text-[16px] leading-none text-muted"
                >
                    {CARET_GLYPH}
                </motion.span>
            </button>
        </h3>
    );

    return (
        <div>
            {header}
            <AnimatePresence initial={false}>
                {expanded && (
                    <motion.div
                        key="recommendations-body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: HEIGHT_AUTO, opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={bodyTransition}
                        style={{ overflow: "hidden" }}
                    >
                        <RecommendationsBody
                            setup={setup}
                            result={result}
                            asPlayer={asPlayer}
                            setAsPlayer={setAsPlayer}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function RecommendationsBody({
    setup,
    result,
    asPlayer,
    setAsPlayer,
}: {
    readonly setup: ReturnType<typeof useClue>["state"]["setup"];
    readonly result: ReturnType<typeof useClue>["derived"]["deductionResult"];
    readonly asPlayer: string;
    readonly setAsPlayer: (v: string) => void;
}) {
    const t = useTranslations("suggestions");
    const tRecs = useTranslations("recommendations");

    const knowledge = Result.getOrUndefined(result);

    // Shared service layer for the three recommender Effect.gen
    // paths below — built once per render, reused across all calls.
    const recommendLayer = useMemo(
        () =>
            knowledge === undefined
                ? null
                : Layer.mergeAll(
                      makeSetupLayer(setup),
                      makeKnowledgeLayer(knowledge),
                  ),
        [setup, knowledge],
    );

    if (knowledge === undefined || !asPlayer || recommendLayer === null) {
        return (
            <div className="mt-2 text-[13px] text-muted">
                {knowledge === undefined
                    ? t("resolveContradictionFirst")
                    : t("addPlayersFirst")}
            </div>
        );
    }

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
        <>
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
                                    isAnySlot(c) ? [] : [c],
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
                            <li key={i} className="py-1.5">
                                <div className="flex items-start gap-1.5">
                                    <div className="min-w-0 flex-1">
                                        <div>
                                            {r.cards.map((c, ci) => {
                                                const rawName =
                                                    setup.categories[ci]?.name ??
                                                    t("defaultCategorySingular");
                                                const categoryLabel =
                                                    rawName.toLowerCase();
                                                return (
                                                    <span key={ci}>
                                                        {ci > 0 && " + "}
                                                        {isAnySlot(c) ? (
                                                            <em className="text-muted">
                                                                {renderAnySlot(
                                                                    t,
                                                                    c,
                                                                    categoryLabel,
                                                                )}
                                                            </em>
                                                        ) : (
                                                            <strong>
                                                                {cardName(
                                                                    setup,
                                                                    c,
                                                                )}
                                                            </strong>
                                                        )}
                                                    </span>
                                                );
                                            })}
                                            <span className="ml-1 text-muted">
                                                {t("score", {
                                                    score: r.score,
                                                })}
                                            </span>
                                        </div>
                                        <div className="text-[12px] text-muted">
                                            {explanation}
                                        </div>
                                    </div>
                                    <RecommendationInfoIcon
                                        content={scoreBreakdown}
                                    />
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
        </>
    );
}

function PriorSuggestions() {
    const t = useTranslations("suggestions");
    const { state } = useClue();
    const isDesktop = useIsDesktop();
    const suggestions = state.suggestions;
    return (
        <div className="mt-4 border-t border-border pt-4">
            <h3
                id="prior-suggestions"
                tabIndex={-1}
                className={`${SECTION_TITLE} rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2`}
            >
                {t("priorTitle", {
                    count: suggestions.length,
                    shortcut: label("global.gotoPriorLog"),
                })}
            </h3>
            {suggestions.length === 0 ? (
                <div className="text-[13px] text-muted">
                    {t("priorEmpty")}
                </div>
            ) : (
                <>
                    {isDesktop && (
                        <div className="mb-1 text-[11px] text-muted">
                            {t("priorKeyboardHint")}
                        </div>
                    )}
                    <ol className="m-0 flex list-none flex-col gap-2 p-0">
                        <AnimatePresence initial={false}>
                            {suggestions
                                .map((s, idx) => ({ s, idx }))
                                .slice()
                                .reverse()
                                .map(({ s, idx }) => (
                                    <PriorSuggestionItem
                                        key={s.id}
                                        suggestion={s}
                                        idx={idx}
                                    />
                                ))}
                        </AnimatePresence>
                    </ol>
                </>
            )}
        </div>
    );
}

/**
 * One row in the prior-suggestions list. Two display modes:
 *  - idle: renders the existing sentence pair ("Player 3 suggested …"
 *    + refutation summary). Hover / focus / cell-cross-highlight
 *    surface an outline ring but do NOT open the pill editor.
 *  - edit mode: explicitly entered via Enter on a focused row, a
 *    desktop click, or the mobile two-tap (row tap → Edit button).
 *    Renders the pill row and buffers changes in a local draft — the
 *    store is only mutated when the user clicks Update. Cancel via
 *    the × button, Esc, or any outside click.
 *
 * The outline styling (ring) is shared between idle hover/focus and
 * the cell-cross highlight. The red accent background is reserved for
 * edit mode so the two signals remain visually distinct.
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
    const {
        setHoveredSuggestion,
        activeCell,
        selectedSuggestionIndex,
        setSelectedSuggestion,
    } = useSelection();
    const confirm = useConfirm();
    const isDesktop = useIsDesktop();
    const setup = state.setup;
    const listFormatter = useListFormatter();

    const [openPillId, setOpenPillId] = useState<string | null>(null);
    // Explicit edit-mode flag. Decoupled from hover/focus — only set
    // by an unambiguous user gesture (Enter, desktop click, or the
    // mobile Edit button). Controls whether the row renders pills and
    // the Update/× buttons.
    const [isEditing, setIsEditing] = useState(false);
    // Local buffered edits. `null` when not editing. Pills render
    // from `draft ?? s` so the display follows unsaved changes, while
    // the canonical suggestion store is only mutated when the user
    // clicks Update.
    const [draft, setDraft] = useState<DraftSuggestion | null>(null);
    // Mobile-only two-step-to-edit state. First tap on a row flips
    // this on and reveals an Edit button; tapping the button is the
    // second step that actually enters edit mode. Irrelevant on
    // desktop (where click / Enter enter edit directly).
    const [showMobileEditButton, setShowMobileEditButton] = useState(false);
    // Row-level keyboard focus tracker. Only true while focus is on
    // the <li> itself (not descendant pills / ×) — drives the
    // "Press Enter to edit" cue on desktop.
    const [isRowFocused, setIsRowFocused] = useState(false);

    const isSelected = selectedSuggestionIndex === idx;
    // Canonical "current values" for this row — buffered draft while
    // editing, otherwise the stored suggestion.
    const current: DraftSuggestion = draft ?? s;
    // Pill-mode is strictly coupled to the edit-mode flag now (plus a
    // grace window while a pill popover is closing, which lives in
    // `openPillId`). Hover/focus never flips this on.
    const isInPillMode = isEditing || openPillId !== null;

    // Cell → suggestion cross-highlight (reverse of the Checklist's
    // `cellIsHighlighted`). Two ways a cell can reference a suggestion:
    //   1. Provenance chain: the cell was SET by a rule that consulted
    //      this suggestion. `chainFor` walks back through dependsOn.
    //   2. Footnote candidacy: the cell is still in the running as the
    //      refuter's shown card for this suggestion (the superscript
    //      numbers in the grid). `footnotesForCell` indexes those,
    //      1-based, against the cell.
    const isHighlightedByCell = useMemo(() => {
        if (!activeCell) return false;
        if (derived.provenance) {
            for (const { reason } of chainFor(derived.provenance, activeCell)) {
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
                activeCell,
            );
            if (fnNumbers.includes(idx + 1)) return true;
        }
        return false;
    }, [activeCell, derived.provenance, derived.footnotes, idx]);

    // Two visual modes, deliberately distinct:
    //  - editing → filled red accent (strong "you're modifying this")
    //  - cell-cross-highlight / hover / focus → outline ring only
    // Pill variant flips to `onAccent` only for the red-bg mode so the
    // pills remain readable against the filled background.
    // eslint-disable-next-line i18next/no-literal-string
    const pillVariant = isEditing ? "onAccent" : "default";

    // Commit helpers now mutate the local draft instead of dispatching
    // to the store. The store is only written when the user clicks
    // Update (`commitEdit`), so partial edits and exploratory changes
    // are cheap to discard.
    const commit = (patch: Partial<DraftSuggestion>) =>
        setDraft(d => ({ ...(d ?? s), ...patch }));

    const commitRefuter = (value: Player | Nobody) =>
        setDraft(d => {
            const base = d ?? s;
            if (isNobody(value)) {
                // Use destructure-without-field trick: exactOptionalPropertyTypes
                // requires absent key (not `undefined`) for the optional slot.
                const { refuter: _r, seenCard: _sc, ...rest } = base;
                return rest;
            }
            return { ...base, refuter: value };
        });

    const commitSeenCard = (value: Card | Nobody) =>
        setDraft(d => {
            const base = d ?? s;
            if (isNobody(value)) {
                const { seenCard: _sc, ...rest } = base;
                return rest;
            }
            return { ...base, seenCard: value };
        });

    const commitPassers = (value: ReadonlyArray<Player> | Nobody) =>
        setDraft(d => ({
            ...(d ?? s),
            nonRefuters: isNobody(value) ? [] : Array.from(new Set(value)),
        }));

    const clearRefuter = () =>
        setDraft(d => {
            const base = d ?? s;
            const { refuter: _r, seenCard: _sc, ...rest } = base;
            return rest;
        });
    const clearSeenCard = () =>
        setDraft(d => {
            const base = d ?? s;
            const { seenCard: _sc, ...rest } = base;
            return rest;
        });
    const clearPassers = () =>
        setDraft(d => ({ ...(d ?? s), nonRefuters: [] }));

    const onRemove = async () => {
        if (await confirm({ message: t("removeConfirm") })) {
            dispatch({ type: "removeSuggestion", id: s.id });
        }
    };

    const enterEdit = () => {
        setIsEditing(true);
        setDraft({ ...s });
        setShowMobileEditButton(false);
        // Pin the selection while editing so the grid highlights the
        // cells this suggestion contributed to (via the existing
        // `activeSuggestionIndex` reverse cross-highlight).
        setSelectedSuggestion(idx);
    };

    const cancelEdit = () => {
        setIsEditing(false);
        setDraft(null);
        setOpenPillId(null);
        setShowMobileEditButton(false);
        if (selectedSuggestionIndex === idx) setSelectedSuggestion(null);
    };

    const commitEdit = () => {
        const next = draft;
        setIsEditing(false);
        setDraft(null);
        setOpenPillId(null);
        setShowMobileEditButton(false);
        if (selectedSuggestionIndex === idx) setSelectedSuggestion(null);
        if (next !== null) {
            dispatch({ type: "updateSuggestion", suggestion: next });
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
        () => playerChoices([current.refuter, ...current.nonRefuters]),
        [current, setup.players],
    );
    const refuterOpts = useMemo(
        () => playerChoices([current.suggester, ...current.nonRefuters]),
        [current, setup.players],
    );
    const passersOpts = useMemo(
        () => playerChoices([current.suggester, current.refuter]),
        [current, setup.players],
    );
    const seenCardOpts = useMemo(
        () =>
            current.cards.flatMap((id): Array<Option<Card>> => {
                for (const cat of setup.categories) {
                    const entry = cat.cards.find(e => e.id === id);
                    if (entry !== undefined)
                        return [{ value: id, label: entry.name }];
                }
                return [];
            }),
        [current.cards, setup.categories],
    );

    // Desktop hover preview. Touch never fires these (pointer-type
    // filter) because on iOS Safari tap synthesizes a pointerenter
    // that would otherwise highlight after every row tap. Feeds the
    // suggestion → cell cross-highlight (via `activeSuggestionIndex`)
    // without entering edit mode.
    const onPointerEnter = (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        setHoveredSuggestion(idx);
    };
    const onPointerLeave = (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        if (openPillId === null) setHoveredSuggestion(null);
    };

    // Click / tap on the row itself. Desktop: one click → edit.
    // Mobile: two-tap path — first tap reveals the Edit button.
    const onRowClick = () => {
        if (isEditing) return;
        if (isDesktop) {
            enterEdit();
        } else if (!showMobileEditButton) {
            setShowMobileEditButton(true);
            setSelectedSuggestion(idx);
        }
    };

    // Pill open-state toggle shared by every pill on the row.
    const onOpenChangeFor = (pillId: string) => (open: boolean) => {
        setOpenPillId(prev =>
            open ? pillId : prev === pillId ? null : prev,
        );
    };

    // Refuter pill disables the Shown card pill when absent (same rule
    // the Add form uses: can't pick a shown card if nobody refuted).
    const seenDisabled = current.refuter === undefined;

    // Pill IDs for this row, in visual order. Used by the arrow-key
    // nav and the advance-on-commit logic that mirror SuggestionForm's
    // behaviour. The seenCard pill is skipped when disabled (no
    // refuter).
    const pillIds = useMemo<ReadonlyArray<string>>(() => {
        const ids = [`suggester-${s.id}`];
        setup.categories.forEach((_, i) => {
            ids.push(`card-${s.id}-${i}`);
        });
        ids.push(`passers-${s.id}`);
        ids.push(`refuter-${s.id}`);
        ids.push(`seenCard-${s.id}`);
        return ids;
    }, [s.id, setup.categories]);

    // `next` defaults to the *current* buffered draft — callers pass a
    // post-commit snapshot when a commit just swapped `refuter` so the
    // advance skips an unreachable shown-card pill immediately.
    const advanceFrom = (
        fromId: string,
        nextSuggestion: DraftSuggestion = current,
    ) => {
        const idx = pillIds.indexOf(fromId);
        if (idx < 0) {
            setOpenPillId(null);
            return;
        }
        for (let i = idx + 1; i < pillIds.length; i++) {
            const id = pillIds[i];
            if (id === undefined) continue;
            if (
                id.startsWith("seenCard-") &&
                nextSuggestion.refuter === undefined
            ) {
                continue;
            }
            setOpenPillId(id);
            return;
        }
        setOpenPillId(null);
    };

    // Row ref for scoping the arrow-key nav listener to this row's
    // pills + popovers (popovers live in a Radix portal, so the row
    // can't own the keydown directly).
    const rowRef = useRef<HTMLLIElement>(null);

    // ArrowLeft / ArrowRight between pills — matches SuggestionForm's
    // behaviour for the Add-a-suggestion flow. Active when focus is on
    // one of this row's pill triggers, or inside one of its popovers.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
            const isLeft = matches("nav.left", e);
            const isRight = matches("nav.right", e);
            if (!isLeft && !isRight) return;

            const rowEl = rowRef.current;
            const active = document.activeElement as Element | null;
            if (!rowEl || !active) return;

            // Determine which pill the user is currently on. Either
            // focus is on a trigger inside this row, or a popover
            // (portalled outside the row) is open for one of our
            // pills.
            let currentPillId: string | null = null;
            if (rowEl.contains(active)) {
                const trig = active.closest("[data-pill-id]");
                if (trig) {
                    currentPillId = trig.getAttribute("data-pill-id");
                }
            }
            if (
                currentPillId === null &&
                openPillId !== null &&
                pillIds.includes(openPillId) &&
                isInsideSuggestionPopover(active) &&
                rowEl.querySelector(
                    '[data-pill-id][data-state="open"]',
                ) !== null
            ) {
                currentPillId = openPillId;
            }
            if (currentPillId === null || !pillIds.includes(currentPillId)) {
                return;
            }

            const dir = isRight ? 1 : -1;
            let targetId: string | null = null;
            for (
                let i = pillIds.indexOf(currentPillId) + dir;
                i >= 0 && i < pillIds.length;
                i += dir
            ) {
                const id = pillIds[i];
                if (id === undefined) continue;
                if (
                    id.startsWith("seenCard-") &&
                    current.refuter === undefined
                ) {
                    continue;
                }
                targetId = id;
                break;
            }
            if (targetId === null) {
                if (isLeft) e.preventDefault();
                return;
            }
            e.preventDefault();
            setOpenPillId(targetId);
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [pillIds, openPillId, current.refuter]);

    // Internal-consistency validation: unlike the Add form (where
    // option-builders prevent most paradoxes at input time and pill
    // ordering gates PILL_SEEN behind the refuter), the inline edit
    // lets the user change fields in any order. A later edit can
    // strand an earlier choice — most commonly a `seenCard` whose
    // category card was subsequently swapped. Surface that as a
    // pill-level error instead of silently keeping the stale value.
    const formLike: FormState = useMemo(
        () => ({
            id: String(s.id),
            suggester: current.suggester,
            cards: current.cards,
            nonRefuters:
                current.nonRefuters.length > 0 ? current.nonRefuters : null,
            refuter: current.refuter ?? null,
            seenCard: current.seenCard ?? null,
        }),
        [s.id, current],
    );
    const errors = useMemo(
        () => validateFormConsistency(formLike),
        [formLike],
    );
    const errorMessageFor = (code: PillErrorCode): string => {
        switch (code) {
            case "seenCardNotSuggested":
                return t("pillErrorSeenCardNotSuggested");
            case "seenCardWithoutRefuter":
                return t("pillErrorSeenCardWithoutRefuter");
            case "suggesterIsRefuter":
                return t("pillErrorSuggesterIsRefuter");
            case "suggesterInPassers":
                return t("pillErrorSuggesterInPassers");
            case "refuterInPassers":
                return t("pillErrorRefuterInPassers");
        }
    };
    const errorReasonFor = (id: PillId): string | undefined => {
        const code = errors.get(id);
        return code === undefined ? undefined : errorMessageFor(code);
    };

    // Passed-by value: map from DraftSuggestion's always-array shape
    // to the pill-status-friendly null-when-empty shape. The underlying
    // data can't distinguish "explicit nobody" from "not decided" —
    // empty array collapses both.
    const passersValue =
        current.nonRefuters.length === 0 ? null : current.nonRefuters;

    // Outside-click cancel: while editing, any pointerdown outside
    // this row and outside any Radix pill popover portal discards the
    // buffered draft. Capture phase so we observe the pointerdown
    // before other handlers react to it; we never stop propagation.
    useEffect(() => {
        if (!isEditing) return;
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target;
            if (!(target instanceof Node)) return;
            const row = rowRef.current;
            if (row && row.contains(target)) return;
            if (
                target instanceof Element &&
                isInsideSuggestionPopover(target)
            ) {
                return;
            }
            cancelEdit();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () =>
            document.removeEventListener("pointerdown", onPointerDown, true);
    }, [isEditing]);

    // Cmd/Ctrl+Enter commits the draft from anywhere inside the row
    // (or any of its pill popovers). Mirrors the SuggestionForm Add
    // shortcut so the keyboard flow is consistent across the two
    // editors.
    useEffect(() => {
        if (!isEditing) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (!matches("action.submit", e)) return;
            const active = document.activeElement;
            const row = rowRef.current;
            const inRow = !!(
                row &&
                active instanceof Node &&
                row.contains(active)
            );
            const inPopover =
                active instanceof Element &&
                isInsideSuggestionPopover(active) &&
                row?.querySelector('[data-pill-id][data-state="open"]') !==
                    null;
            if (!inRow && !inPopover) return;
            e.preventDefault();
            commitEdit();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [isEditing, draft]);

    const rowTransition = useReducedTransition(T_SPRING_SOFT);
    const pillStaggerTransition = useReducedTransition(T_FAST);

    return (
        <motion.li
            ref={rowRef}
            layout
            // Larger initial y offset so a newly-added suggestion
            // visually "drops in" from the Add-a-suggestion form
            // area above. Existing siblings have `layout` too, so
            // they slide down to make room. The scale+opacity
            // softens the drop so it reads as a card settling into
            // place, not a hard teleport.
            initial={{ y: -80, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, marginTop: 0, marginBottom: 0 }}
            transition={rowTransition}
            tabIndex={0}
            role="button"
            aria-pressed={isSelected}
            data-suggestion-row={idx}
            className={
                // Edit mode is a strong fill; cell-cross-highlight and
                // hover are subtler outline rings. Keyboard focus is
                // covered by the app-wide `:focus-visible` outline (see
                // app/globals.css), so we don't add a ring there.
                "relative flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2 text-[13px] transition-colors cursor-pointer overflow-hidden " +
                (isEditing
                    ? "border-accent bg-accent text-white "
                    : (isHighlightedByCell
                          ? "border-border ring-2 ring-accent ring-offset-1 ring-offset-panel "
                          : "border-border hover:ring-2 hover:ring-accent hover:ring-offset-1 hover:ring-offset-panel "))
            }
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            onClick={onRowClick}
            onFocus={e => {
                // Row itself gained focus (not a descendant).
                if (e.currentTarget === e.target) {
                    setHoveredSuggestion(idx);
                    setIsRowFocused(true);
                }
            }}
            onBlur={e => {
                // Row-level focus left (whether or not focus stays
                // inside the row via pills/×, the row itself is no
                // longer the focused element).
                if (e.target === e.currentTarget) {
                    setIsRowFocused(false);
                }
                // Keep the cross-panel highlight while focus stays
                // anywhere inside the row (pills / popovers / ×).
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                setHoveredSuggestion(null);
            }}
            onKeyDown={e => {
                const native = e.nativeEvent;
                // Escape inside pills: bubble up here and cancel edit
                // mode entirely (discards the draft).
                if (e.currentTarget !== e.target) {
                    if (
                        matches("action.cancel", native) &&
                        isEditing &&
                        openPillId === null
                    ) {
                        e.preventDefault();
                        const row = e.currentTarget;
                        cancelEdit();
                        row.focus();
                    }
                    return;
                }
                if (
                    matches("nav.down", native) ||
                    matches("nav.up", native)
                ) {
                    e.preventDefault();
                    const dir = matches("nav.down", native) ? 1 : -1;
                    let sib =
                        dir === 1
                            ? e.currentTarget.nextElementSibling
                            : e.currentTarget.previousElementSibling;
                    while (sib && !(sib instanceof HTMLLIElement)) {
                        sib =
                            dir === 1
                                ? sib.nextElementSibling
                                : sib.previousElementSibling;
                    }
                    if (sib instanceof HTMLElement) sib.focus();
                } else if (matches("action.toggle", native)) {
                    e.preventDefault();
                    const row = e.currentTarget;
                    if (!isEditing) {
                        enterEdit();
                    }
                    queueMicrotask(() => {
                        const first = row.querySelector<HTMLElement>(
                            "[data-pill-id]",
                        );
                        first?.focus();
                    });
                } else if (matches("action.remove", native)) {
                    e.preventDefault();
                    void onRemove();
                } else if (
                    matches("action.cancel", native) &&
                    isEditing
                ) {
                    e.preventDefault();
                    const row = e.currentTarget;
                    cancelEdit();
                    row.focus();
                }
            }}
        >
            <span className="font-semibold">{idx + 1}.</span>
            <div
                className="min-w-0 flex-1 pr-5"
                onClick={e => {
                    // Pills and the remove × live here; don't let their
                    // clicks toggle the row's pin state.
                    if (isInPillMode) e.stopPropagation();
                }}
            >
                {isInPillMode ? (
                    <motion.div
                        key="pill-mode"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={pillStaggerTransition}
                        className="flex flex-wrap items-center gap-1.5"
                    >
                        <PillPopover
                            pillId={`suggester-${s.id}`}
                            label={t("pillSuggester")}
                            status={pillStatusForPlayer(current.suggester, false)}
                            valueDisplay={displayPlayer(current.suggester)}
                            errorReason={errorReasonFor(PILL_SUGGESTER)}
                            variant={pillVariant}
                            open={openPillId === `suggester-${s.id}`}
                            onOpenChange={onOpenChangeFor(`suggester-${s.id}`)}
                        >
                            <SingleSelectList<Player>
                                options={suggesterOpts}
                                selected={current.suggester}
                                onCommit={value => {
                                    if (!isNobody(value)) {
                                        commit({ suggester: value });
                                        advanceFrom(`suggester-${s.id}`, {
                                            ...current,
                                            suggester: value,
                                        });
                                    } else {
                                        setOpenPillId(null);
                                    }
                                }}
                                nobodyLabel={null}
                                nobodyValue={null}
                            />
                        </PillPopover>

                        {setup.categories.map((cat, i) => {
                            const cardId = current.cards[i] ?? null;
                            const pid = `card-${s.id}-${i}`;
                            return (
                                <PillPopover
                                    key={cat.id}
                                    pillId={pid}
                                    label={cat.name}
                                    status={pillStatusForCard(cardId, false)}
                                    valueDisplay={displayCard(cardId, setup)}
                                    errorReason={errorReasonFor(
                                        `card-${i}` as PillId,
                                    )}
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
                                                const nextCards = [
                                                    ...current.cards,
                                                ];
                                                nextCards[i] = value;
                                                commit({ cards: nextCards });
                                                advanceFrom(pid, {
                                                    ...current,
                                                    cards: nextCards,
                                                });
                                            } else {
                                                setOpenPillId(null);
                                            }
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
                            errorReason={errorReasonFor(PILL_PASSERS)}
                            variant={pillVariant}
                            open={openPillId === `passers-${s.id}`}
                            onOpenChange={onOpenChangeFor(`passers-${s.id}`)}
                            {...(current.nonRefuters.length > 0
                                ? { onClear: clearPassers }
                                : {})}
                        >
                            <MultiSelectList
                                options={passersOpts}
                                selected={current.nonRefuters}
                                nobodyChosen={false}
                                nobodyLabel={t("popoverNobodyPassed")}
                                commitHint={t("popoverCommitHint")}
                                onCommit={(value, opts) => {
                                    commitPassers(value);
                                    // MultiSelectList fires an
                                    // `advance: false` commit from its
                                    // unmount cleanup (to persist
                                    // toggled state on outside-click /
                                    // Esc / arrow-nav-away). Auto-
                                    // advancing there would hijack the
                                    // very nav that caused the unmount
                                    // and open the wrong pill.
                                    if (opts?.advance === false) return;
                                    const nextNonRefuters = isNobody(value)
                                        ? []
                                        : Array.from(new Set(value));
                                    advanceFrom(`passers-${s.id}`, {
                                        ...current,
                                        nonRefuters: nextNonRefuters,
                                    });
                                }}
                            />
                        </PillPopover>

                        <PillPopover
                            pillId={`refuter-${s.id}`}
                            label={t("pillRefuter")}
                            status={pillStatusForPlayer(
                                current.refuter ?? null,
                                true,
                            )}
                            valueDisplay={displayPlayerOpt(
                                current.refuter ?? null,
                                t,
                            )}
                            errorReason={errorReasonFor(PILL_REFUTER)}
                            variant={pillVariant}
                            open={openPillId === `refuter-${s.id}`}
                            onOpenChange={onOpenChangeFor(`refuter-${s.id}`)}
                            {...(current.refuter !== undefined
                                ? { onClear: clearRefuter }
                                : {})}
                        >
                            <SingleSelectList<Player>
                                options={refuterOpts}
                                selected={current.refuter ?? null}
                                onCommit={value => {
                                    commitRefuter(value);
                                    // Post-commit shape: nobody clears both
                                    // refuter and seenCard; otherwise refuter
                                    // is set (keep any existing seenCard —
                                    // the error banner will surface a stale
                                    // pairing if the user later fixes it).
                                    const nextS: DraftSuggestion = isNobody(
                                        value,
                                    )
                                        ? (() => {
                                              const {
                                                  refuter: _r,
                                                  seenCard: _sc,
                                                  ...rest
                                              } = current;
                                              return rest;
                                          })()
                                        : { ...current, refuter: value };
                                    advanceFrom(`refuter-${s.id}`, nextS);
                                }}
                                nobodyLabel={t("popoverNobodyRefuted")}
                                nobodyValue={NOBODY}
                            />
                        </PillPopover>

                        <PillPopover
                            pillId={`seenCard-${s.id}`}
                            label={t("pillSeen")}
                            status={pillStatusForCard(
                                current.seenCard ?? null,
                                true,
                            )}
                            valueDisplay={displayCardOpt(
                                current.seenCard ?? null,
                                setup,
                                t,
                            )}
                            disabled={seenDisabled}
                            disabledHint={t("pillSeenDisabledHint")}
                            errorReason={errorReasonFor(PILL_SEEN)}
                            variant={pillVariant}
                            open={openPillId === `seenCard-${s.id}`}
                            onOpenChange={onOpenChangeFor(
                                `seenCard-${s.id}`,
                            )}
                            {...(current.seenCard !== undefined
                                ? { onClear: clearSeenCard }
                                : {})}
                        >
                            <SingleSelectList<Card>
                                options={seenCardOpts}
                                selected={current.seenCard ?? null}
                                onCommit={value => {
                                    commitSeenCard(value);
                                    // seenCard is the last pill — no
                                    // advance target; just close the
                                    // popover.
                                    setOpenPillId(null);
                                }}
                                nobodyLabel={t("popoverNoShownCard")}
                                nobodyValue={NOBODY}
                            />
                        </PillPopover>

                        {/* Update lives inline with the pills (mirrors
                            the Add button on the new-suggestion form)
                            so the row reads as one cohesive editor. */}
                        <button
                            type="button"
                            onClick={e => {
                                e.stopPropagation();
                                commitEdit();
                            }}
                            className="cursor-pointer rounded border-none bg-accent px-3 py-2 text-[13px] text-white"
                        >
                            {t("updateAction", {
                                shortcut: label("action.submit"),
                            })}
                        </button>
                    </motion.div>
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
                        <div className="text-[13px] text-muted">
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
                        {!isDesktop && !showMobileEditButton && (
                            <div className="mt-0.5 text-[11px] text-muted">
                                {t("priorRowHintMobile")}
                            </div>
                        )}
                        {!isDesktop && showMobileEditButton && (
                            <div className="mt-2">
                                <button
                                    type="button"
                                    onClick={e => {
                                        e.stopPropagation();
                                        enterEdit();
                                    }}
                                    className="min-h-[44px] cursor-pointer rounded-[var(--radius)] border border-accent bg-transparent px-4 py-2 text-[13px] font-semibold text-accent"
                                >
                                    {t("editAction")}
                                </button>
                            </div>
                        )}
                    </>
                )}
                {isDesktop && isRowFocused && !isEditing && (
                    <div className="mt-0.5 text-[11px] text-muted">
                        {t("priorRowHintDesktop")}
                    </div>
                )}
            </div>
            {isEditing ? (
                <button
                    type="button"
                    aria-label={t("cancelEditAria")}
                    onClick={e => {
                        e.stopPropagation();
                        cancelEdit();
                    }}
                    className="absolute right-1 top-1 min-h-[44px] min-w-[44px] cursor-pointer rounded border-none bg-transparent px-2 py-1 text-[22px] leading-none text-white/80 hover:text-white"
                >
                    ×
                </button>
            ) : (
                <button
                    type="button"
                    aria-label={t("removeAction")}
                    className={
                        "absolute cursor-pointer rounded border-none bg-transparent leading-none text-muted hover:text-accent " +
                        (isDesktop
                            ? "right-1.5 top-1 px-1 text-[16px] "
                            : "right-0.5 top-0.5 min-h-[32px] min-w-[32px] px-2 py-1 text-[22px] ")
                    }
                    onClick={e => {
                        e.stopPropagation();
                        void onRemove();
                    }}
                >
                    ×
                </button>
            )}
        </motion.li>
    );
}
