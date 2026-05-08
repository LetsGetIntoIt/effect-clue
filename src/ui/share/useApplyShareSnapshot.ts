/**
 * Hook + pure builder for hydrating a received share into the local
 * game state (M22).
 *
 * The receive page calls `useApplyShareSnapshot()` and gets back a
 * single-arg function: pass it the `ShareSnapshot` and the receiver's
 * persisted game is replaced. The play page then hydrates from that
 * persisted session after the router sends the receiver to `/play`.
 * The split between the pure builder (`buildSessionFromSnapshot`) and
 * the localStorage writer lets us unit-test the snapshot-decode logic
 * without React.
 *
 * Hydration semantics:
 *   - The share is the new game. Sections present in the snapshot
 *     replace the matching slice; sections absent are blanked
 *     (because they may reference cards from the receiver's old pack
 *     and would orphan after the swap).
 *   - When the snapshot has no card pack, the receiver's existing
 *     pack is preserved as a defensive fallback. The receive page
 *     gates Import for empty (no-pack) shares before this hook runs,
 *     so this branch only executes for legacy / malformed inputs.
 *   - Branded ids round-trip through the Effect Schema codecs — no
 *     manual `Player()` / `Card()` re-wrapping needed downstream.
 *
 * Persistence side effects: the share landing page intentionally sits
 * outside the play shell, so it must not call `useClue()`. Instead it
 * writes the decoded session directly to the v6 persistence slot; the
 * next `/play` mount reads it through the normal `<ClueProvider>`
 * hydration path.
 */
"use client";

import { DateTime, Result, Schema } from "effect";
import { Accusation, newAccusationId } from "../../logic/Accusation";
import {
    cardSetEquals,
    CardSet,
    CardEntry,
    Category,
} from "../../logic/CardSet";
import { CARD_SETS, DEFAULT_SETUP, GameSetup } from "../../logic/GameSetup";
import { HashMap } from "effect";
import {
    CaseFileOwner,
    PlayerOwner,
} from "../../logic/GameObjects";
import {
    emptyHypotheses,
    type HypothesisMap,
    type HypothesisValue,
} from "../../logic/Hypothesis";
import { Cell } from "../../logic/Knowledge";
import {
    loadFromLocalStorage,
    saveToLocalStorage,
    type GameSession,
} from "../../logic/Persistence";
import {
    loadCustomCardSets,
    saveCustomCardSet,
    type CustomCardSet,
} from "../../logic/CustomCardSets";
import {
    loadCardPackUsage,
    recordCardPackUse,
} from "../../logic/CardPackUsage";
import { PlayerSet } from "../../logic/PlayerSet";
import {
    accusationsCodec,
    cardPackCodec,
    handSizesCodec,
    hypothesesCodec,
    knownCardsCodec,
    playersCodec,
    suggestionsCodec,
} from "../../logic/ShareCodec";
import { newSuggestionId, Suggestion } from "../../logic/Suggestion";

export interface ShareSnapshotForHydration {
    readonly cardPackData: string | null;
    readonly playersData: string | null;
    readonly handSizesData: string | null;
    readonly knownCardsData: string | null;
    readonly suggestionsData: string | null;
    readonly accusationsData: string | null;
    readonly hypothesesData: string | null;
}

// Wire-format field names. Module-scope so they don't trip the
// no-literal-string lint and so the decode-failure messages are
// recognisably tied back to their codec.
const F_CARD_PACK_DATA = "cardPackData";
const F_PLAYERS_DATA = "playersData";
const F_HAND_SIZES_DATA = "handSizesData";
const F_KNOWN_CARDS_DATA = "knownCardsData";
const F_SUGGESTIONS_DATA = "suggestionsData";
const F_ACCUSATIONS_DATA = "accusationsData";
const F_HYPOTHESES_DATA = "hypothesesData";

const DECODE_ERROR_PREFIX = "share snapshot decode failed: ";

export class ShareSnapshotDecodeError extends Error {
    readonly field: string;
    constructor(field: string) {
        super(DECODE_ERROR_PREFIX + field);
        this.name = "ShareSnapshotDecodeError";
        this.field = field;
    }
}

