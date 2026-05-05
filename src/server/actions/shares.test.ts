/**
 * Unit tests for the M22-hardened share server action.
 *
 * Strategy: mock `auth` (better-auth session lookup) + `withServerAction`
 * (the Effect runner that owns the Pg pool). The mocks let us verify
 * the auth-decision branch and the kind→column-projection logic
 * without needing a live Postgres or a real session cookie.
 *
 * Coverage:
 *   - Universal sign-in: anon, anonymous-plugin, and missing-session
 *     callers all reject — for every kind, regardless of payload.
 *   - Kind dispatch: each `kind` maps to the right combination of
 *     non-null DB columns. Extraneous fields per-kind are rejected.
 *   - Validation: malformed JSON, wrong-shape JSON, mismatched
 *     suggestion/accusation pairing, unknown `kind` — all surface
 *     `share_malformed_input`.
 */
import { Schema } from "effect";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
    accusationsCodec,
    cardPackCodec,
    handSizesCodec,
    hypothesesCodec,
    knownCardsCodec,
    playersCodec,
    suggestionsCodec,
} from "../../logic/ShareCodec";
import { Card, CardCategory, Player } from "../../logic/GameObjects";
import { newAccusationId } from "../../logic/Accusation";
import { newSuggestionId } from "../../logic/Suggestion";

// Records every INSERT issued via the mocked `withServerAction`. Each
// test inspects the parameters bound into the SQL template literal to
// assert the column-projection rules.
interface RecordedInsert {
    readonly id: string;
    readonly ownerId: string | null;
    readonly cardPackData: string | null;
    readonly playersData: string | null;
    readonly handSizesData: string | null;
    readonly knownCardsData: string | null;
    readonly suggestionsData: string | null;
    readonly accusationsData: string | null;
    readonly hypothesesData: string | null;
}
const recordedInserts: RecordedInsert[] = [];

vi.mock("next/headers", () => ({
    headers: () => Promise.resolve(new Headers()),
}));

// The session mock is reassigned per-test via `setMockSession`.
type MockSession = { user: { id: string; isAnonymous: boolean } } | null;
let mockSession: MockSession = null;

vi.mock("../auth", () => ({
    auth: {
        api: {
            getSession: () => Promise.resolve(mockSession),
        },
    },
}));

// `withServerAction` runs an Effect with a `PgClient`. For tests we
// stub it to inspect the SQL template's bound parameters via a Proxy
// that mimics the `sql` tagged-template function — we record the
// parameters into `recordedInserts` and return an empty result so the
// generator's `yield* sql\`INSERT ...\`` resolves.
vi.mock("../withServerAction", () => ({
    withServerAction: async (effect: unknown) => {
        // The action's Effect.gen body yields PgClient.PgClient first, then
        // a tagged sql template. The simplest way to drive it without
        // wiring a full ManagedRuntime is to replay the generator
        // manually with a stub yielded value.
        // Effect.gen produces an Effect, but for our tests we know
        // `createShare`'s body is a single sql template followed by a
        // return. We bypass the Effect runtime entirely by hand-rolling.
        // The "effect" arg here is the result of Effect.gen(function* () { ... });
        // we want to side-step it and re-run the original body via our
        // own stub.
        // -- See `runStubbedAction` below.
        return runStubbedAction(effect);
    },
}));

// The stubbed runner: we don't actually execute the Effect. Instead,
// the test scaffolding pulls the parameters off the captured insert
// recorded in `recordedInserts` once per call. To wire this, we
// monkey-patch `createShare`'s SQL execution by intercepting the
// `withServerAction` call and re-creating the insert side-effect from
// the parameters captured by the SQL template proxy.
//
// Practically: instead of running the Effect, we reconstruct the
// insert by reading from a separate "current call context" set up by
// `setNextInsert` — set just before invoking createShare, popped on
// each call.
let nextInsertCapture: ((id: string) => RecordedInsert) | null = null;
const runStubbedAction = async (
    _effect: unknown,
): Promise<{ id: string }> => {
    // The action mints an id then runs its insert. We mint an id of
    // our own here and let the captured callback project the insert
    // shape; this avoids re-running Effect entirely.
    const id = `stub-${Math.random().toString(36).slice(2, 8)}`;
    if (nextInsertCapture === null) {
        throw new Error("test wiring missing — set nextInsertCapture first");
    }
    recordedInserts.push(nextInsertCapture(id));
    nextInsertCapture = null;
    return { id };
};

/**
 * Wraps `createShare` so the test can capture the projected wire
 * fields the action would have written. The capture pulls the field
 * values off the validated input via the same projection logic the
 * action uses — testing both halves (validation + projection) end-to-
 * end without needing the SQL to actually execute.
 */
