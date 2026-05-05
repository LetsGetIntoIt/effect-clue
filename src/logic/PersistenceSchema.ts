import { Schema } from "effect";
import { AccusationId } from "./Accusation";
import { Card, CardCategory, Player } from "./GameObjects";
import { SuggestionId } from "./Suggestion";

/**
 * Effect Schema definitions for the persisted session shape.
 *
 * The current canonical version is v7 (adds `hypotheses`). Reads accept
 * v7 first, then fall back to v6 (auto-lifting with `hypotheses: []`)
 * so that users who roll back-and-forward between builds don't lose
 * suggestion / accusation state. Writes always go to v7.
 *
 * v6 added the `loggedAt: number` field to each suggestion + accusation,
 * recording the millisecond timestamp at which it was logged.
 *
 * v7 adds `hypotheses: Array<{ owner, card, value }>` — per-cell what-if
 * assumptions the user toggles on. See `src/logic/Hypothesis.ts`.
 *
 * Branded strings (Player, Card, CardCategory, SuggestionId,
 * AccusationId) are decoded straight into their nominal types via
 * `Schema.fromBrand`, so downstream code receives properly-branded
 * values without a second wrapping pass.
 */

const PlayerSchema = Schema.String.pipe(Schema.fromBrand("Player", Player));
const CardSchema = Schema.String.pipe(Schema.fromBrand("Card", Card));
const CardCategorySchema = Schema.String.pipe(
    Schema.fromBrand("CardCategory", CardCategory),
);
const SuggestionIdSchema = Schema.String.pipe(
    Schema.fromBrand("SuggestionId", SuggestionId),
);
const AccusationIdSchema = Schema.String.pipe(
    Schema.fromBrand("AccusationId", AccusationId),
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
    loggedAt: Schema.Number,
});

const PersistedAccusationSchema = Schema.Struct({
    id: Schema.optional(AccusationIdSchema),
    accuser: PlayerSchema,
    cards: Schema.Array(CardSchema),
    loggedAt: Schema.Number,
});

/**
 * Persisted owner: a single `player` field that's null when the cell
 * belongs to the case file. Flat encoding (vs a discriminated `kind`
 * tag) keeps the schema's `DecodingServices` channel clean — Schema's
 * `Union` widens services to `unknown`, which incompatibilises the
 * outer struct with `decodeUnknownResult`'s `Decoder<unknown>` constraint.
 */
const PersistedHypothesisSchema = Schema.Struct({
    player: Schema.NullOr(PlayerSchema),
    card: CardSchema,
    value: Schema.Literals(["Y", "N"]),
});

/**
 * Convenience array wrappers for the share codec — the shares wire
 * format ships these as top-level JSON arrays rather than wrapped
 * inside a versioned envelope.
 */
export const PlayersArraySchema = Schema.Array(PlayerSchema);
export const HandSizesArraySchema = Schema.Array(PersistedHandSizeSchema);
export const HandsArraySchema = Schema.Array(PersistedHandSchema);
export const SuggestionsArraySchema = Schema.Array(PersistedSuggestionSchema);
export const AccusationsArraySchema = Schema.Array(PersistedAccusationSchema);
export const HypothesesArraySchema = Schema.Array(PersistedHypothesisSchema);

/**
 * Wire shape for the card-pack half of a share. The `name` field is
 * informational — the sender embeds the user-facing label of the pack
 * when it can identify one (built-in name from CARD_SETS, or the
 * user's custom-pack label) so the receive modal can show "Card pack:
 * Master Detective" instead of "Card pack: (untitled)". Receivers
 * cross-reference `categories` against built-in packs to decide
 * whether to render "(custom)" — `name` alone is not authoritative.
 *
 * `CardSet` itself (`src/logic/CardSet.ts`) carries no identity, so
 * the sender encodes both halves explicitly.
 */
export const CardSetSchema = Schema.Struct({
    name: Schema.optional(Schema.String),
    categories: Schema.Array(PersistedCategorySchema),
});

/**
 * v6 session shape — kept for back-compat reads. v7 supersedes it.
 */
const PersistedSessionV6Schema = Schema.Struct({
    version: Schema.Literal(6),
    setup: PersistedGameSetupSchema,
    hands: Schema.Array(PersistedHandSchema),
    handSizes: Schema.Array(PersistedHandSizeSchema),
    suggestions: Schema.Array(PersistedSuggestionSchema),
    accusations: Schema.Array(PersistedAccusationSchema),
});

/**
 * Canonical v7 session shape. Adds `hypotheses` — per-cell what-if
 * assumptions. See `src/logic/Hypothesis.ts`.
 */
const PersistedSessionV7Schema = Schema.Struct({
    version: Schema.Literal(7),
    setup: PersistedGameSetupSchema,
    hands: Schema.Array(PersistedHandSchema),
    handSizes: Schema.Array(PersistedHandSizeSchema),
    suggestions: Schema.Array(PersistedSuggestionSchema),
    accusations: Schema.Array(PersistedAccusationSchema),
    hypotheses: HypothesesArraySchema,
});

/**
 * Result-returning decoders. Hand back `Result<session, SchemaError>` —
 * callers decide whether to surface the error or fall back to a fresh
 * session.
 */
export const decodeV6Unknown = Schema.decodeUnknownResult(
    PersistedSessionV6Schema,
);
export const decodeV7Unknown = Schema.decodeUnknownResult(
    PersistedSessionV7Schema,
);

/**
 * Runtime types of decoded sessions — the branded, Schema-validated
 * payload `decodeV{6,7}Unknown` hand back. Callers construct the
 * GameSession domain value from this.
 */
export type PersistedSessionV6 = Schema.Schema.Type<typeof PersistedSessionV6Schema>;
export type PersistedSessionV7 = Schema.Schema.Type<typeof PersistedSessionV7Schema>;

export type PersistedHypothesis = Schema.Schema.Type<typeof PersistedHypothesisSchema>;
