/**
 * Pure helper used by `ShareCreateModal` to recover the user-facing
 * label of the currently-loaded custom pack when the caller didn't
 * pass an explicit `forcedCardPackLabel` (true for invite/transfer
 * shares — those open from the overflow menu / setup pane and don't
 * know which custom pack the live deck came from).
 *
 * Mirrors the active-pill resolution in `CardPackRow`: the
 * most-recently-used pack id whose `cardSet` still equals the live
 * `setup.cardSet`. Returning `undefined` here causes the modal to
 * fall back to its existing "no label" behaviour, which round-trips
 * as the receiver's `isUnnamedCustom` branch.
 */
import { DateTime } from "effect";
import { cardSetEquals, type CardSet } from "../../logic/CardSet";
import type { CustomCardSet } from "../../logic/CustomCardSets";

export const resolveActivePackLabel = (
    cardSet: CardSet,
    customPacks: ReadonlyArray<CustomCardSet>,
    usage: ReadonlyMap<string, DateTime.Utc>,
    explicit: string | undefined,
): string | undefined => {
    if (explicit !== undefined && explicit !== "") return explicit;
    let candidateId: string | undefined;
    let mostRecent: DateTime.Utc | undefined;
    for (const [id, at] of usage.entries()) {
        if (
            !mostRecent ||
            DateTime.toEpochMillis(at) > DateTime.toEpochMillis(mostRecent)
        ) {
            mostRecent = at;
            candidateId = id;
        }
    }
    if (candidateId === undefined) return undefined;
    const candidate = customPacks.find((p) => p.id === candidateId);
    if (candidate === undefined) return undefined;
    if (!cardSetEquals(cardSet, candidate.cardSet)) return undefined;
    return candidate.label;
};