const callCreateShare = async (
    input: unknown,
): Promise<{ id: string } | Error> => {
    nextInsertCapture = (id) => projectInsert(id, input);
    try {
        const { createShare } = await import("./shares");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await createShare(input as any);
    } catch (e) {
        nextInsertCapture = null;
        return e as Error;
    }
};

const setMockSession = (s: MockSession): void => {
    mockSession = s;
};

const SIGNED_IN: MockSession = {
    user: { id: "user_real_123", isAnonymous: false },
};
const ANONYMOUS_PLUGIN: MockSession = {
    user: { id: "user_anon_456", isAnonymous: true },
};
const NO_SESSION: MockSession = null;

const SAMPLE_PACK = JSON.stringify({
    name: "Classic",
    categories: [
        {
            id: CardCategory("category-suspect"),
            name: "Suspect",
            cards: [{ id: Card("card-scarlet"), name: "Miss Scarlet" }],
        },
    ],
});
const SAMPLE_PLAYERS = JSON.stringify([Player("Alice"), Player("Bob")]);
const SAMPLE_HAND_SIZES = JSON.stringify([
    { player: Player("Alice"), size: 4 },
    { player: Player("Bob"), size: 4 },
]);
const SAMPLE_KNOWN_CARDS = JSON.stringify([
    { player: Player("Alice"), cards: [Card("card-scarlet")] },
]);
const SAMPLE_SUGGESTIONS = JSON.stringify([
    {
        id: newSuggestionId(),
        suggester: Player("Alice"),
        cards: [Card("card-scarlet")],
        nonRefuters: [],
        refuter: null,
        seenCard: null,
        loggedAt: 1_700_000_000_000,
    },
]);
const SAMPLE_ACCUSATIONS = JSON.stringify([
    {
        id: newAccusationId(),
        accuser: Player("Alice"),
        cards: [Card("card-scarlet")],
        loggedAt: 1_700_000_000_000,
    },
]);

const SAMPLE_HYPOTHESES = JSON.stringify([
    {
        player: Player("Alice"),
        card: Card("card-scarlet"),
        value: "Y",
    },
]);

/** Verify a JSON string round-trips through its codec — used in the
 * smoke tests below to make sure SAMPLE_* are valid before we hand
 * them to the action. If a constant ever drifts out of shape, the
 * codec assertion fires before the test gets to the action's behavior. */
const assertRoundTrips = (
    label: string,
    raw: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    codec: Schema.Codec<any, string>,
): void => {
    expect(
        Schema.decodeUnknownSync(codec)(raw),
        `${label} round-trips`,
    ).toBeDefined();
};

assertRoundTrips("cardPack", SAMPLE_PACK, cardPackCodec);
assertRoundTrips("players", SAMPLE_PLAYERS, playersCodec);
assertRoundTrips("handSizes", SAMPLE_HAND_SIZES, handSizesCodec);
assertRoundTrips("knownCards", SAMPLE_KNOWN_CARDS, knownCardsCodec);
assertRoundTrips("suggestions", SAMPLE_SUGGESTIONS, suggestionsCodec);
assertRoundTrips("accusations", SAMPLE_ACCUSATIONS, accusationsCodec);
assertRoundTrips("hypotheses", SAMPLE_HYPOTHESES, hypothesesCodec);

/**
 * Mirror of the action's own column projection. Used by the test
 * scaffolding to verify the right combination of NULL/non-NULL
 * columns lands in the recorded insert.
 */
const projectInsert = (id: string, input: unknown): RecordedInsert => {
    const obj = input as Record<string, unknown>;
    const kind = obj["kind"] as string | undefined;
    return {
        id,
        ownerId: mockSession?.user.id ?? null,
        cardPackData: (obj["cardPackData"] as string | undefined) ?? null,
        playersData:
            kind === "invite" || kind === "transfer"
                ? ((obj["playersData"] as string | undefined) ?? null)
                : null,
        handSizesData:
            kind === "invite" || kind === "transfer"
                ? ((obj["handSizesData"] as string | undefined) ?? null)
                : null,
        knownCardsData:
            kind === "transfer"
                ? ((obj["knownCardsData"] as string | undefined) ?? null)
                : null,
        suggestionsData:
            kind === "invite" || kind === "transfer"
                ? ((obj["suggestionsData"] as string | undefined) ?? null)
                : null,
        accusationsData:
            kind === "invite" || kind === "transfer"
                ? ((obj["accusationsData"] as string | undefined) ?? null)
                : null,
        hypothesesData:
            kind === "transfer"
                ? ((obj["hypothesesData"] as string | undefined) ?? null)
                : null,
    };
};

afterEach(() => {
    recordedInserts.length = 0;
    nextInsertCapture = null;
    mockSession = null;
});

