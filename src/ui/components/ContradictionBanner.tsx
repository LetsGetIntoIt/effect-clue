"use client";

import { Player } from "../../logic/GameObjects";
import { cardName } from "../../logic/GameSetup";
import { ContradictionTrace } from "../../logic/Deducer";
import { useClue } from "../state";

/**
 * Structured contradiction display + one-click quick-fix buttons. Reads
 * `ContradictionTrace.offendingCells` and `offendingSuggestionIndices`
 * and offers concrete actions the user can take to unstick the solver:
 *
 *  - Remove the offending suggestion(s)
 *  - Unset a known-card checkbox that conflicts
 *  - Reset a player's hand size if the overflow is there
 *
 * The banner replaces the legacy plain-text "Contradiction: ..." boxes
 * in GameSetupPanel and ChecklistGrid. It renders once, at the top of
 * GameSetupPanel (the most prominent place), since a contradiction
 * blocks the whole deducer.
 */
export function ContradictionBanner({
    trace,
}: {
    trace: ContradictionTrace;
}) {
    const { state, dispatch } = useClue();
    const setup = state.setup;

    // Map offending cells onto the user's inputs so we can offer quick
    // fixes. Three kinds of fixes are possible:
    //   - "Unset known card": the offending cell matches a knownCards
    //     entry (the user directly ticked that box).
    //   - "Reset hand size": the player whose row is over-saturated has
    //     an explicit hand-size entry we can clear.
    //   - (nothing): the offending cell comes from a deduction the user
    //     didn't directly enter — they'll have to remove the suggestion.
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

        // Hand-size-related slice contradictions put every Y cell in
        // the player's row into offendingCells. Offer "reset hand size"
        // once per player, if they actually have an explicit entry.
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

    // Rewrite any card ids in the reason string to their display names
    // so we don't leak opaque "card-miss-scarlet" strings into the UI.
    // Slice labels and error messages both bake the card identifier in
    // directly (Rules.ts built them before the id/name split).
    let prettyReason = trace.reason;
    for (const entry of setup.categories.flatMap(c => c.cards)) {
        const id = String(entry.id);
        if (prettyReason.includes(id)) {
            prettyReason = prettyReason.split(id).join(entry.name);
        }
    }

    return (
        <div className="mb-3 rounded-[var(--radius)] border border-danger-border bg-danger-bg p-3 text-[13px] text-danger">
            <div className="mb-2">
                <strong>Contradiction:</strong> {prettyReason}
            </div>
            {(trace.offendingSuggestionIndices.length > 0 || fixes.length > 0) && (
                <div>
                    <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.05em] text-danger">
                        Offending inputs
                    </div>
                    <ul className="m-0 flex list-none flex-col gap-1 pl-0">
                        {trace.offendingSuggestionIndices.map(idx => {
                            const s = state.suggestions[idx];
                            const label = s
                                ? `Suggestion #${idx + 1} by ${s.suggester}`
                                : `Suggestion #${idx + 1}`;
                            return (
                                <li
                                    key={`sug-${idx}`}
                                    className="flex items-center justify-between gap-2"
                                >
                                    <span>{label}</span>
                                    {s && (
                                        <button
                                            type="button"
                                            className="cursor-pointer rounded border border-danger-border bg-white px-2 py-0.5 text-[12px] text-danger hover:bg-danger-bg"
                                            onClick={() =>
                                                dispatch({
                                                    type: "removeSuggestion",
                                                    id: s.id,
                                                })
                                            }
                                        >
                                            Remove suggestion
                                        </button>
                                    )}
                                </li>
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
                                            Known card: <strong>{fix.player}</strong> has{" "}
                                            <strong>{fix.cardLabel}</strong>
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
                                            Unset
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
                                        Hand size: <strong>{fix.player}</strong> ={" "}
                                        {fix.size}
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
                                        Reset
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
}
