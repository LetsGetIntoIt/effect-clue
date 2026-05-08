"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Card, Player, ownerLabel } from "../../logic/GameObjects";
import { GameSetup, cardName, categoryName } from "../../logic/GameSetup";
import { ContradictionTrace } from "../../logic/Deducer";
import { DraftAccusation, DraftSuggestion } from "../../logic/ClueState";
import type { Cell } from "../../logic/Knowledge";
import { useClue, type HypothesisConflict } from "../state";
import { useSelection } from "../SelectionContext";
import type { CellValue } from "../../logic/Knowledge";
import { ProseChecklistIcon } from "./CellGlyph";

// i18n key tags hoisted to module scope so the `no-literal-string`
// lint rule reads them as code identifiers, not UI text.
const KEY_DIRECT_TITLE = "directBannerTitle" as const;
const KEY_DIRECT_HELP = "directBannerHelp" as const;
const KEY_JOINT_TITLE = "jointBannerTitle" as const;
const KEY_JOINT_HELP = "jointBannerHelp" as const;

/**
 * Structured contradiction display + one-click quick-fix buttons. Reads
 * `ContradictionTrace.offendingCells` and `offendingSuggestionIndices`
 * and offers concrete actions the user can take to unstick the solver:
 *
 *  - Edit / remove the offending suggestion(s)
 *  - Unset a known-card checkbox that conflicts
 *  - Reset a player's hand size if the overflow is there
 *
 * For offending suggestions the row carries the full description
 * (suggester, cards, refuter, seen card) plus a parsed-from-reason
 * "what's wrong" sentence so the user can act without scrolling back
 * to the log.
 */
