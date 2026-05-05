/**
 * Add transfer-only hypothesis snapshots to shares.
 *
 * Forward-only and backwards-compatible: nullable column, no reads
 * require it, and older share rows remain valid with NULL.
 */
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
        ALTER TABLE shares
        ADD COLUMN IF NOT EXISTS snapshot_hypotheses_data TEXT
    `;
});
