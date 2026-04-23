"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Card, Player } from "../../logic/GameObjects";
import { GameSetup, cardName } from "../../logic/GameSetup";
import { ContradictionTrace } from "../../logic/Deducer";
import { DraftSuggestion } from "../../logic/ClueState";
import { useClue } from "../state";
import { useSelection } from "../SelectionContext";

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

    return (
        <div className="mb-3 rounded-[var(--radius)] border border-danger-border bg-danger-bg p-3 text-[13px] text-danger">
            {!hasOffendingSuggestions && (
                <div className="mb-2">
                    {t.rich("full", {
                        reason: prettifyReason(trace.reason),
                        strong: chunks => <strong>{chunks}</strong>,
                    })}
                </div>
            )}
            {hasOffendingSuggestions && (
                <div className="mb-2 font-semibold">
                    {t("offendingInputsHeader")}
                </div>
            )}
            {(hasOffendingSuggestions || fixes.length > 0) && (
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
                    {!hasOffendingSuggestions && fixes.length > 0 && (
                        <li className="-mt-1 mb-1 text-[12px] font-semibold uppercase tracking-[0.05em] text-danger">
                            {t("offendingInputsHeader")}
                        </li>
                    )}
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
            <div className="mt-1 flex gap-2">
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
 * Translate the raw `Contradiction` reason string into a human-friendly
 * sentence inline with the offending suggestion. Templates this matches:
 *
 *   - cell conflict (Knowledge.ts): "tried to set {owner}/{card} to {Y|N} but it is already {N|Y}"
 *   - card-ownership slice (Rules.ts): slice label "card ownership: {CARD}", reason has "has 2 Ys ..."
 *   - hand-size slice (Rules.ts): slice label "hand size: {PLAYER}", reason has "has N Ys ..."
 *
 * Falls back to the prettified raw reason string for shapes we don't
 * recognise — better something verbatim than nothing.
 */
function describeSuggestionConflict(
    trace: ContradictionTrace,
    setup: GameSetup,
    t: ReturnType<typeof useTranslations<"contradictions">>,
    prettify: (s: string) => string,
): ReactNode {
    const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;

    // Cell conflict: "tried to set <owner>/<cardId> to <Y|N> but it is already <N|Y>"
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

    // Slice over-saturation: prefer sliceLabel, which encodes the kind.
    if (trace.sliceLabel) {
        const cardOwn = /^card ownership: (.+)$/.exec(trace.sliceLabel);
        if (cardOwn) {
            const cardDisplay =
                lookupCardName(setup, cardOwn[1]!) ?? cardOwn[1]!;
            return t.rich("conflictCardHasOtherOwner", {
                card: cardDisplay,
                strong,
            });
        }
        const handSize = /^hand size: (.+)$/.exec(trace.sliceLabel);
        if (handSize) {
            return t.rich("conflictHandSizeOverflow", {
                player: handSize[1]!,
                strong,
            });
        }
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
