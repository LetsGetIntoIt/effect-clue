/**
 * Add a nullable `snapshot_teach_mode_data` column to the `shares`
 * table — the wire field for the per-game teach-me preference on
 * `transfer` shares.
 *
 * Forward-only additive migration (CLAUDE.md migration rules):
 *   - Single nullable TEXT column, no default. Pre-migration rows
 *     naturally have NULL, which the receive path treats as "the
 *     sender wasn't in teach-mode" (consistent with the share
 *     wire-format default of false).
 *   - The application code that READS this column is deployed in the
 *     same release; old app instances served from cached deploys
 *     never query it, so the additive change is invisible to them.
 *
 * `userDeductions` are NOT on the wire — they're personal scratchwork.
 * Receivers of a transfer share inherit the mode but start with empty
 * marks (this is enforced in `useApplyShareSnapshot`, not the schema).
 *
 * See `docs/shares-and-sync.md` for the per-kind wire-fields table.
 */
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
        ALTER TABLE shares
        ADD COLUMN snapshot_teach_mode_data TEXT
    `;
});
