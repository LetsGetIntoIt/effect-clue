import { Schema } from "effect";
import { AccusationId } from "./Accusation";
import { Card, CardCategory, Player } from "./GameObjects";
import { SuggestionId } from "./Suggestion";

/**
 * Effect Schema definitions for the persisted session shape.
 *
 * The current canonical version is v10 (adds `dismissedInsights`).
 * Reads accept v10 first, then fall back to v9 (auto-lifting with
 * `dismissedInsights: []`), then v8 (auto-lifting with `selfPlayerId:
 * null` and `firstDealtPlayerId: null`), then v7 (auto-lifting with
 * `pendingSuggestion: null`), then v6 (auto-lifting with `hypotheses:
 * []` and the v7+v8+v9+v10 defaults), so users who roll back-and-forward
 * between builds don't lose suggestion / accusation state. Writes always
 * go to v10.
 *
 * v6 added the `loggedAt: number` field to each suggestion + accusation,
 * recording the millisecond timestamp at which it was logged.
 *
 * v7 adds `hypotheses: Array<{ owner, card, value }>` — per-cell what-if
 * assumptions the user toggles on. See `src/logic/Hypothesis.ts`.
 *
 * v8 adds `pendingSuggestion`: the user's in-flight new-suggestion
 * draft, persisted so it survives mobile tab swaps (which unmount the
 * suggestion form) and full-page reloads. See
 * `src/logic/ClueState.ts`'s `PendingSuggestionDraft`.
 *
 * v9 adds `selfPlayerId` + `firstDealtPlayerId` — identity-related
 * fields driven by the M6 setup wizard. The local round-trip
 * preserves them; the share wire format does not (receivers pick
 * their own identity post-import).
 *
 * v10 adds `dismissedInsights: Array<{ key, atConfidence }>` — the
 * per-game dismissal records that drive the "suppress until evidence
 * grows" filter for behavioral insights. Local round-trip only; the
 * share wire format does not include them (personal scratchwork, same
 * policy as hypotheses).
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
 * Persisted shape of `PendingSuggestionDraft`. Each optional slot has
 * three runtime states: `null` ("not decided"), `Nobody` (explicit
 * "no one"), or a concrete Player/Card. They round-trip through a
 * pair of flat fields per slot — `*Decided` and `*IsNobody` — alongside
 * the value field, mirroring the flat encoding pattern that
 * `PersistedHypothesisSchema` uses to keep the decoder's
 * `DecodingServices` channel clean.
 *
 *   decided=false                 -> null ("not decided")
 *   decided=true, isNobody=true   -> Nobody
 *   decided=true, isNobody=false  -> the Player/Card/array value
 *
 * This avoids `Schema.Union`, whose AST widens the surrounding struct's
 * services to `unknown` and breaks the v8 decoder's `Decoder<unknown>`
 * constraint.
 */