export const sessionHasGameData = (session: GameSession): boolean => {
    if (session.hands.some((hand) => hand.cards.length > 0)) return true;
    if (session.handSizes.length > 0) return true;
    if (session.suggestions.length > 0) return true;
    if (session.accusations.length > 0) return true;
    const players = session.setup.players;
    if (players.length !== DEFAULT_SETUP.players.length) return true;
    for (let i = 0; i < players.length; i += 1) {
        if (players[i] !== DEFAULT_SETUP.players[i]) return true;
    }
    return false;
};

export const hasPersistedGameData = (): boolean => {
    const session = loadFromLocalStorage();
    return session !== undefined && sessionHasGameData(session);
};

/**
 * Decode a single wire field via its codec. Throws
 * `ShareSnapshotDecodeError` (carrying the failing field's name) on
 * decode failure — the caller surfaces a user-visible error and
 * aborts hydration rather than partially applying.
 */
const decodeField = <A>(
    field: string,
    raw: string,
    codec: Schema.Codec<A, string>,
): A => {
    const decoded = Schema.decodeUnknownResult(codec)(raw);
    if (Result.isFailure(decoded)) {
        throw new ShareSnapshotDecodeError(field);
    }
    return decoded.success;
};

/**
 * Pure conversion: decoded snapshot → `GameSession`. Mirrors the
 * domain-construction pattern in `buildSessionFromV6` (Persistence.ts):
 * decoded plain objects get wrapped into the Data.Class domain values
 * the reducer (and downstream solver) expect, missing IDs get minted.
 *
 * `fallbackCardSet` is used when the snapshot has no card pack —
 * defensive, since the receive page gates Import out of that branch.
 */
export const buildSessionFromSnapshot = (
    snapshot: ShareSnapshotForHydration,
    fallbackCardSet: CardSet,
    fallbackPlayerSet: GameSession["setup"]["playerSet"],
): GameSession => {
    const cardSet = (() => {
        if (snapshot.cardPackData === null) return fallbackCardSet;
        const decoded = decodeField(
            F_CARD_PACK_DATA,
            snapshot.cardPackData,
            cardPackCodec,
        );
        return CardSet({
            categories: decoded.categories.map((c) =>
                Category({
                    id: c.id,
                    name: c.name,
                    cards: c.cards.map((card) =>
                        CardEntry({ id: card.id, name: card.name }),
                    ),
                }),
            ),
        });
    })();

    const players =
        snapshot.playersData !== null
            ? decodeField(F_PLAYERS_DATA, snapshot.playersData, playersCodec)
            : null;
    const setup =
        players !== null
            ? GameSetup({
                  cardSet,
                  playerSet: PlayerSet({ players }),
              })
            : GameSetup({ cardSet, playerSet: fallbackPlayerSet });

    const handSizes =
        snapshot.handSizesData !== null
            ? decodeField(
                  F_HAND_SIZES_DATA,
                  snapshot.handSizesData,
                  handSizesCodec,
              ).map((h) => ({ player: h.player, size: h.size }))
            : [];

    const hands =
        snapshot.knownCardsData !== null
            ? decodeField(
                  F_KNOWN_CARDS_DATA,
                  snapshot.knownCardsData,
                  knownCardsCodec,
              ).map((h) => ({
                  player: h.player,
                  cards: h.cards as ReadonlyArray<
                      GameSession["hands"][number]["cards"][number]
                  >,
              }))
            : [];

    const suggestions =
        snapshot.suggestionsData !== null
            ? decodeField(
                  F_SUGGESTIONS_DATA,
                  snapshot.suggestionsData,
                  suggestionsCodec,
              ).map((s) =>
                  Suggestion({
                      id:
                          s.id === undefined
                              ? newSuggestionId()
                              : s.id,
                      suggester: s.suggester,
                      cards: s.cards,
                      nonRefuters: s.nonRefuters,
                      refuter: s.refuter ?? undefined,
                      seenCard: s.seenCard ?? undefined,
                      loggedAt: s.loggedAt,
                  }),
              )
            : [];

    const accusations =
        snapshot.accusationsData !== null
            ? decodeField(
                  F_ACCUSATIONS_DATA,
                  snapshot.accusationsData,
                  accusationsCodec,
              ).map((a) =>
                  Accusation({
                      id:
                          a.id === undefined
                              ? newAccusationId()
                              : a.id,
                      accuser: a.accuser,
                      cards: a.cards,
                      loggedAt: a.loggedAt,
                  }),
              )
            : [];

    const hypotheses: HypothesisMap =
        snapshot.hypothesesData !== null
            ? (() => {
                  const decoded = decodeField(
                      F_HYPOTHESES_DATA,
                      snapshot.hypothesesData,
                      hypothesesCodec,
                  );
                  let m: HypothesisMap = emptyHypotheses;
                  for (const h of decoded) {
                      const owner =
                          h.player !== null
                              ? PlayerOwner(h.player)
                              : CaseFileOwner();
                      m = HashMap.set(
                          m,
                          Cell(owner, h.card),
                          h.value as HypothesisValue,
                      );
                  }
                  return m;
              })()
            : emptyHypotheses;

    return {
        setup,
        hands,
        handSizes,
        suggestions,
        accusations,
        hypotheses,
        // Drafts are local-only; the receiver enters their own.
        pendingSuggestion: null,
    };
};

