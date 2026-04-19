import { Schema } from "effect";

/**
 * Effect v4 Schema definitions for the persisted session shape. v4
 * piggy-backs on v3's on-disk layout — same field names, same nesting
 * — but runs decoded payloads through `Schema.decodeUnknown*` so
 * malformed data produces a structured `SchemaError` instead of
 * silent `undefined`.
 *
 * Legacy v1/v2/v3 blobs still go through the hand-rolled migration
 * chain in `Persistence.ts`; once they upgrade to v3 shape, the same
 * schema here validates them on decode. New writes go out as v4.
 */

const PersistedCardEntrySchema = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
});

const PersistedCategorySchema = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    cards: Schema.Array(PersistedCardEntrySchema),
});

const PersistedGameSetupSchema = Schema.Struct({
    players: Schema.Array(Schema.String),
    categories: Schema.Array(PersistedCategorySchema),
});

const PersistedHandSchema = Schema.Struct({
    player: Schema.String,
    cards: Schema.Array(Schema.String),
});

const PersistedHandSizeSchema = Schema.Struct({
    player: Schema.String,
    size: Schema.Number,
});

const PersistedSuggestionSchema = Schema.Struct({
    id: Schema.optional(Schema.String),
    suggester: Schema.String,
    cards: Schema.Array(Schema.String),
    nonRefuters: Schema.Array(Schema.String),
    refuter: Schema.NullOr(Schema.String),
    seenCard: Schema.NullOr(Schema.String),
});

/**
 * Canonical v4 session shape. Identical payload to v3 — we bump the
 * version byte so decoders can tell which path to run, not because
 * the bytes on disk changed.
 */
const PersistedSessionV4Schema = Schema.Struct({
    version: Schema.Literal(4),
    setup: PersistedGameSetupSchema,
    hands: Schema.Array(PersistedHandSchema),
    handSizes: Schema.Array(PersistedHandSizeSchema),
    suggestions: Schema.Array(PersistedSuggestionSchema),
});

/**
 * Result-returning decoder for v4 payloads. Hands back
 * `Result.Result<session, SchemaError>` — callers decide whether to
 * surface the error or fall back to a fresh session.
 */
export const decodeV4Unknown = Schema.decodeUnknownResult(
    PersistedSessionV4Schema,
);
