/**
 * Effect-Schema codecs for the eleven wire fields that flow through
 * the M9 share path.
 *
 * The shares feature serialises sub-slices of a `GameSession` to
 * JSON-strings on the wire (one column per slice in the `shares`
 * table). Every encode and decode goes through the codecs below so:
 *
 *   - The sender can't ship a payload the receiver wouldn't accept
 *     (`encodeSync` validates on the way out).
 *   - The receiver and the server can both `decodeUnknown*` with
 *     branded-type round-tripping (Player / Card / etc.) preserved.
 *   - The wire format is one declarative source of truth — adding a
 *     new sub-slice means adding a codec here, not patching three
 *     ad-hoc `JSON.stringify`/`JSON.parse` sites.
 *
 * `Schema.fromJsonString(Inner)` is the Effect-4 combinator that
 * packages "JSON-string ↔ schema-validated object" into a single
 * Codec — `Type` is the domain shape, `Encoded` is `string`.
 *
 * Per-kind usage (see `docs/shares-and-sync.md` for the full table):
 *
 *   - `pack`:     cardPackCodec
 *   - `invite`:   cardPackCodec, playersCodec, handSizesCodec,
 *                 suggestionsCodec, accusationsCodec,
 *                 firstDealtPlayerIdCodec
 *   - `transfer`: all of the above plus knownCardsCodec, hypothesesCodec,
 *                 selfPlayerIdCodec, dismissedInsightsCodec,
 *                 hypothesisOrderCodec, teachModeCodec
 *
 * `teachModeCodec` carries the per-game teach-me preference; the
 * receiver inherits the mode but always starts with empty
 * `userDeductions` (personal scratchwork; deliberately not on the wire).
 */
import { Schema } from "effect";
import {
    AccusationsArraySchema,
    CardSetSchema,
    DismissedInsightsArraySchema,
    FirstDealtPlayerIdSchema,
    HandSizesArraySchema,
    HandsArraySchema,
    HypothesesArraySchema,
    HypothesisOrderArraySchema,
    PlayersArraySchema,
    SelfPlayerIdSchema,
    SuggestionsArraySchema,
} from "./PersistenceSchema";

/**
 * Teach-mode wire schema — a single boolean. `transfer` shares carry
 * this so the receiver's destination device inherits the sender's
 * mode preference. Invite shares omit it (the receiver's import
 * modal offers an opt-in checkbox instead).
 */
const TeachModeSchema = Schema.Boolean;

export const cardPackCodec = Schema.fromJsonString(CardSetSchema);
export const playersCodec = Schema.fromJsonString(PlayersArraySchema);
export const handSizesCodec = Schema.fromJsonString(HandSizesArraySchema);
export const knownCardsCodec = Schema.fromJsonString(HandsArraySchema);
export const suggestionsCodec = Schema.fromJsonString(SuggestionsArraySchema);
export const accusationsCodec = Schema.fromJsonString(AccusationsArraySchema);

/**
 * Hypotheses codec — only used by the `transfer` share kind ("move my
 * game to another device"). `pack` and `invite` shares deliberately
 * omit hypotheses since those flows go to other people; hypotheses are
 * personal scratchwork. See `docs/shares-and-sync.md` for the
 * kind-discriminated wire-format rule.
 */
export const hypothesesCodec = Schema.fromJsonString(HypothesesArraySchema);

/**
 * Identity + scratchwork codecs (added when share-kind coverage was
 * re-evaluated against ClueState — see `docs/shares-and-sync.md`).
 *
 * - `firstDealtPlayerIdCodec` rides `invite` AND `transfer` — who was
 *   dealt the first card is publicly known game state, every player
 *   at the table heard it called out.
 * - `selfPlayerIdCodec`, `dismissedInsightsCodec`, and
 *   `hypothesisOrderCodec` are `transfer`-only. They encode the
 *   sender's identity choice and personal scratchwork; invite shares
 *   go to a *different* player who picks their own identity and
 *   starts with empty scratchwork.
 */
export const selfPlayerIdCodec = Schema.fromJsonString(SelfPlayerIdSchema);
export const firstDealtPlayerIdCodec = Schema.fromJsonString(
    FirstDealtPlayerIdSchema,
);
export const dismissedInsightsCodec = Schema.fromJsonString(
    DismissedInsightsArraySchema,
);
export const hypothesisOrderCodec = Schema.fromJsonString(
    HypothesisOrderArraySchema,
);

/**
 * Teach-mode codec — `transfer`-only. Boolean indicating whether the
 * sender's game was in teach-me mode. Receivers inherit the mode but
 * always start with empty `userDeductions`.
 */
export const teachModeCodec = Schema.fromJsonString(TeachModeSchema);