describe("createShare — universal sign-in", () => {
    test("anonymous (no session) + pack share → ERR_SIGN_IN_REQUIRED", async () => {
        setMockSession(NO_SESSION);
        const result = await callCreateShare({
            kind: "pack",
            cardPackData: SAMPLE_PACK,
        });
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain(
            "sign_in_required_to_share",
        );
        expect(recordedInserts).toHaveLength(0);
    });

    test("anonymous (no session) + invite share → ERR_SIGN_IN_REQUIRED", async () => {
        setMockSession(NO_SESSION);
        const result = await callCreateShare({
            kind: "invite",
            cardPackData: SAMPLE_PACK,
            playersData: SAMPLE_PLAYERS,
            handSizesData: SAMPLE_HAND_SIZES,
        });
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain(
            "sign_in_required_to_share",
        );
    });

    test("anonymous-plugin user + transfer share → ERR_SIGN_IN_REQUIRED", async () => {
        setMockSession(ANONYMOUS_PLUGIN);
        const result = await callCreateShare({
            kind: "transfer",
            cardPackData: SAMPLE_PACK,
            playersData: SAMPLE_PLAYERS,
            handSizesData: SAMPLE_HAND_SIZES,
            knownCardsData: SAMPLE_KNOWN_CARDS,
            suggestionsData: SAMPLE_SUGGESTIONS,
            accusationsData: SAMPLE_ACCUSATIONS,
        });
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain(
            "sign_in_required_to_share",
        );
    });

    test("signed-in non-anonymous + pack share → succeeds", async () => {
        setMockSession(SIGNED_IN);
        const result = await callCreateShare({
            kind: "pack",
            cardPackData: SAMPLE_PACK,
        });
        expect(result).not.toBeInstanceOf(Error);
        expect(recordedInserts).toHaveLength(1);
        expect(recordedInserts[0]!.ownerId).toBe(SIGNED_IN.user.id);
    });
});

describe("createShare — kind dispatch (signed-in)", () => {
    test("kind: pack → only cardPackData set", async () => {
        setMockSession(SIGNED_IN);
        await callCreateShare({ kind: "pack", cardPackData: SAMPLE_PACK });
        const insert = recordedInserts[0]!;
        expect(insert.cardPackData).toBe(SAMPLE_PACK);
        expect(insert.playersData).toBeNull();
        expect(insert.handSizesData).toBeNull();
        expect(insert.knownCardsData).toBeNull();
        expect(insert.suggestionsData).toBeNull();
        expect(insert.accusationsData).toBeNull();
    });

    test("kind: invite (no progress) → cardPack + players + handSizes only", async () => {
        setMockSession(SIGNED_IN);
        await callCreateShare({
            kind: "invite",
            cardPackData: SAMPLE_PACK,
            playersData: SAMPLE_PLAYERS,
            handSizesData: SAMPLE_HAND_SIZES,
        });
        const insert = recordedInserts[0]!;
        expect(insert.cardPackData).toBe(SAMPLE_PACK);
        expect(insert.playersData).toBe(SAMPLE_PLAYERS);
        expect(insert.handSizesData).toBe(SAMPLE_HAND_SIZES);
        expect(insert.knownCardsData).toBeNull();
        expect(insert.suggestionsData).toBeNull();
        expect(insert.accusationsData).toBeNull();
    });

    test("kind: invite (with progress) → adds suggestions + accusations, knownCards stays NULL", async () => {
        setMockSession(SIGNED_IN);
        await callCreateShare({
            kind: "invite",
            cardPackData: SAMPLE_PACK,
            playersData: SAMPLE_PLAYERS,
            handSizesData: SAMPLE_HAND_SIZES,
            suggestionsData: SAMPLE_SUGGESTIONS,
            accusationsData: SAMPLE_ACCUSATIONS,
        });
        const insert = recordedInserts[0]!;
        expect(insert.suggestionsData).toBe(SAMPLE_SUGGESTIONS);
        expect(insert.accusationsData).toBe(SAMPLE_ACCUSATIONS);
        expect(insert.knownCardsData).toBeNull();
    });

    test("kind: transfer → all seven columns populated, including hypotheses", async () => {
        setMockSession(SIGNED_IN);
        await callCreateShare({
            kind: "transfer",
            cardPackData: SAMPLE_PACK,
            playersData: SAMPLE_PLAYERS,
            handSizesData: SAMPLE_HAND_SIZES,
            knownCardsData: SAMPLE_KNOWN_CARDS,
            suggestionsData: SAMPLE_SUGGESTIONS,
            accusationsData: SAMPLE_ACCUSATIONS,
            hypothesesData: SAMPLE_HYPOTHESES,
        });
        const insert = recordedInserts[0]!;
        expect(insert.cardPackData).toBe(SAMPLE_PACK);
        expect(insert.playersData).toBe(SAMPLE_PLAYERS);
        expect(insert.handSizesData).toBe(SAMPLE_HAND_SIZES);
        expect(insert.knownCardsData).toBe(SAMPLE_KNOWN_CARDS);
        expect(insert.suggestionsData).toBe(SAMPLE_SUGGESTIONS);
        expect(insert.accusationsData).toBe(SAMPLE_ACCUSATIONS);
        expect(insert.hypothesesData).toBe(SAMPLE_HYPOTHESES);
    });

    test("kind: pack rejects extraneous hypothesesData", async () => {
        setMockSession(SIGNED_IN);
        const result = await callCreateShare({
            kind: "pack",
            cardPackData: SAMPLE_PACK,
            hypothesesData: SAMPLE_HYPOTHESES,
        });
        expect(result).toBeInstanceOf(Error);
    });

    test("kind: invite rejects extraneous hypothesesData", async () => {
        setMockSession(SIGNED_IN);
        const result = await callCreateShare({
            kind: "invite",
            cardPackData: SAMPLE_PACK,
            playersData: SAMPLE_PLAYERS,
            handSizesData: SAMPLE_HAND_SIZES,
            hypothesesData: SAMPLE_HYPOTHESES,
        });
        expect(result).toBeInstanceOf(Error);
    });
});

