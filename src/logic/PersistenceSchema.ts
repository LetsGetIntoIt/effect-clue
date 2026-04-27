import { Schema } from "effect";
import { Card, CardCategory, Player } from "./GameObjects";
import { SuggestionId } from "./Suggestion";

/**
 * Effect Schema definitions for the persisted session shape (v4).
 *
 * The app is pre-production, so there's a single on-disk format —
 * writes go to v4, reads only accept v4. If an older / malformed blob
 * shows up, decode returns `Result.Failure` and the caller falls back
 * to a fresh session. No migration chain, no legacy schemas.
 *
 * Branded strings (Player, Card, CardCategory, SuggestionId) are
 * decoded straight into their nominal types via `Schema.fromBrand`,
 * so downstream code receives properly-branded values without a
 * second wrapping pass.
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
 * Canonical v4 session shape. The only version the decoder accepts.
 */
const PersistedSessionV4Schema = Schema.Struct({
    version: Schema.Literal(4),
    setup: PersistedGameSetupSchema,
    hands: Schema.Array(PersistedHandSchema),
    handSizes: Schema.Array(PersistedHandSizeSchema),
    suggestions: Schema.Array(PersistedSuggestionSchema),
});

/**
 * Result-returning decoder. Hands back `Result<session, SchemaError>` —
 * callers decide whether to surface the error or fall back to a fresh
 * session.
 */
export const decodeV4Unknown = Schema.decodeUnknownResult(
    PersistedSessionV4Schema,
);

/**
 * Runtime type of a decoded v4 session — the branded, Schema-validated
 * payload `decodeV4Unknown` hands back. Callers construct the
 * GameSession domain value from this.
 */
export type PersistedSessionV4 = Schema.Schema.Type<typeof PersistedSessionV4Schema>;
