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

import { Result, Schema } from "effect";
import { Accusation, newAccusationId } from "../../logic/Accusation";
import {
    CardSet,
    CardEntry,
    Category,
} from "../../logic/CardSet";
import { DEFAULT_SETUP, GameSetup } from "../../logic/GameSetup";
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
    saveCustomCardSet,
    type CustomCardSet,
} from "../../logic/CustomCardSets";
import { recordCardPackUse } from "../../logic/CardPackUsage";
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
    };
};

export const saveCardPackFromSnapshot = (
    snapshot: ShareSnapshotForHydration,
): CustomCardSet => {
    if (snapshot.cardPackData === null) {
        throw new ShareSnapshotDecodeError(F_CARD_PACK_DATA);
    }
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
    const savedPack = saveCustomCardSet(
        decoded.name ?? "",
        cardSet,
    );
    recordCardPackUse(savedPack.id);
    return savedPack;
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
    return session;
};

export function useApplyShareSnapshot(): (
    snapshot: ShareSnapshotForHydration,
) => void {
    return (snapshot) => {
        applyShareSnapshotToLocalStorage(snapshot);
    };
}