/**
 * Distinct outcome of `saveOrRecognisePack`. `recognised` means the
 * snapshot's pack matched something already in the user's library —
 * either a built-in (`CARD_SETS`) or a saved custom pack — by
 * structural equality, so we just stamped that pack's id as MRU and
 * left the registry alone. `saved` means the pack was structurally
 * new and was persisted to `customCardSets` plus stamped MRU.
 * `none` means the snapshot has no pack at all (defensive — the
 * receive page gates Import out of that branch).
 */
export type RecognisedPackResult =
    | { readonly kind: "saved"; readonly pack: CustomCardSet }
    | {
          readonly kind: "recognised";
          readonly id: string;
          readonly label: string;
      }
    | { readonly kind: "none" };

const decodeAndBuildCardSet = (
    snapshot: ShareSnapshotForHydration,
): { readonly cardSet: CardSet; readonly name: string } | null => {
    if (snapshot.cardPackData === null) return null;
    const decoded = decodeField(
        F_CARD_PACK_DATA,
        snapshot.cardPackData,
        cardPackCodec,
    );
    const cardSet = CardSet({
        categories: decoded.categories.map((c) =>
            Category({
                id: c.id,
                name: c.name,
                cards: c.cards.map((card) =>
                    CardEntry({ id: card.id, name: card.name }),
                ),
            }),
        ),
    });
    return { cardSet, name: decoded.name ?? "" };
};

/**
 * Persist the snapshot's pack into the local card-pack registry and
 * mark it as the most-recently-used pack. Two short-circuits before
 * we'd otherwise duplicate-write:
 *
 *   1. Built-in match: when the decoded deck structurally equals one
 *      of `CARD_SETS` (Classic / Master Detective), stamp that id as
 *      MRU and return — receiving Classic shouldn't seed a "Classic"
 *      copy into the user's customCardSets every time. The wire-name
 *      is ignored for built-ins; they're identified by content.
 *   2. Existing custom-pack match: when the decoded deck structurally
 *      equals a pack the user already has saved AND carries the same
 *      label, stamp the existing id and return. The name has to match
 *      because users distinguish two structurally-identical decks by
 *      label ("Mike's Office" vs "The Office Pack" with the same
 *      cards are deliberately separate packs); duplicating content
 *      across labels is a feature, not a bug. Without the name match
 *      we'd incorrectly fold one into the other on re-import.
 *
 * Content equality is `cardSetEquals` — the same name-based
 * structural comparison `CardPackRow` uses to decide which pack pill
 * is active. IDs aren't compared (the wire-format IDs from a sender
 * may differ from the receiver's local IDs even for content-identical
 * packs). Label equality is exact-string (no trim/case-folding) for
 * the same reason: users see the label they chose, so any character
 * difference is meaningful.
 *
 * Tie-breaker when multiple existing custom packs match content+label
 * (rare — would mean the user saved the same pack twice under the
 * same name): pick the most-recently-used one, falling back to the
 * first match. Keeps the active-pill resolution stable across
 * re-imports.
 */
