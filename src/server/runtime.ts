/**
 * Singleton `ManagedRuntime` for server actions + API routes.
 *
 * Layers composed:
 *   - `PgClient.layerConfig` — Postgres pool fed by `DATABASE_URL`.
 *   - `MigratorLive` — runs every migration in `migrations/index.ts`
 *     once per fresh database state. The migrator carries an
 *     advisory lock so concurrent cold-starts don't race.
 *   - Node platform layers (`NodeFileSystem`, `NodePath`,
 *     `NodeChildProcessSpawner`) wired in via `Layer.provideMerge`
 *     because `PgMigrator.layer` formally depends on them (for the
 *     `pg_dump` schema-dump capability) even when we don't use it.
 *
 * Why a singleton: every Vercel Function cold-start already owns
 * its own process; building one runtime per process and sharing it
 * across handlers keeps the Pg pool warm between back-to-back
 * actions and avoids re-running the migrator on every request
 * after the first.
 *
 * Server actions don't reach for this directly — they go through
 * the `withServerAction` wrapper so every request gets a fresh
 * scope and standard error / span handling.
 */
import {
    NodeChildProcessSpawner,
    NodeFileSystem,
    NodePath,
} from "@effect/platform-node";
import { PgClient, PgMigrator } from "@effect/sql-pg";
import { Config, Layer, ManagedRuntime } from "effect";
import { Migrator } from "effect/unstable/sql";
import { migrations } from "./migrations";

const PgLive = PgClient.layerConfig({
    url: Config.redacted("DATABASE_URL"),
});

/**
 * Node platform layers. `NodeChildProcessSpawner.layer` itself
 * needs `FileSystem | Path` to materialise — `provideMerge` keeps
 * those outputs visible on the merged layer so `PgMigrator.layer`
 * can read them.
 */
const PlatformNodeLive = NodeChildProcessSpawner.layer.pipe(
    Layer.provideMerge(NodeFileSystem.layer),
    Layer.provideMerge(NodePath.layer),
);

const MigratorLive = PgMigrator.layer({
    loader: Migrator.fromRecord(migrations),
}).pipe(
    Layer.provideMerge(PgLive),
    Layer.provide(PlatformNodeLive),
);

const ServerLayer = Layer.mergeAll(PgLive, MigratorLive);

export const ServerRuntime = ManagedRuntime.make(ServerLayer);
