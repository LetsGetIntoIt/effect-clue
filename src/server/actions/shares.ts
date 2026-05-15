/**
 * Server actions for the M9 sharing flow.
 *
 *   - `createShare(payload)` — sender-controlled, *kind*-discriminated.
 *     The client picks one of three flow kinds — `pack` (just the
 *     deck), `invite` (deck + players + hand sizes, optionally with
 *     suggestions+accusations + firstDealtPlayerId), `transfer`
 *     (everything, for moving the game to another device — adds
 *     hypotheses + identity + dismissedInsights + hypothesisOrder).
 *     The server validates the input shape via Effect Schema and
 *     writes only the columns appropriate for the kind.
 *   - `getShare({ id })` — public read of the snapshot, plus a JOIN on
 *     `"user"` so the receive modal can render "Shared by {name}" for
 *     non-anonymous senders.
 *
 * Universal sign-in rule (M22 hardening): EVERY share requires an
 * authenticated, non-anonymous user. The previous "custom packs need
 * sign-in" conditional was both a security gap (the client controlled
 * the gate) and an unnecessary surface — the modal now handles all
 * three flows with one rule.
 *
 * Server-mints IDs: `cuid2.createId()` is collision-resistant
 * enough (~10^15 ids before a collision is expected) that we can
 * mint shares synchronously without uniqueness retries.
 */
"use server";

import { createId } from "@paralleldrive/cuid2";
import { Duration, Effect, Result, Schema } from "effect";
import { PgClient } from "@effect/sql-pg";
import { headers } from "next/headers";
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
    teachModeCodec,
} from "../../logic/ShareCodec";
import { SHARE_TTL } from "../shares/constants";
import { ERR_SHARE_NOT_FOUND } from "../shares/errors";
import { withServerAction } from "../withServerAction";

/**
 * Discriminated input by `kind`. Each variant carries only the wire
 * fields appropriate for that flow — the server enforces the shape
 * via `CreateShareInputSchema` so a malicious client can't, say,
 * smuggle `knownCardsData` through a `kind: "pack"` request.
 */
export type CreateShareInput =
    | {
          readonly kind: "pack";
          readonly cardPackData: string;
      }
    | {
          readonly kind: "invite";
          readonly cardPackData: string;
          readonly playersData: string;
          readonly handSizesData: string;
          /**
           * `Player | null` JSON-encoded. Always sent (even as `null`)
           * because this is publicly known game state — every player
           * at the table heard "X was dealt first". Required so the
           * receiver doesn't re-prompt for it.
           */
          readonly firstDealtPlayerIdData: string;
          // Suggestions + accusations are paired — the modal's optional
          // checkbox toggles both together. Server enforces the
          // pairing post-decode.
          readonly suggestionsData?: string;
          readonly accusationsData?: string;
      }
    | {
          readonly kind: "transfer";
          readonly cardPackData: string;
          readonly playersData: string;
          readonly handSizesData: string;
          readonly knownCardsData: string;
          readonly suggestionsData: string;
          readonly accusationsData: string;
          /**
           * Per-cell what-if assumptions. Carried only by the
           * `transfer` kind ("move my game to another device" —
           * same user); `pack` and `invite` shares deliberately omit
           * hypotheses since those flows go to other people.
           */
          readonly hypothesesData: string;
          /**
           * Sender's identity choice. `Player | null`. Restored on the
           * receive side so the M6 wizard doesn't re-prompt "Who are
           * you?" after a transfer.
           */
          readonly selfPlayerIdData: string;
          /** Same publicly-known fact as on `invite`. */
          readonly firstDealtPlayerIdData: string;
          /**
           * Behavioral-insight dismissals. Keys are deterministic
           * (`<DetectorKind>:<Player>:<Card>`) so the receiver's
           * regenerated insights line up with the shipped map without
           * any ID-resolution layer.
           */
          readonly dismissedInsightsData: string;
          /**
           * Most-recent-first ordering of the hypothesis panel
           * (mirrors `hypothesesData` keys; values live in that
           * array). Restored so the panel reads as the same
           * historical log on the receiving device.
           */
          readonly hypothesisOrderData: string;
          /**
           * Whether the sender's game was in teach-me mode. Boolean
           * JSON-encoded. The receiver's destination device inherits
           * the mode but always starts with empty `userDeductions`
           * (those are personal scratchwork; not on the wire).
           */
          readonly teachModeData: string;
      };

