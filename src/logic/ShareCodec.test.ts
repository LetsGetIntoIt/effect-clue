/**
 * Round-trip tests for the M9-share wire codecs.
 *
 * Each codec is `Schema.fromJsonString(InnerSchema)` — encode produces
 * a JSON string that the receive path (or the server validation
 * boundary) can decode back into the original branded domain shape.
 *
 * Coverage per codec:
 *   - Round-trip parity for a representative value.
 *   - Decode rejects malformed JSON.
 *   - Decode rejects well-formed JSON with the wrong inner shape.
 *   - Branded ids (Player / Card) survive decode (the brand survives
 *     the schema pipe, no manual wrapping needed downstream).
 */
import { Result, Schema } from "effect";
import { describe, expect, test } from "vitest";
import { Card, CardCategory, Player } from "./GameObjects";
import { newSuggestionId } from "./Suggestion";
import { newAccusationId } from "./Accusation";
import {
    accusationsCodec,
    cardPackCodec,
    dismissedInsightsCodec,
    firstDealtPlayerIdCodec,
    handSizesCodec,
    hypothesesCodec,
    hypothesisOrderCodec,
    knownCardsCodec,
    playersCodec,
    selfPlayerIdCodec,
    suggestionsCodec,
} from "./ShareCodec";

const decode = <A>(codec: Schema.Codec<A, string>) =>
    Schema.decodeUnknownResult(codec);
const encode = <A>(codec: Schema.Codec<A, string>) =>
    Schema.encodeSync(codec);

const SAMPLE_CARD_SET = {
    name: "Classic" as const,
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

describe("cardPackCodec", () => {
    test("round-trips the sample card set", () => {
        const encoded = encode(cardPackCodec)(SAMPLE_CARD_SET);
        const decoded = decode(cardPackCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success.categories.length).toBe(1);
            expect(decoded.success.name).toBe("Classic");
            // Brand preserved — Card / CardCategory ids round-trip.
            expect(decoded.success.categories[0]!.cards[0]!.id).toBe(
                Card("card-scarlet"),
            );
        }
    });

    test("rejects malformed JSON", () => {
        const decoded = decode(cardPackCodec)("{not json");
        expect(Result.isFailure(decoded)).toBe(true);
    });

    test("rejects well-formed JSON with wrong shape", () => {
        const decoded = decode(cardPackCodec)(JSON.stringify({ foo: "bar" }));
        expect(Result.isFailure(decoded)).toBe(true);
    });

    test("accepts a name-less card set (built-in publisher might omit it)", () => {
        const encoded = encode(cardPackCodec)({
            categories: SAMPLE_CARD_SET.categories,
        });
        const decoded = decode(cardPackCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
    });
});

describe("playersCodec", () => {
    test("round-trips a player list and preserves the brand", () => {
        const players = [Player("Alice"), Player("Bob")];
        const encoded = encode(playersCodec)(players);
        const decoded = decode(playersCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success.length).toBe(2);
            expect(decoded.success[0]).toBe(Player("Alice"));
        }
    });

    test("rejects a non-array payload", () => {
        const decoded = decode(playersCodec)(JSON.stringify({ foo: "bar" }));
        expect(Result.isFailure(decoded)).toBe(true);
    });
});

describe("handSizesCodec", () => {
    test("round-trips player + size pairs", () => {
        const sizes = [
            { player: Player("Alice"), size: 4 },
            { player: Player("Bob"), size: 5 },
        ];
        const encoded = encode(handSizesCodec)(sizes);
        const decoded = decode(handSizesCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success[1]!.size).toBe(5);
        }
    });
});

describe("knownCardsCodec", () => {
    test("round-trips player → cards mappings", () => {
        const hands = [
            {
                player: Player("Alice"),
                cards: [Card("card-scarlet"), Card("card-mustard")],
            },
        ];
        const encoded = encode(knownCardsCodec)(hands);
        const decoded = decode(knownCardsCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success[0]!.cards.length).toBe(2);
            expect(decoded.success[0]!.player).toBe(Player("Alice"));
        }
    });
});

describe("suggestionsCodec", () => {
    test("round-trips a suggestion in the persisted shape", () => {
        const suggestions = [
            {
                id: newSuggestionId(),
                suggester: Player("Alice"),
                cards: [Card("card-scarlet"), Card("card-rope")],
                nonRefuters: [Player("Bob")],
                refuter: null,
                seenCard: null,
                loggedAt: 1_700_000_000_000,
            },
        ];
        const encoded = encode(suggestionsCodec)(suggestions);
        const decoded = decode(suggestionsCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success[0]!.suggester).toBe(Player("Alice"));
            expect(decoded.success[0]!.cards.length).toBe(2);
        }
    });

    test("rejects a suggestion missing the loggedAt field", () => {
        const decoded = decode(suggestionsCodec)(
            JSON.stringify([
                {
                    suggester: "Alice",
                    cards: [],
                    nonRefuters: [],
                    refuter: null,
                    seenCard: null,
                },
            ]),
        );
        expect(Result.isFailure(decoded)).toBe(true);
    });
});

