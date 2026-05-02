/**
 * Pure-builder tests for the share-snapshot hydration. Exercises
 * `buildSessionFromSnapshot` (the React-free half of
 * `useApplyShareSnapshot`) so we don't need a `<ClueProvider>` or a
 * router to validate the snapshot → GameSession conversion.
 *
 * Coverage:
 *   - Each variant's snapshot shape (pack / invite / invite-with-
 *     progress / transfer / empty) round-trips into the expected
 *     GameSession with non-snapshot slices blanked.
 *   - Receiver's existing pack + playerSet are preserved when the
 *     snapshot omits them.
 *   - A bad codec payload throws `ShareSnapshotDecodeError` with the
 *     failing field's name surfaced.
 */
import { Schema } from "effect";
import { describe, expect, test } from "vitest";
import { Card, CardCategory, Player } from "../../logic/GameObjects";
import { newAccusationId } from "../../logic/Accusation";
import { newSuggestionId } from "../../logic/Suggestion";
import { CardSet, CardEntry, Category } from "../../logic/CardSet";
import { PlayerSet } from "../../logic/PlayerSet";
import {
    accusationsCodec,
    cardPackCodec,
    handSizesCodec,
    knownCardsCodec,
    playersCodec,
    suggestionsCodec,
} from "../../logic/ShareCodec";
import {
    buildSessionFromSnapshot,
    ShareSnapshotDecodeError,
    type ShareSnapshotForHydration,
} from "./useApplyShareSnapshot";

const RECEIVER_FALLBACK_PACK = CardSet({
    categories: [
        Category({
            id: CardCategory("category-receiver-fallback"),
            name: "Receiver fallback",
            cards: [
                CardEntry({
                    id: Card("card-receiver-fallback"),
                    name: "Fallback card",
                }),
            ],
        }),
    ],
});
const RECEIVER_FALLBACK_PLAYERS = PlayerSet({
    players: [Player("Original-Receiver-1"), Player("Original-Receiver-2")],
});

const SHARE_PACK = {
    name: "Classic",
    categories: [
        {
            id: CardCategory("category-suspect"),
            name: "Suspect",
            cards: [
                { id: Card("card-scarlet"), name: "Miss Scarlet" },
                { id: Card("card-mustard"), name: "Colonel Mustard" },
            ],
        },
    ],
};

const sampleSnapshot = (overrides: {
    cardPack?: boolean;
    players?: boolean;
    handSizes?: boolean;
    knownCards?: boolean;
    suggestions?: boolean;
    accusations?: boolean;
}): ShareSnapshotForHydration => ({
    cardPackData:
        overrides.cardPack !== false
            ? Schema.encodeSync(cardPackCodec)(SHARE_PACK)
            : null,
    playersData:
        overrides.players === true
            ? Schema.encodeSync(playersCodec)([
                  Player("Alice"),
                  Player("Bob"),
              ])
            : null,
    handSizesData:
        overrides.handSizes === true
            ? Schema.encodeSync(handSizesCodec)([
                  { player: Player("Alice"), size: 4 },
                  { player: Player("Bob"), size: 4 },
              ])
            : null,
    knownCardsData:
        overrides.knownCards === true
            ? Schema.encodeSync(knownCardsCodec)([
                  {
                      player: Player("Alice"),
                      cards: [Card("card-scarlet")],
                  },
              ])
            : null,
    suggestionsData:
        overrides.suggestions === true
            ? Schema.encodeSync(suggestionsCodec)([
                  {
                      id: newSuggestionId(),
                      suggester: Player("Alice"),
                      cards: [Card("card-scarlet")],
                      nonRefuters: [],
                      refuter: null,
                      seenCard: null,
                      loggedAt: 1_700_000_000_000,
                  },
              ])
            : null,
    accusationsData:
        overrides.accusations === true
            ? Schema.encodeSync(accusationsCodec)([
                  {
                      id: newAccusationId(),
                      accuser: Player("Alice"),
                      cards: [Card("card-scarlet")],
                      loggedAt: 1_700_000_000_000,
                  },
              ])
            : null,
});

const apply = (
    snapshot: ShareSnapshotForHydration,
) =>
    buildSessionFromSnapshot(
        snapshot,
        RECEIVER_FALLBACK_PACK,
        RECEIVER_FALLBACK_PLAYERS,
    );

