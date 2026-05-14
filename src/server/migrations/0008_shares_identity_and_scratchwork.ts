/**
 * Add four nullable snapshot columns to the `shares` table for the
 * identity + personal-scratchwork wire fields.
 *
 *   - `snapshot_self_player_id_data`         — `transfer` only
 *     ("which player I am").
 *   - `snapshot_first_dealt_player_id_data`  — `invite` AND `transfer`
 *     (publicly known game state).
 *   - `snapshot_dismissed_insights_data`     — `transfer` only
 *     (behavioral-insight dismissals).
 *   - `snapshot_hypothesis_order_data`       — `transfer` only
 *     (most-recent-first ordering of the hypothesis panel).
 *
 * Forward-only additive migration (CLAUDE.md migration rules):
 *   - All four columns are nullable, no default — pre-migration rows
 *     naturally have NULL, which the receive path already treats as
 *     "use the existing fallback" for each field.
 *   - The application code that READS these columns is deployed in
 *     the same release; old app instances served from cached deploys
 *     never query them, so the additive change is invisible to them.
 *
 * See `docs/shares-and-sync.md` for the per-kind wire-fields table.
 */
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
        ALTER TABLE shares
        ADD COLUMN snapshot_self_player_id_data        TEXT,
        ADD COLUMN snapshot_first_dealt_player_id_data TEXT,
        ADD COLUMN snapshot_dismissed_insights_data    TEXT,
        ADD COLUMN snapshot_hypothesis_order_data      TEXT
    `;
});
