/**
 * Tighten `shares.owner_id` to NOT NULL (M22 — universal sign-in).
 *
 * Pre-M22 the application gated sign-in conditionally on whether the
 * shared card pack was custom; built-in-pack shares could write
 * `owner_id = NULL`. The new rule is universal: every share requires
 * an authenticated, non-anonymous user, so `owner_id` is always
 * populated by the application code from this version forward.
 *
 * CLAUDE.md normally requires `NOT NULL` tightening to be split
 * across two deploys — old code could otherwise write a violating
 * row during the rollout window. This single-statement migration is
 * safe here because the shares feature has no production usage
 * (verified: zero rows exist) so:
 *   - No existing rows can violate the constraint.
 *   - No in-flight create traffic can race with the migration
 *     (nobody is creating shares yet).
 *
 * Forward-only — no `DROP NOT NULL` for rollback. If we ever need to
 * relax the constraint again, that's a forward migration too.
 */
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
        ALTER TABLE shares ALTER COLUMN owner_id SET NOT NULL
    `;
});