describe("buildSessionFromSnapshot — variant shapes", () => {
    test("pack-only snapshot → pack replaced, game-state blanked, receiver player set preserved", () => {
        const session = apply(sampleSnapshot({ cardPack: true }));
        expect(session.setup.cardSet.categories[0]!.name).toBe("Suspect");
        // No players in share → receiver's existing players stay.
        expect(session.setup.players).toEqual(
            RECEIVER_FALLBACK_PLAYERS.players,
        );
        // All game-state slices blank.
        expect(session.handSizes).toEqual([]);
        expect(session.hands).toEqual([]);
        expect(session.suggestions).toEqual([]);
        expect(session.accusations).toEqual([]);
    });

    test("invite snapshot (no progress) → pack + players + handSizes; rest blank", () => {
        const session = apply(
            sampleSnapshot({
                cardPack: true,
                players: true,
                handSizes: true,
            }),
        );
        expect(session.setup.players.length).toBe(2);
        expect(session.setup.players[0]).toBe(Player("Alice"));
        expect(session.handSizes.length).toBe(2);
        expect(session.handSizes[0]!.player).toBe(Player("Alice"));
        expect(session.hands).toEqual([]);
        expect(session.suggestions).toEqual([]);
        expect(session.accusations).toEqual([]);
    });

    test("invite snapshot with progress → suggestions + accusations populated, knownCards blank", () => {
        const session = apply(
            sampleSnapshot({
                cardPack: true,
                players: true,
                handSizes: true,
                suggestions: true,
                accusations: true,
            }),
        );
        expect(session.suggestions.length).toBe(1);
        expect(session.suggestions[0]!.suggester).toBe(Player("Alice"));
        expect(session.accusations.length).toBe(1);
        expect(session.hands).toEqual([]);
    });

    test("transfer snapshot → all six slices populated", () => {
        const session = apply(
            sampleSnapshot({
                cardPack: true,
                players: true,
                handSizes: true,
                knownCards: true,
                suggestions: true,
                accusations: true,
            }),
        );
        expect(session.setup.players.length).toBe(2);
        expect(session.handSizes.length).toBe(2);
        expect(session.hands.length).toBe(1);
        expect(session.hands[0]!.cards[0]).toBe(Card("card-scarlet"));
        expect(session.suggestions.length).toBe(1);
        expect(session.accusations.length).toBe(1);
    });

    test("empty snapshot (no pack) → falls back to receiver pack + receiver players + blank slices", () => {
        const session = apply({
            cardPackData: null,
            playersData: null,
            handSizesData: null,
            knownCardsData: null,
            suggestionsData: null,
            accusationsData: null,
        });
        expect(session.setup.cardSet).toBe(RECEIVER_FALLBACK_PACK);
        expect(session.setup.players).toEqual(
            RECEIVER_FALLBACK_PLAYERS.players,
        );
        expect(session.handSizes).toEqual([]);
        expect(session.suggestions).toEqual([]);
    });
});

describe("buildSessionFromSnapshot — decode failures", () => {
    test("malformed cardPackData throws ShareSnapshotDecodeError naming the field", () => {
        expect(() =>
            apply({
                cardPackData: "{not json",
                playersData: null,
                handSizesData: null,
                knownCardsData: null,
                suggestionsData: null,
                accusationsData: null,
            }),
        ).toThrow(ShareSnapshotDecodeError);
        try {
            apply({
                cardPackData: "{not json",
                playersData: null,
                handSizesData: null,
                knownCardsData: null,
                suggestionsData: null,
                accusationsData: null,
            });
        } catch (e) {
            expect((e as ShareSnapshotDecodeError).field).toBe("cardPackData");
        }
    });

    test("missing-id suggestion gets a freshly minted id (mirrors persistence path)", () => {
        const session = apply({
            cardPackData: Schema.encodeSync(cardPackCodec)(SHARE_PACK),
            playersData: Schema.encodeSync(playersCodec)([Player("Alice")]),
            handSizesData: Schema.encodeSync(handSizesCodec)([]),
            knownCardsData: null,
            suggestionsData: Schema.encodeSync(suggestionsCodec)([
                {
                    // No id field — codec accepts it as optional.
                    suggester: Player("Alice"),
                    cards: [Card("card-scarlet")],
                    nonRefuters: [],
                    refuter: null,
                    seenCard: null,
                    loggedAt: 1_700_000_000_000,
                },
            ]),
            accusationsData: null,
        });
        expect(session.suggestions[0]!.id).toBeTruthy();
        expect(String(session.suggestions[0]!.id).length).toBeGreaterThan(0);
    });
});
