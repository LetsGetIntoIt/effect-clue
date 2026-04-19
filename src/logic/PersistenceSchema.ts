import { Schema, SchemaGetter } from "effect";
import { Card, CardCategory, Player } from "./GameObjects";
import { SuggestionId } from "./Suggestion";

/**
 * Effect v4 Schema definitions for the persisted session shape. v4
 * piggy-backs on v3's on-disk layout — same field names, same nesting
 * — but runs decoded payloads through `Schema.decodeUnknown*` so
 * malformed data produces a structured `SchemaError` instead of
 * silent `undefined`.
 *
 * Branded strings (Player, Card, CardCategory, SuggestionId) are
 * decoded straight into their nominal types via `Schema.fromBrand`,
 * so downstream code receives properly-branded values without a
 * second wrapping pass.
 *
 * Legacy v1/v2/v3 blobs still go through the hand-rolled migration
 * chain in `Persistence.ts`; once they upgrade to v3 shape, the same
 * schema here validates them on decode. New writes go out as v4.
 */

const PlayerSchema = Schema.String.pipe(Schema.fromBrand("Player", Player));
const CardSchema = Schema.String.pipe(Schema.fromBrand("Card", Card));
const CardCategorySchema = Schema.String.pipe(
    Schema.fromBrand("CardCategory", CardCategory),
);
const SuggestionIdSchema = Schema.String.pipe(
    Schema.fromBrand("SuggestionId", SuggestionId),
);

const PersistedCardEntrySchema = Schema.Struct({
    id: CardSchema,
    name: Schema.String,
});

const PersistedCategorySchema = Schema.Struct({
    id: CardCategorySchema,
    name: Schema.String,
    cards: Schema.Array(PersistedCardEntrySchema),
});

const PersistedGameSetupSchema = Schema.Struct({
    players: Schema.Array(PlayerSchema),
    categories: Schema.Array(PersistedCategorySchema),
});

const PersistedHandSchema = Schema.Struct({
    player: PlayerSchema,
    cards: Schema.Array(CardSchema),
});

const PersistedHandSizeSchema = Schema.Struct({
    player: PlayerSchema,
    size: Schema.Number,
});

const PersistedSuggestionSchema = Schema.Struct({
    id: Schema.optional(SuggestionIdSchema),
    suggester: PlayerSchema,
    cards: Schema.Array(CardSchema),
    nonRefuters: Schema.Array(PlayerSchema),
    refuter: Schema.NullOr(PlayerSchema),
    seenCard: Schema.NullOr(CardSchema),
});

/**
 * Canonical v4 session shape. Identical payload to v3 — we bump the
 * version byte so decoders can tell which path to run, not because
 * the bytes on disk changed.
 */
export const PersistedSessionV4Schema = Schema.Struct({
    version: Schema.Literal(4),
    setup: PersistedGameSetupSchema,
    hands: Schema.Array(PersistedHandSchema),
    handSizes: Schema.Array(PersistedHandSizeSchema),
    suggestions: Schema.Array(PersistedSuggestionSchema),
});

/**
 * v3 on-disk schema. Shape is identical to v4 except for the version
 * discriminator — the only difference between eras is that we run v4
 * through structured Schema validation on write, whereas v3 blobs
 * were hand-rolled. Decoded v3 payloads carry fully-branded fields
 * (same nested schemas as v4).
 */
const PersistedSessionV3Schema = Schema.Struct({
    version: Schema.Literal(3),
    setup: PersistedGameSetupSchema,
    hands: Schema.Array(PersistedHandSchema),
    handSizes: Schema.Array(PersistedHandSizeSchema),
    suggestions: Schema.Array(PersistedSuggestionSchema),
});

/**
 * v3 → v4 migration as a Schema.decodeTo chain: a pure version-byte
 * bump, but modelled as Schema so the chain can compose. Callers
 * decode via `decodeV3Unknown` and get back the v4-shaped payload
 * without a separate hand-rolled migration.
 */
const V3ToV4Schema = PersistedSessionV3Schema.pipe(
    Schema.decodeTo(PersistedSessionV4Schema, {
        decode: SchemaGetter.transform(
            (v3: Schema.Schema.Type<typeof PersistedSessionV3Schema>) =>
                ({ ...v3, version: 4 as const }),
        ),
        encode: SchemaGetter.transform(
            (v4: Schema.Schema.Type<typeof PersistedSessionV4Schema>) =>
                ({ ...v4, version: 3 as const }),
        ),
    }),
);

/**
 * Result-returning decoder for v4 payloads. Hands back
 * `Result.Result<session, SchemaError>` — callers decide whether to
 * surface the error or fall back to a fresh session.
 */
export const decodeV4Unknown = Schema.decodeUnknownResult(
    PersistedSessionV4Schema,
);

/**
 * Result-returning decoder for v3 payloads. Output is v4-shaped (the
 * transform runs the version bump). Same error semantics as v4.
 */
export const decodeV3Unknown = Schema.decodeUnknownResult(V3ToV4Schema);

/**
 * v2 on-disk schema. v2 pre-dates the id/name split: each card and
 * category are identified by display name (a string, not an id+name
 * object). Hands / handSizes / suggestions already reference cards by
 * these name-strings, so migrating to v3 is mostly lifting the
 * category shape — hands and suggestions pass through unchanged.
 */
const PersistedCategoryV2Schema = Schema.Struct({
    name: Schema.String,
    cards: Schema.Array(Schema.String),
});