interface CreateShareResult {
    readonly id: string;
}

interface ShareSnapshot {
    readonly id: string;
    readonly cardPackData: string | null;
    readonly playersData: string | null;
    readonly handSizesData: string | null;
    readonly knownCardsData: string | null;
    readonly suggestionsData: string | null;
    readonly accusationsData: string | null;
    readonly hypothesesData: string | null;
    readonly selfPlayerIdData: string | null;
    readonly firstDealtPlayerIdData: string | null;
    readonly dismissedInsightsData: string | null;
    readonly hypothesisOrderData: string | null;
    readonly teachModeData: string | null;
    /**
     * Display name of the share's owner — populated via `LEFT JOIN
     * "user"` in `getShare`. `null` when:
     *   - The share has no owner_id (only possible for legacy rows
     *     pre-dating the universal sign-in rule + the 0006 migration
     *     adding `NOT NULL` — neither is reachable from new shares).
     *   - The owner is anonymous (anonymous-plugin sessions).
     */
    readonly ownerName: string | null;
    readonly ownerIsAnonymous: boolean | null;
}

const ERR_SIGN_IN_REQUIRED = "sign_in_required_to_share";
const ERR_MALFORMED_INPUT = "share_malformed_input";

// Wire-format field names. Module-scope so they don't trip the
// i18next/no-literal-string lint, and so the validation /
// projection logic below has one place to reference each name.
const KIND_FIELD = "kind";
const KIND_PACK = "pack";
const KIND_INVITE = "invite";
const KIND_TRANSFER = "transfer";
const F_CARD_PACK_DATA = "cardPackData";
const F_PLAYERS_DATA = "playersData";
const F_HAND_SIZES_DATA = "handSizesData";
const F_KNOWN_CARDS_DATA = "knownCardsData";
const F_SUGGESTIONS_DATA = "suggestionsData";
const F_ACCUSATIONS_DATA = "accusationsData";
const F_HYPOTHESES_DATA = "hypothesesData";
const F_SELF_PLAYER_ID_DATA = "selfPlayerIdData";
const F_FIRST_DEALT_PLAYER_ID_DATA = "firstDealtPlayerIdData";
const F_DISMISSED_INSIGHTS_DATA = "dismissedInsightsData";
const F_HYPOTHESIS_ORDER_DATA = "hypothesisOrderData";
const F_TEACH_MODE_DATA = "teachModeData";

const SUFFIX_UNEXPECTED_FIELD = "unexpected_field";
const SUFFIX_SUGGESTIONS_PAIR = "suggestions_pair";

// Each codec validates a JSON-string payload. We use them to round-
// trip-validate the wire fields server-side before insert; if any
// field doesn't decode, we throw `ERR_MALFORMED_INPUT` rather than
// persisting an unparseable blob the receiver couldn't render.
const validateJsonField = (
    label: string,
    value: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    codec: Schema.Codec<any, string>,
): void => {
    const decoded = Schema.decodeUnknownResult(codec)(value);
    if (Result.isFailure(decoded)) {
        // Surface which field failed — helps debugging without leaking
        // the raw payload.
        throw new Error(`${ERR_MALFORMED_INPUT}:${label}`);
    }
};