export function ContradictionBanner({
    trace,
}: {
    trace: ContradictionTrace;
}) {
    const t = useTranslations("contradictions");
    const { state, dispatch } = useClue();
    const { setSelectedSuggestion } = useSelection();
    const setup = state.setup;

    interface KnownCardFix {
        readonly kind: "unset-known-card";
        readonly index: number;
        readonly player: Player;
        readonly cardLabel: string;
    }
    interface HandSizeFix {
        readonly kind: "reset-hand-size";
        readonly player: Player;
        readonly size: number;
    }
    type Fix = KnownCardFix | HandSizeFix;

    const fixes: Fix[] = [];
    const seenHandSizePlayers = new Set<string>();

    for (const cell of trace.offendingCells) {
        const { owner, card: cardId } = cell;
        if (owner._tag !== "Player") continue;
        const player = owner.player;

        const knownIdx = state.knownCards.findIndex(
            kc => kc.player === player && kc.card === cardId,
        );
        if (knownIdx >= 0) {
            fixes.push({
                kind: "unset-known-card",
                index: knownIdx,
                player,
                cardLabel: cardName(setup, cardId),
            });
        }

        if (!seenHandSizePlayers.has(String(player))) {
            seenHandSizePlayers.add(String(player));
            const entry = state.handSizes.find(([p]) => p === player);
            if (entry && trace.sliceLabel?.startsWith("hand size")) {
                fixes.push({
                    kind: "reset-hand-size",
                    player,
                    size: entry[1],
                });
            }
        }
    }

    // Card-id → display-name rewrite for any reason string the banner
    // shows directly (slice labels and Knowledge.ts errors bake in the
    // raw id, predating the id/name split).
    const prettifyReason = (raw: string): string => {
        let s = raw;
        for (const entry of setup.categories.flatMap(c => c.cards)) {
            const id = String(entry.id);
            if (s.includes(id)) s = s.split(id).join(entry.name);
        }
        return s;
    };

    const handleEdit = (idx: number) => {
        if (state.uiMode !== "suggest") {
            dispatch({ type: "setUiMode", mode: "suggest" });
        }
        setSelectedSuggestion(idx);
        queueMicrotask(() => {
            const row = document.querySelector<HTMLElement>(
                `[data-suggestion-row="${idx}"]`,
            );
            if (row) {
                // eslint-disable-next-line i18next/no-literal-string
                row.scrollIntoView({ behavior: "smooth", block: "center" });
                row.focus({ preventScroll: true });
            }
        });
    };

    const hasOffendingSuggestions = trace.offendingSuggestionIndices.length > 0;
    const hasOffendingAccusations =
        trace.offendingAccusationIndices.length > 0;

    return (
        <div className="mb-3 rounded-[var(--radius)] border border-danger-border bg-danger-bg p-3 text-[13px] text-danger">
            <div className="mb-2">
                <div className="font-semibold">{t("bannerTitle")}</div>
                <div className="text-[12px] opacity-80">{t("bannerHelp")}</div>
            </div>
            {!hasOffendingSuggestions && !hasOffendingAccusations && (
                <div className="mb-2">
                    {prettifyReason(trace.reason)}
                </div>
            )}
            {(hasOffendingSuggestions ||
                hasOffendingAccusations ||
                fixes.length > 0) && (
                <ul className="m-0 flex list-none flex-col gap-2 pl-0">
                    {trace.offendingSuggestionIndices.map(idx => {
                        const s = state.suggestions[idx];
                        return (
                            <OffendingSuggestionRow
                                key={`sug-${idx}`}
                                idx={idx}
                                suggestion={s}
                                setup={setup}
                                conflictNode={describeSuggestionConflict(
                                    trace,
                                    setup,
                                    s,
                                    t,
                                    prettifyReason,
                                )}
                                onEdit={() => handleEdit(idx)}
                                onRemove={
                                    s
                                        ? () =>
                                              dispatch({
                                                  type: "removeSuggestion",
                                                  id: s.id,
                                              })
                                        : undefined
                                }
                            />
                        );
                    })}
                    {trace.offendingAccusationIndices.map(idx => {
                        const a = state.accusations[idx];
                        return (
                            <OffendingAccusationRow
                                key={`acc-${idx}`}
                                idx={idx}
                                accusation={a}
                                setup={setup}
                                conflictNode={describeAccusationConflict(
                                    setup,
                                    a,
                                    t,
                                )}
                                onRemove={
                                    a
                                        ? () =>
                                              dispatch({
                                                  type: "removeAccusation",
                                                  id: a.id,
                                              })
                                        : undefined
                                }
                            />
                        );
                    })}
                    {fixes.map((fix, i) => {
                        if (fix.kind === "unset-known-card") {
                            return (
                                <li
                                    key={`known-${i}`}
                                    className="flex items-center justify-between gap-2"
                                >
                                    <span>
                                        {t.rich("knownCardFix", {
                                            player: String(fix.player),
                                            card: fix.cardLabel,
                                            strong: chunks => (
                                                <strong>{chunks}</strong>
                                            ),
                                        })}
                                    </span>
                                    <button
                                        type="button"
                                        className="cursor-pointer rounded border border-danger-border bg-white px-2 py-0.5 text-[12px] text-danger hover:bg-danger-bg"
                                        onClick={() =>
                                            dispatch({
                                                type: "removeKnownCard",
                                                index: fix.index,
                                            })
                                        }
                                    >
                                        {t("knownCardUnset")}
                                    </button>
                                </li>
                            );
                        }
                        return (
                            <li
                                key={`hand-${i}`}
                                className="flex items-center justify-between gap-2"
                            >
                                <span>
                                    {t.rich("handSizeFix", {
                                        player: String(fix.player),
                                        size: fix.size,
                                        strong: chunks => (
                                            <strong>{chunks}</strong>
                                        ),
                                    })}
                                </span>
                                <button
                                    type="button"
                                    className="cursor-pointer rounded border border-danger-border bg-white px-2 py-0.5 text-[12px] text-danger hover:bg-danger-bg"
                                    onClick={() =>
                                        dispatch({
                                            type: "setHandSize",
                                            player: fix.player,
                                            size: undefined,
                                        })
                                    }
                                >
                                    {t("handSizeReset")}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

function OffendingSuggestionRow({
    idx,
    suggestion,
    setup,
    conflictNode,
    onEdit,
    onRemove,
}: {
    readonly idx: number;
    readonly suggestion: DraftSuggestion | undefined;
    readonly setup: GameSetup;
    readonly conflictNode: ReactNode;
    readonly onEdit: () => void;
    readonly onRemove: (() => void) | undefined;
}) {
    const t = useTranslations("contradictions");
    const heading = suggestion
        ? t("suggestionLabel", {
              index: idx + 1,
              player: String(suggestion.suggester),
          })
        : t("suggestionLabelNoPlayer", { index: idx + 1 });
    return (
        <li className="flex flex-col gap-1 rounded border border-danger-border bg-white/40 p-2">
            <div className="font-semibold">{heading}</div>
            {suggestion && (
                <div>
                    {t.rich("suggestionCardsLine", {
                        suggester: String(suggestion.suggester),
                        cards: joinCardNames(setup, suggestion.cards),
                        strong: chunks => <strong>{chunks}</strong>,
                    })}{" "}
                    {renderRefuterSentence(suggestion, setup, t)}
                </div>
            )}
            {conflictNode && <div>{conflictNode}</div>}
            <div className="mt-1 flex justify-end gap-2">
                <button
                    type="button"
                    className="cursor-pointer rounded border border-danger-border bg-white px-2 py-0.5 text-[12px] text-danger hover:bg-danger-bg"
                    onClick={onEdit}
                >
                    {t("editSuggestion")}
                </button>
                {onRemove && (
                    <button
                        type="button"
                        className="cursor-pointer rounded border border-danger-border bg-white px-2 py-0.5 text-[12px] text-danger hover:bg-danger-bg"
                        onClick={onRemove}
                    >
                        {t("removeSuggestion")}
                    </button>
                )}
            </div>
        </li>
    );
}

function joinCardNames(
    setup: GameSetup,
    cards: ReadonlyArray<Card>,
): string {
    return cards.map(id => cardName(setup, id)).join(" + ");
}

function renderRefuterSentence(
    s: DraftSuggestion,
    setup: GameSetup,
    t: ReturnType<typeof useTranslations<"contradictions">>,
): ReactNode {
    const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
    if (s.refuter !== undefined && s.seenCard !== undefined) {
        return t.rich("suggestionRefutedWith", {
            refuter: String(s.refuter),
            card: cardName(setup, s.seenCard),
            strong,
        });
    }
    if (s.refuter !== undefined) {
        return t.rich("suggestionRefutedUnknown", {
            refuter: String(s.refuter),
            strong,
        });
    }
    if (s.nonRefuters.length > 0) {
        return t("suggestionNoRefuter");
    }
    return null;
}

/**
 * Render a sentence that names *both* the rule that fired and the
 * conflicting fact. Dispatches on `trace.contradictionKind._tag`:
 *
 *   - `NonRefuters`       — "X passed on this suggestion, so they can't
 *                            have Y — but X is already known to have Y."
 *   - `RefuterShowed`     — "X showed Y to refute, but X is already
 *                            known not to have Y."
 *   - `RefuterOwnsOneOf`  — "X refuted without showing a card, so they
 *                            must own one of {cards}, but X is already
 *                            known not to have any."
 *   - `Slice…`            — slice over- or under-saturation copy
 *                            (card ownership / player hand / case file).
 *
 * Falls through to the legacy regex parse on the raw reason string when
 * `contradictionKind` is undefined or `DirectCell` (e.g. two raw
 * known-card inputs collide), so we never regress on what we say today.
 */
function describeSuggestionConflict(
    trace: ContradictionTrace,
    setup: GameSetup,
    suggestion: DraftSuggestion | undefined,
    t: ReturnType<typeof useTranslations<"contradictions">>,
    prettify: (s: string) => string,
): ReactNode {
    const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
    const cell = trace.offendingCells[0];
    const offendingPlayer =
        cell && cell.owner._tag === "Player" ? cell.owner.player : undefined;
    const offendingCardLabel = cell ? cardName(setup, cell.card) : undefined;

    const kind = trace.contradictionKind;
    if (kind) {
        switch (kind._tag) {
            case "NonRefuters":
                if (offendingPlayer && offendingCardLabel) {
                    return t.rich("conflictNonRefuterAlreadyOwns", {
                        player: String(offendingPlayer),
                        card: offendingCardLabel,
                        strong,
                    });
                }
                break;
            case "RefuterShowed":
                if (suggestion?.refuter && suggestion.seenCard !== undefined) {
                    return t.rich("conflictRefuterShowedButCantOwn", {
                        refuter: String(suggestion.refuter),
                        card: cardName(setup, suggestion.seenCard),
                        strong,
                    });
                }
                break;
            case "RefuterOwnsOneOf":
                if (suggestion?.refuter) {
                    return t.rich("conflictRefuterOwnsOneOfImpossible", {
                        refuter: String(suggestion.refuter),
                        cards: joinCardNames(setup, suggestion.cards),
                        strong,
                    });
                }
                break;
            case "SliceCardOwnership": {
                const cardLabel = cardName(setup, kind.card);
                return kind.direction === "over"
                    ? t.rich("conflictCardHasOtherOwner", {
                          card: cardLabel,
                          strong,
                      })
                    : t.rich("conflictCardNoPossibleOwner", {
                          card: cardLabel,
                          strong,
                      });
            }
            case "SlicePlayerHand":
                return kind.direction === "over"
                    ? t.rich("conflictHandSizeOverflow", {
                          player: String(kind.player),
                          handSize: kind.handSize,
                          strong,
                      })
                    : t.rich("conflictHandSizeUnderflow", {
                          player: String(kind.player),
                          handSize: kind.handSize,
                          strong,
                      });
            case "SliceCaseFileCategory": {
                const catLabel = categoryName(setup, kind.category) ?? String(kind.category);
                return kind.direction === "over"
                    ? t.rich("conflictCaseFileCategoryConflict", {
                          category: catLabel,
                          strong,
                      })
                    : t.rich("conflictCaseFileCategoryNoOption", {
                          category: catLabel,
                          strong,
                      });
            }
            case "DisjointGroupsHandLock":
            case "FailedAccusation":
                // Both surface their own dedicated rows (the disjoint
                // case via the hand-size slice that fires next; the
                // failed-accusation case via `OffendingAccusationRow`).
                // Fall through to the legacy parse if we're displaying
                // a suggestion-row that lacks a dedicated kind branch.
                break;
            case "DirectCell":
                break; // fall through to legacy parse
        }
    }

    // Legacy fallback: parse the raw reason string for cell conflicts
    // raised by `setCell` outside any rule wrapping (or when
    // `contradictionKind` was lost across boundaries).
    const cellMatch = /^tried to set (.+?)\/(.+?) to ([YN]) but it is already ([YN])$/.exec(
        trace.reason,
    );
    if (cellMatch) {
        const [, ownerLabel, cardId, attempted] = cellMatch;
        const cardDisplay = lookupCardName(setup, cardId!) ?? cardId!;
        if (attempted === "Y") {
            return t.rich("conflictAlreadyNotOwns", {
                player: ownerLabel!,
                card: cardDisplay,
                strong,
            });
        }
        return t.rich("conflictAlreadyOwns", {
            player: ownerLabel!,
            card: cardDisplay,
            strong,
        });
    }

    return prettify(trace.reason);
}

function lookupCardName(setup: GameSetup, idOrName: string): string | undefined {
    for (const cat of setup.categories) {
        for (const entry of cat.cards) {
            if (String(entry.id) === idOrName) return entry.name;
        }
    }
    return undefined;
}

/**
 * Render the "what went wrong" sentence for a failed accusation row.
 * The deducer's other inputs concluded that all three accusation cards
 * were in the case file — but a failed accusation contradicts that.
 * The user's recourse is to remove either the accusation (if it was
 * mis-logged) or one of the upstream inputs that drove the case-file
 * Y cells.
 */
function describeAccusationConflict(
    setup: GameSetup,
    accusation: DraftAccusation | undefined,
    t: ReturnType<typeof useTranslations<"contradictions">>,
): ReactNode {
    if (!accusation) return null;
    const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
    return t.rich("conflictFailedAccusationAllPinned", {
        cards: joinCardNames(setup, accusation.cards),
        strong,
    });
}

/**
 * Render one row in the contradiction banner for an offending failed
 * accusation. Mirrors `OffendingSuggestionRow` but with the simpler
 * Accusation shape (no refuter, no seen card) — and only a "Remove"
 * action, since editing a failed accusation back to a different triple
 * doesn't really fit the failed-accusation semantics (you should just
 * log a new one).
 */
function OffendingAccusationRow({
    idx,
    accusation,
    setup,
    conflictNode,
    onRemove,
}: {
    readonly idx: number;
    readonly accusation: DraftAccusation | undefined;
    readonly setup: GameSetup;
    readonly conflictNode: ReactNode;
    readonly onRemove: (() => void) | undefined;
}) {
    const t = useTranslations("contradictions");
    const heading = accusation
        ? t("accusationLabel", {
              index: idx + 1,
              player: String(accusation.accuser),
          })
        : t("accusationLabelNoPlayer", { index: idx + 1 });
    return (
        <li className="flex flex-col gap-1 rounded border border-danger-border bg-white/40 p-2">
            <div className="font-semibold">{heading}</div>
            {accusation && (
                <div>
                    {t.rich("accusationCardsLine", {
                        accuser: String(accusation.accuser),
                        cards: joinCardNames(setup, accusation.cards),
                        strong: chunks => <strong>{chunks}</strong>,
                    })}
                </div>
            )}
            {conflictNode && <div>{conflictNode}</div>}
            <div className="mt-1 flex justify-end gap-2">
                {onRemove && (
                    <button
                        type="button"
                        className="cursor-pointer rounded border border-danger-border bg-white px-2 py-0.5 text-[12px] text-danger hover:bg-danger-bg"
                        onClick={onRemove}
                    >
                        {t("removeAccusation")}
                    </button>
                )}
            </div>
        </li>
    );
}

/**
 * Contradiction banner variant for any rejected-hypothesis state.
 * Two flavours, distinguished by `conflict.kind`:
 *
 *   - `directly-contradicted`: at least one hypothesis disagrees with
 *     a real fact. The banner lists ONLY the contradicted hypotheses
 *     (other still-plausible ones don't belong here) and asks the user
 *     to turn the rejected hypothesis off.
 *   - `jointly-conflicting`: every hypothesis is individually
 *     plausible against the real-only knowledge but their union is
 *     unsatisfiable. The banner lists ALL active hypotheses since the
 *     conflict is in their interaction.
 *
 * Both share the row layout (sorted by `(ownerLabel, cardName)` for
 * stable order) and the per-row "Turn off" CTA dispatching
 * `clearHypothesis`. Only the title + help text change.
 */
export function JointHypothesisContradictionBanner({
    conflict,
}: {
    readonly conflict: HypothesisConflict;
}) {
    const t = useTranslations("contradictions");
    const { state, dispatch } = useClue();
    const setup = state.setup;
    const isDirect = conflict.kind === "directly-contradicted";

    interface Row {
        readonly cell: Cell;
        readonly ownerName: string;
        readonly cardLabel: string;
        readonly value: CellValue;
    }

    const rows: ReadonlyArray<Row> = (() => {
        const collected: Array<Row> = conflict.entries.map(entry => ({
            cell: entry.cell,
            ownerName: ownerLabel(entry.cell.owner),
            cardLabel: cardName(setup, entry.cell.card),
            value: entry.value,
        }));
        collected.sort((a, b) => {
            const byOwner = a.ownerName.localeCompare(b.ownerName);
            return byOwner !== 0
                ? byOwner
                : a.cardLabel.localeCompare(b.cardLabel);
        });
        return collected;
    })();

    const titleKey = isDirect ? KEY_DIRECT_TITLE : KEY_JOINT_TITLE;
    const helpKey = isDirect ? KEY_DIRECT_HELP : KEY_JOINT_HELP;

    return (
        <div className="mb-3 rounded-[var(--radius)] border border-danger-border bg-danger-bg p-3 text-[13px] text-danger">
            <div className="mb-2">
                <div className="font-semibold">
                    {t(titleKey, { count: rows.length })}
                </div>
                <div className="text-[12px] opacity-80">
                    {t(helpKey, { count: rows.length })}
                </div>
            </div>
            {rows.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-2 pl-0">
                    {rows.map(row => {
                        const key = `${row.ownerName}/${row.cardLabel}/${row.value}`;
                        return (
                            <li
                                key={key}
                                className="flex items-center justify-between gap-2 rounded border border-danger-border bg-white/40 p-2"
                            >
                                <span>
                                    {t.rich("jointHypothesisRow", {
                                        owner: row.ownerName,
                                        card: row.cardLabel,
                                        chip: () => (
                                            <ProseChecklistIcon
                                                value={row.value}
                                            />
                                        ),
                                        strong: chunks => (
                                            <strong>{chunks}</strong>
                                        ),
                                    })}
                                </span>
                                <button
                                    type="button"
                                    className="cursor-pointer rounded border border-danger-border bg-white px-2 py-0.5 text-[12px] text-danger hover:bg-danger-bg"
                                    onClick={() =>
                                        dispatch({
                                            type: "clearHypothesis",
                                            cell: row.cell,
                                        })
                                    }
                                >
                                    {t("jointHypothesisTurnOff")}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

