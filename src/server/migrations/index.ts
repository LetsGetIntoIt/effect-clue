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
import migration0002 from "./0002_better_auth";
import migration0003 from "./0003_card_packs";
import migration0004 from "./0004_shares";
import migration0005 from "./0005_share_expiry_backfill";

export const migrations: Record<
    string,
    Effect.Effect<unknown, unknown, SqlClient.SqlClient>
> = {
    "0001_init": migration0001,
    "0002_better_auth": migration0002,
    "0003_card_packs": migration0003,
    "0004_shares": migration0004,
    "0005_share_expiry_backfill": migration0005,
};