const ALLOWED_KEYS_FOR: Record<string, ReadonlySet<string>> = {
    [KIND_PACK]: new Set([KIND_FIELD, F_CARD_PACK_DATA]),
    [KIND_INVITE]: new Set([
        KIND_FIELD,
        F_CARD_PACK_DATA,
        F_PLAYERS_DATA,
        F_HAND_SIZES_DATA,
        F_SUGGESTIONS_DATA,
        F_ACCUSATIONS_DATA,
        F_FIRST_DEALT_PLAYER_ID_DATA,
    ]),
    [KIND_TRANSFER]: new Set([
        KIND_FIELD,
        F_CARD_PACK_DATA,
        F_PLAYERS_DATA,
        F_HAND_SIZES_DATA,
        F_KNOWN_CARDS_DATA,
        F_SUGGESTIONS_DATA,
        F_ACCUSATIONS_DATA,
        F_HYPOTHESES_DATA,
        F_SELF_PLAYER_ID_DATA,
        F_FIRST_DEALT_PLAYER_ID_DATA,
        F_DISMISSED_INSIGHTS_DATA,
        F_HYPOTHESIS_ORDER_DATA,
        F_TEACH_MODE_DATA,
    ]),
};

const validateInputShape = (input: unknown): CreateShareInput => {
    if (typeof input !== "object" || input === null) {
        throw new Error(ERR_MALFORMED_INPUT);
    }
    const kind = (input as Record<string, unknown>)[KIND_FIELD];
    if (kind !== KIND_PACK && kind !== KIND_INVITE && kind !== KIND_TRANSFER) {
        throw new Error(ERR_MALFORMED_INPUT);
    }
    const obj = input as Record<string, unknown>;

    // Whitelist the fields each kind is allowed to carry. Anything
    // extra or anything missing throws.
    const requireString = (key: string): string => {
        const v = obj[key];
        if (typeof v !== "string") {
            throw new Error(`${ERR_MALFORMED_INPUT}:${key}`);
        }
        return v;
    };
    const optionalString = (key: string): string | undefined => {
        const v = obj[key];
        if (v === undefined) return undefined;
        if (typeof v !== "string") {
            throw new Error(`${ERR_MALFORMED_INPUT}:${key}`);
        }
        return v;
    };

    for (const key of Object.keys(obj)) {
        if (!ALLOWED_KEYS_FOR[kind]!.has(key)) {
            throw new Error(
                `${ERR_MALFORMED_INPUT}:${SUFFIX_UNEXPECTED_FIELD}:${key}`,
            );
        }
    }

    if (kind === KIND_PACK) {
        const cardPackData = requireString(F_CARD_PACK_DATA);
        validateJsonField(F_CARD_PACK_DATA, cardPackData, cardPackCodec);
        return { kind, cardPackData };
    }
    if (kind === KIND_INVITE) {
        const cardPackData = requireString(F_CARD_PACK_DATA);
        const playersData = requireString(F_PLAYERS_DATA);
        const handSizesData = requireString(F_HAND_SIZES_DATA);
        const firstDealtPlayerIdData = requireString(
            F_FIRST_DEALT_PLAYER_ID_DATA,
        );
        const suggestionsData = optionalString(F_SUGGESTIONS_DATA);
        const accusationsData = optionalString(F_ACCUSATIONS_DATA);
        // Pairing constraint — both or neither.
        if ((suggestionsData == null) !== (accusationsData == null)) {
            throw new Error(
                `${ERR_MALFORMED_INPUT}:${SUFFIX_SUGGESTIONS_PAIR}`,
            );
        }
        validateJsonField(F_CARD_PACK_DATA, cardPackData, cardPackCodec);
        validateJsonField(F_PLAYERS_DATA, playersData, playersCodec);
        validateJsonField(F_HAND_SIZES_DATA, handSizesData, handSizesCodec);
        validateJsonField(
            F_FIRST_DEALT_PLAYER_ID_DATA,
            firstDealtPlayerIdData,
            firstDealtPlayerIdCodec,
        );
        if (suggestionsData !== undefined) {
            validateJsonField(
                F_SUGGESTIONS_DATA,
                suggestionsData,
                suggestionsCodec,
            );
        }
        if (accusationsData !== undefined) {
            validateJsonField(
                F_ACCUSATIONS_DATA,
                accusationsData,
                accusationsCodec,
            );
        }
        return {
            kind,
            cardPackData,
            playersData,
            handSizesData,
            firstDealtPlayerIdData,
            ...(suggestionsData !== undefined ? { suggestionsData } : {}),
            ...(accusationsData !== undefined ? { accusationsData } : {}),
        };
    }
    // kind === KIND_TRANSFER
    const cardPackData = requireString(F_CARD_PACK_DATA);
    const playersData = requireString(F_PLAYERS_DATA);
    const handSizesData = requireString(F_HAND_SIZES_DATA);
    const knownCardsData = requireString(F_KNOWN_CARDS_DATA);
    const suggestionsData = requireString(F_SUGGESTIONS_DATA);
    const accusationsData = requireString(F_ACCUSATIONS_DATA);
    const hypothesesData = requireString(F_HYPOTHESES_DATA);
    const selfPlayerIdData = requireString(F_SELF_PLAYER_ID_DATA);
    const firstDealtPlayerIdData = requireString(
        F_FIRST_DEALT_PLAYER_ID_DATA,
    );
    const dismissedInsightsData = requireString(F_DISMISSED_INSIGHTS_DATA);
    const hypothesisOrderData = requireString(F_HYPOTHESIS_ORDER_DATA);
    const teachModeData = requireString(F_TEACH_MODE_DATA);
    validateJsonField(F_CARD_PACK_DATA, cardPackData, cardPackCodec);
    validateJsonField(F_PLAYERS_DATA, playersData, playersCodec);
    validateJsonField(F_HAND_SIZES_DATA, handSizesData, handSizesCodec);
    validateJsonField(F_KNOWN_CARDS_DATA, knownCardsData, knownCardsCodec);
    validateJsonField(F_SUGGESTIONS_DATA, suggestionsData, suggestionsCodec);
    validateJsonField(F_ACCUSATIONS_DATA, accusationsData, accusationsCodec);
    validateJsonField(F_HYPOTHESES_DATA, hypothesesData, hypothesesCodec);
    validateJsonField(
        F_SELF_PLAYER_ID_DATA,
        selfPlayerIdData,
        selfPlayerIdCodec,
    );
    validateJsonField(
        F_FIRST_DEALT_PLAYER_ID_DATA,
        firstDealtPlayerIdData,
        firstDealtPlayerIdCodec,
    );
    validateJsonField(
        F_DISMISSED_INSIGHTS_DATA,
        dismissedInsightsData,
        dismissedInsightsCodec,
    );
    validateJsonField(
        F_HYPOTHESIS_ORDER_DATA,
        hypothesisOrderData,
        hypothesisOrderCodec,
    );
    validateJsonField(F_TEACH_MODE_DATA, teachModeData, teachModeCodec);
    return {
        kind,
        cardPackData,
        playersData,
        handSizesData,
        knownCardsData,
        suggestionsData,
        accusationsData,
        hypothesesData,
        selfPlayerIdData,
        firstDealtPlayerIdData,
        dismissedInsightsData,
        hypothesisOrderData,
        teachModeData,
    };
};

