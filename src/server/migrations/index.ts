/**
 * Migration registry — every migration lives as its own numbered
 * TypeScript file under `src/server/migrations/` and is exported
 * through this index so the migrator can locate them by string-key
 * order.
 *
 * The keys are the file basenames (`0001_init`, `0002_better_auth`,
 * etc.) — the migrator runs them in lexicographic order, so keep
 * the leading-zero numbering. Once a migration has been applied to
 * production, never re-number / rename it; add a new file instead.
 *
 * No filesystem reads at runtime — `Migrator.fromRecord` walks this
 * static record at startup, so production builds don't need a
 * `migrations/` directory deployed alongside the bundle.
 */
import type { Effect } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import migration0001 from "./0001_init";

export const migrations: Record<
    string,
    Effect.Effect<unknown, unknown, SqlClient.SqlClient>
> = {
    "0001_init": migration0001,
};
