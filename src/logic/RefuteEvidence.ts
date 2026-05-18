import type { Card, Player } from "./GameObjects";
import { PlayerOwner } from "./GameObjects";
import { getCellByOwnerCard, type Knowledge } from "./Knowledge";

/**
 * Per-(player, suggestion) refute evidence.
 *
 * - `definiteYes`: at least one suggestion card has `Knowledge[player][card] === "Y"`.
 *   One positive fact is enough to know the player can refute — no need
 *   to enumerate the whole hand.
 * - `definiteNo`: every chosen suggestion card has `Knowledge[player][card] === "N"`
 *   AND every category is filled. Without all categories filled, an
 *   unfilled card could flip the answer, so we cannot claim "cannot
 *   refute" definitively.
 * - `noInfo`: anything else. Partial fills with no Y yet, full fills with
 *   undefined cells, full fills mixing N and undefined.
 */
export type RefuteEvidence = "definiteYes" | "definiteNo" | "noInfo";

export const DEFINITE_YES: RefuteEvidence = "definiteYes";
export const DEFINITE_NO: RefuteEvidence = "definiteNo";
export const NO_INFO: RefuteEvidence = "noInfo";

/**
 * Computes refute evidence for a given player against the cards that
 * have been chosen so far in a suggestion draft.
 *
 * `complete` tells us whether every category has been filled. A
 * complete suggestion with all-N cells produces `definiteNo`; an
 * incomplete suggestion can only ever produce `definiteYes` or
 * `noInfo` (since an unfilled card could be a Y).
 */
export const computeRefuteEvidence = (args: {
    readonly knowledge: Knowledge;
    readonly player: Player;
    readonly cards: ReadonlyArray<Card>;
    readonly complete: boolean;
}): RefuteEvidence => {
    const { knowledge, player, cards, complete } = args;
    if (cards.length === 0) return NO_INFO;
    const owner = PlayerOwner(player);
    let allN = true;
    for (const card of cards) {
        const cell = getCellByOwnerCard(knowledge, owner, card);
        if (cell === "Y") return DEFINITE_YES;
        if (cell !== "N") allN = false;
    }
    if (complete && allN) return DEFINITE_NO;
    return NO_INFO;
};

/**
 * Lookup the per-card cell value for a specific player. Convenience
 * wrapper around `getCellByOwnerCard` that hides the `PlayerOwner`
 * wrapping at call sites.
 */
export const playerCellValue = (
    knowledge: Knowledge,
    player: Player,
    card: Card,
): "Y" | "N" | undefined =>
    getCellByOwnerCard(knowledge, PlayerOwner(player), card);