/**
 * Returns the user id only for real (non-anonymous) sessions —
 * anonymous-plugin sessions resolve to `null` because we want the
 * share to be tied to a durable account the receiver could later
 * navigate to / contact, not to a throwaway local identity.
 */
const realUserId = async (): Promise<string | null> => {
    const { auth } = await import("../auth");
    const session = await auth.api.getSession({
        headers: await headers(),
    });
    if (!session) return null;
    if (session.user.isAnonymous) return null;
    return session.user.id;
};

export async function createShare(
    input: CreateShareInput,
): Promise<CreateShareResult> {
    // Universal rule: every share requires sign-in. No conditionals.
    const ownerId = await realUserId();
    if (ownerId === null) {
        throw new Error(ERR_SIGN_IN_REQUIRED);
    }
    // Validate + narrow: throws ERR_MALFORMED_INPUT on shape errors,
    // unexpected fields, or any wire-field that doesn't round-trip
    // through its codec.
    const validated = validateInputShape(input);
    const id = createId();
    // Pass the TTL as a number of hours and let Postgres compute
    // `NOW() + INTERVAL ... HOUR` so we don't have to pre-format a
    // TIMESTAMPTZ on the client. `Duration.toHours` returns a
    // floating-point number; floor it before binding so the
    // INTERVAL receives a clean integer.
    const ttlHours = Math.floor(Duration.toHours(SHARE_TTL));

    // Project the validated input into the DB columns. Fields the
    // kind doesn't carry get NULL — the column nullability pattern is
    // the receive-side discriminator (no `kind` column in the table).
    const cardPackData =
        validated.kind === "pack" ||
        validated.kind === "invite" ||
        validated.kind === "transfer"
            ? validated.cardPackData
            : null;
    const playersData =
        validated.kind === "invite" || validated.kind === "transfer"
            ? validated.playersData
            : null;
    const handSizesData =
        validated.kind === "invite" || validated.kind === "transfer"
            ? validated.handSizesData
            : null;
    const knownCardsData =
        validated.kind === "transfer" ? validated.knownCardsData : null;
    const suggestionsData =
        validated.kind === "transfer"
            ? validated.suggestionsData
            : validated.kind === "invite"
                ? (validated.suggestionsData ?? null)
                : null;
    const accusationsData =
        validated.kind === "transfer"
            ? validated.accusationsData
            : validated.kind === "invite"
                ? (validated.accusationsData ?? null)
                : null;
    // Hypotheses ride along with `transfer` shares only ("move my game
    // to another device" — same user). Pack and invite shares always
    // store NULL since those flows go to other people.
    const hypothesesData =
        validated.kind === "transfer" ? validated.hypothesesData : null;
    // Identity choice is `transfer` only — invite recipients pick
    // their own.
    const selfPlayerIdData =
        validated.kind === "transfer" ? validated.selfPlayerIdData : null;
    // `firstDealtPlayerId` is publicly known game state — every player
    // at the physical table heard it called out. Rides both `invite`
    // and `transfer`.
    const firstDealtPlayerIdData =
        validated.kind === "transfer" || validated.kind === "invite"
            ? validated.firstDealtPlayerIdData
            : null;
    // Behavioral-insight dismissals and hypothesis ordering are
    // personal scratchwork — `transfer` only.
    const dismissedInsightsData =
        validated.kind === "transfer"
            ? validated.dismissedInsightsData
            : null;
    const hypothesisOrderData =
        validated.kind === "transfer" ? validated.hypothesisOrderData : null;
    // Teach-mode preference is `transfer` only — the user wants their
    // destination device to inherit the mode. Invite shares omit it
    // (the receiver's import modal offers an optional opt-in checkbox).
    const teachModeData =
        validated.kind === "transfer" ? validated.teachModeData : null;

    return withServerAction(
        Effect.gen(function* () {
            const sql = yield* PgClient.PgClient;
            yield* sql`
                INSERT INTO shares (
                    id, owner_id,
                    snapshot_card_pack_data,
                    snapshot_players_data,
                    snapshot_hand_sizes_data,
                    snapshot_known_cards_data,
                    snapshot_suggestions_data,
                    snapshot_accusations_data,
                    snapshot_hypotheses_data,
                    snapshot_self_player_id_data,
                    snapshot_first_dealt_player_id_data,
                    snapshot_dismissed_insights_data,
                    snapshot_hypothesis_order_data,
                    snapshot_teach_mode_data,
                    expires_at
                ) VALUES (
                    ${id}, ${ownerId},
                    ${cardPackData},
                    ${playersData},
                    ${handSizesData},
                    ${knownCardsData},
                    ${suggestionsData},
                    ${accusationsData},
                    ${hypothesesData},
                    ${selfPlayerIdData},
                    ${firstDealtPlayerIdData},
                    ${dismissedInsightsData},
                    ${hypothesisOrderData},
                    ${teachModeData},
                    NOW() + (${ttlHours} || ' hours')::INTERVAL
                )
            `;
            return { id };
        }),
    );
}

