/**
 * Initial migration — bootstraps the public schema with a `_health`
 * table so the migrator has something to write the first time it
 * runs against an empty database. The `_health` row is also what
 * the `getHealth` server action SELECTs against to prove the
 * end-to-end runtime works (Effect → PgClient → Postgres → Effect).
 *
 * Subsequent milestones add the real tables in their own numbered
 * files: M7 adds better-auth's `user` / `session` / `account` /
 * `verification`, M8 adds `card_packs`, M9 adds `shares`.
 *
 * Migration discipline (codified in CLAUDE.md): forward-only adds.
 * Never drop a column the deployed app code still reads, never
 * rename in-place, never tighten a column to NOT NULL without first
 * deploying a default and a backfill. Breaking changes are a
 * separate migration-only deploy after dependent code has rolled
 * out and stabilised.
 */
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
        CREATE TABLE IF NOT EXISTS _health (
            id          TEXT PRIMARY KEY,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `;
});
