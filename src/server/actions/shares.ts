/**
 * Server actions for the M9 sharing flow.
 *
 *   - `createShare(payload)` — sender-controlled subset. Accepts a
 *     bag of optional snapshot sections (card pack, players + hand
 *     sizes, known cards, suggestions + accusations); each
 *     toggled-on section is JSON-serialised and written to its
 *     column. Returns the server-minted id (cuid2) so the sender
 *     can build the share URL.
 *   - `getShare({ id })` — public. Reads every snapshot column;
 *     consumers parse the JSON-encoded fields back into domain
 *     shapes on the client.
 *   - `importShare({ id, choices })` — receiver-driven. Pure
 *     server-side validation today; the actual hydration into the
 *     receiver's local game state happens client-side via the
 *     `ShareImportModal` after this returns the chosen subset.
 *
 * Shares with a CUSTOM card pack (one not in the built-in
 * `CARD_SETS` registry) require sign-in on the sender path so the
 * pack's owner is recorded — the receiver can later import the
 * pack into their own account.
 *
 * Server-mints IDs: `cuid2.createId()` is collision-resistant
 * enough (~10^15 ids before a collision is expected) that we can
 * mint shares synchronously without uniqueness retries.
 */
"use server";

import { createId } from "@paralleldrive/cuid2";
import { Duration, Effect } from "effect";
import { PgClient } from "@effect/sql-pg";
import { headers } from "next/headers";
import { auth } from "../auth";
import { SHARE_TTL } from "../shares/constants";
import { withServerAction } from "../withServerAction";

interface CreateShareInput {
    /** Stringified Effect-Schema-encoded `CardSet`, or null. */
    readonly cardPackData: string | null;
    readonly playersData: string | null;
    readonly handSizesData: string | null;
    readonly knownCardsData: string | null;
    readonly suggestionsData: string | null;
    readonly accusationsData: string | null;
    /**
     * `true` when the included card pack is custom (not in
     * `CARD_SETS`). Forces an auth check so we have an `owner_id`
     * to associate the pack with.
     */
    readonly cardPackIsCustom: boolean;
}

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
}

const ERR_SIGN_IN_REQUIRED = "sign_in_required_for_custom_pack_share";
const ERR_SHARE_NOT_FOUND = "share_not_found";

const optionalUserId = async (): Promise<string | null> => {
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
    const ownerId = await optionalUserId();
    // Custom packs require sign-in.
    if (input.cardPackIsCustom && ownerId === null) {
        throw new Error(ERR_SIGN_IN_REQUIRED);
    }
    const id = createId();
    // Pass the TTL as a number of hours and let Postgres compute
    // `NOW() + INTERVAL ... HOUR` so we don't have to pre-format a
    // TIMESTAMPTZ on the client. `Duration.toHours` returns a
    // floating-point number; floor it before binding so the
    // INTERVAL receives a clean integer.
    const ttlHours = Math.floor(Duration.toHours(SHARE_TTL));
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
                    expires_at
                ) VALUES (
                    ${id}, ${ownerId},
                    ${input.cardPackData},
                    ${input.playersData},
                    ${input.handSizesData},
                    ${input.knownCardsData},
                    ${input.suggestionsData},
                    ${input.accusationsData},
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
            }>`
                SELECT id,
                       snapshot_card_pack_data,
                       snapshot_players_data,
                       snapshot_hand_sizes_data,
                       snapshot_known_cards_data,
                       snapshot_suggestions_data,
                       snapshot_accusations_data
                FROM shares
                WHERE id = ${input.id}
                  AND (expires_at IS NULL OR expires_at > NOW())
                LIMIT 1
            `;
            const row = rows[0];
            if (!row) {
                throw new Error(ERR_SHARE_NOT_FOUND);
            }
            return {
                id: row.id,
                cardPackData: row.snapshot_card_pack_data,
                playersData: row.snapshot_players_data,
                handSizesData: row.snapshot_hand_sizes_data,
                knownCardsData: row.snapshot_known_cards_data,
                suggestionsData: row.snapshot_suggestions_data,
                accusationsData: row.snapshot_accusations_data,
            };
        }),
    );
}
