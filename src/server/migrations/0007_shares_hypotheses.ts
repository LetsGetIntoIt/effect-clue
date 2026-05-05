/**
 * Add `snapshot_hypotheses_data` to the `shares` table.
 *
 * Hypotheses are per-cell what-if assumptions the user toggles on
 * locally. Only the `transfer` share kind ("move my game to another
 * device" — same user) carries them; `pack` and `invite` shares
 * deliberately omit hypotheses since those flows go to other people
 * and hypotheses are personal scratchwork.
 *
 * Forward-only additive migration (CLAUDE.md migration rules):
 *   - Nullable, no default — old `pack` / `invite` rows naturally
 *     have NULL here.
 *   - The application code that READS the column is deployed in the
 *     same release as this migration. Reading a NULL column from old
 *     `transfer` rows is handled the same way other nullable
 *     snapshot columns are: receiver decodes only when the value is
 *     non-null.
 *   - Old app instances served from cached deploys never query this
 *     column, so the additive change is invisible to them.
 */
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
        ALTER TABLE shares
        ADD COLUMN snapshot_hypotheses_data TEXT
    `;
});