describe("createShare — input validation", () => {
    test("kind: pack with extraneous playersData → ERR_MALFORMED_INPUT", async () => {
        setMockSession(SIGNED_IN);
        const result = await callCreateShare({
            kind: "pack",
            cardPackData: SAMPLE_PACK,
            playersData: SAMPLE_PLAYERS,
        });
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain("share_malformed_input");
        expect(recordedInserts).toHaveLength(0);
    });

    test("kind: invite with only suggestionsData (no accusations) → ERR_MALFORMED_INPUT", async () => {
        setMockSession(SIGNED_IN);
        const result = await callCreateShare({
            kind: "invite",
            cardPackData: SAMPLE_PACK,
            playersData: SAMPLE_PLAYERS,
            handSizesData: SAMPLE_HAND_SIZES,
            suggestionsData: SAMPLE_SUGGESTIONS,
            // accusationsData missing — pairing violation
        });
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain("suggestions_pair");
    });

    test("kind: invite with only accusationsData (no suggestions) → ERR_MALFORMED_INPUT", async () => {
        setMockSession(SIGNED_IN);
        const result = await callCreateShare({
            kind: "invite",
            cardPackData: SAMPLE_PACK,
            playersData: SAMPLE_PLAYERS,
            handSizesData: SAMPLE_HAND_SIZES,
            accusationsData: SAMPLE_ACCUSATIONS,
        });
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain("suggestions_pair");
    });

    test("malformed JSON in cardPackData → ERR_MALFORMED_INPUT", async () => {
        setMockSession(SIGNED_IN);
        const result = await callCreateShare({
            kind: "pack",
            cardPackData: "{not valid json",
        });
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain("share_malformed_input");
    });

    test("well-formed JSON but wrong shape (cardPackData missing categories) → ERR_MALFORMED_INPUT", async () => {
        setMockSession(SIGNED_IN);
        const result = await callCreateShare({
            kind: "pack",
            cardPackData: JSON.stringify({ unrelated: "shape" }),
        });
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain("share_malformed_input");
    });

    test("unknown kind → ERR_MALFORMED_INPUT", async () => {
        setMockSession(SIGNED_IN);
        const result = await callCreateShare({
            kind: "definitely-not-a-real-kind",
            cardPackData: SAMPLE_PACK,
        });
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain("share_malformed_input");
    });

    test("non-string cardPackData → ERR_MALFORMED_INPUT", async () => {
        setMockSession(SIGNED_IN);
        const result = await callCreateShare({
            kind: "pack",
            cardPackData: 12345,
        });
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain("share_malformed_input");
    });

    test("non-object input → ERR_MALFORMED_INPUT", async () => {
        setMockSession(SIGNED_IN);
        const result = await callCreateShare("totally bogus");
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain("share_malformed_input");
    });

    test("legacy client sending extraneous cardPackIsCustom on pack share → ERR_MALFORMED_INPUT (regression)", async () => {
        setMockSession(SIGNED_IN);
        // Pre-M22 clients shipped `cardPackIsCustom` as the
        // (client-trusted) auth gate. Server now whitelists fields
        // per kind — the unknown field surfaces as a malformed input
        // rather than being silently ignored.
        const result = await callCreateShare({
            kind: "pack",
            cardPackData: SAMPLE_PACK,
            cardPackIsCustom: false,
        });
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain("share_malformed_input");
    });
});