export async function getShare(input: {
    readonly id: string;
}): Promise<ShareSnapshot> {
    return withServerAction(
        Effect.gen(function* () {
            const sql = yield* PgClient.PgClient;
            const rows = yield* sql<{
                id: string;
                snapshot_card_pack_data: string | null;
                snapshot_players_data: string | null;
                snapshot_hand_sizes_data: string | null;
                snapshot_known_cards_data: string | null;
                snapshot_suggestions_data: string | null;
                snapshot_accusations_data: string | null;
                snapshot_hypotheses_data: string | null;
                snapshot_self_player_id_data: string | null;
                snapshot_first_dealt_player_id_data: string | null;
                snapshot_dismissed_insights_data: string | null;
                snapshot_hypothesis_order_data: string | null;
                snapshot_teach_mode_data: string | null;
                owner_id: string | null;
                owner_name: string | null;
                owner_is_anonymous: boolean | null;
            }>`
                SELECT s.id,
                       s.snapshot_card_pack_data,
                       s.snapshot_players_data,
                       s.snapshot_hand_sizes_data,
                       s.snapshot_known_cards_data,
                       s.snapshot_suggestions_data,
                       s.snapshot_accusations_data,
                       s.snapshot_hypotheses_data,
                       s.snapshot_self_player_id_data,
                       s.snapshot_first_dealt_player_id_data,
                       s.snapshot_dismissed_insights_data,
                       s.snapshot_hypothesis_order_data,
                       s.snapshot_teach_mode_data,
                       s.owner_id,
                       u.name AS owner_name,
                       u.is_anonymous AS owner_is_anonymous
                FROM shares s
                LEFT JOIN "user" u ON u.id = s.owner_id
                WHERE s.id = ${input.id}
                  AND (s.expires_at IS NULL OR s.expires_at > NOW())
                LIMIT 1
            `;
            const row = rows[0];
            if (!row) {
                throw new Error(ERR_SHARE_NOT_FOUND);
            }
            // Sender-display rule: only surface the name for non-
            // anonymous owners. Anonymous-plugin owners (or owner-less
            // legacy rows) collapse to `ownerName: null`, which the
            // receive modal renders as "no Shared by line".
            const ownerIsAnonymous =
                row.owner_id === null ? null : row.owner_is_anonymous ?? false;
            const ownerName =
                row.owner_id === null
                    ? null
                    : ownerIsAnonymous === true
                        ? null
                        : row.owner_name;
            return {
                id: row.id,
                cardPackData: row.snapshot_card_pack_data,
                playersData: row.snapshot_players_data,
                handSizesData: row.snapshot_hand_sizes_data,
                knownCardsData: row.snapshot_known_cards_data,
                suggestionsData: row.snapshot_suggestions_data,
                accusationsData: row.snapshot_accusations_data,
                hypothesesData: row.snapshot_hypotheses_data,
                selfPlayerIdData: row.snapshot_self_player_id_data,
                firstDealtPlayerIdData:
                    row.snapshot_first_dealt_player_id_data,
                dismissedInsightsData: row.snapshot_dismissed_insights_data,
                hypothesisOrderData: row.snapshot_hypothesis_order_data,
                teachModeData: row.snapshot_teach_mode_data,
                ownerName,
                ownerIsAnonymous,
            };
        }),
    );
}
