/**
 * Backfill missing `expires_at` for legacy share rows (M17).
 *
 * Pre-M17 the application code never set `expires_at` on
 * `INSERT INTO shares`, so any row created against an early
 * deployment of M9 has `NULL` and is treated as non-expiring by
 * `getShare`'s filter. From M17 forward every freshly-created
 * share carries `created_at + 24 hours`; this migration brings
 * existing rows in line.
 *
 * Idempotent — re-running is a no-op once every row has a value.
 * Safe to run multiple times during cold-start migration cycles.
 *
 * Adding an index on `expires_at` here keeps the daily cleanup
 * cron's `WHERE expires_at < NOW()` cheap as the table grows.
 */
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
        UPDATE shares
        SET expires_at = created_at + INTERVAL '24 hours'
        WHERE expires_at IS NULL
    `;
    yield* sql`
        CREATE INDEX IF NOT EXISTS shares_expires_at_idx
        ON shares(expires_at)
    `;
});