const PersistedPendingSuggestionSchema = Schema.Struct({
    id: Schema.String,
    suggester: Schema.NullOr(PlayerSchema),
    cards: Schema.Array(Schema.NullOr(CardSchema)),
    nonRefutersDecided: Schema.Boolean,
    nonRefutersIsNobody: Schema.Boolean,
    nonRefuters: Schema.Array(PlayerSchema),
    refuterDecided: Schema.Boolean,
    refuterIsNobody: Schema.Boolean,
    refuter: Schema.NullOr(PlayerSchema),
    seenCardDecided: Schema.Boolean,
    seenCardIsNobody: Schema.Boolean,
    seenCard: Schema.NullOr(CardSchema),
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
 * v7 session shape — kept for back-compat reads. v8 supersedes it.
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
 * v8 session shape — kept for back-compat reads. v9 supersedes it.
 */
const PersistedSessionV8Schema = Schema.Struct({
    version: Schema.Literal(8),
    setup: PersistedGameSetupSchema,
    hands: Schema.Array(PersistedHandSchema),
    handSizes: Schema.Array(PersistedHandSizeSchema),
    suggestions: Schema.Array(PersistedSuggestionSchema),
    accusations: Schema.Array(PersistedAccusationSchema),
    hypotheses: HypothesesArraySchema,
    pendingSuggestion: Schema.NullOr(PersistedPendingSuggestionSchema),
});

/**
 * Persisted shape of a single dismissed-insight record. Keyed by the
 * stable `Insight.dismissedKey` and the confidence the insight had at
 * dismissal time. Flat encoding — same rationale as the hypothesis
 * schema (avoids `Schema.Union` and keeps the decoder's services
 * channel typed).
 */
const PersistedDismissedInsightSchema = Schema.Struct({
    key: Schema.String,
    atConfidence: Schema.Literals(["low", "med", "high"]),
});

const DismissedInsightsArraySchema = Schema.Array(
    PersistedDismissedInsightSchema,
);

/**
 * v9 session shape — kept for back-compat reads. v10 supersedes it.
 * Selfsame as v8 plus `selfPlayerId` + `firstDealtPlayerId` — the
 * identity-related fields driven by the M6 setup wizard.
 */
const PersistedSessionV9Schema = Schema.Struct({
    version: Schema.Literal(9),
    setup: PersistedGameSetupSchema,
    hands: Schema.Array(PersistedHandSchema),
    handSizes: Schema.Array(PersistedHandSizeSchema),
    suggestions: Schema.Array(PersistedSuggestionSchema),
    accusations: Schema.Array(PersistedAccusationSchema),
    hypotheses: HypothesesArraySchema,
    pendingSuggestion: Schema.NullOr(PersistedPendingSuggestionSchema),
    selfPlayerId: Schema.NullOr(PlayerSchema),
    firstDealtPlayerId: Schema.NullOr(PlayerSchema),
});

/**
 * Canonical v10 session shape. Adds `dismissedInsights` — per-game
 * dismissal records for behavioral insights (see
 * `src/logic/BehavioralInsights.ts`). Local round-trip only; the share
 * wire format intentionally omits them (personal scratchwork, same
 * policy as hypotheses). The share codec stays unchanged.
 *
 * Identity fields (`selfPlayerId`, `firstDealtPlayerId`) carry over
 * from v9 verbatim — local-storage preserves them, share wire format
 * does not.
 */
const PersistedSessionV10Schema = Schema.Struct({
    version: Schema.Literal(10),
    setup: PersistedGameSetupSchema,
    hands: Schema.Array(PersistedHandSchema),
    handSizes: Schema.Array(PersistedHandSizeSchema),
    suggestions: Schema.Array(PersistedSuggestionSchema),
    accusations: Schema.Array(PersistedAccusationSchema),
    hypotheses: HypothesesArraySchema,
    pendingSuggestion: Schema.NullOr(PersistedPendingSuggestionSchema),
    selfPlayerId: Schema.NullOr(PlayerSchema),
    firstDealtPlayerId: Schema.NullOr(PlayerSchema),
    dismissedInsights: DismissedInsightsArraySchema,
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
export const decodeV8Unknown = Schema.decodeUnknownResult(
    PersistedSessionV8Schema,
);
export const decodeV9Unknown = Schema.decodeUnknownResult(
    PersistedSessionV9Schema,
);
export const decodeV10Unknown = Schema.decodeUnknownResult(
    PersistedSessionV10Schema,
);

/**
 * Runtime types of decoded sessions — the branded, Schema-validated
 * payload `decodeV{6,7,8,9,10}Unknown` hand back. Callers construct
 * the GameSession domain value from this.
 */
export type PersistedSessionV6 = Schema.Schema.Type<typeof PersistedSessionV6Schema>;
export type PersistedSessionV7 = Schema.Schema.Type<typeof PersistedSessionV7Schema>;
export type PersistedSessionV8 = Schema.Schema.Type<typeof PersistedSessionV8Schema>;
export type PersistedSessionV9 = Schema.Schema.Type<typeof PersistedSessionV9Schema>;
export type PersistedSessionV10 = Schema.Schema.Type<typeof PersistedSessionV10Schema>;
export type PersistedDismissedInsight = Schema.Schema.Type<
    typeof PersistedDismissedInsightSchema
>;

export type PersistedHypothesis = Schema.Schema.Type<typeof PersistedHypothesisSchema>;
export type PersistedPendingSuggestion = Schema.Schema.Type<
    typeof PersistedPendingSuggestionSchema
>;