describe("accusationsCodec", () => {
    test("round-trips an accusation in the persisted shape", () => {
        const accusations = [
            {
                id: newAccusationId(),
                accuser: Player("Alice"),
                cards: [Card("card-scarlet")],
                loggedAt: 1_700_000_000_000,
            },
        ];
        const encoded = encode(accusationsCodec)(accusations);
        const decoded = decode(accusationsCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success[0]!.accuser).toBe(Player("Alice"));
        }
    });
});

describe("hypothesesCodec", () => {
    test("round-trips a hypothesis cell with player owner", () => {
        const hypotheses = [
            {
                player: Player("Alice"),
                card: Card("card-scarlet"),
                value: "Y" as const,
            },
        ];
        const encoded = encode(hypothesesCodec)(hypotheses);
        const decoded = decode(hypothesesCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success[0]!.player).toBe(Player("Alice"));
            expect(decoded.success[0]!.card).toBe(Card("card-scarlet"));
            expect(decoded.success[0]!.value).toBe("Y");
        }
    });

    test("round-trips a hypothesis cell with case-file owner (player=null)", () => {
        const hypotheses = [
            {
                player: null,
                card: Card("card-knife"),
                value: "N" as const,
            },
        ];
        const encoded = encode(hypothesesCodec)(hypotheses);
        const decoded = decode(hypothesesCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success[0]!.player).toBeNull();
        }
    });
});

describe("selfPlayerIdCodec", () => {
    test("round-trips a Player value", () => {
        const encoded = encode(selfPlayerIdCodec)(Player("Alice"));
        const decoded = decode(selfPlayerIdCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success).toBe(Player("Alice"));
        }
    });

    test("round-trips null (skipped identity)", () => {
        const encoded = encode(selfPlayerIdCodec)(null);
        expect(encoded).toBe("null");
        const decoded = decode(selfPlayerIdCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success).toBeNull();
        }
    });

    test("rejects non-string non-null payloads", () => {
        const decoded = decode(selfPlayerIdCodec)(
            JSON.stringify({ player: "Alice" }),
        );
        expect(Result.isFailure(decoded)).toBe(true);
    });
});

describe("firstDealtPlayerIdCodec", () => {
    test("round-trips a Player value", () => {
        const encoded = encode(firstDealtPlayerIdCodec)(Player("Bob"));
        const decoded = decode(firstDealtPlayerIdCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success).toBe(Player("Bob"));
        }
    });

    test("round-trips null", () => {
        const decoded = decode(firstDealtPlayerIdCodec)("null");
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success).toBeNull();
        }
    });
});

describe("dismissedInsightsCodec", () => {
    test("round-trips a list of dismissals", () => {
        const dismissals = [
            { key: "FrequentSuggester:Alice:Knife", atConfidence: "med" as const },
            { key: "InsistentDenier:Bob:Rope", atConfidence: "high" as const },
        ];
        const encoded = encode(dismissedInsightsCodec)(dismissals);
        const decoded = decode(dismissedInsightsCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success.length).toBe(2);
            expect(decoded.success[0]!.key).toBe(
                "FrequentSuggester:Alice:Knife",
            );
            expect(decoded.success[0]!.atConfidence).toBe("med");
        }
    });

    test("round-trips an empty dismissal list", () => {
        const encoded = encode(dismissedInsightsCodec)([]);
        const decoded = decode(dismissedInsightsCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success.length).toBe(0);
        }
    });

    test("rejects an unknown atConfidence value", () => {
        const decoded = decode(dismissedInsightsCodec)(
            JSON.stringify([{ key: "X", atConfidence: "extreme" }]),
        );
        expect(Result.isFailure(decoded)).toBe(true);
    });
});

describe("hypothesisOrderCodec", () => {
    test("round-trips an ordering with player + case-file entries", () => {
        const order = [
            { player: Player("Alice"), card: Card("card-scarlet") },
            { player: null, card: Card("card-knife") },
        ];
        const encoded = encode(hypothesisOrderCodec)(order);
        const decoded = decode(hypothesisOrderCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success.length).toBe(2);
            expect(decoded.success[0]!.player).toBe(Player("Alice"));
            expect(decoded.success[1]!.player).toBeNull();
            expect(decoded.success[1]!.card).toBe(Card("card-knife"));
        }
    });

    test("rejects entries missing a card", () => {
        const decoded = decode(hypothesisOrderCodec)(
            JSON.stringify([{ player: "Alice" }]),
        );
        expect(Result.isFailure(decoded)).toBe(true);
    });
});
