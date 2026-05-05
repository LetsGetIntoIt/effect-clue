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
    handSizesCodec,
    hypothesesCodec,
    knownCardsCodec,
    playersCodec,
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
    test("round-trips a cell hypothesis in the persisted shape", () => {
        const hypotheses = [
            {
                owner: { _tag: "Player" as const, player: Player("Alice") },
                card: Card("card-scarlet"),
                value: "Y" as const,
            },
        ];
        const encoded = encode(hypothesesCodec)(hypotheses);
        const decoded = decode(hypothesesCodec)(encoded);
        expect(Result.isSuccess(decoded)).toBe(true);
        if (Result.isSuccess(decoded)) {
            expect(decoded.success[0]!.owner).toEqual({
                _tag: "Player",
                player: Player("Alice"),
            });
            expect(decoded.success[0]!.value).toBe("Y");
        }
    });
});
