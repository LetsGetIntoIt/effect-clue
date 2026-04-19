import { Schema } from "effect";
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
