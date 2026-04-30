/**
 * Server-stored shares (M9).
 *
 * Shares have no client-side lifecycle (the sender hits a server
 * action; the server returns the new id), so no
 * `client_generated_id` column is needed. Each snapshot column
 * stores an Effect-Schema-encoded payload of the corresponding
 * domain shape — the sender chooses which sections to include and
 * each toggled-on section writes its column; toggled-off sections
 * stay NULL.
 *
 * `owner_id` is nullable because shares created against an
 * anonymous session may not have an identity. In practice the
 * sender path requires sign-in only when the share includes a
 * custom (non-built-in) card pack — built-in-pack-only shares can
 * have `owner_id IS NULL`. The receiver path is always public and
 * doesn't read `owner_id`.
 *
 * Migration discipline (forward-only adds): see CLAUDE.md.
 */
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
        CREATE TABLE IF NOT EXISTS shares (
            id                          TEXT PRIMARY KEY,
            owner_id                    TEXT REFERENCES "user"(id) ON DELETE SET NULL,
            snapshot_card_pack_data     TEXT,
            snapshot_players_data       TEXT,
            snapshot_hand_sizes_data    TEXT,
            snapshot_known_cards_data   TEXT,
            snapshot_suggestions_data   TEXT,
            snapshot_accusations_data   TEXT,
            created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at                  TIMESTAMPTZ
        )
    `;
    yield* sql`
        CREATE INDEX IF NOT EXISTS shares_owner_id_idx
        ON shares(owner_id)
    `;
});