const PersistedGameSetupV2Schema = Schema.Struct({
    players: Schema.Array(Schema.String),
    categories: Schema.Array(PersistedCategoryV2Schema),
});

const PersistedHandV2Schema = Schema.Struct({
    player: Schema.String,
    cards: Schema.Array(Schema.String),
});

const PersistedHandSizeV2Schema = Schema.Struct({
    player: Schema.String,
    size: Schema.Number,
});

const PersistedSuggestionV2Schema = Schema.Struct({
    id: Schema.optional(Schema.String),
    suggester: Schema.String,
    cards: Schema.Array(Schema.String),
    nonRefuters: Schema.Array(Schema.String),
    refuter: Schema.NullOr(Schema.String),
    seenCard: Schema.NullOr(Schema.String),
});

const PersistedSessionV2Schema = Schema.Struct({
    version: Schema.Literal(2),
    setup: PersistedGameSetupV2Schema,
    hands: Schema.Array(PersistedHandV2Schema),
    handSizes: Schema.Array(PersistedHandSizeV2Schema),
    suggestions: Schema.Array(PersistedSuggestionV2Schema),
});

/**
 * v2 → v3 migration as Schema. Synthesises card / category ids from
 * their display names (same rule the hand-rolled migrateV2ToV3 used);
 * hands / handSizes / suggestions pass through because they already
 * reference those names as ids. Downstream, the v3 → v4 chain runs
 * the version bump and applies brands.
 *
 * Writes always go to v4, so encode throws — callers never hit it.
 */
const V2ToV3Schema = PersistedSessionV2Schema.pipe(
    Schema.decodeTo(PersistedSessionV3Schema, {
        decode: SchemaGetter.transform(
            (v2: Schema.Schema.Type<typeof PersistedSessionV2Schema>) => ({
                version: 3 as const,
                setup: {
                    players: v2.setup.players,
                    categories: v2.setup.categories.map(c => ({
                        id: c.name,
                        name: c.name,
                        cards: c.cards.map(card => ({
                            id: card,
                            name: card,
                        })),
                    })),
                },
                hands: v2.hands,
                handSizes: v2.handSizes,
                suggestions: v2.suggestions.map(s => ({
                    ...(s.id === undefined ? {} : { id: s.id }),
                    suggester: s.suggester,
                    cards: s.cards,
                    nonRefuters: s.nonRefuters,
                    refuter: s.refuter,
                    seenCard: s.seenCard,
                })),
            }),
        ),
        encode: SchemaGetter.transform(
            (_v3: (typeof PersistedSessionV3Schema)["Encoded"]):
                (typeof PersistedSessionV2Schema)["Type"] => {
                throw new Error("v2 encode not supported — writes go to v4");
            },
        ),
    }),
);

/**
 * Result-returning decoder for v2 payloads. Output is v3-shaped and
 * fully branded. Callers bump the version byte before handing it to
 * the v4-session builder.
 */
export const decodeV2Unknown = Schema.decodeUnknownResult(V2ToV3Schema);

/**
 * v1 on-disk schema. v1 predates the categories array entirely —
 * suspects / weapons / rooms were hardcoded top-level keys under
 * setup. Everything else matches v2.
 */
const PersistedGameSetupV1Schema = Schema.Struct({
    players: Schema.Array(Schema.String),
    suspects: Schema.Array(Schema.String),
    weapons: Schema.Array(Schema.String),
    rooms: Schema.Array(Schema.String),
});

const PersistedSessionV1Schema = Schema.Struct({
    version: Schema.Literal(1),
    setup: PersistedGameSetupV1Schema,
    hands: Schema.Array(PersistedHandV2Schema),
    handSizes: Schema.Array(PersistedHandSizeV2Schema),
    suggestions: Schema.Array(PersistedSuggestionV2Schema),
});

/**
 * v1 → v2 migration as Schema. Converts the three hardcoded category
 * arrays into the categories array, preserving order
 * (Suspects / Weapons / Rooms).
 */
const V1ToV2Schema = PersistedSessionV1Schema.pipe(
    Schema.decodeTo(PersistedSessionV2Schema, {
        decode: SchemaGetter.transform(
            (v1: Schema.Schema.Type<typeof PersistedSessionV1Schema>) => ({
                version: 2 as const,
                setup: {
                    players: v1.setup.players,
                    categories: [
                        { name: "Suspects", cards: v1.setup.suspects },
                        { name: "Weapons", cards: v1.setup.weapons },
                        { name: "Rooms", cards: v1.setup.rooms },
                    ],
                },
                hands: v1.hands,
                handSizes: v1.handSizes,
                suggestions: v1.suggestions,
            }),
        ),
        encode: SchemaGetter.transform(
            (_v2: (typeof PersistedSessionV2Schema)["Encoded"]):
                (typeof PersistedSessionV1Schema)["Type"] => {
                throw new Error("v1 encode not supported — writes go to v4");
            },
        ),
    }),
);

/**
 * Result-returning decoder for v1 payloads. Output is v2-shaped; the
 * caller runs it through the v2 -> v3 path next.
 */
export const decodeV1Unknown = Schema.decodeUnknownResult(V1ToV2Schema);

/**
 * Runtime type of a decoded v4 session — the branded, Schema-validated
 * payload both decodeV4Unknown and decodeV3Unknown hand back. Callers
 * construct the GameSession domain value from this.
 */
export type PersistedSessionV4 = Schema.Schema.Type<typeof PersistedSessionV4Schema>;
