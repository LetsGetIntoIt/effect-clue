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
import { beforeEach, describe, expect, test } from "vitest";
import { Card, CardCategory, Player } from "../../logic/GameObjects";
import { newAccusationId } from "../../logic/Accusation";
import { newSuggestionId } from "../../logic/Suggestion";
import { GameSetup } from "../../logic/GameSetup";
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
    applyShareSnapshotToLocalStorage,
    buildSessionFromSnapshot,
    hasPersistedGameData,
    saveCardPackFromSnapshot,
    ShareSnapshotDecodeError,
    sessionHasGameData,
    type ShareSnapshotForHydration,
} from "./useApplyShareSnapshot";
import {
    loadFromLocalStorage,
    saveToLocalStorage,
} from "../../logic/Persistence";
import { loadCustomCardSets } from "../../logic/CustomCardSets";
import { loadCardPackUsage } from "../../logic/CardPackUsage";

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

beforeEach(() => {
    window.localStorage.clear();
});

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

describe("applyShareSnapshotToLocalStorage — receive page handoff", () => {
    test("writes the decoded share without requiring ClueProvider", () => {
        const session = applyShareSnapshotToLocalStorage(
            sampleSnapshot({
                cardPack: true,
                players: true,
                handSizes: true,
                knownCards: true,
                suggestions: true,
                accusations: true,
            }),
        );
        const persisted = loadFromLocalStorage();

        expect(persisted?.setup.players).toEqual(session.setup.players);
        expect(persisted?.hands.length).toBe(1);
        expect(persisted?.suggestions.length).toBe(1);
        expect(persisted?.accusations.length).toBe(1);
    });

    test("pack-only shares preserve the receiver's existing players", () => {
        saveToLocalStorage({
            setup: GameSetup({
                cardSet: RECEIVER_FALLBACK_PACK,
                playerSet: RECEIVER_FALLBACK_PLAYERS,
            }),
            hands: [],
            handSizes: [],
            suggestions: [],
            accusations: [],
        });

        const session = applyShareSnapshotToLocalStorage(
            sampleSnapshot({ cardPack: true }),
        );

        expect(session.setup.players).toEqual(
            RECEIVER_FALLBACK_PLAYERS.players,
        );
        expect(loadFromLocalStorage()?.setup.players).toEqual(
            RECEIVER_FALLBACK_PLAYERS.players,
        );
    });
});

describe("saveCardPackFromSnapshot — pack-only receive", () => {
    test("adds the shared pack, marks it recent, and leaves the current game untouched", () => {
        const currentSession = {
            setup: GameSetup({
                cardSet: RECEIVER_FALLBACK_PACK,
                playerSet: RECEIVER_FALLBACK_PLAYERS,
            }),
            hands: [{ player: Player("Original-Receiver-1"), cards: [] }],
            handSizes: [{ player: Player("Original-Receiver-1"), size: 1 }],
            suggestions: [],
            accusations: [],
        };
        saveToLocalStorage(currentSession);

        const savedPack = saveCardPackFromSnapshot(
            sampleSnapshot({ cardPack: true }),
        );

        expect(savedPack.label).toBe("Classic");
        expect(savedPack.cardSet.categories[0]!.name).toBe("Suspect");
        expect(loadCustomCardSets()).toContainEqual(savedPack);
        expect(loadCardPackUsage().has(savedPack.id)).toBe(true);
        expect(loadFromLocalStorage()).toEqual(currentSession);
    });

    test("missing cardPackData throws without touching saved packs", () => {
        expect(() =>
            saveCardPackFromSnapshot({
                cardPackData: null,
                playersData: null,
                handSizesData: null,
                knownCardsData: null,
                suggestionsData: null,
                accusationsData: null,
            }),
        ).toThrow(ShareSnapshotDecodeError);
        expect(loadCustomCardSets()).toEqual([]);
    });
});

describe("share receive dirty-state detection", () => {
    test("default persisted session is clean", () => {
        const clean = {
            setup: GameSetup({
                cardSet: RECEIVER_FALLBACK_PACK,
                playerSet: DEFAULT_PLAYER_SET(),
            }),
            hands: [],
            handSizes: [],
            suggestions: [],
            accusations: [],
        };

        expect(sessionHasGameData(clean)).toBe(false);
    });

    test("hand sizes, progress, or edited players are dirty", () => {
        const base = GameSetup({
            cardSet: RECEIVER_FALLBACK_PACK,
            playerSet: DEFAULT_PLAYER_SET(),
        });

        expect(
            sessionHasGameData({
                setup: base,
                hands: [],
                handSizes: [{ player: Player("Player 1"), size: 4 }],
                suggestions: [],
                accusations: [],
            }),
        ).toBe(true);
        expect(
            sessionHasGameData({
                setup: GameSetup({
                    cardSet: RECEIVER_FALLBACK_PACK,
                    playerSet: PlayerSet({
                        players: [Player("Alice"), Player("Player 2")],
                    }),
                }),
                hands: [],
                handSizes: [],
                suggestions: [],
                accusations: [],
            }),
        ).toBe(true);
    });

    test("hasPersistedGameData reads the same predicate from localStorage", () => {
        expect(hasPersistedGameData()).toBe(false);
        saveToLocalStorage({
            setup: GameSetup({
                cardSet: RECEIVER_FALLBACK_PACK,
                playerSet: DEFAULT_PLAYER_SET(),
            }),
            hands: [{ player: Player("Player 1"), cards: [Card("card-x")] }],
            handSizes: [],
            suggestions: [],
            accusations: [],
        });
        expect(hasPersistedGameData()).toBe(true);
    });
});

const DEFAULT_PLAYER_SET = () =>
    PlayerSet({
        players: [
            Player("Player 1"),
            Player("Player 2"),
            Player("Player 3"),
            Player("Player 4"),
        ],
    });