const saveOrRecognisePack = (
    snapshot: ShareSnapshotForHydration,
): RecognisedPackResult => {
    const decoded = decodeAndBuildCardSet(snapshot);
    if (decoded === null) return { kind: "none" };
    const builtIn = CARD_SETS.find((s) =>
        cardSetEquals(decoded.cardSet, s.cardSet),
    );
    if (builtIn !== undefined) {
        recordCardPackUse(builtIn.id);
        return { kind: "recognised", id: builtIn.id, label: builtIn.label };
    }
    const existing = pickExistingCustomMatch(decoded.cardSet, decoded.name);
    if (existing !== undefined) {
        recordCardPackUse(existing.id);
        return {
            kind: "recognised",
            id: existing.id,
            label: existing.label,
        };
    }
    const savedPack = saveCustomCardSet(decoded.name, decoded.cardSet);
    recordCardPackUse(savedPack.id);
    return { kind: "saved", pack: savedPack };
};

/**
 * Find a saved custom pack whose contents structurally match
 * `cardSet` AND whose label exactly matches `label`. When more than
 * one matches, prefer the most-recently-used; when none has been
 * used (or usage map is empty), the first match wins.
 */
const pickExistingCustomMatch = (
    cardSet: CardSet,
    label: string,
): CustomCardSet | undefined => {
    const candidates = loadCustomCardSets().filter(
        (p) => p.label === label && cardSetEquals(p.cardSet, cardSet),
    );
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];
    const usage = loadCardPackUsage();
    let best = candidates[0]!;
    let bestAt: number | undefined = epochOf(usage, best.id);
    for (let i = 1; i < candidates.length; i += 1) {
        const c = candidates[i]!;
        const at = epochOf(usage, c.id);
        if (at !== undefined && (bestAt === undefined || at > bestAt)) {
            best = c;
            bestAt = at;
        }
    }
    return best;
};

const epochOf = (
    usage: ReturnType<typeof loadCardPackUsage>,
    id: string,
): number | undefined => {
    const at = usage.get(id);
    return at === undefined ? undefined : DateTime.toEpochMillis(at);
};

/**
 * Pack-only receive flow: persists the pack and returns the saved
 * descriptor (or null when the snapshot's pack matches a built-in).
 * Callers that need the user-facing label can read it from either
 * branch — see `pickPackResultLabel` in `ShareImportPage`.
 */
export const saveCardPackFromSnapshot = (
    snapshot: ShareSnapshotForHydration,
): RecognisedPackResult => {
    if (snapshot.cardPackData === null) {
        throw new ShareSnapshotDecodeError(F_CARD_PACK_DATA);
    }
    return saveOrRecognisePack(snapshot);
};

export const applyShareSnapshotToLocalStorage = (
    snapshot: ShareSnapshotForHydration,
): GameSession => {
    const currentSession = loadFromLocalStorage();
    const session = buildSessionFromSnapshot(
        snapshot,
        currentSession?.setup.cardSet ?? DEFAULT_SETUP.cardSet,
        currentSession?.setup.playerSet ?? DEFAULT_SETUP.playerSet,
    );
    saveToLocalStorage(session);
    // Invite/transfer also feeds the imported pack into the local
    // card-pack registry so `CardPackRow` can light its pill up post-
    // import. Built-ins are recognised, not duplicated.
    if (snapshot.cardPackData !== null) saveOrRecognisePack(snapshot);
    return session;
};

export function useApplyShareSnapshot(): (
    snapshot: ShareSnapshotForHydration,
) => void {
    return (snapshot) => {
        applyShareSnapshotToLocalStorage(snapshot);
    };
}
